const util = require('util');
const { EventEmitter } = require('events');

const ps4lib = require('./ps4lib');

/** Built in always handlers */
const HANDLERS = {
    /** Respond to search requests */
    srch(packet, rinfo) {
        this.udp.discover(`HTTP/1.1 ${this.options.status}`, {
            'host-id': this.options['host-id'],
            'host-type': 'PS4',
            'host-name': this.options['host-name'],
            'host-request-port': ps4lib.REQ_PORT,
        }, rinfo);
    },
};

function Dummy(options) {
    this.options = {
        'host-id': '1234567890AB',
        'host-name': 'PS4-Waker',
        status: ps4lib.STATUS_STANDBY,

        ...options,
    };
    this.receivedWake = false;
    this.alive = true;
}
util.inherits(Dummy, EventEmitter);

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
        this.emit('error', new Error('Root permissions required to start PS4 Dummy'));
        return;
    }

    const self = this;
    const s = ps4lib.udpSocket();
    this.udp = s;
    this.udp.bind(ps4lib.DDP_PORT, () => {
        s.setBroadcast(true);

        s.on('message', (msg, rinfo) => {
            const packet = ps4lib.parse(msg);

            const eventType = packet.type.toLowerCase();
            if (eventType in HANDLERS) {
                HANDLERS[eventType].call(self, packet, rinfo);
            }

            self.emit(eventType, packet, rinfo);
        });
        s.on('error', (err) => {
            self.emit('error', err);
        });

        // ready and waiting...
        self.emit('ready');
    });
};

module.exports = Dummy;
