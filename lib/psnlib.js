
var url = require('url')
  , Q = require('q')
  , request = require('request')
  , getmac = require('getmac')
  , Browser = require('zombie')
  
  , CLIENT_TYPE = 'a'
  , AUTH_TYPE = 'C'

  , OAUTH_SCOPE = "sceapp"
  , USER_AGENT = "com.playstation.companionutil.USER_AGENT"
  , SIGNIN_REDIRECT = "com.scee.psxandroid.scecompcall://redirect"
  , API_HOST = "reg.api.km.playstation.net"

  , SIGNIN_URL = "https://" + API_HOST + "/regcam/mobile/sign-in.html"
                + "?redirectURL=" + SIGNIN_REDIRECT
                + "&scope=" + OAUTH_SCOPE 
                + "&client_id=" // please append
  , TOKEN_URL = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token"
  , ACCOUNT_URL = "https://" + API_HOST + "/vl/api/v1/mobile/users/me/info";

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

/**
 * Main class. required arg config is a dict that looks like: 
 *
 * {
 *  client_id: oauth clientId; extract from PS app 
 *  client_secret: oauth client secret; extract from PS app 
 *  device: "Nexus 7" (for example)
 *  manufacturer: "LGE" (for example)
 * }
 *
 * client_id and client_secret are buried in the PS app, but
 *  can be extracted relatively easily. However, since Sony
 *  went through the trouble of obscuring them in NDK, I 
 *  do not feel comfortable just releasing them.
 */
function PsnLib(config) {
    this.config = config;
    this.log = config.debug ? console.log.bind(console) : function() {}
}

/**
 * Returns a Promise which resolves to the
 *  DUID for the current computer (it's based
 *  on the computer's mac address)
 */
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

        // payload len << 3
        buf.writeUInt16BE(payloadLen << 3, 6);
        
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

/**
 * Given a username and password, signs into PSN
 *  to get an oauthInfo dict.
 *
 * returns a Promise which resolves to the oauthInfo dict
 */
PsnLib.prototype.signin = function(user, pass) {
    var self = this;
    var browser = new Browser({
        runScripts: false
    });

    this.log("fetching signin form");
    return browser.visit(SIGNIN_URL + self.config.client_id)
    .then(function() {

        self.log("logging in to psn");
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

/**
 * Exchange a temporary auth token for oauth access_tokens.
 *  Returns a Promise which resolves to an oauthInfo dict
 */
PsnLib.prototype.exchangeToken = function(token) {
    var self = this;
    return this.getDeviceUid()
    .then(function(duid) {
        return Q.Promise(function(resolve, reject) {
            self.log("exchanging token", token);
            request({
                url: TOKEN_URL
              , method: 'POST'
              , headers: {
                    'User-Agent': USER_AGENT
                }
              , form: {
                    grant_type: "authorization_code"
                  , client_id: self.config.client_id
                  , client_secret: self.config.client_secret
                  , code: token
                  , redirect_uri: SIGNIN_REDIRECT
                  , state: "x"
                  , scope: "psn:" + OAUTH_SCOPE
                  , duid: duid
                }
            }, function(err, response, body) {
                if (err) return reject(err);

                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    self.log("Could not parse oauth body to json:", e);
                    reject(e);
                }
            });
        });
    });
};

/**
 * Given an oauthInfo dict (as resolved by signin()),
 *  return a Promise which resolves to the user's
 *  accountInfo dict, which can be passed to generateCredentials()
 */
PsnLib.prototype.getAccountInfo = function(oauthInfo) {
    var self = this;
    return Q.Promise(function(resolve, reject) {
        self.log("fetching account info with", oauthInfo.access_token, 'from', oauthInfo);
        request({
            url: ACCOUNT_URL
          , method: 'GET'
          , headers: {
                'User-Agent': USER_AGENT
              , 'X-NP-ACCESS-TOKEN': oauthInfo.access_token
            }
        }, function(err, response, body) {
            if (err) return reject(err);

            try {
                var json = JSON.parse(body);
                if (json.error) return reject(json.error);
                resolve(json);
            } catch (e) {
                self.log("failed to parse accountInfo body", body);
                reject(e);
            }
        });
    });
};

/**
 * Returns a Promise which resolves to the credentials dict.
 */
PsnLib.prototype.getCredentialsForAccount = function(user, pass) {
    var self = this;
    return this.signin(user, pass)
        .then(function(oauth) {
            self.log('got oauth=', oauth);
            return self.getAccountInfo(oauth);
        })
        .then(function(accountInfo) {
            return self.generateCredentials(accountInfo);
        });
};

/**
 * Given an accountInfo dict (resolved by getAccountInfo()),
 *  returns a credentials dict for waking the PS4
 */
PsnLib.prototype.generateCredentials = function(accountInfo) {
    this.log("generate credentials from", accountInfo);
    return {
        'client-type': CLIENT_TYPE
      , 'auth-type': AUTH_TYPE
      , 'user-credential': accountInfo.mAccountId
    };
};

/*
 * Example/test stuff:
 *
var config = require('./_config');

var psn = new PsnLib(config)
// .getDeviceUid()
psn
// .signin(config.username, config.password)
// .then(function(oauth) {
//     console.log('got oauth', oauth);
//     return psn.getAccountInfo(oauth)
// })
// .getAccountInfo(config.oauth)
.getCredentialsForAccount(config.username, config.password)
.then(function(lib) {
    console.log('yay!', lib);
})
.fail(function(err) {
    console.error(err);
    console.error(err.stack);
});
 */

module.exports = function(config) {
    return new PsnLib(config);
}
