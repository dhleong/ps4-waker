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

var util = require('util')
  , events = require('events')
  , net = require('net')

  , ps4lib = require('./ps4lib')
  , PacketFactory = require('./packets.js')

  , DEFAULT_PORT = 997
  , DEFAULT_LOGIN_TIMEOUT = 5000

  , LOGIN_RETRY_DELAY = 2000
  ;

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
    this.config = Object.assign({
        modelAppendHostname: true
      , autoLogin: true
    }, config);

    this.packets = new PacketFactory(this.config.debug);
    this.loggedIn = false;

    this.log = this.config.debug ? console.log.bind(console) : function(){};
    if (this.config.host)
        this.connect(this.config.host, this.config.port);
}
util.inherits(Ps4Socket, events.EventEmitter);

Ps4Socket.prototype.connect = function(host, port) {
    if (this.client)
        throw new Error("Socket is already connected");

    var creds = {'user-credential': this.config.accountId};
    var device = {address: host};

    var self = this;
    var udp = ps4lib.udpSocket();
    udp.bind(function() {
        // send some packets to make sure
        //  the PS4 is willing to accept our
        //  TCP connection
        udp.discover("WAKEUP", creds, device)
        .then(function() {
            return udp.discover("LAUNCH", creds, device);
        })
        .then(function() {
            // slight delay to give it a chance to respond
            setTimeout(function() {
                self._connect(host, port);
                udp.close();
            }, 500);
        });
    });

};

Ps4Socket.prototype._connect = function(host, port) {

    if (!port)
        port = DEFAULT_PORT;

    var self = this;
    this.client = net.connect({host: host, port: port}, function() { 
        //'connect' listener
        self.log('client connected');
        self.emit('connected', self);

        self.send(self.packets.newCHelloPacket());
    });

    this.client.on('data', this.receiveData.bind(this));

    this.client.on('error', function(err) {
        // the docs say error is followed by `close`,
        //  but an error handler might want to do something.
        self.client = null;

        // pass it forward
        self.log('error', err);
        self.emit('error', err);
    });
    this.client.on('close', function() {
        // no longer connected, so remove the crypto
        self.packets.reset();
        self.log('client disconnected');
        self.client = null;
        self.loggedIn = false;
        self.emit('disconnected', self);
    });

    return this;
};

Ps4Socket.prototype.close = function() {
    // cleanup and disconnect;
    // sometimes the device still has more to say before it
    // sends the FIN-ACK, but we will have already disposed
    // of our socket reference and so will just cause errors
    // if we try to respond to it. So, let's just shove our
    // fingers in our ears.
    this.client.removeAllListeners('data');
    this.client.removeAllListeners('error');
    this.client.removeAllListeners('close');

    // say goodbye before we go
    this.client.end(
        this.packets.newByePacket()
            .encrypted()
            .buf
    );

    this.client = null;
    this.emit('disconnected', this);
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
 *      pinCode: // the (optional) pincode
 *    , timeout: // milliseconds after which to give up
 *    , retries: // number of times to retry on timeout
 *   }
 * @param callback Optional; if provided, will be
 *  called when we get the login_result event
 */
Ps4Socket.prototype.login = function(pinCodeOrConfig, callback) {

    if (this.loggedIn) {
        // perhaps our timeout was too aggressive
        if (callback) callback(null);
        return;
    }

    var config = pinCodeOrConfig || {};
    if (typeof(config) === 'string' || typeof(config) === 'number') {
        config = {pinCode: config};
    }

    if (!callback && typeof(config) === 'function') {
        callback = config;
        config = {};
    }

    config = Object.assign({
        pinCode: ''
      , timeout: DEFAULT_LOGIN_TIMEOUT
      , retries: 3
    }, config);

    if (callback) {
        this.log("Login w/ config", config);
        var self = this;
        var loginTimeout;
        var onLoginResult = function(result) {
            // CAUTION: Using `this` in this enclosure, will give a wrong scope.
            this.log("Login result", result);
            clearTimeout(loginTimeout);

            if (result.error) return callback(new Error(result.error));
            if (result.error_code) return callback(new Error("ERR: " + result.error_code));

            callback(null);
        };

        loginTimeout = setTimeout(function() {
            self.log("Login timed out; " + config.retries + " retries remaining");
            self.removeListener('login_result', onLoginResult);

            if (--config.retries > 0) {
                // try again after a short delay
                self.log("Retry login in " + LOGIN_RETRY_DELAY);
                self.emit('login_retry', self);
                setTimeout(self.login.bind(self, config, callback), LOGIN_RETRY_DELAY);
                return;
            }

            self.emit('login_result', {error_code: -1, error: "Timeout"});
            callback(new Error("Timeout logging in"));
        }, config.timeout);

        this.once('login_result', onLoginResult);
    }

    this.log("Sending registration:", config.pinCode);
    this.packets.newLoginPacket({
        accountId: this.config.accountId
      , pinCode: config.pinCode
      , modelAppendHostname: this.config.modelAppendHostname
    })
    .encrypted().send(this);

};

Ps4Socket.prototype.requestStandby = function(callback) {
    this.log("Requesting standby");
    this.packets.create(8)
        .writeInt(26)
        .encrypted().send(this);

    if (callback) {
        this.once('standby_result', function(result) {
            // presumably it's the same as the rest
            if (result.status) {
                var error = new Error("Unable to go standby:" + result.status);
                error.status = result.status;
                return callback(error);
            }

            callback();
        });
    }
};

Ps4Socket.prototype.receiveData = function(data) {
    var packet = this.packets.parse(data);
    this.log("<<", data, '\n====>(' + packet.type() + ')', packet.buf);
    this.emit('packet', packet);

    var type = packet.type();
    if (KnownPackets[type]) {
        KnownPackets[type].call(this, packet);
    }
};

/** Convenience method */
Ps4Socket.prototype.send = function(packet) {
    if (!this.client) throw new Error("This socket is not connected");

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
    this.log("Starting OSK");
    this.packets.newOskStartPacket()
        .encrypted()
        .send(this);

    if (callback) {
        this.once('start_osk_result', packet => {
            if (packet.status) {
                callback(new Error(
                    "Unable to start OSK: Error code "
                        + packet.status
                ));
            } else {
                callback(null, packet);
            }
        });
    }
};

Ps4Socket.prototype.startTitle = function(titleId, callback) {
    this.log("Starting title", titleId);
    this.packets.newBootRequestPacket(titleId)
        .encrypted()
        .send(this);

    if (callback) {
        this.once('start_title_result', function(packet) {
            if (packet.status) {
                callback(new Error("Error " + packet.status
                        + " starting " + titleId));
            } else {
                callback();
            }
        });
    }
};

/** For educational purposes; prefer startTitle */
Ps4Socket.prototype.startTitle2 = function(titleId) {
    this.log("Starting title", titleId);
    this.packets.newBootRequest2Packet(titleId)
        .encrypted()
        .send(this);
};

Ps4Socket.prototype.remoteControl = function(op, holdTime) {
    this.log("Sending remote control", op, holdTime);
    holdTime = holdTime || 0;
    this.packets.newRemoteControlPacket(op, holdTime)
        .encrypted()
        .send(this);
};

/** In case someone uses packet.send(Ps4Socket) */
Ps4Socket.prototype.write = function(buffer) {
    this.log('>>', buffer.length, buffer);
    this.client.write(buffer);
};



/**
 * Incoming packet handlers.
 *  Called with "this" referencing
 *  the Ps4Socket
 */
var KnownPackets = {

    // SHello
    0x6f636370: function(packet) {
        packet.status = packet.readInt(12);

        if (packet.status !== 0) {
            this.emit('error', new Error("Unknown status code: " + packet.status));
            this.close();
        }

        this.log("Sending handshake");
        this.send(this.packets.newHandshakePacket(packet));

        // emit AFTER sending the handshake, in case
        //  they want to login from this callback
        this.emit('shello', packet);

        if (this.config.autoLogin) {
            // go ahead and attempt to login now
            var self = this;
            this.login(this.config.pinCode, function(result) {
                self.log("Auto-Login result:", result);
            });
        } else {
            this.emit('ready', this);
        }
    },

    // "invalid"
    0: function(packet) {
        this.emit('invalid', packet);
    },

    // wait_login_result (emitted as just login_result)
    7: function(packet) {
        var result = packet.result = packet.readInt(8);
        if (result !== 0) {
            packet.error = "LOGIN_FAILED";
            packet.error_code = result;

            var statuses = {
                20: "PASSCODE_IS_NEEDED"
              , 22: "PIN_IS_NEEDED"
            };
            if (statuses[result])
                packet.error = statuses[result];

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

        this.emit('ready', this);
        this.emit('login_result', packet);
    },

    // game boot result
    11: function(packet) {
        packet.status = packet.readInt(8);
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
        packet.preEditIndex = packet.readInt();
        packet.preEditLength = packet.readInt();
        packet.editIndex = packet.readInt();
        packet.editLength = packet.readInt();
        packet.caretLength = packet.readInt();
        packet.string = packet.readString(packet._index);
        this.emit('osk_string_changed', packet);
    },

    // server status
    18: function(packet) {
        packet.status = packet.readInt(8);
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
        this.emit('standby_result', packet);
    },
};

/*
 * Export
 */

module.exports = function(config, callback) {
    var socket = new Ps4Socket(config);

    if (callback) {
        socket.on('error', function(err) {
            callback(err);
        });
        socket.once('ready', function() {
            callback(null, socket);
        });
    }

    return socket;
};

module.exports.RCKeys = PacketFactory.RCKeys;
