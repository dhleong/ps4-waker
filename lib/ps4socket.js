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
  , _ = require('underscore')
  , ps4lib = require('./ps4lib')
  , Packet = ps4lib.Packet

  , DEFAULT_PORT = 997

  , VERSION = 0x20000 // maybe?
  ;

/**
 *
 * Events:
 *  connected: Connected to the PS4
 *  ready: Handshake complete; socket is ready to be used.
 *          If you provide a callback to the factory, it
 *          will be fired after this event occurs
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
 *  status: Emitted periodic with an int "status" field. It is unknown
 *      what this field means, but may simply be a heartbeat
 *
 * Low level packets:
 *  shello: Server's HELLO packet, as part of the handshake. Has
 *      "status" field which should normally be 0; a non-zero
 *      value means an error, and that the connection will be
 *      closed and the error emitted
 */
function Ps4Socket(config) {
    this.config = config;

    this.log = config.debug ? console.log.bind(console) : function(){};
    if (config.host)
        this.connect(config.host, config.port);
}
util.inherits(Ps4Socket, events.EventEmitter);

Ps4Socket.prototype.connect = function(host, port) {
    if (this.client)
        throw new Error("Socket is already connected");

    if (!port)
        port = DEFAULT_PORT;

    var self = this;
    this.client = net.connect({host: host, port: port}, function() { 
        //'connect' listener
        self.log('client connected');
        self.emit('connected', self);

        self.send(newCHelloPacket());
    });

    this.client.on('data', this.receiveData.bind(this));

    this.client.on('error', function(err) {
        // pass it forward
        self.log('error', err);
        self.emit('error', err);
    });
    this.client.on('end', function() {
        self.log('client disconnected');
        self.client = null;
        self.emit('disconnected', self);
    });

    return this;
};

Ps4Socket.prototype.close = function() {
    this.client.end();
    this.client = null;
    this.emit('disconnected', this);
};

Ps4Socket.prototype.login = function(pinCode) {
    this.log("Sending registration");
    newLoginPacket({
        accountId: this.config.accountId, 
        pinCode: pinCode
    })
    .encrypted().send(this);
};


Ps4Socket.prototype.receiveData = function(data) {
    this.log("<<", data);
    var packet = Packet.parse(data);
    this.emit('packet', packet);

    var type = packet.type();
    if (KnownPackets[type])
        KnownPackets[type].handle.call(this, type);
};

/** Convenience method */
Ps4Socket.prototype.send = function(packet) {
    if (!this.client)
        throw new Error("This socket is not connected");

    packet.send(this.client);
};

/*
 * Packet factories
 */

function newCHelloPacket() {
    return new Packet(28)
        .writeInt(0x6f636370) // packet type
        .writeInt(VERSION)
        .writeInt(0);
}

function newHandshakePacket(shello) {

    var seed = shello.slice(20, 36)
    Packet.setCryptoIV(seed);

    // encrypt our "random key" with the public key
    var publicKey = ps4lib.createPublicKey();
    var key = publicKey.encrypt(Packet.randomSeed);
    if (key.length != 256)
        throw new Error("Key is wrong size (was " + key.length + ")");
    if (seed.length > 16)
        throw new Error("Seed is wrong size (was " + seed.length + ")");

    return new Packet(280)
        .writeInt(32)
        .write(key)
        .write(seed);
}

function newLoginPacket(args) {
    var config = _.extend({
        osVersion: "4.4"
      , model: "PS4 Waker"
      , appLabel: "PlayStation"
    }, args);

    var pack = new Packet(384);
    pack.writeInt(30); // packet type?

    // pass code (should be 4 bytes of nothing)
    pack.write("", 4);

    // magic number? protocol/app version?
    pack.writeInt(513);

    // write padded strings
    pack.write(config.accountId, 64)
        .write(config.appLabel, 256)
        .write(config.osVersion, 16)
        .write(config.model, 16)
        .write(config.pinCode, 16);

    return pack;
}

/**
 * Incoming packet handlers.
 *  Called with "this" referencing
 *  the Ps4Socket
 */
var KnownPackets = {

    // SHello
    0x6f636370: function(packet) {
        packet.status = packet.readInt(12);
        this.emit('shello', packet);

        if (packet.status !== 0) {
            this.emit('error', new Error("Unknown status code: " + packet.status));
            this.close();
        }

        this.log("Sending handshake");
        this.send(newHandshakePacket(packet));

        // go ahead and attempt to login now
        this.login("");
    }

    // wait_login_result (emitted as just login_result)
  , 7: function(packet) {
        var result = packet.result = packet.readInt(8);
        if (result !== 0) {
            packet.error = "LOGIN_FAILED";

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
            this.emit('ready', this);
        }

        this.emit('login_result', packet);
    }

    // server status?
  , 18: function(packet) {
        packet.status = packet.readInt(8);
        this.emit('status', packet);
    }
}

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
}
