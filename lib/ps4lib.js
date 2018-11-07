const dgram = require('dgram');
const NodeRSA = require('node-rsa');

const DDP_VERSION = '00020020';
const DDP_PORT = 987;

const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\n'
    + 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxfAO/MDk5ovZpp7xlG9J\n'
    + 'JKc4Sg4ztAz+BbOt6Gbhub02tF9bryklpTIyzM0v817pwQ3TCoigpxEcWdTykhDL\n'
    + 'cGhAbcp6E7Xh8aHEsqgtQ/c+wY1zIl3fU//uddlB1XuipXthDv6emXsyyU/tJWqc\n'
    + 'zy9HCJncLJeYo7MJvf2TE9nnlVm1x4flmD0k1zrvb3MONqoZbKb/TQVuVhBv7SM+\n'
    + 'U5PSi3diXIx1Nnj4vQ8clRNUJ5X1tT9XfVmKQS1J513XNZ0uYHYRDzQYujpLWucu\n'
    + 'ob7v50wCpUm3iKP1fYCixMP6xFm0jPYz1YQaMV35VkYwc40qgk3av0PDS+1G0dCm\n'
    + 'swIDAQAB\n'
    + '-----END PUBLIC KEY-----';

module.exports = {

    DDP_VERSION,
    DDP_PORT,
    REQ_PORT: 997,

    STATUS_AWAKE: '200 Ok',
    STATUS_STANDBY: '620 Server Standby',

    parse(buffer) {
        const lines = buffer.toString().split('\n');
        const type = lines[0].indexOf('HTTP') === 0
            ? 'device'
            : lines[0].substr(0, lines[0].indexOf(' '));

        const base = { type };
        if (type === 'device') {
            base.statusLine = lines[0].substr('HTTP/1.1 '.length);

            const parts = base.statusLine.split(' ');
            // eslint-disable-next-line
            base.statusCode = parts[0];
            base.status = parts.length === 2
                ? parts[1]
                : parts[2];
        }

        return lines.slice(1).reduce((data, line) => {
            const parts = line.split(':');
            // eslint-disable-next-line
            if (parts[1]) data[parts[0]] = parts[1];
            return data;
        }, base);
    },

    udpSocket() {
        return module.exports.wrap(dgram.createSocket('udp4'));
    },

    /* eslint-disable no-param-reassign */
    /** wrap a dgram socket with fanciness */
    wrap(socket) {
        /**
         * Send a discovery-type packet
         * @param type SRCH/WAKEUP/LAUNCH
         * @param data (optional) Dict of data rows to include
         * @param addr (optional) Addr to send to; if not specified,
         *          broadcast; the socket must have broadcast enabled
         *          for this to work. Format of rinfo from a dgram
         *          (eg: {address:'str', port:int})
         * @return a Promise that is resolved when the packet has sent.
         *          This is for argument simplicity---we already have 2
         *          optional params, and it is also optional to listen
         *          for completion.
         */
        socket.discover = function(type, data, addr) {
            if (!addr) {
                addr = {
                    address: '255.255.255.255', // broadcast!
                    port: DDP_PORT,
                };
            }

            if (!data) {
                data = {};
            } else if (data.port && typeof (data.port) === 'number') {
                addr = data;
                data = {};
            }

            if (!addr.port) {
                // use default port if not provided
                addr.port = DDP_PORT;
            }

            if (type.indexOf('HTTP') !== 0) {
                type = `${type} * HTTP/1.1`;
            }

            const msg = Buffer.from(`${type}\n${
                Object.keys(data).reduce((last, key) => {
                    return `${last + key}:${data[key]}\n`;
                }, '')
            }device-discovery-protocol-version:${DDP_VERSION}\n`);
            return new Promise((resolve, reject) => {
                socket.send(
                    msg, 0, msg.length, addr.port, addr.address,
                    (err) => {
                        if (err) return reject(err);
                        return resolve(socket);
                    },
                );
            });
        };

        return socket;
    },
    /* eslint-enable no-param-reassign */

    createPublicKey() {
        return new NodeRSA(PUBLIC_KEY, 'pkcs8-public');
    },
};
