const redis = require('redis')
const bluebird = require('bluebird')
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const Clients = require('./clients');

const redis_client = redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
});

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
  const now = Math.floor(new Date().getTime() / 1000);

  redis_client.getAsync('last_timestamp')
  .then((last_timestamp) => {
    const ago = last_timestamp === null ? 0 : now - last_timestamp;
    redis_client.set('last_timestamp', now);

    console.log(`Running loop at ${now}; last ran ${ago} seconds ago`);
  })
  .finally(() => {
    // schedule next loop
    setTimeout(() => { this.doLoop() }, this.timeout_in_seconds * 1000);
  });


};

module.exports = Idle;