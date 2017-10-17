const assert = require('assert'); 
const Idle = require('../src/idle'); 
const timeUntilLevelupString = require('../src/TimeUtil'); 
 
describe("calculate time to level", () => { 
  it("initial level up time is 5 minutes", () => { 
    assert.equal(Idle.prototype.calculateTimeToLevel(1), 300); 
  }) 
  it("second level up time is slightly more than 5 minutes", () => { 
    assert.equal(Idle.prototype.calculateTimeToLevel(2), 300 * 1.16); 
  }) 
});