
var util = require('util')
  , events = require('events')
  , fs = require('fs')
  , exec = require('child_process').exec
  , arp = require('node-arp')
  , spoof = require('spoof')
  
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
    fs.readFile(this.credentials, function(err, buf) {
        if (err && self.listeners('need-credentials')) {
            self.emit('need-credentials');
            return;
        } else if (err) {
            // no listeners? just hop to it
            self.requestCredentials(self._doWake.bind(self, device, callback));
            return;
        }

        var creds = JSON.parse(buf.toString());
        self.sendWake(device, creds, callback);
    });
};

Waker.prototype.requestCredentials = function(callback) {
    var self = this;
    var dummy = new Dummy();
    dummy.setStandby();
    dummy.once('wakeup', function(packet, rinfo) {

        var creds = CRED_KEYS.reduce(function(data, key) {
            data[key] = packet[key];
            return data;
        }, {});

        arp.getMAC(rinfo.address, function(err, mac) {
            if (err) return callback(err);

            creds.deviceMac = mac;
            fs.writeFile(self.credentials, JSON.stringify(creds), function(err) {
                if (err) return callback(err);

                callback(null, creds);
            });
        });

        dummy.close();
    });
    dummy.once('error', function(err) {
        callback(err);
    });
    dummy.listen();
}

Waker.prototype.sendWake = function(device, creds, callback) {
    var appMac = creds.deviceMac;
    delete creds.deviceMac;

    // make sure to use standard port
    device.port = ps4lib.DDP_PORT;

    var wifi = spoof.findInterface('Wi-Fi');
    if (!wifi)
        return callback(new Error("Could not find Wi-Fi interface"));

    var oldMac = wifi.currentAddress || wifi.address;
    if (!oldMac)
        return callback(new Error("SAFETY: Couldn't resolve existing MAC addr"));

    ensureMac(wifi.device, appMac, wifi.port, function(err) {
        if (err) return callback(err);

        // send the wake command
        var udp = ps4lib.udpSocket();
        udp.bind(function() {
            udp.setBroadcast(true); // maybe?

            udp.discover("WAKEUP", creds, device);

            // TODO actually try to detect it?
            setTimeout(function() {
                udp.close();

                // spoof.setInterfaceMAC(wifi.device, oldMac, wifi.port);
                ensureMac(wifi.device, oldMac, wifi.port, callback);

            }, 1000);
        });

    });
}

function getAirportNetwork(deviceName, callback) {
    
    exec('networksetup -getairportnetwork ' + deviceName, function(err, stdout) {
        if (err) return callback(err);

        if (!~stdout.indexOf('Current'))
            return callback(null, null);

        callback(null, stdout.substr(stdout.indexOf(': ') + 2).trim());
    });
}

function powerCycleAirport(deviceName, callback) {
    var cmd = 'networksetup -setairportpower ' + deviceName + ' ';
    exec(cmd + 'off', function() {
        exec(cmd + 'on', function() {
            setTimeout(callback, 8000);
        });
    });
}

/**
 * Spoof is great, but (at least on my machine) it doesn't
 *  get airport to properly reconnect to the network,
 *  so... let's make sure that happens
 */
function ensureMac(deviceName, mac, port, callback) {
    if (spoof.getInterfaceMAC(deviceName) == mac) 
        return callback();

    if (process.getuid && process.getuid()) {
        callback(new Error("You must be ROOT to spoof the device's MAC address"));
        return;
    }

    try {
        spoof.setInterfaceMAC(deviceName, mac, port);
    } catch (e) {
        return callback(e);
    }

    if (process.platform == 'darwin') {

        var cycle = function() {
            getAirportNetwork(deviceName, function(err, network) {
                // console.log("Got network", err, network);
                if (err) return callback(err);
                if (network) return callback();

                // network not up yet!
                // console.log("No network yet!");
                powerCycleAirport(deviceName, cycle);
            });
        };

        cycle();

        // } else {  // others?
    }
}

module.exports = Waker;
