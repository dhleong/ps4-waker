
var util = require('util')
  , events = require('events')
  , fs = require('fs')
  
  , Detector = require('./lib/detector')
  , Dummy = require('./lib/dummy')
  , ps4lib = require('./lib/ps4lib')
  , newSocket = require('./lib/ps4socket')
  
  , DEFAULT_TIMEOUT = 5000
  , WAIT_FOR_WAKE = 15000
  , MAX_RETRIES = 5
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

    if (device) {
        return this._doWake(device, callback);
    }

    // get the first device we can find
    var self = this;
    Detector.findAny(timeout, function(err, device, rinfo) {
        if (err) return callback(err);

        device.address = rinfo.address;
        device.port = device['host-request-port']
        self._doWake(device, callback);
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

        // we have credentials!
        if (device.status != 'Standby') {
            return callback(new Error(device['host-name'] 
                    + ' is already awake! ('
                    + device.status
                    + ')'
            ));
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
    var self = this;
    this.udp = ps4lib.udpSocket();
    this.udp.bind(function() {
        self.udp.setBroadcast(true); // maybe?

        self.udp.discover("WAKEUP", creds, device);
        self._whenAwake(device, 
            WAIT_FOR_WAKE,
            self._login.bind(self, device, creds, callback));
    });
}

Waker.prototype._whenAwake = function(device, timeout, callback) {
    this.emit('device-notified', device);

    var statusCheckDelay = 1000;
    var start = new Date().getTime();
    var self = this;
    var loop = function(err, d) {
        if (d.statusLine != ps4lib.STATUS_AWAKE) {
            var now = new Date().getTime();
            var delta = now - start;
            var newTimeout = timeout - delta - statusCheckDelay;
            if (newTimeout > 0) {
                setTimeout(function() {
                    Detector.find(device.address, newTimeout, loop);
                }, statusCheckDelay);
            } else {
                self.udp.close();
                callback(new Error("Device didn't wake in time"));
            }
            return;
        }

        self.udp.close();
        callback(null);
    }

    // begin the loop
    loop(null, {});
}

// NB: weird arg order due to binding
Waker.prototype._login = function(device, creds, callback, err) {
    if (err) return callback(err);

    this.emit('logging-in', device);
    var socket = newSocket({
        accountId: creds['user-credential']
      , host: device.address
      , pinCode: '' // assume we're registered...?
    });
    socket.retries = 0;
    socket.on('login_result', function(packet) {
        if (packet.result !== 0) {
            console.error("Login error:", packet.error);
        }
        this.close();
        callback(null);
    }).on('error', function(err) {
        if (socket.retries++ < MAX_RETRIES && err.code == 'ECONNREFUSED') {
            console.warn("Login connect refused; retrying soon");
            setTimeout(function() {
                // try again; system may just not be up yet
                socket.connect(device.address);
            }, 1000);
            return;
        }

        console.error("Error logging in:", err);
        callback(null); // technically, wake was successful
    });
}

module.exports = Waker;
module.exports.Detector = Detector;
module.exports.Socket = newSocket;
