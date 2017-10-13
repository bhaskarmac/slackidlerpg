const redis = require('redis')
const bluebird = require('bluebird')
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

function Storage(host, port) {
  this.redis_client = redis.createClient({
    host: host || process.env.REDIS_HOST || '127.0.0.1',
    port: port || process.env.REDIS_PORT || 6379,
  });

  this.regexChannelId = new RegExp(/:channel_id$/);
  this.regexToken = new RegExp(/:token$/);
  this.regexUser = new RegExp(/:U/); // slack-specific user
  this.regexPlayers = new RegExp(/:players$/);
}

Storage.prototype.get = function get(...keys) {
  const client = this.redis_client.multi();

  keys.forEach(key => {
    if (this._isSet(key)) {
      client.smembers(key);
    } else if (this._isNumber(key) || this._isString(key)) {
      client.get(key);
    }
  });

  return client.execAsync();
}

Storage.prototype.set = function set(key, val) {
  return this.redis_client.set(key, val);
}

Storage.prototype.add = function add(key, val) {
  return this.redis_client.sadd(key, val);
}

Storage.prototype._isNumber = function _isNumber(key) {
  return key === 'last_timestamp'
    || false;
}

Storage.prototype._isString = function _isString(key) {
  return this.regexChannelId.test(key)
    || this.regexToken.test(key)
    || this.regexUser.test(key)
    || false
    ;
}

Storage.prototype._isSet = function _isSet(key) {
  return key === 'teams'
    || this.regexPlayers.test(key)
    || false
    ;
}

module.exports = Storage;