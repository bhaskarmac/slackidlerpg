function calculateHoursMinutesSeconds(seconds) {
  const hours = Math.floor(seconds / 3600);
  seconds = seconds - hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = seconds - minutes * 60;
  return {
    hours,
    minutes,
    seconds,
  };
}
  
module.exports = function timeUntilLevelupString(seconds) {
  const hms = calculateHoursMinutesSeconds(seconds);
  let msg = "";
  if (hms.hours) {
    if (hms.hours === 1) {
      msg += `${hms.hours} hour, `;
    } else {
      msg += `${hms.hours} hours, `;
    }
  }
  if (hms.minutes || hms.hours) {
    if (hms.minutes === 1) {
      msg += `${hms.minutes} minute, `;      
    } else {
      msg += `${hms.minutes} minutes, `;
    }
  }
  if (hms.seconds === 1) {
    msg += `${hms.seconds} second`;
  } else {
    msg += `${hms.seconds} seconds`;
  }  
  return msg;
}
