
var crypto = require('crypto')
  , os = require('os')

  , _ = require('underscore')
  , ps4lib = require('./ps4lib')

  , CRYPTO_ALGORITHM = "aes-128-cbc"

  , DEFAULT_MODEL_NAME = "PS4 Waker"
  , VERSION = 0x20000 // maybe?

  ;

/**
 * Utility for creating and reading TCP packets
 */
function Packet(length) {
    this._index = 0;
    if (length instanceof Buffer) {
        this.buf = length;
    } else {
        this.buf = new Buffer(length);
        this.buf.fill(0);

        this.writeInt32LE(length);
    }
}

// I don't think true randomness is required
Packet.randomSeed = new Buffer(16);

Packet.prototype.length = function() {
    return this.readInt(0);
};

Packet.prototype.type = function() {
    return this.readInt(4);
};

Packet.prototype.slice = function(start, end) {
    return this.buf.slice(start, end);
};


Packet.prototype.write = function(string, paddedLength) {
    var hasPadding = paddedLength !== undefined;

    if (string instanceof Buffer) {
        var end = string.length;
        if (end > paddedLength)
            end = paddedLength;

        string.copy(this.buf, this._index, 0, end);
        this._index += string.length;
        return this;
    }

    if (hasPadding && string.length > paddedLength) {
        string = string.substring(0, paddedLength);
    }

    this.buf.write(string, this._index);
    this._index += string.length;

    if (hasPadding) {

        // 1 byte at a time is inefficient, but simple
        var padding = paddedLength - string.length;
        while (padding > 0) {
            this.buf.writeUInt8(0, this._index++);
            padding--;
        }
    }
    return this;
}

Packet.prototype.readInt32LE = function(index) {
    var reading = index;
    if (reading === undefined) {
        // auto read
        reading = this._index;
        this._index += 4;
    }

    return this.buf.readInt32LE(reading);
};
// alias
Packet.prototype.readInt = Packet.prototype.readInt32LE;


Packet.prototype.writeInt32LE = function(value) {
    this.buf.writeInt32LE(value, this._index);
    this._index += 4;
    return this;
};

// alias
Packet.prototype.writeInt = Packet.prototype.writeInt32LE;

/**
 * Returns a new Packet whose contents are the
 *  encrypted version of this packet
 */
Packet.prototype.encrypted = function() {
    if (!this._cipher)
        throw new Error("Cipher is not initialized!");

    // pad the input the same way the client app does
    var newLen = 1 + (this.buf.length - 1) / 16 << 4;
    var bytes = new Buffer(newLen);
    this.buf.copy(bytes, 0, 0, this.buf.length);
        
    var encrypted = new Packet(this._cipher.update(bytes));
    encrypted._original = this.buf;
    return encrypted;
};

/**
 * Returns a new Packet whose contents are the
 *  decrypted version of this packet
 */
Packet.prototype.decrypted = function() {
    if (!this._decipher)
        throw new Error("Decipher is not initialized!");
        
    return new Packet(this._decipher.update(this.buf));
};

Packet.prototype.send = function(socket) {
    if (this._debug) {
        console.log(">>>", this._original || this.buf);
    }
    socket.write(this.buf);
};


/**
 * Public interface for manufacturing packets.
 *  Tracks crypto state as necessary
 */
function PacketFactory(debug) {
    this.reset();
    this._debug = debug;
}

PacketFactory.prototype.create = function(lengthOrBuffer) {
    var packet = new Packet(lengthOrBuffer);
    packet._cipher = this.cipher
    packet._decipher = this.decipher
    packet._debug = this._debug;
    return packet;
}

PacketFactory.prototype.parse = function(buffer) {
    // TODO make sure we read the whole packet?
    // var len = buffer.readInt32LE(0);
    // var packet = new Packet(len);
    // packet.write(buffer.slice(4));
    var packet = this.create(buffer);
    packet._index = 8; // first data byte

    if (this.decipher) {
        // I don't know why, but I have to update it first
        //  before decrypted() will work....
        this.decipher.update(buffer)
        return packet.decrypted();
    }
    return packet;
}

/**
 * To be called on disconnect, for example. Resets
 *  internal state---specifically any crypto
 *  that was set by setCryptoIV
 */
PacketFactory.prototype.reset = function() {
    this.cipher = null;
    this.decipher = null;
}

PacketFactory.prototype.setCryptoIV = function(initVector) {
    if (!initVector) {
        this.cipher = null;
        this.decipher = null;
    } else {
        this.cipher = crypto.createCipheriv(CRYPTO_ALGORITHM, 
            Packet.randomSeed, 
            initVector);
        this.decipher = crypto.createDecipheriv(CRYPTO_ALGORITHM, 
            Packet.randomSeed, 
            initVector);
    }
}


/*
 * Packet factories
 */

PacketFactory.prototype.newCHelloPacket = function newCHelloPacket() {
    return this.create(28)
        .writeInt(0x6f636370) // packet type
        .writeInt(VERSION)
        .writeInt(0);
}

PacketFactory.prototype.newHandshakePacket =
    function newHandshakePacket(shello) {

    var seed = shello.slice(20, 36)
    this.setCryptoIV(seed);

    // encrypt our "random key" with the public key
    var publicKey = ps4lib.createPublicKey();
    var key = publicKey.encrypt(Packet.randomSeed);
    if (key.length != 256)
        throw new Error("Key is wrong size (was " + key.length + ")");
    if (seed.length > 16)
        throw new Error("Seed is wrong size (was " + seed.length + ")");

    return this.create(280)
        .writeInt(32)
        .write(key)
        .write(seed);
}

PacketFactory.prototype.newLoginPacket = function newLoginPacket(args) {
    var config = _.extend({
        osVersion: "4.4"
      , model: DEFAULT_MODEL_NAME
      , appLabel: "PlayStation"
      , pinCode: ""
    }, args);

    if (args.modelAppendHostname)
        config.model += ' ' + os.hostname();

    var pack = this.create(384);
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

PacketFactory.prototype.newStatusPacket = function newStatusPacket(status) {
    return this.create(12)
        .writeInt(20) // packet type
        .writeInt(status || 0);
}

PacketFactory.prototype.newBootRequestPacket = function newBootRequestPacket(titleId) {
    return this.create(8 + 16)
        .writeInt(10) // packet type
        .write(titleId, 16);
}

/** For educational purposes; prefer newBootRequestPacket */
PacketFactory.prototype.newBootRequest2Packet = function newBootRequest2Packet(titleId) {
    var i = 0; // first param "obstruction dialog id"
    var j = 0; // second param "option" (always 0)
    return this.create(92 + 16)
        .writeInt(36) // packet type
        .writeInt(i)
        .write("", 12) // "reserved 1"
        .write("", 64) // "reserved 2"
        .writeInt(j)
        .write(titleId, 16)
}

PacketFactory.prototype.newRemoteControlPacket = function newRemoteControlPacket(op, holdTime) {
    holdTime = holdTime || 0;
    return this.create(16)
        .writeInt(28) // packet type
        .writeInt(op)
        .writeInt(holdTime);
}
PacketFactory.RCKeys = {
  UP: 1,
  DOWN: 2,
  RIGHT: 4,
  LEFT: 8,
  ENTER: 16,
  BACK: 32,
  OPTION: 64,
  PS: 128,
  KEY_OFF: 256,
  CANCEL: 512,
  CLOSE_RC: 2048,
  OPEN_RC: 1024,
}

module.exports = PacketFactory;
