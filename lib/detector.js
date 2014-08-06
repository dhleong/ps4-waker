
var util = require('util')
  , events = require('events')
  , ps4lib = require('./ps4lib');

function Detector() {
    this.alive = true;
}
util.inherits(Detector, events.EventEmitter);

Detector.prototype.detect = function(timeout) {

    var self = this;
    var s = ps4lib.udpSocket();
    this.socket = s;
    s.bind(function() {
        s.setBroadcast(true);

        s.on('message', function(msg, rinfo) {
            var packet = ps4lib.parse(msg);
            self.emit(packet.type.toLowerCase(), packet, rinfo);
        });
        s.on('error', function(err) {
            self.emit('error', err);
        });

        // discover!
        var search;
        search = function() {
            if (!self.alive)
                return;

            s.discover('SRCH');
            self.searchTimer = setTimeout(search, 1000);
        };

        search();
    });

    if (timeout) {
        self.timeoutTimer = setTimeout(this.close.bind(this), timeout);
    }
};

Detector.prototype.close = function() {
    clearTimeout(this.searchTimer);
    clearTimeout(this.timeoutTimer);
    this.emit('close');
    this.alive = false;
    if (this.socket)
        this.socket.close();
};

Detector.findAny = function(timeout, callback) {

    var detector = new Detector();
    detector.once('device', function(device, rinfo) {
        detector.removeAllListeners('close');
        detector.close();
        
        callback(null, device, rinfo);
    });
    detector.on('close', function() {
        callback(new Error("Could not detect any PS4 device"));
    });
    detector.detect(timeout);
};

Detector.find = function(address, timeout, callback) {
    var detector = new Detector();
    detector.on('device', function(device, rinfo) {
        if (rinfo.address == address) {
            detector.removeAllListeners('close');
            detector.close();
            
            callback(null, device, rinfo);
        }
    });
    detector.on('close', function() {
        callback(new Error("Could not detect any PS4 device"));
    });
    detector.detect(timeout);
}

module.exports = Detector;
