const crypto = require('crypto');
const os = require('os');

const debug = require('debug')('ps4:packets');

const ps4lib = require('./ps4lib');

const CRYPTO_ALGORITHM = 'aes-128-cbc';
const DEFAULT_MODEL_NAME = 'PS4 Waker';
const VERSION = 0x20000; // maybe?

const PacketType = {
    BootRequest: 10,
    BootRequest2: 36,
    Bye: 4,
    ClientHello: 0x6f636370,
    Handshake: 32,
    Login: 30,
    Logout: 34,
    OskChangeString: 14,
    OskControl: 16,
    OskStart: 12,
    RemoteControl: 28,
    Status: 20,
};

/**
 * Utility for creating and reading TCP packets
 */
function Packet(length) {
    this._index = 0;
    if (length instanceof Buffer) {
        this.buf = length;
    } else {
        this.buf = Buffer.alloc(length, 0);

        this.writeInt32LE(length);
    }
}

// I don't think true randomness is required
Packet.randomSeed = Buffer.alloc(16);

Packet.prototype.length = function() {
    if (this.buf.length < 4) return 0;
    return this.readInt(0);
};

Packet.prototype.type = function() {
    if (this.buf.length < 8) return -1;
    return this.readInt(4);
};

Packet.prototype.slice = function(start, end) {
    return this.buf.slice(start, end);
};

Packet.prototype.write = function(stringOrBuffer, paddedLength, encoding) {
    const hasPadding = paddedLength !== undefined;

    if (stringOrBuffer instanceof Buffer) {
        let end = stringOrBuffer.length;
        if (end > paddedLength) {
            end = paddedLength;
        }

        stringOrBuffer.copy(this.buf, this._index, 0, end);
        this._index += stringOrBuffer.length;
        return this;
    }

    let string = stringOrBuffer;
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
        let padding = paddedLength - written;
        while (padding > 0) {
            this.buf.writeUInt8(0, this._index);
            this._index += 1;
            padding -= 1;
        }
    }

    return this;
};

Packet.prototype.readInt32LE = function(index) {
    let reading = index;
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
    const end = (length === undefined)
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
    if (!this._cipher) throw new Error('Cipher is not initialized!');

    // pad the input the same way the client app does
    const newLen = 1 + (this.buf.length - 1) / 16 << 4;
    const bytes = Buffer.alloc(newLen);
    this.buf.copy(bytes, 0, 0, this.buf.length);

    const encrypted = new Packet(this._cipher.update(bytes));
    // eslint-disable-next-line
    encrypted._original = this.buf;
    return encrypted;
};

/**
 * Returns a new Packet whose contents are the
 *  decrypted version of this packet
 */
Packet.prototype.decrypted = function() {
    if (!this._decipher) throw new Error('Decipher is not initialized!');

    return new Packet(this._decipher.update(this.buf));
};

Packet.prototype.send = function(socket) {
    debug('>>>', this._original || this.buf);
    socket.write(this.buf);
};

/**
 * Public interface for manufacturing packets.
 *  Tracks crypto state as necessary
 */
class PacketFactory {
    constructor() {
        this.reset();
    }

    /* eslint-disable no-underscore-dangle */
    create(lengthOrBuffer) {
        const packet = new Packet(lengthOrBuffer);
        packet._cipher = this.cipher;
        packet._decipher = this.decipher;
        return packet;
    }

    parse(buffer) {
        // TODO make sure we read the whole packet?
        // const len = buffer.readInt32LE(0);
        // const packet = new Packet(len);
        // packet.write(buffer.slice(4));
        let packet = this.create(buffer);
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
    /* eslint-enable no-underscore-dangle */

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
            .writeInt(PacketType.Bye);
    }

    newCHelloPacket() {
        return this.create(28)
            .writeInt(PacketType.ClientHello)
            .writeInt(VERSION)
            .writeInt(0);
    }

    newHandshakePacket(shello) {
        const seed = shello.slice(20, 36);
        this.setCryptoIV(seed);

        // encrypt our "random key" with the public key
        const publicKey = ps4lib.createPublicKey();
        const key = publicKey.encrypt(Packet.randomSeed);
        if (key.length !== 256) {
            throw new Error(`Key is wrong size (was ${key.length})`);
        }
        if (seed.length > 16) {
            throw new Error(`Seed is wrong size (was ${seed.length})`);
        }

        return this.create(280)
            .writeInt(PacketType.Handshake)
            .write(key)
            .write(seed);
    }

    newLoginPacket(args) {
        const config = {
            osVersion: '4.4',
            model: DEFAULT_MODEL_NAME,
            appLabel: 'PlayStation',
            pinCode: '',
            passCode: '',

            ...args,
        };

        if (args.modelAppendHostname) {
            config.model += ` ${os.hostname()}`;
        }

        const pack = this.create(384);
        pack.writeInt(PacketType.Login);

        // pass code (4-byte user security code)
        pack.write(config.passCode, 4);

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

    newLogoutPacket() {
        return this.create(8)
            .writeInt(PacketType.Logout);
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
        const cmd = {
            preEditIndex: 0,
            preEditLength: 0,

            editIndex: 0, // where text was replaced
            editLength: 0, // how much text was replaced
            caretIndex: -1,

            ...opts,
        };
        if (cmd.caretIndex === -1) {
            cmd.caretIndex = cmd.editIndex + cmd.editLength;
        }

        // handle utf16 length. to keep things simple we
        // just toss it into a Buffer which will know the
        // exact length in bytes. It's probably just 2*chars,
        // but we'll have to convert it to bytes anyway...
        const stringBuf = Buffer.from(string, 'UTF-16LE');
        const stringLen = stringBuf.length;

        return this.create(28 + stringLen)
            .writeInt(PacketType.OskChangeString)
            .writeInt(cmd.preEditIndex)
            .writeInt(cmd.preEditLength)
            .writeInt(cmd.caretIndex)
            .writeInt(cmd.editIndex)
            .writeInt(cmd.editLength)
            .write(stringBuf);
    }

    newOskStartPacket() {
        return this.create(8)
            .writeInt(PacketType.OskStart);
    }

    newOskControlPacket(command) {
        const commands = {
            close: 1,
            return: 0,
        };

        let commandId = command;
        if (typeof comandId !== 'number') {
            commandId = commands[command];
        }

        if (commandId === undefined) {
            throw new Error(`Invalid OSK Control command: ${command}`);
        }

        return this.create(12)
            .writeInt(PacketType.OskControl)
            .writeInt(commandId);
    }

    newStatusPacket(status) {
        return this.create(12)
            .writeInt(PacketType.Status)
            .writeInt(status || 0);
    }

    newBootRequestPacket(titleId) {
        return this.create(8 + 16)
            .writeInt(PacketType.BootRequest)
            .write(titleId, 16);
    }

    /** For educational purposes; prefer newBootRequestPacket */
    newBootRequest2Packet(titleId) {
        const i = 0; // first param "obstruction dialog id"
        const j = 0; // second param "option" (always 0)
        return this.create(92 + 16)
            .writeInt(PacketType.BootRequest2)
            .writeInt(i)
            .write('', 12) // "reserved 1"
            .write('', 64) // "reserved 2"
            .writeInt(j)
            .write(titleId, 16);
    }

    newRemoteControlPacket(op, holdTime) {
        return this.create(16)
            .writeInt(PacketType.RemoteControl)
            .writeInt(op)
            .writeInt(holdTime || 0);
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
    OPEN_RC: 1024,
};

module.exports = PacketFactory;
