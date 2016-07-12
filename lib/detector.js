
var util = require('util')
  , events = require('events')
  , ps4lib = require('./ps4lib');

function Detector() {
    this.alive = true;
}
util.inherits(Detector, events.EventEmitter);

/**
 * Begin detecting devices. detectOpts is optional,
 *  and may be any one of:
 *  - omitted/<null>: will continue detecting "forever,"
 *      on the default network interface, until #close()
 *  - <int>: A number will be used as a `timeout` in
 *      milliseconds (for backwards compatibility)
 *      on the default network interface, for `timeout`
 *      seconds
 *  - <Object>: An options map, all of whose keys are
 *      optional. Valid keys:
 *      - `timeout`: As above; if omitted, will continue
 *          detecting "forever" as above
 *      - `bindAddress`: Address on which to bind the local
 *          udp detection socket, in case of multiple interfaces.
 *          If omitted, will bind on the default interface.
 *          See dgram.Socket.bind() option `address`
 */
Detector.prototype.detect = function(detectOpts) {

    var self = this;
    var s = ps4lib.udpSocket();
    this.socket = s;

    if (!detectOpts || typeof(detectOpts) === 'number') {
        detectOpts = {
            timeout: detectOpts
        };
    } else if (detectOpts && typeof(detectOpts) !== 'object') {
        // not undefined, not a number, and not an object.
        // barf all over the input
        throw new Error("Illegal value for detectOpts: " + detectOpts);
    }

    // NB: The docs say that if `port` "is not specified," the OS 
    //  will pick one, but through trial and examining the source,
    //  you *do* need to provide "some" argument, else the address
    //  is just ignored. Providing {address: bindAddress} also seems
    //  to work, but the docs claim that `port` is REQUIRED in that
    //  form, and I don't want to explode if that's enforced later
    s.bind(undefined, detectOpts.bindAddress, function() {
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

    if (typeof(detectOpts.timeout) == 'number') {
        self.timeoutTimer = setTimeout(this.close.bind(this), detectOpts.timeout);
    }
};

Detector.prototype.close = function() {
    clearTimeout(this.searchTimer);
    clearTimeout(this.timeoutTimer);
    this.emit('close');
    this.alive = false;
    if (this.socket) {
        this.socket.close();
    }
};

/**
 * Find a single device for whome filterFn returns
 *  `true`
 *
 * @param filterFn (device, rinfo) => Bool
 */
Detector.findWhen = function(filterFn, detectOpts, callback) {
    if (!callback) throw new Error('`callback` is required');

    var detector = new Detector();
    detector.on('device', function(device, rinfo) {
        if (filterFn(device, rinfo)) {
            detector.removeAllListeners('close');
            detector.close();
            
            callback(null, device, rinfo);
        }
    });
    detector.on('close', function() {
        callback(new Error("Could not detect any PS4 device"));
    });
    detector.detect(detectOpts);
}

Detector.findAny = function(detectOpts, callback) {
    return Detector.findWhen(function() {
        return true;
    }, detectOpts, callback);
};

Detector.find = function(address, detectOpts, callback) {
    return Detector.findWhen(function(detected, rinfo) {
        return rinfo.address == address;
    }, detectOpts, callback);
}

module.exports = Detector;
