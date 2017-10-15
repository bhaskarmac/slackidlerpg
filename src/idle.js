const winston = require('winston');
const SlackWebClient = require('@slack/client').WebClient;

const Clients = require('./clients');
const Storage = require('./storage-redis');
const timeUntilLevelupString = require('./TimeUtil');

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
  this.storage = new Storage();
  this.timeout_in_seconds = timeout_in_seconds || 10;

  // crap self if these aren't set, since they're required
  this.client_id = process.env.CLIENT_ID;
  this.client_secret = process.env.CLIENT_SECRET;
  this.redirect = process.env.REDIRECT_URI;
}

Idle.prototype.handleEvent = function handleEvent(event) {
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

  this.findChannels()
  .then(() => {
    winston.info(`Updated channels, starting main idle loop`);
    this.doLoop();
  });
};

Idle.prototype.findChannels = function findChannels() {
  return this.storage.get('teams')
  .then(([teams]) => {
    return Promise.all(teams.map(team => {
      return this.findChannelForTeam(team);
    }));
  });
};

// TODO - handle pagination at some point, see https://api.slack.com/methods/channels.list
// TODO - there's a Promise-based version of the slack client
Idle.prototype.findChannelForTeam = function findChannelForTeam(team_id) {
  return new Promise( (resolve, reject) => {
    this.storage.get(`${team_id}:token`)
    .then(([token]) => {
      const opts = {
        exclude_archived: true,
        exclude_members: true,
      };
      this.clients.client(token).channels.list(opts, (err, res) => {
        if (err) {
          winston.error(`Error getting channels for team ${team_id}: ${JSON.stringify(err)}`);
        } else if (res.ok === false) {
          winston.error(`Unhappy response getting channels for team ${team_id}: ${JSON.stringify(res)}`);
        } else {
          const channel = res.channels.find((channel) => { return channel.name === "idlerpg"; });
          if (channel === undefined) {
            winston.error(`#idlerpg not found for team ${team_id}`);
          } else {
            winston.info(`Updating #idlerpg channel for ${team_id} to ${channel.id}`);
            this.storage.set(`${team_id}:channel_id`, channel.id);
          }
        }
        resolve();
      });
    });
  });
};

Idle.prototype.doLoop = function doLoop() {
  const now = Math.floor(new Date().getTime() / 1000);

  this.storage.get('last_timestamp', 'teams')
    .then(([last_timestamp, teams]) => {
      const ago = (last_timestamp === null) ? 0 : (now - parseInt(last_timestamp));
      this.storage.set('last_timestamp', now);

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
  this.storage.get(`${team_id}:token`, `${team_id}:channel_id`, `${team_id}:players`)
  .then(([token, channel_id, players]) => {
    if (channel_id === null) {
      winston.error(`No channel ID was found for ${team_id}; skipping.`);
      return;
    }
    for (player_id of players) {
      this.handlePlayer(ago, team_id, channel_id, player_id);
    }
  });
};

Idle.prototype.handlePlayer = function handlePlayer(ago, team_id, channel_id, player_id) {
  this.storage.get(`${team_id}:${player_id}`)
  .then(([data]) => {
    const player_data = (data === null)
      ? this.initPlayer(team_id, player_id)
      : JSON.parse(data);

    const { events, ...debug_data } = player_data;
    winston.debug(`Processing player ${player_id} on team ${team_id}: ${JSON.stringify(debug_data)}`);

    player_data['time_to_level'] = parseInt(player_data['time_to_level']) - ago;

    if (player_data['time_to_level'] <= 0) {
      player_data['level'] = parseInt(player_data['level']) + 1;
      player_data['time_to_level'] = this.calculateTimeToLevel(parseInt(player_data['level'])+1) + parseInt(player_data['time_to_level']);
      player_data['events'][Math.floor(new Date().getTime() / 1000)] = `Levelled up to ${player_data['level']}!`;

      this.announceLevel(player_data);

      // trim player_data events
      const keys = Object.keys(player_data['events']);
      if (keys.length > 10) {
        const oldest_key = Math.min(...keys);
        delete player_data['events'][oldest_key];
      }
    }

    this.storage.set(`${team_id}:${player_id}`, JSON.stringify(player_data));
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

  this.storage.set(`${team_id}:${player_id}`, JSON.stringify(data));
  this.storage.add(`${team_id}:players`, player_id);

  return data;
};

Idle.prototype.calculateTimeToLevel = function calculateTimeToLevel(level) {
  // #idlerpg
  return Math.floor(600 * Math.pow(1.16, level-1));
};

Idle.prototype.announceLevel = function announceLevel(player_data) {
  // announce the level up event in Slack
  const message = `Player <@${player_data['user_id']}> has levelled up to *level ${player_data['level']}*! ${timeUntilLevelupString(player_data['time_to_level'])} until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announceRegistration = function announceRegistration(player_data) {
  // announce the level up event in Slack
  const message = `Player <@${player_data['user_id']}> has started playing IdleRPG! Currently at *level ${player_data['level']}*, with ${timeUntilLevelupString(player_data['time_to_level'])} until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announcePenalty = function announcePenalty(event, penalty, player_data) {
  // announce the penalty event in Slack
  const message = `Player <@${player_data['user_id']}> has been penalized by *${penalty} seconds* for *${event}* - must now wait ${timeUntilLevelupString(player_data['time_to_level'])} until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announce = function announce(team_id, message) {
  this.storage.get(`${team_id}:token`, `${team_id}:channel_id`)
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
    this.storage.get('teams', `${command.team_id}:channel_id`, `${command.team_id}:players`, `${command.team_id}:${command.user_id}`)
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
        const message = `You are currently level ${player_data['level']} and have ${timeUntilLevelupString(player_data['time_to_level'])} left until you level up.`;
        winston.info(message);
        return resolve(message);
      } else if (players === null || !players.includes(command.user_id)) {
        // Register this player!
        player_data = this.initPlayer(command.team_id, command.user_id, command.user_name);
        const message = `Welcome to IdleRPG! You are now level ${player_data['level']}, and have ${timeUntilLevelupString(player_data['time_to_level'])} until you level up.`;
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
  const player_id = event.event.user;
  const team_id = event.team_id;
  const event_channel_id = event.event.channel;

  this.storage.get('teams', `${team_id}:channel_id`, `${team_id}:players`, `${team_id}:${player_id}`)
  .then(([teams, channel_id, players, data]) => {
    if (!teams.includes(team_id)) {
      // Did this team install idlerpg?
      return;
    }
    if (event_channel_id !== channel_id) {
      // Did this take place in #idlerpg?
      return;
    }
    if (players === null || !players.includes(player_id)) {
      // Is this a registered player?
      return;
    }

    winston.debug(`Handling message event: ${JSON.stringify(event)}`);

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

    this.storage.set(`${team_id}:${player_id}`, JSON.stringify(player_data));

  });
};

Idle.prototype.calculatePenalty = function calculatePenalty(type, player_data) {
  // TODO - implement
  winston.debug(`Hardcoding a 10 second penalty ${type} for ${JSON.stringify(player_data)}`);
  return 10;
}

Idle.prototype.getDisplayName = function getDisplayName(team_id, user_id) {
  winston.warn("getDisplayName is unimplemented"); // TODO implement
  return "Unknown Username";
}

// TODO - clean this up, extract this out, everything here is gross
// shouldn't log the access tokens, either
Idle.prototype.authorize = function authorize(code) {
  return new Promise((resolve ,reject) => {
    var client = new SlackWebClient();
    client.oauth.access(this.client_id, this.client_secret, code, this.redirect_uri, (err, res) => {
      if (err) {
        const message = `OAuth error: ${JSON.stringify(err)}`;
        winston.error(message);
        resolve(message);
      } else if (!res.ok) {
        const message = `Bad OAuth response: ${JSON.stringify(res)}`;
        winston.error(message);
        resolve(message);
      } else {
        winston.debug(`OAuth response: ${JSON.stringify(res)}`);
        this.storage.set(`${res.team_id}:token`, res.access_token);
        this.storage.add('teams', res.team_id);
        resolve('You must create a channel named #idlerpg in order for this app to work.');
      }
    });
  });
};

module.exports = Idle;