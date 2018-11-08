/**
 * PS4 TCP communications
 *
 * example usage:
 *  require('ps4socket')({accountId: id, host:address}, function(socket) {
 *      socket.on('status', ...);
 *      socket.send(...);
 *  });
 *
 * registration process, for example:
 *  var socket = require('ps4socket')({accountId: id});
 *  socket.connect(
 *  socket.on('login_result', function(packet) {
 *      if (packet.result === 0) {
 *          console.log("success!");
 *      } else if (packet.error == "PIN_IS_NEEDED") {
 *          console.log("input pin code");
 *          var pin = // ...
 *          socket.register(pin);
 *      }
 *  });
 */

const util = require('util');
const events = require('events');
const net = require('net');

const debug = require('debug')('ps4:socket');

const ps4lib = require('./ps4lib');
const PacketFactory = require('./packets.js');
const { delayMillis } = require('./util');

const DEFAULT_PORT = 997;
const DEFAULT_LOGIN_TIMEOUT = 5000;
const LOGIN_RETRY_DELAY = 2000;

let KnownPackets;

/**
 * Ps4Socket constructor
 *
 * Events:
 *  connected: Connected to the PS4
 *  ready: This socket is ready to be used.
 *          If you provide a callback to the factory, it
 *          will be fired after this event occurs. By default,
 *          this will be fired after login, but if autoLogin
 *          is `false`, it will be called after the handshake
 *          is completed
 *  packet: Raw Packets. Probably better to wait for
 *          specific events
 *  disconnected: Connection with PS4 lost
 *  error: Of course
 *
 * Parsed packet events:
 *  login_result: Immediately after "ready" on successful login,
 *      this will have a "result" field that should be 0 on success.
 *      On failure, will also have a string "error" field indicating
 *      the meaning of the result code.
 *  status: Emitted periodically with an int "status" field. It is unknown
 *      what this field means, but may simply be a heartbeat
 *  start_osk_result: Emitted in response to startOsk.
 *  start_title_result: Emitted in response to startTitle. Has an int
 *      "status" field.
 *  standby_result: Emitted in response to requestStandby. Has an int
 *      "status" field.
 *
 * Low level packets:
 *  shello: Server's HELLO packet, as part of the handshake. Has
 *      "status" field which should normally be 0; a non-zero
 *      value means an error, and that the connection will be
 *      closed and the error emitted. If you disable autoLogin,
 *      this is a good opportunity to manually login.
 *
 * @param config TODO
 */
function Ps4Socket(config) {
    this.config = {
        modelAppendHostname: true,
        autoLogin: true,

        ...config,
    };

    this.packets = new PacketFactory();
    this.loggedIn = false;
    this._loginResult = null;

    // eslint-disable-next-line
    if (this.config.host) {
        this.connect(this.config.host, this.config.port);
    }
}
util.inherits(Ps4Socket, events.EventEmitter);

Ps4Socket.prototype.connect = function(host, port) {
    if (this.client) throw new Error('Socket is already connected');

    const creds = { 'user-credential': this.config.accountId };
    const device = { address: host };

    const udp = ps4lib.udpSocket();
    udp.bind(async () => {
        // send some packets to make sure
        //  the PS4 is willing to accept our
        //  TCP connection
        await udp.discover('WAKEUP', creds, device);
        await udp.discover('LAUNCH', creds, device);

        // slight delay to give it a chance to respond
        await delayMillis(500);

        // finally, actually attempt to connect
        this._connect(host, port);
        udp.close();
    });
};

// eslint-disable-next-line
Ps4Socket.prototype._connect = function(host, portOpt) {
    const port = portOpt || DEFAULT_PORT;

    this.client = net.connect({ host, port }, () => {
        // 'connect' listener
        debug('client connected');
        this.emit('connected', this);

        this.send(this.packets.newCHelloPacket());
    });

    this.client.on('data', this.receiveData.bind(this));

    this.client.on('error', (err) => {
        // the docs say error is followed by `close`,
        //  but an error handler might want to do something.
        this.client = null;
        this._loginResult = null;

        // pass it forward
        debug('error', err);
        this.emit('error', err);
    });
    this.client.on('close', () => {
        // no longer connected, so remove the crypto
        this.packets.reset();
        this.client = null;
        this.loggedIn = false;
        this._loginResult = null;

        debug('client disconnected');
        this.emit('disconnected', this);
    });

    return this;
};

/**
 * NOTE: the close process is asynchronous in order to be
 * somewhat graceful. Listen for 'disconnected' if you need
 * to know for sure that we're closed.
 */
Ps4Socket.prototype.close = function() {
    debug('close(); sending BYE');
    this.packets.newByePacket()
        .encrypted()
        .send(this);
};

Ps4Socket.prototype.isLoggedIn = function() {
    return this.loggedIn;
};

/**
 * Request login. This is normally called for you;
 *  generally you will want to just listen for
 *  the "ready" event, or even just pass a callback
 *  to the factory method.
 *
 * @param pinCodeOrConfig Optional; if not provided, we
 *  assume you've already logged in/registered with
 *  the PS4 in question. May be a string pinCode,
 *  or a config object:
 *   {
 *      passCode: // the (optional) passcode
 *    , pinCode:  // the (optional) pincode
 *    , timeout:  // milliseconds after which to give up
 *    , retries:  // number of times to retry on timeout
 *   }
 * @param callback Optional; if provided, will be
 *  called when we get the login_result event
 */
Ps4Socket.prototype.login = function(pinCodeOrConfig, callback) {
    let config = pinCodeOrConfig || {};
    if (typeof (config) === 'string' || typeof (config) === 'number') {
        config = { pinCode: config };
    }

    let cb = callback;
    if (!cb && typeof (config) === 'function') {
        cb = config;
        config = {};
    }

    if (this.loggedIn) {
        // perhaps our timeout was too aggressive
        if (cb) cb(null);
        return;
    }

    config = {
        pinCode: '',
        timeout: DEFAULT_LOGIN_TIMEOUT,
        retries: 3,

        ...config,
    };

    if (cb) {
        if (debug.enabled) {
            const debugConfig = { ...config };
            if (config.accountId) {
                debugConfig.accountId = '<redacted>';
            }
            if (config.passCode) {
                debugConfig.passCode = '<redacted>';
            }
            debug('Login w/ config', debugConfig);
        }

        let loginTimeout;
        const onLoginResult = (result) => {
            debug('Login result', result);
            clearTimeout(loginTimeout);

            if (result.error) return cb(new Error(result.error));
            if (result.error_code) return cb(new Error(`ERR: ${result.error_code}`));

            return cb(null);
        };

        loginTimeout = setTimeout(() => {
            debug(`Login timed out; ${config.retries} retries remaining`);
            this.removeListener('login_result', onLoginResult);

            config.retries -= 1;
            if (config.retries > 0) {
                // try again after a short delay
                debug(`Retry login in ${LOGIN_RETRY_DELAY}`);
                this.emit('login_retry', this);
                setTimeout(this.login.bind(this, config, cb), LOGIN_RETRY_DELAY);
                return;
            }

            this.emit('login_result', { error_code: -1, error: 'Timeout' });
            cb(new Error('Timeout logging in'));
        }, config.timeout);

        this.once('login_result', onLoginResult);
    }

    debug('Sending registration:', config.pinCode);
    this.packets.newLoginPacket({
        accountId: this.config.accountId,
        passCode: config.passCode || '',
        pinCode: config.pinCode,
        modelAppendHostname: this.config.modelAppendHostname,
    }).encrypted()
        .send(this);
};

/**
 * It's not entirely clear when this should be used
 */
Ps4Socket.prototype.logout = function(callback) {
    this.packets.newLogoutPacket()
        .encrypted()
        .send(this);

    if (!callback) return;

    let logoutTimeout;
    const onLogoutResult = (result) => {
        clearTimeout(logoutTimeout);

        if (result.status) {
            callback(new Error(`Unable to logout: ${result.status}`));
            return;
        }

        callback(null);
    };

    logoutTimeout = setTimeout(() => {
        debug('Logout timeout');
        this.removeListener('login_result', onLogoutResult);
        callback(new Error('Timeout waiting for logout result'));
    }, 15000);

    this.once('logout_result', onLogoutResult);
};

Ps4Socket.prototype.requestStandby = function(callback) {
    debug('Requesting standby');
    this.packets.create(8)
        .writeInt(26)
        .encrypted().send(this);

    if (callback) {
        this.once('standby_result', (result) => {
            // presumably it's the same as the rest
            if (result.status) {
                const error = new Error(`Unable to go standby:${result.status}`);
                error.status = result.status;
                return callback(error);
            }

            return callback();
        });
    }
};

Ps4Socket.prototype.receiveData = function(data) {
    const packet = this.packets.parse(data);
    debug('<<', data, `\n====>(${packet.type()})`, packet.buf);
    this.emit('packet', packet);

    const type = packet.type();
    if (KnownPackets[type]) {
        KnownPackets[type].call(this, packet);
    } else {
        debug('<<< UNKNOWN PACKET!');
    }
};

/** Convenience method */
Ps4Socket.prototype.send = function(packet) {
    if (!this.client) throw new Error('This socket is not connected');

    packet.send(this.client);
};

Ps4Socket.prototype.changeOskString = function(opts, string) {
    this.packets.newOskChangeStringPacket(opts, string)
        .encrypted()
        .send(this);
};

Ps4Socket.prototype.sendOskCommand = function(command) {
    this.packets.newOskControlPacket(command)
        .encrypted()
        .send(this);
};

Ps4Socket.prototype.startOsk = function(callback) {
    debug('Starting OSK');
    this.packets.newOskStartPacket()
        .encrypted()
        .send(this);

    if (callback) {
        this.once('start_osk_result', (packet) => {
            if (packet.status) {
                callback(new Error(
                    `Unable to start OSK: Error code ${
                        packet.status}`,
                ));
            } else {
                callback(null, packet);
            }
        });
    }
};

Ps4Socket.prototype.startTitle = function(titleId, callback) {
    debug('Starting title', titleId);
    this.packets.newBootRequestPacket(titleId)
        .encrypted()
        .send(this);

    if (callback) {
        this.once('start_title_result', (packet) => {
            if (packet.status) {
                callback(new Error(`Error ${packet.status} starting ${titleId}`));
            } else {
                callback();
            }
        });
    }
};

/** For educational purposes; prefer startTitle */
Ps4Socket.prototype.startTitle2 = function(titleId) {
    debug('Starting title', titleId);
    this.packets.newBootRequest2Packet(titleId)
        .encrypted()
        .send(this);
};

Ps4Socket.prototype.remoteControl = function(op, holdTime) {
    debug('Sending remote control', op, holdTime);
    this.packets.newRemoteControlPacket(op, holdTime)
        .encrypted()
        .send(this);
};

/** In case someone uses packet.send(Ps4Socket) */
Ps4Socket.prototype.write = function(buffer) {
    debug('>>', buffer.length, buffer);
    this.client.write(buffer);
};

/* eslint-disable no-underscore-dangle,object-shorthand */
/**
 * Incoming packet handlers.
 *  Called with "this" referencing
 *  the Ps4Socket
 */
KnownPackets = {

    // SHello
    0x6f636370: function(packet) {
        packet.status = packet.readInt(12);

        if (packet.status !== 0) {
            this.emit('error', new Error(`Unknown status code: ${packet.status}`));
            this.close();
        }

        debug('Sending handshake');
        this.send(this.packets.newHandshakePacket(packet));

        // emit AFTER sending the handshake, in case
        //  they want to login from this callback
        this.emit('shello', packet);

        if (this.config.autoLogin) {
            this.login(this.config, (err) => {
                if (err) debug('Auto-Login error:', err);
                else debug('Auto-Login success!');
            });
        } else {
            this.emit('ready', this);
        }
    },

    // "invalid"
    0: function(packet) {
        debug('<<< INVALID');
        this.emit('invalid', packet);
    },

    // wait_login_result (emitted as just login_result)
    7: function(packet) {
        const result = packet.readInt(8);
        packet.result = result;
        debug('<<< LOGIN_RESULT', result);

        if (result !== 0) {
            packet.error = 'LOGIN_FAILED';
            packet.error_code = result;

            const statuses = {
                20: 'PIN_IS_NEEDED',
                22: 'PASSCODE_IS_NEEDED',
                24: 'PASSCODE_IS_UNMATCHED',
                30: 'LOGIN_MGR_BUSY',
            };
            if (statuses[result]) {
                packet.error = statuses[result];
            }

            // NB we do not emit an error if the login
            //  failed; we simply know that we need to
            //  get a pin code and try again
        }

        if (result === 0) {
            // logged in successfully!
            // provide the server with our status
            this.packets.newStatusPacket(0)
                .encrypted()
                .send(this);

            this.loggedIn = true;
        }

        this._loginResult = packet;
        this.emit('ready', this);
        this.emit('login_result', packet);
    },

    // game boot result
    11: function(packet) {
        packet.status = packet.readInt(8);
        debug('<<< START_TITLE_RESULT', packet.status);
        this.emit('start_title_result', packet);
    },

    // osk start result
    13: function(packet) {
        packet.status = packet.readInt(8);
        packet.oskType = packet.readInt(12);
        // TODO: for some reason, the way we decode it
        //  gives an extra 16 bytes of garbage here. We
        //  should really figure out why that's happening
        //  ... and fix it
        if (packet.buf.length > 36) {
            packet.max = packet.readInt(32);
            packet.initial = packet.readString(36);
        }
        this.emit('start_osk_result', packet);
    },

    // osk string changed
    14: function(packet) {
        packet._index = 8;
        packet.preEditIndex = packet.readInt();
        packet.preEditLength = packet.readInt();
        // TODO: see above about how how we're skipping
        // 16 bytes here for some reason and how hacky
        // this is
        if (packet.buf.length > 36) {
            packet._index += 16;
            packet.editIndex = packet.readInt();
            packet.editLength = packet.readInt();
            packet.caretIndex = packet.readInt();
            packet.string = packet.readString(packet._index);
        }
        this.emit('osk_string_changed', packet);
    },

    // osk command received
    16: function(packet) {
        packet.commandId = packet.readInt();
        packet.command = packet.commandId === 0
            ? 'return'
            : 'close';
        this.emit('osk_command', packet);
    },

    // server status
    18: function(packet) {
        packet.status = packet.readInt(8);
        debug('<<< SERVER_STATUS', packet.status);
        this.emit('status', packet);

        // also we should respond with a status
        //  packet as a heartbeat, to maintain
        //  the connection. Anyone who doesn't
        //  want the connection maintained should
        //  properly close() it, like any other socket
        this.packets.newStatusPacket(0)
            .encrypted()
            .send(this);
    },

    // standbyResult
    27: function(packet) {
        packet.status = packet.readInt(8);
        debug('<<< STANDBY_RESULT', packet.status);
        this.emit('standby_result', packet);
    },

    // logoutResult
    35: function(packet) {
        packet.status = packet.readInt(8);
        debug('<<< LOGOUT_RESULT', packet.status);
        this.emit('logout_result', packet);
    },
};

/*
 * Export
 */

module.exports = function(config, callback) {
    const socket = new Ps4Socket(config);

    if (callback) {
        socket.on('error', (err) => {
            callback(err);
        });
        socket.once('ready', () => {
            callback(null, socket);
        });
    }

    return socket;
};

module.exports.RCKeys = PacketFactory.RCKeys;
