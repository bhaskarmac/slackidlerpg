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

const MAX_ITEM_SLOTS = 3;

const randomIntegerInclusive = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const local_event_types = [
  'message',
  'star_added',
  'star_removed',
  'pin_added',
  'pin_removed',
  'reaction_added',
  'reaction_removed',
];

const local_message_event_subtypes = [
  'file_share',
  'message_deleted',
  'message_changed',
  'channel_purpose',
  'channel_topic',
];

const penalty_modifiers = {
  // Talking in channel is the length of the message
  'message': (event) => { return event.event.text.length; },
  // Talking in a thread is half the penalty of a message
  '_thread': (event) => { return Math.ceil(0.5 * event.event.text.length); },
  // Checking the box to broadcast a thread reply to a channel... needs custom stuff. Bleh.
  '_message_from_thread': (event) => { return event.event.message.text.length; },

  // Penalty is the size of the file in megabytes.
  'file_share': (event) => { return Math.ceil(event.event.file.size / (1024 * 1024)); },

  // These are sort of channel-wide events
  'pin_added': (event) => { return 5; },
  'pin_removed': (event) => { return 5; },
  'channel_purpose': (event) => { return 5; },
  'channel_topic': (event) => { return 5; },

  // These are moderately quiet events
  'star_added': (event) => { return 1; },
  'star_removed': (event) => { return 1; },
  'reaction_added': (event) => { return 2; },
  'reaction_removed': (event) => { return 2; },

  // Oh no you don't, you sneaky little jerk.
  'message_deleted': (event) => { return 15; },
  'message_changed': (event) => { return 15; },
};


function Idle(timeout_in_seconds) {
  this.clients = new Clients();
  this.storage = new Storage();
  this.timeout_in_seconds = timeout_in_seconds || 30;

  // crap self if these aren't set, since they're required
  this.client_id = process.env.CLIENT_ID;
  this.client_secret = process.env.CLIENT_SECRET;
  this.redirect = process.env.REDIRECT_URI;
}

Idle.prototype.handleEvent = function handleEvent(event) {
  if (!event || !event.hasOwnProperty('event') || !event.event.hasOwnProperty('type')) {
    // Some sort of broken event.
    winston.error(`Weird event: ${JSON.stringify(event)}`);
    return;
  }

  if (!event.event.hasOwnProperty('user') && event.event.hasOwnProperty('subtype') && event.event.subtype === 'bot_message') {
    // A bot is never a user.
    return;
  }

  const team_id = event.team_id;

  // Things like message changes and thread responses that get broadcast to channel
  // don't belong to a channel, per se, they belong to some item that belongs to a channel
  const event_channel_id = event.event.hasOwnProperty('item')
    ? event.event.item.channel
    : event.event.channel;

  // Ditto for users
  // TODO - this is basically guaranteed to be buggy, this badly needs tests based on the JSON events.
  const player_id = event.event.hasOwnProperty('user')
    ? event.event.user
    : event.event.message.user;

  this.storage.get('teams', `${team_id}:channel_id`, `${team_id}:players`, `${team_id}:${player_id}`)
  .then(([teams, channel_id, players, data]) => {
    const player_data = JSON.parse(data);

    if (!teams.includes(team_id)) {
      // Did this team install idlerpg?
      return;
    }
    if (players === null || !players.includes(player_id)) {
      // Is this a registered player?
      return;
    }

    if (event_channel_id === channel_id) {
      this.handleLocalEvent(event, channel_id, player_data);
    } else {
      this.handleGlobalEvent(event, player_data);
    }
  });
};

Idle.prototype.handleLocalEvent = function handleLocalEvent(event, channel_id, player_data) {
  winston.debug(`Handling local event: ${JSON.stringify(event)}`);

  // Figure out penalty type
  const penalty_type = this.getPenaltyType(event);

  winston.debug(`Penalty type is ${penalty_type} for ${JSON.stringify(event)}`);

  if (!penalty_modifiers.hasOwnProperty(penalty_type)) {
    // Not a penalizable event
    return;
  }

  const penalty_modifier = penalty_modifiers[penalty_type](event);
  const penalty = Math.floor(penalty_modifier * Math.pow(1.14, player_data.level));

  player_data['time_to_level'] = parseInt(player_data['time_to_level']) + penalty;
  player_data['events'][Math.floor(new Date().getTime() / 1000)] = `Penalized by ${penalty} seconds for ${penalty_type}`;

  const message = `User <@${player_data['user_id']}> penalized *${timeUntilLevelupString(penalty)}* for ${penalty_type}. New time to level ${player_data['level']+1}: *${timeUntilLevelupString(player_data['time_to_level'])}*.`;

  this.announce(player_data['team_id'], message);

  // trim player_data events
  const keys = Object.keys(player_data['events']);
  if (keys.length > 10) {
    const oldest_key = Math.min(...keys);
    delete player_data['events'][oldest_key];
  }

  this.storage.set(`${team_id}:${player_id}`, JSON.stringify(player_data));
};

Idle.prototype.handleGlobalEvent = function handleGlobalEvent(event, player_data) {
  // Ignoring global events for now
};

Idle.prototype.getPenaltyType = function getPenaltyType(event) {
  if (event.event.type === 'message'
    && event.event.subtype === 'pin_added') {
    // Special case: Slack sends a message event when a pin is added,
    // in addition to the pin_added event. The user should not be penalized twice.
    return undefined;
  }

  if (event.event.type === 'message'
    && event.event.hasOwnProperty('thread_ts')) {
    // A message in a thread
    return '_thread';
  }

  if (event.event.type === 'message'
    && event.event.hasOwnProperty('message')
    && event.event.message.hasOwnProperty('thread_ts')) {
    // I _think_ this is what Slack does when you reply to a thread,
    // and check the box to post it in the original channel.
    // See thread-participating-and-sending-to-channel-2.json

    // The thread reply itself looks like thread-participating-and-sending-to-channel-1.json,
    // and is handled above.

    // I cannot find anywhere that this is documented.
    // Why don't I see https://api.slack.com/events/message/message_replied anywhere
    // in the responses I'm generating while testing this by hand?
    return '_message_from_thread';
  }

  if (event.event.type === 'message'
    && event.event.hasOwnProperty('subtype')
    && local_message_event_subtypes.includes(event.event.subtype)) {
    return event.event.subtype;
  }

  if (local_event_types.includes(event.event.type)) {
    return event.event.type;
  }

  return undefined;
};

Idle.prototype.handleCommand = function handleCommand(command) {
  winston.debug(`Received command: ${JSON.stringify(command)}`);

  if (command.command === '/idle') {
    return this.handleUserRegistration(command);
  }
  if (command.command === '/idlereset') {
    return this.handleGameReset(command);
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
      this.levelPlayer(player_data);
    }

    this.storage.set(`${team_id}:${player_id}`, JSON.stringify(player_data));
  });
};

Idle.prototype.levelPlayer = function levelPlayer(player_data) {
  player_data['level'] = parseInt(player_data['level']) + 1;
  player_data['time_to_level'] = this.calculateTimeToLevel(parseInt(player_data['level'])+1) + parseInt(player_data['time_to_level']);
  player_data['events'][Math.floor(new Date().getTime() / 1000)] = `Levelled up to ${player_data['level']}!`;

  // Find new item
  const new_item = this.findItem(1.5 * player_data['level']);
  let new_item_message = `\nThey find a new *${this.describeItem(new_item)}*`;
  // Does the user have any empty slots?
  if (player_data['items'].length < MAX_ITEM_SLOTS) {
    player_data['items'].push(new_item);
  } else {
    // Is this item better than user's current items?
    player_data['items'].sort((item1, item2) => { return item1.level - item2.level; });
    if (player_data['items'][0].level < new_item.level) {
      new_item_message = new_item_message + `, and throw out their old *${this.describeItem(player_data['items'][0])}* to make space for it.`;
      player_data['items'][0] = new_item;
    } else {
      new_item_message = new_item_message + `, but it is no better than their current items.`;
    }
  }

  const message = `Player <@${player_data['user_id']}> has levelled up to *level ${player_data['level']}*! *${timeUntilLevelupString(player_data['time_to_level'])}* until the next level.`;
  this.announce(player_data['team_id'], message + ' ' + new_item_message);

  // trim player_data events
  const keys = Object.keys(player_data['events']);
  if (keys.length > 10) {
    const oldest_key = Math.min(...keys);
    delete player_data['events'][oldest_key];
  }
}

Idle.prototype.findItem = function findItem(max_item_level) {
  const adjectives = [
    'Vorpal',
    'Shiny',
    'Rusty',
    'Quiescent',
    'Bloody',
    'Lazy',
    'Illicit',
    '+1',
    'Adjacent',
    'Sterile',
    'Bespoke',
    'Greasy',
    'Erotic',
    ];
  const items = [
    'Sword',
    'Smartphone',
    'Spear',
    'Gun',
    'Horse',
    'Bat',
    'Hammer',
    'Henchman',
    'Novel',
  ];
  const suffixes = [ // don't forget the leading space.
    ' of Doom',
    ' the Destroyer',
    ', Killer of Henchmen',
    ' 2.0',
    'alyzer',
    ' 2000',
  ];

  const level = randomIntegerInclusive(1, max_item_level);
  const adjective = Math.random() > 0.5 ? '' : adjectives[randomIntegerInclusive(0, adjectives.length - 1)];
  const suffix = Math.random() > 0.2 ? '' : suffixes[randomIntegerInclusive(0, suffixes.length - 1)];
  const name = items[randomIntegerInclusive(0, items.length - 1)];

  const item = `${adjective} ${name}${suffix}`.replace(/ +/g, ' ').trim();

  return { level, item };
};

Idle.prototype.describeItem = function describeItem(item) {
  return `Level ${item.level} ${item.item}`;
};

Idle.prototype.initPlayer = function initPlayer(team_id, player_id, display_name) {
  const data = {
    "user_id": player_id,
    "display_name": display_name === undefined ? this.getDisplayName(team_id, player_id) : display_name,
    "team_id": team_id,
    "level": 1,
    "time_to_level": this.calculateTimeToLevel(2),
    "events": {},
    "items": [],
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

Idle.prototype.announceRegistration = function announceRegistration(player_data) {
  // announce the level up event in Slack
  const message = `Player <@${player_data['user_id']}> has started playing IdleRPG! Currently at *level ${player_data['level']}*, with ${timeUntilLevelupString(player_data['time_to_level'])} until the next level.`;
  this.announce(player_data['team_id'], message);
}

Idle.prototype.announceReset = function announceReset(team_id, players) {
  const message = `The game has been reset - ${players.length} players idled.`;
  this.announce(team_id, message);
};

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

Idle.prototype.handleGameReset = function handleGameReset(command) {
  return new Promise((resolve, reject) => {
    const user_id = command.user_id;
    const team_id = command.team_id;
    const team_domain = command.team_domain;
    this.storage.get('teams', `${team_id}:token`, `${team_id}:players`)
    .then(([teams, token, players]) => {
      // Did this team install idlerpg?
      if (!teams.includes(team_id)) {
        const message = `Team ${team_id} (${team_domain}) has not installed IdleRPG.`;
        winston.error(message);
        return resolve(message);
      }

      // verify that user is an admin
      const slack_client = this.clients.client(token);
      slack_client.users.info(user_id, (err, res) => {
        if (err) {
          const message = `Error fetching info for user ${user_id}: ${JSON.stringify(err)}`;
          winston.error(message);
          resolve(message);
        } else if (!res.ok) {
          const message = `Bad response fetching info for user ${user_id}: ${JSON.stringify(res)}`;
          winston.error(message);
          resolve(message);
        } else if (res.user.is_admin === false) {
          // maybe comment in the channel and tell everyone to boo this man
          const message = `Only admins are allowed to reset IdleRPG for team ${team_id}.`;
          winston.error(message);
          resolve(message);
        } else {
          const message = `Resetting game for team ${team_id}`;
          winston.debug(message);
          resolve(message);
          this.resetGame(team_id);
        }
      });
    });
  });
};

Idle.prototype.resetGame = function resetGame(team_id) {
  this.storage.get('teams', `${team_id}:token`, `${team_id}:players`)
    .then(([teams, token, players]) => {
      // Did this team install idlerpg?
      if (!teams.includes(team_id)) {
        winston.error(`Attempted to reset idleRPG for ${team_id}, which is not registered.`);
        return;
      }

      for (player_id of players) {
        winston.debug(`Deleting data for ${team_id}:${player_id}`);
        this.storage.remove(`${team_id}:${player_id}`);
        // Message player directly?
      }

      winston.debug(`Clearing player data for ${team_id}`);
      this.storage.remove(`${team_id}:players`);

      // Announce highest level achieved, total time spent idling, highest penalty? Something fancy.
      this.announceReset(team_id, players);
  });
};

Idle.prototype.handlePenalty = function handlePenalty(event) {
};

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