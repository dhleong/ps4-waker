#!/usr/bin/env node

var Q = require('q')
  , request = require('request')
  , getmac = require('getmac')
  
  , TOKEN_URL = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token";

function pad(string, withChar, count) {
    if (string.length == count)
        return string
    if (string.length > count)
        return string.substring(0, count);

    for (var i=string.length; i < count; i++) {
        string += withChar;
    }

    return string;
}

function PsnLib(config) {
    this.config = config;
}

PsnLib.prototype.getDeviceUid = function() {
    var config = this.config;
    return Q.nfcall(getmac.getMac)
    .then(function(macAddress) {

        var payloadLen = 37; // 15 + 10 + 10 + 2x':'
        var headerLen = 6;

        var buf = new Buffer(payloadLen + headerLen);
        buf.fill(0);

        // header bytes
        buf.writeUInt16BE(0, 0);
        buf.writeUInt16BE(7, 2);
        buf.writeUInt16BE(2, 4);

        // payload len
        buf.writeUInt16BE(payloadLen, 6);
        
        // last 15 of mac address without ':', padded by X
        var offset = 8;
        var cleanMac = macAddress.replace(/:/g, '');
        var padMac = pad(cleanMac, 'X', 15);
        buf.write(padMac, offset);
        offset += 15;

        buf.write(':', offset++);
        buf.write(pad(config.manufacturer, ' ', 10), offset);
        offset += 10;

        buf.write(':', offset++);
        buf.write(pad(config.device, ' ', 10), offset);

        return buf.toString('hex');
    });
};

PsnLib.prototype.signin = function(/* user, pass */) {
    var self = this;
    // return Q.Promise(function(resolve, reject) {
    //     resolve(self);
    // });
    return self.exchangeToken("yHQwEZ");
};

PsnLib.prototype.exchangeToken = function(token) {
    var self = this;
    return this.getDeviceUid()
    .then(function(duid) {
        return Q.Promise(function(resolve, reject) {
            request({
                url: TOKEN_URL
              , method: 'POST'
              , form: {
                    grant_type: "authorization_code"
                  , client_id: self.config.client_id
                  , client_secret: self.config.client_secret
                  , code: token
                  , redirect_uri: "com.scee.psxandroid.scecompcall://redirect"
                  , state: "x"
                  , scope: "psn:sceapp"
                  , duid: duid
                }
            }, function(err, response, body) {
                if (err) return reject(err);

                console.log(response);
                console.log(body);
                resolve(body);
            });
        });
    });
};


var config = require('./_config');

new PsnLib(config)
// .signin(config.username, config.password)
.getDeviceUid()
.then(function(lib) {
    console.log('yay!', lib);
})
.fail(function(err) {
    console.error(err);
    console.error(err.stack);
});
