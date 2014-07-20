
var dgram = require('dgram')

  , DDP_VERSION = '00020020'
  , DDP_PORT = 987;

module.exports = {

    DDP_VERSION: DDP_VERSION
  , DDP_PORT: DDP_PORT
  , REQ_PORT: 997

  , STATUS_STANDBY: '620 Server Standby'

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

};
