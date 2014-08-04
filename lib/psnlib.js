#!/usr/bin/env node

var url = require('url')
  , Q = require('q')
  , request = require('request')
  , getmac = require('getmac')
  , Browser = require('zombie')
  
  , SIGNIN_REDIRECT = "com.scee.psxandroid.scecompcall://redirect"
  , SIGNIN_URL = "https://reg.api.km.playstation.net/regcam/mobile/sign-in.html?redirectURL="
                + SIGNIN_REDIRECT
                + "&scope=sceapp&client_id="
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
    this.log = config.debug ? console.log.bind(console) : function() {}
}

PsnLib.prototype.getDeviceUid = function() {
    var config = this.config;
    return Q.nfcall(getmac.getMac)
    .then(function(macAddress) {

        var payloadLen = 37; // 15 + 10 + 10 + 2x':'
        var headerLen = 8; // 6 bytes + payload length 2 bytes

        var buf = new Buffer(payloadLen + headerLen);
        buf.fill(0);

        // header bytes
        buf.writeUInt16BE(0, 0);
        buf.writeUInt16BE(7, 2);
        buf.writeUInt16BE(2, 4);

        console.log(buf);

        // payload len << 3
        buf.writeUInt16BE(payloadLen << 3, 6);

        console.log(buf);
        
        // last 15 of mac address without ':', padded by X
        var offset = 8;
        var cleanMac = macAddress.replace(/:/g, '');
        var padMac = pad(cleanMac, 'X', 15);
        buf.write(padMac, offset);
        offset += 15;

        console.log(cleanMac);
        console.log(buf);

        buf.write(':', offset++);
        buf.write(pad(config.manufacturer, ' ', 10), offset);
        offset += 10;

        console.log(buf);

        buf.write(':', offset++);
        buf.write(pad(config.device, ' ', 10), offset);

        console.log(buf);
        return buf.toString('hex');
    });
};

PsnLib.prototype.signin = function(user, pass) {
    var self = this;
    // return Q.Promise(function(resolve, reject) {
    //     resolve(self);
    // });
    // return self.exchangeToken("yHQwEZ");
    // var browser = Browser.create();
    // return browser.visit(SIGNIN_URL + self.config.client_id)
    var browser = new Browser({
        runScripts: false
    });
    return browser.visit(SIGNIN_URL + self.config.client_id)
    .then(function() {

        self.log("logging in to psn...");
        return browser.fill('j_username', user)
                      .fill('j_password', pass)
                      .pressButton("Sign In");
    })
    .then(function() {
        var href = browser.location.href;
        if (~href.indexOf('error=true'))
            throw new Error("Invalid login");

        var parsed = url.parse(href, true);
        if (!parsed.query || !parsed.query.targetUrl) {
            var err = new Error("No targetUrl; no authCode");
            err.parsedUrl = parsed;
            throw err;
        }
        
        var targetUrl = parsed.query.targetUrl;
        var targetParsed = url.parse(targetUrl, true);
        if (!targetParsed.query || !targetParsed.query.authCode) {
            var err2 = new Error("No authCode in targetUrl");
            err2.parsedUrl = parsed;
            err2.parsedTarget = targetParsed;
            throw err2;
        }

        // got it!
        browser.close();
        var authCode = targetParsed.query.authCode;
        self.log("got auth code", authCode);
        return authCode;
    })
    .then(self.exchangeToken.bind(self));
};

PsnLib.prototype.exchangeToken = function(token) {
    var self = this;
    return this.getDeviceUid()
    .then(function(duid) {
        return Q.Promise(function(resolve, reject) {
            self.log("exchanging token", token);
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

                resolve(body);
            });
        });
    });
};


var config = require('./_config');

new PsnLib(config)
.signin(config.username, config.password)
// .getDeviceUid()
.then(function(lib) {
    console.log('yay!', lib);
})
.fail(function(err) {
    console.error(err);
    console.error(err.stack);
});
