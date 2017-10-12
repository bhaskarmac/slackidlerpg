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
};

Idle.prototype.handleCommand = function handleCommand(command) {
  winston.debug(`Received command: ${JSON.stringify(command)}`);
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

    player_data['time_to_level'] -= ago;

    if (player_data['time_to_level'] <= 0) {
      player_data['level'] += 1;
      player_data['time_to_level'] = this.calculateTimeToLevel(player_data['level'] + 1) - player_data['time_to_level'];
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

Idle.prototype.initPlayer = function initPlayer(team_id, player_id) {
  const data = {
    "user_id": player_id,
    "level": 1,
    "time_to_level": this.calculateTimeToLevel(2),
    "events": {}
  };

  redis_client.set(`${team_id}:${player_id}`, JSON.stringify(data));
  redis_client.sadd(`${team_id}:players`, player_id);

  return data;
};

Idle.prototype.calculateTimeToLevel = function calculateTimeToLevel(level) {
  // #idlerpg
  // return Math.floor(600 * Math.pow(1.16, level));

  // let's be more generous
  return Math.floor(60 * Math.pow(1.16, level));
};

Idle.prototype.announceLevel = function announceLevel(player_data) {
  // announce the level up event in Slack
  // TODO - slack!
  winston.info(`Player ${player_data['user_id']} has levelled up to Level ${player_data['level']}! ${player_data['time_to_level']} seconds until the next level.`);
}

module.exports = Idle;