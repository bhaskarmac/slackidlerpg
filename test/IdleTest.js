const assert = require('assert'); 
const Idle = require('../src/idle'); 
const timeUntilLevelupString = require('../src/TimeUtil'); 
 
describe("calculate time to level", () => { 
  it("initial level up time is 5 minutes", () => { 
    assert.equal(Idle.prototype.calculateTimeToLevel(1), 300); 
    assert.equal(timeUntilLevelupString(300), "5 minutes, 0 seconds"); 
  }) 
  it("second level up time is slightly more than 5 minutes", () => { 
    assert.equal(Idle.prototype.calculateTimeToLevel(2), 300 * 1.16); 
    assert.equal(timeUntilLevelupString(300 * 1.16), "5 minutes, 48 seconds"); 
  }) 
});