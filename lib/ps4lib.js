
var dgram = require('dgram')
  , crypto = require('crypto')
  , ursa = require('ursa')

  , DDP_VERSION = '00020020'
  , DDP_PORT = 987
  
  , CRYPTO_ALGORITHM = "aes-128-cbc"
  
  , PUBLIC_KEY = 
      "-----BEGIN PUBLIC KEY-----\n"
    + "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxfAO/MDk5ovZpp7xlG9J\n"
    + "JKc4Sg4ztAz+BbOt6Gbhub02tF9bryklpTIyzM0v817pwQ3TCoigpxEcWdTykhDL\n"
    + "cGhAbcp6E7Xh8aHEsqgtQ/c+wY1zIl3fU//uddlB1XuipXthDv6emXsyyU/tJWqc\n"
    + "zy9HCJncLJeYo7MJvf2TE9nnlVm1x4flmD0k1zrvb3MONqoZbKb/TQVuVhBv7SM+\n"
    + "U5PSi3diXIx1Nnj4vQ8clRNUJ5X1tT9XfVmKQS1J513XNZ0uYHYRDzQYujpLWucu\n"
    + "ob7v50wCpUm3iKP1fYCixMP6xFm0jPYz1YQaMV35VkYwc40qgk3av0PDS+1G0dCm\n"
    + "swIDAQAB\n"
    + "-----END PUBLIC KEY-----";

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
Packet.setCryptoIV = function(initVector) {
    Packet.cipher = crypto.createCipheriv(CRYPTO_ALGORITHM, 
        Packet.randomSeed, 
        initVector);
    Packet.decipher = crypto.createDecipheriv(CRYPTO_ALGORITHM, 
        Packet.randomSeed, 
        initVector);
}

Packet.parse = function(buffer) {
    // TODO make sure we read the whole packet?
    // var len = buffer.readInt32LE(0);
    // var packet = new Packet(len);
    // packet.write(buffer.slice(4));
    var packet = new Packet(buffer);
    packet._index = 8; // first data byte

    if (Packet.decipher) {
        // I don't know why, but I have to update it first
        //  before decrypted() will work....
        Packet.decipher.update(buffer)
        return packet.decrypted();
    }
    return packet;
}

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
        var end = this.buf.length;
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
    if (!Packet.cipher)
        throw new Error("Cipher is not initialized!");
        
    return new Packet(Packet.cipher.update(this.buf));
};

/**
 * Returns a new Packet whose contents are the
 *  decrypted version of this packet
 */
Packet.prototype.decrypted = function() {
    if (!Packet.decipher)
        throw new Error("Decipher is not initialized!");
        
    return new Packet(Packet.decipher.update(this.buf));
};

Packet.prototype.send = function(socket) {
    socket.write(this.buf);
};


module.exports = {

    DDP_VERSION: DDP_VERSION
  , DDP_PORT: DDP_PORT
  , REQ_PORT: 997

  , STATUS_STANDBY: '620 Server Standby'

  , Packet: Packet

  , parse: function(buffer) {
        // console.log("PARSING", buffer.toString());
        var lines = buffer.toString().split('\n');
        var type = lines[0].indexOf('HTTP') === 0
            ? 'device'
            : lines[0].substr(0, lines[0].indexOf(' '));

        var base = {type: type};
        if (type == 'device') {
            base.statusLine = lines[0].substr('HTTP/1.1 '.length);

            var parts = base.statusLine.split(' ');
            base.statusCode = parts[0];
            base.status = parts.length == 2
                ? parts[1]
                : parts[2];
        }

        return lines.slice(1).reduce(function(data, line) {
            var parts = line.split(':');
            if (parts[1])
                data[parts[0]] = parts[1];
            return data;
        }, base);
    }

  , udpSocket: function() {
        return module.exports.wrap(dgram.createSocket('udp4'));
    }

    /** wrap a dgram socket with fanciness */
  , wrap: function(socket) {
        /**
         * Send a discovery-type packet
         * @param type SRCH/WAKEUP/LAUNCH
         * @param data (optional) Dict of data rows to include
         * @param addr (optional) Addr to send to; if not specified,
         *          broadcast; the socket must have broadcast enabled
         *          for this to work. Format of rinfo from a dgram
         *          (eg: {address:'str', port:int})
         */
        socket.discover = function(type, data, addr) {
            if (!addr) {
                addr = {
                    address:'255.255.255.255' // broadcast!
                  , port: DDP_PORT
                };
            }

            if (!data) {
                data = {};
            } else if (data.port && typeof(data.port) == 'number') {
                addr = data;
                data = {};
            }

            if (type.indexOf('HTTP') !== 0)
                type = type + " * HTTP/1.1";

            var msg = new Buffer(type + "\n" +
                    Object.keys(data).reduce(function(last, key) {
                        return last + key + ':' + data[key] + '\n';
                    }, '') +
                    "device-discovery-protocol-version:" + DDP_VERSION + "\n");
            // console.log("Send", msg.toString(), "to ", addr);
            socket.send(msg, 0, msg.length, addr.port, addr.address);
        }

        return socket;
    }

  , createPublicKey: function() {
        return ursa.createPublicKey(PUBLIC_KEY);
    }
};
