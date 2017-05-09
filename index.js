var Detector = require('./dist/detector')
  , Device = require('./dist/device')
  , Waker = require('./dist/waker')
  , newSocket = require('./dist/ps4socket');

// legacy:
module.exports = Waker;

module.exports.Detector = Detector;
module.exports.Device = Device;
module.exports.Socket = newSocket;
module.exports.Waker = Waker;
