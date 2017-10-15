const assert = require('assert');
const timeUntilLevelupString = require('../src/TimeUtil');

describe("test seconds to hours/minutes/seconds", () => {  
  assert.equal(timeUntilLevelupString(15711), "4 hours, 21 minutes, 51 seconds");

  it("leaving out hours and minutes when they are 0", () => {
    assert.equal(timeUntilLevelupString(125), "2 minutes, 5 seconds", "Shouldn't contain hours");
    assert.equal(timeUntilLevelupString(7202), "2 hours, 0 minutes, 2 seconds", "Should contain 0 minutes if there are hours")
    assert.equal(timeUntilLevelupString(45), "45 seconds", "Shouldn't contain hours or minutes");
  });

  it("tense correct with 1 hour/minute/second", () => {
    assert.equal(timeUntilLevelupString(4911), "1 hour, 21 minutes, 51 seconds", "Hours should be singular tense");
    assert.equal(timeUntilLevelupString(14511), "4 hours, 1 minute, 51 seconds", "Minutes should be singular tense");
    assert.equal(timeUntilLevelupString(15661), "4 hours, 21 minutes, 1 second", "Seconds should be singular tense");
    assert.equal(timeUntilLevelupString(3711), "1 hour, 1 minute, 51 seconds", "Hours/Minutes should be singular tense");
    assert.equal(timeUntilLevelupString(4861), "1 hour, 21 minutes, 1 second", "Hours/Seconds should be singular tense");
    assert.equal(timeUntilLevelupString(14461), "4 hours, 1 minute, 1 second", "Minutes/Seconds should be singular tense");
    assert.equal(timeUntilLevelupString(3661), "1 hour, 1 minute, 1 second", "All should be singular tense");
  });
    
  it("tense and leaving out hours and minutes at the same time", ()=> {
    assert.equal(timeUntilLevelupString(65), "1 minute, 5 seconds", "Minutes should be singular tense");
    assert.equal(timeUntilLevelupString(121), "2 minutes, 1 second", "Seconds should be singular tense");
    assert.equal(timeUntilLevelupString(61), "1 minute, 1 second", "Minutes/Seconds should be singular tense");
    assert.equal(timeUntilLevelupString(3605), "1 hour, 0 minutes, 5 seconds", "Hours should be singular tense")
    assert.equal(timeUntilLevelupString(7201), "2 hours, 0 minutes, 1 second", "Seconds should be singular tense")
    assert.equal(timeUntilLevelupString(3601), "1 hour, 0 minutes, 1 second", "Hours/Seconds should be singular tense")
    assert.equal(timeUntilLevelupString(1), "1 second", "Seconds should be singular tense");
  });
});