
var util = require('util')
  , events = require('events')
  , ps4lib = require('./ps4lib');

/** Built in always handlers */
var HANDLERS = {
    /** Respond to search requests */
    srch: function(packet, rinfo) {
        this.udp.discover('HTTP/1.1 ' + this.options.status, {
            'host-id': this.options['host-id']
          , 'host-type': 'PS4'
          , 'host-name': this.options['host-name']
          , 'host-request-port': ps4lib.REQ_PORT
        }, rinfo);
    }
};

function Dummy(options) {
    if (!options)  {
        options = {
            'host-id': '1234567890AB'
          , 'host-name': 'PS4-Waker'
          , 'status': ps4lib.STATUS_STANDBY
        };
    }

    this.options = options;
    this.receivedWake = false;
    this.alive = true;
}
util.inherits(Dummy, events.EventEmitter);

Dummy.prototype.setStandby = function() {
    this.options.status = ps4lib.STATUS_STANDBY;
};

Dummy.prototype.close = function() {
    this.udp.close();
};

Dummy.prototype.listen = function() {
    // Dummy needs to run on special port 987;
    //  if we're not root, it's impossible....
    //  unless windows? shrug.
    if (process.getuid && process.getuid()) {
        this.emit('error', new Error("Root permissions required to start PS4 Dummy"));
        return;
    }

    var self = this;
    var s = ps4lib.udpSocket();
    this.udp = s;
    this.udp.bind(ps4lib.DDP_PORT, function() {
        s.setBroadcast(true);

        s.on('message', function(msg, rinfo) {
            var packet = ps4lib.parse(msg);

            var eventType = packet.type.toLowerCase();
            if (eventType in HANDLERS) {
                HANDLERS[eventType].call(self, packet, rinfo);
            }

            self.emit(eventType, packet, rinfo);
        });
        s.on('error', function(err) {
            self.emit('error', err);
        });

        // ready and waiting...
        self.emit('ready');
    });
};

module.exports = Dummy;
