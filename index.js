var Detector = require('./lib/detector')
  , Device = require('./lib/device')
  , Waker = require('./lib/waker')
  , newSocket = require('./lib/ps4socket');

// legacy:
module.exports = Waker;

module.exports.Detector = Detector;
module.exports.Device = Device;
module.exports.Socket = newSocket;
module.exports.Waker = Waker;
