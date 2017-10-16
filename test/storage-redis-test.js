const proxyquire = require('proxyquire');
const assert = require('assert');
const sinon = require('sinon');

const bluebirdProxy = {
  promisifyAll: () => {},
};

const redisMultiSpy = {
  get: sinon.stub(),
  smembers: sinon.stub(),
  set: sinon.stub(),
  sadd: sinon.stub(),
  execAsync: sinon.stub(),
};

const redisClientProxy = {
  multi: sinon.stub().returns(redisMultiSpy),
  del: sinon.stub(),
};

const redisProxy = {
  createClient: sinon.stub().returns(redisClientProxy),
};

const Storage = proxyquire('../src/storage-redis', {
  'redis': redisProxy,
  'bluebird': bluebirdProxy,
});

const storage = new Storage();

describe('storage-redis', () => {

  beforeEach(() => {
    for(spy in redisMultiSpy) {
      redisMultiSpy[spy].reset();
    }
  });


  describe('correctly retrieves data', () => {
    it('executes multi() call', () => {
      storage.get('something');
      assert.equal(redisClientProxy.multi.called, true, 'multi() call executed');
    });

    it('executes async() call', () => {
      storage.get('something');
      assert.equal(redisMultiSpy.execAsync.called, true, 'execAsync() call executed');
    });

    it('fetches a set correctly', () => {
      storage.get('teams');
      assert.equal(redisMultiSpy.smembers.called, true, 'smembers called for a set');
      assert.equal(redisMultiSpy.get.called, false, 'get not called for a set');
    });

    it('fetches a string correctly', () => {
      storage.get('team:token');
      assert.equal(redisMultiSpy.get.called, true, 'get called for a string');
      assert.equal(redisMultiSpy.smembers.called, false, 'smembers not called for a set');
    });

    it('fetches a number correctly', () => {
      storage.get('last_timestamp');
      assert.equal(redisMultiSpy.get.called, true, 'get called for a number');
      assert.equal(redisMultiSpy.smembers.called, false, 'smembers not called for a set');
    });

    it('fetches multiple types correctly', () => {
      storage.get('teams', 'last_timestamp');
      assert.equal(redisMultiSpy.smembers.called, true, 'smembers called for a set');
      assert.equal(redisMultiSpy.get.called, true, 'get called for a string');
    });
  });

  it('correctly deletes data', () => {
    storage.remove('some-key');
    assert.equal(redisClientProxy.del.called, true, 'del called');
  });

  describe('correctly identifies key types', () => {
    it('last_timestamp is a number', () => {
      const key = 'last_timestamp';
      assert.equal(storage._isNumber(key), true, `${key} is a number`);
      assert.equal(storage._isString(key), false, `${key} is not a string`);
      assert.equal(storage._isSet(key), false, `${key} is not a set`);
    });

    it('team:channel_id is a string', () => {
      const key = 'TEAM:channel_id';
      assert.equal(storage._isNumber(key), false, `${key} is not a number`);
      assert.equal(storage._isString(key), true, `${key} is not a string`);
      assert.equal(storage._isSet(key), false, `${key} is not a set`);
    });

    it('team:token is a string', () => {
      const key = 'TEAM:token';
      assert.equal(storage._isNumber(key), false, `${key} is not a number`);
      assert.equal(storage._isString(key), true, `${key} is a string`);
      assert.equal(storage._isSet(key), false, `${key} is not a set`);
    });

    it('team:user is a string', () => {
      const key = 'TEAM:U000001';
      assert.equal(storage._isNumber(key), false, `${key} is not a number`);
      assert.equal(storage._isString(key), true, `${key} is not a string`);
      assert.equal(storage._isSet(key), false, `${key} is not a set`);
    });

    it('teams is a set', () => {
      const key = 'teams';
      assert.equal(storage._isNumber(key), false, `${key} is not a number`);
      assert.equal(storage._isString(key), false, `${key} is not a string`);
      assert.equal(storage._isSet(key), true, `${key} is a set`);
    });

    it('teams:players is a set', () => {
      const key = 'TEAM:players';
      assert.equal(storage._isNumber(key), false, `${key} is not a number`);
      assert.equal(storage._isString(key), false, `${key} is not a string`);
      assert.equal(storage._isSet(key), true, `${key} is a set`);
    });

  });
});