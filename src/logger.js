const winston = require('winston');

winston.level = 'debug';
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
  level: process.env.LOG_LEVEL,
  prettyPrint: true,
  colorize: true,
  silent: false,
  timestamp: false
});

const logger = {
  log: function log(message) {
    winston.log(message);
  },
  warn: function warn(message) {
    winston.warn(message);
  },
  info: function info(message) {
    winston.info(message);
  },
  error: function error(message) {
    winston.error(message);
  },
  debug: function debug(message) {
    winston.debug(message);
  },
}

module.exports = logger;