
var crypto = require('crypto')
  , os = require('os')

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
    if (this.buf.length < 4) return;
    return this.readInt(0);
};

Packet.prototype.type = function() {
    if (this.buf.length < 8) return;
    return this.readInt(4);
};

Packet.prototype.slice = function(start, end) {
    return this.buf.slice(start, end);
};

Packet.prototype.write = function(string, paddedLength, encoding) {
    var hasPadding = paddedLength !== undefined;

    if (string instanceof Buffer) {
        var end = string.length;
        if (end > paddedLength) {
            end = paddedLength;
        }

        string.copy(this.buf, this._index, 0, end);
        this._index += string.length;
        return this;
    }

    if (hasPadding && string.length > paddedLength) {
        string = string.substring(0, paddedLength);
    }

    let written;
    if (encoding) {
        written = this.buf.write(string, this._index, encoding);
    } else {
        written = this.buf.write(string, this._index);
    }
    this._index += written;

    if (hasPadding) {

        // 1 byte at a time is inefficient, but simple
        var padding = paddedLength - written;
        while (padding > 0) {
            this.buf.writeUInt8(0, this._index++);
            --padding;
        }
    }
    return this;
};

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

Packet.prototype.readString = function(index, length) {
    let end = (length === undefined)
        ? this.length()
        : index + length;
    return this.buf.toString('UTF-16LE', index, end);
};

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
    if (!this._cipher) throw new Error("Cipher is not initialized!");

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
    if (!this._decipher) throw new Error("Decipher is not initialized!");

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
class PacketFactory {

    constructor(debug) {
        this.reset();
        this._debug = debug;
    }

    create(lengthOrBuffer) {
        var packet = new Packet(lengthOrBuffer);
        packet._cipher = this.cipher;
        packet._decipher = this.decipher;
        packet._debug = this._debug;
        return packet;
    }

    parse(buffer) {
        // TODO make sure we read the whole packet?
        // var len = buffer.readInt32LE(0);
        // var packet = new Packet(len);
        // packet.write(buffer.slice(4));
        var packet = this.create(buffer);
        packet._index = 8; // first data byte

        if (this.decipher) {
            // I don't know why, but I have to update it first
            //  before decrypted() will work....
            // NB: This doesn't seem to be *quite* right, but it
            //  works for now
            this.decipher.update(buffer.slice(0, 16));
            packet = packet.decrypted();
        }

        return packet;
    }

    /**
     * To be called on disconnect, for example. Resets
     *  internal state---specifically any crypto
     *  that was set by setCryptoIV
     */
    reset() {
        this.cipher = null;
        this.decipher = null;
    }

    setCryptoIV(initVector) {
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

    newByePacket() {
        return this.create(8)
            .writeInt(4); // packet type
    }

    newCHelloPacket() {
        return this.create(28)
            .writeInt(0x6f636370) // packet type
            .writeInt(VERSION)
            .writeInt(0);
    }

    newHandshakePacket(shello) {

        var seed = shello.slice(20, 36);
        this.setCryptoIV(seed);

        // encrypt our "random key" with the public key
        var publicKey = ps4lib.createPublicKey();
        var key = publicKey.encrypt(Packet.randomSeed);
        if (key.length !== 256) {
            throw new Error("Key is wrong size (was " + key.length + ")");
        }
        if (seed.length > 16) {
            throw new Error("Seed is wrong size (was " + seed.length + ")");
        }

        return this.create(280)
            .writeInt(32)
            .write(key)
            .write(seed);
    }

    newLoginPacket(args) {
        var config = Object.assign({
            osVersion: "4.4"
            , model: DEFAULT_MODEL_NAME
            , appLabel: "PlayStation"
            , pinCode: ""
        }, args);

        if (args.modelAppendHostname) {
            config.model += ' ' + os.hostname();
        }

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

    /**
     * Build a packet for setting the current value of the OSK.
     * Takes an opts map that's confusing at best, and basically
     * pointless at worst:
     *
     * {
     *    // seem to be a hint to the UI to indicate what text
     *    // is "currently being edited," which currently means
     *    // this span will be visually underlined. Useful if
     *    // you're creating an interactive keyboard, I guess
     *    preEditIndex: <int>,
     *    preEditLength: <int>,
     *
     *    // not sure what the practical use of this is. It seems
     *    // to initially indicate what part of the original text
     *    // was replaced, but the result of this packet is that
     *    // ALL the text is replaced by `string`, no matter what
     *    // values are passed in here. So... 0,0 is fine?
     *    editIndex: <int>,
     *    editLength: <int>,
     *
     *    // where to put the caret within `string`
     *    caretIndex: <int>
     * }
     */
    newOskChangeStringPacket(opts, string) {
        opts = Object.assign({
            preEditIndex: 0,
            preEditLength: 0,

            editIndex: 0,  // where text was replaced
            editLength: 0, // how much text was replaced
            caretIndex: -1,
        }, opts);
        if (opts.caretIndex === -1) {
            opts.caretIndex = opts.editIndex + opts.editLength;
        }

        // handle utf16 length. to keep things simple we
        // just toss it into a Buffer which will know the
        // exact length in bytes. It's probably just 2*chars,
        // but we'll have to convert it to bytes anyway...
        let stringBuf = new Buffer(string, 'UTF-16LE');
        let stringLen = stringBuf.length;

        return this.create(28 + stringLen)
            .writeInt(14) // packet type
            .writeInt(opts.preEditIndex)
            .writeInt(opts.preEditLength)
            .writeInt(opts.caretIndex)
            .writeInt(opts.editIndex)
            .writeInt(opts.editLength)
            .write(stringBuf);
    }

    newOskStartPacket() {
        return this.create(8)
            .writeInt(12); // packet type
    }

    newOskControlPacket(command) {
        let original = command;
        let commands = {
            'close': 1,
            'return': 0,
        };
        if (typeof(comand) !== 'number') {
            command = commands[command];
        }

        if (command === undefined) {
            throw new Error("Invalid OSK Control command: " + original);
        }

        return this.create(12)
            .writeInt(16) // packet type
            .writeInt(command);
    }

    newStatusPacket(status) {
        return this.create(12)
            .writeInt(20) // packet type
            .writeInt(status || 0);
    }

    newBootRequestPacket(titleId) {
        return this.create(8 + 16)
            .writeInt(10) // packet type
            .write(titleId, 16);
    }

    /** For educational purposes; prefer newBootRequestPacket */
    newBootRequest2Packet(titleId) {
        var i = 0; // first param "obstruction dialog id"
        var j = 0; // second param "option" (always 0)
        return this.create(92 + 16)
            .writeInt(36) // packet type
            .writeInt(i)
            .write("", 12) // "reserved 1"
            .write("", 64) // "reserved 2"
            .writeInt(j)
            .write(titleId, 16);
    }

    newRemoteControlPacket(op, holdTime) {
        holdTime = holdTime || 0;
        return this.create(16)
            .writeInt(28) // packet type
            .writeInt(op)
            .writeInt(holdTime);
    }
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
    OPEN_RC: 1024
};

module.exports = PacketFactory;
