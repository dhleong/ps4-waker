
var util = require('util')
  , events = require('events')
  , fs = require('fs')
  
  , Detector = require('./lib/detector')
  , Dummy = require('./lib/dummy')
  , ps4lib = require('./lib/ps4lib')
  
  , DEFAULT_TIMEOUT = 5000
  , CRED_KEYS = ['client-type', 'auth-type', 'user-credential'];

function Waker(credentials) {
    this.credentials = credentials;
}
util.inherits(Waker, events.EventEmitter);

Waker.prototype.wake = function(timeout, device, callback) {
    if (!callback) {
        callback = device;
        device = undefined;

        if (!callback)
            timeout = DEFAULT_TIMEOUT;
    }

    if (device)
        return this._doWake(device, callback);

    // get the first device we can find
    var self = this;
    Detector.findAny(timeout, function(err, device, rinfo) {
        if (err) return callback(err);

        if (device.status != 'Standby')
            return callback(new Error(device['host-name'] + ' is already awake!'));

        var address = {
            address: rinfo.address
          , port: device['host-request-port']
        }
        self._doWake(address, callback);
    });
};

Waker.prototype._doWake = function(device, callback) {

    var self = this;
    this.readCredentials(function(err, creds) {
        if (err && self.listeners('need-credentials')) {
            self.emit('need-credentials', device);
            return;
        } else if (err) {
            // no listeners? just hop to it
            self.requestCredentials(self._doWake.bind(self, device, callback));
            return;
        }

        self.sendWake(device, creds, callback);
    });
};

Waker.prototype.readCredentials = function(callback) {
    
    fs.readFile(this.credentials, function(err, buf) {
        if (err) return callback(err);
        
        callback(null, JSON.parse(buf.toString()));
    });
};


Waker.prototype.requestCredentials = function(callback) {
    var self = this;
    var dummy = new Dummy();
    dummy.setStandby();
    dummy.once('wakeup', function(packet) {

        var creds = CRED_KEYS.reduce(function(data, key) {
            data[key] = packet[key];
            return data;
        }, {});

        fs.writeFile(self.credentials, JSON.stringify(creds), function(err) {
            if (err) return callback(err);

            callback(null, creds);
        });

        dummy.close();
    });
    dummy.once('error', function(err) {
        callback(err);
    });
    dummy.listen();
}

Waker.prototype.sendWake = function(device, creds, callback) {

    // make sure to use standard port
    device.port = ps4lib.DDP_PORT;

    // send the wake command
    var udp = ps4lib.udpSocket();
    udp.bind(function() {
        udp.setBroadcast(true); // maybe?

        udp.discover("WAKEUP", creds, device);

        // TODO actually try to detect it?
        setTimeout(function() {
            udp.close();
            
            callback(null);
        }, 1000);
    });
}

module.exports = Waker;
module.exports.Detector = Detector;
module.exports.Socket = require('./lib/ps4socket');
