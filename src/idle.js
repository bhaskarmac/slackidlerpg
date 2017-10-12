const winston = require('winston');
const redis = require('redis')
const bluebird = require('bluebird')
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const Clients = require('./clients');

const redis_client = redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
});

winston.level = 'debug';
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
  level: process.env.LOG_LEVEL,
  prettyPrint: true,
  colorize: true,
  silent: false,
  timestamp: false
});


function Idle(timeout_in_seconds) {
  this.clients = new Clients();
  this.timeout_in_seconds = timeout_in_seconds || 10;
}

Idle.prototype.handleEvent = function handleEvent(event) {
  winston.debug(`Received event: ${JSON.stringify(event)}`);

  if (event.event.type === 'message') {
    this.handleMessageEvent(event);
  }
};

Idle.prototype.handleCommand = function handleCommand(command) {
  winston.debug(`Received command: ${JSON.stringify(command)}`);

  if (command.command === '/idle') {
    return this.handleUserRegistration(command);
  }

  return Promise.resolve(`Received command: ${JSON.stringify(command)}`);
};

Idle.prototype.start = function start() {
  winston.info("Starting idle loop");
  const that = this;
  this.doLoop(that);
};

Idle.prototype.doLoop = function doLoop(that) {
  const now = Math.floor(new Date().getTime() / 1000);

  redis_client.multi()
    .get('last_timestamp')
    .smembers('teams')
    .execAsync()
    .then(([last_timestamp, teams]) => {
      const ago = (last_timestamp === null) ? 0 : (now - parseInt(last_timestamp));
      redis_client.set('last_timestamp', now);

      winston.info(`Running loop at ${now}; last ran ${ago} seconds ago`);

      for(team_id of teams) {
        this.handleTeam(ago, team_id);
      }
    })
    .finally(() => {
      // schedule next loop
      setTimeout(() => { this.doLoop() }, this.timeout_in_seconds * 1000);
    });
};

Idle.prototype.handleTeam = function handleTeam(ago, team_id) {
  redis_client.multi()
    .get(`${team_id}:token`)
    .get(`${team_id}:channel_id`)
    .smembers(`${team_id}:players`)
    .execAsync()
    .then(([token, channel_id, players]) => {
      for (player_id of players) {
        this.handlePlayer(ago, team_id, channel_id, player_id);
      }
    });
};

Idle.prototype.handlePlayer = function handlePlayer(ago, team_id, channel_id, player_id) {
  redis_client.getAsync(`${team_id}:${player_id}`).then((data) => {
    const player_data = (data === null)
      ? this.initPlayer(team_id, player_id)
      : JSON.parse(data);

    winston.debug(`Processing player ${player_id} on team ${team_id}: ${JSON.stringify(player_data)}`);

    player_data['time_to_level'] = parseInt(player_data['time_to_level']) - ago;

    if (player_data['time_to_level'] <= 0) {
      player_data['level'] = parseInt(player_data['level']) + 1;
      player_data['time_to_level'] = this.calculateTimeToLevel(parseInt(player_data['level']) + 1) + parseInt(player_data['time_to_level']);
      player_data['events'][Math.floor(new Date().getTime() / 1000)] = `Levelled up to ${player_data['level']}!`;

      this.announceLevel(player_data);

      // trim player_data events
      const keys = Object.keys(player_data['events']);
      if (keys.length > 10) {
        const oldest_key = Math.min(...keys);
        delete player_data['events'][oldest_key];
      }
    }

    redis_client.set(`${team_id}:${player_id}`, JSON.stringify(player_data));
  });
};

Idle.prototype.initPlayer = function initPlayer(team_id, player_id, display_name) {

  const data = {
    "user_id": player_id,
    "display_name": display_name === undefined ? this.getDisplayName(team_id, player_id) : display_name,
    "team_id": team_id,
    "level": 1,
    "time_to_level": this.calculateTimeToLevel(2),
    "events": {},
    "away": false,
  };

  redis_client.set(`${team_id}:${player_id}`, JSON.stringify(data));
  redis_client.sadd(`${team_id}:players`, player_id);

  return data;
};

Idle.prototype.calculateTimeToLevel = function calculateTimeToLevel(level) {
  // #idlerpg
  return Math.floor(600 * Math.pow(1.16, level));
};

Idle.prototype.announceLevel = function announceLevel(player_data) {
  // announce the level up event in Slack
  const message = `Player *${player_data['display_name']}* has levelled up to *level ${player_data['level']}*! ${player_data['time_to_level']} seconds until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announceRegistration = function announceRegistration(player_data) {
  // announce the level up event in Slack
  const message = `Player *${player_data['display_name']} has started playing IdleRPG! Currently at *level ${player_data['level']}*, with ${player_data['time_to_level']} seconds until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announcePenalty = function announcePenalty(event, penalty, player_data) {
  // announce the penalty event in Slack
  const message = `Player *${player_data['display_name']}* has been penalized by *${penalty} seconds* for *${event}* - must now wait ${player_data['time_to_level']} seconds until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announce = function announce(team_id, message) {
  redis_client
  .multi()
  .get(`${team_id}:token`)
  .get(`${team_id}:channel_id`)
  .execAsync()
  .then(([token, channel_id]) => {
    const slack_client = this.clients.client(token);
    slack_client.chat.postMessage(channel_id, message, (err, res) => {
      if (err) {
        winston.error(`Error sending message to ${team_id}:${channel_id}: ${err}`);
      } else {
        winston.info(`Sent message to ${team_id}:${channel_id}: ${message}`);
      }
    });
  });
}

Idle.prototype.handleUserRegistration = function handleUserRegistration(command) {
  return new Promise((resolve, reject) => {
    redis_client
    .multi()
    .smembers('teams')
    .get(`${command.team_id}:channel`)
    .smembers(`${command.team_id}:players`)
    .get(`${command.team_id}:${command.user_id}`)
    .execAsync()
    .then(([teams, channel, players, data]) => {

      if (!teams.includes(command.team_id)) {
        // Did this team install idlerpg?
        const message = `Team ${command.team_id} (${command.team_domain}) has not installed IdleRPG - cannot register user ${command.user_id} (${command.user_name})`;
        winston.error(message);
        return resolve(message);
      } else if (command.channel_id !== channel) {
        // Is this command being called from within #idlerpg?
        const message = `You must issue the /idle command from the ${channel} channel`; // TODO stupid, they need to know the name. All the more reason to hardcode #idlerpg
        winston.error(message);
        return resolve(message);
      } else if (players !== null && players.includes(command.user_id) && data !== null) {
        // Is this player already registered?
        const player_data = JSON.parse(data);
        const message = `You are currently level ${player_data['level']} and have ${player_data['time_to_level']} seconds left until you level up.`;
        winston.info(message);
        return resolve(message);
      } else if (players === null || !players.includes(command.user_id)) {
        // Register this player!
        player_data = this.initPlayer(command.team_id, command.user_id, command.user_name);
        const message = `Welcome to IdleRPG! You are now level ${player_data['level']}, and have ${player_data['time_to_level']} seconds until you level up.`;
        winston.info(message);
        this.announceRegistration(player_data);
        return resolve(message);
      } else {
        // Uh-poh.
        const message = `Something went wrong during your registration.`;
        winston.error(message);
        return resolve(message);
      }
    });
  });
};

Idle.prototype.handleMessageEvent = function handleMessageEvent(event) {
    redis_client
    .multi()
    .smembers('teams')
    .get(`${event.team_id}:channel`)
    .smembers(`${event.team_id}:players`)
    .get(`${event.team_id}:${event.event.user}`)
    .execAsync()
    .then(([teams, channel, players, data]) => {
      if (!teams.includes(event.team_id)) {
        // Did this team install idlerpg?
        return;
      }
      if (event.event.channel !== channel) {
        // Did this take place in #idlerpg?
        return;
      }
      if (players === null || !players.includes(event.event.user)) {
        // Is this a registered player?
        return;
      }

      // Apply penalty.
      const player_data = (data === null)
        ? this.initPlayer(team_id, player_id)
        : JSON.parse(data);

      const penalty = this.calculatePenalty(event.event.type, player_data);

      player_data['time_to_level'] = parseInt(player_data['time_to_level']) + penalty;
      player_data['events'][Math.floor(new Date().getTime() / 1000)] = `Penalized by ${penalty} seconds for ${event.event.type}`;

      this.announcePenalty(event.event.type, penalty, player_data);

      // trim player_data events
      const keys = Object.keys(player_data['events']);
      if (keys.length > 10) {
        const oldest_key = Math.min(...keys);
        delete player_data['events'][oldest_key];
      }

      redis_client.set(`${team_id}:${player_id}`, JSON.stringify(player_data));

    });
};

Idle.prototype.calculatePenalty = function calculatePenalty(type, player_data) {
  // TODO - implement
  winston.debug(`Hardcoding a 10 second penalty ${type} for ${player_data}`);
  return 10;
}

Idle.prototype.getDisplayName = function getDisplayName(team_id, user_id) {
  winston.warn("getDisplayName is unimplemented"); // TODO implement
  return "Unknown Username";
}

module.exports = Idle;