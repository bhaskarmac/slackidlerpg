const redis = require('redis')
const bluebird = require('bluebird')
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const Clients = require('./clients');


function Idle(timeout_in_seconds) {
  this.clients = new Clients();
  this.timeout_in_seconds = timeout_in_seconds || 10;
}

Idle.prototype.handleEvent = function handleEvent(event) {
  console.log(`Received event: ${JSON.stringify(event)}`);
};

Idle.prototype.handleCommand = function handleCommand(command) {
  console.log(`Received command: ${JSON.stringify(command)}`);
};

Idle.prototype.start = function start() {
  console.log("Starting idle loop");
  const that = this;
  this.doLoop(that);
};

Idle.prototype.doLoop = function doLoop(that) {
  console.log(`Running loop at ${new Date().getTime()}`);
  setTimeout(() => { this.doLoop() }, this.timeout_in_seconds * 1000);
};

module.exports = Idle;