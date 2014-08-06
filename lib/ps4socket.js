/**
 * PS4 TCP communications
 */

var util = require('util')
  , events = require('events')
  , net = require('net')
  , ps4util = require('./util')
  , Packet = ps4util.Packet

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
 *  TODO
 */
function Ps4Socket(config) {
    this.config = config;
    this.publicKey = ps4util.createPublicKey();

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
};

Ps4Socket.prototype.receiveData = function(data) {
    this.log("<<", data);
    var packet = Packet.parse(data);
    this.emit('packet', packet);
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


/*
 * Export
 */

module.exports = function(config, callback) {
    var socket = new Ps4Socket(config);

    if (callback) {
        socket.on('err', function(err) {
            callback(err);
        });
        socket.on('ready', function() {
            callback(null, socket);
        });
    }

    return socket;
}
