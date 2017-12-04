#!/usr/bin/env node

var {Detector, Device, Socket} = require('../')

  , DEFAULT_TIMEOUT = 10000;

const argv = require('minimist')(process.argv.slice(2), {
    default: {
        pin: ''
    },
    alias: {
        credentials: 'c',
        device: 'd',
        timeout: 't',
        bind: 'b',
        'bind-port': 'p'
    }
});

if (argv.v || argv.version) {
    console.log(require('../package.json').version);
    return;
}

if (argv.h || argv.help || argv['?']) {
    console.log('ps4-waker - Wake your PS4 (and more!) with help from the Playstation App');
    console.log('');
    console.log('Usage:');
    console.log('  ps4-waker [options]                                   Wake PS4 device(s)');
    console.log('  ps4-waker [options] osk-submit (text)                 Submit the OSK, optionally providing the text');
    console.log('  ps4-waker [options] remote <key-name> (...<key-name>) Send remote key-press event(s)');
    console.log('  ps4-waker [options] search                            Search for devices');
    console.log('  ps4-waker [options] standby                           Request the device enter standby/rest mode');
    console.log('  ps4-waker [options] start <titleId>                   Start a specified title id');
    console.log('  ps4-waker --help | -h | -?                  Shows this help message.');
    console.log('  ps4-waker --version | -v                    Show package version.');
    console.log('');
    console.log('Options:');
    console.log('  --bind | -b <ip>             Bind to a specific network adapter IP, if you have multiple');
    console.log('  --bind-port | -p <port>      Bind on a specific port, if you need to route specifically');
    console.log('  --credentials | -c <file>    Specify credentials file');
    console.log('  --device | -d <ip>           Specify IP address of a specific PS4');
    console.log('  --failfast                   Don\'t request credentials if none');
    console.log('  --skip-login                 Don\'t automatically login');
    console.log('  --pin <pin-code>             Manual pin-code registration');
    console.log('  --timeout | -t <time>        Stop searching after <time> milliseconds; the default timeout') ;
    console.log('                                unspecified is 10 seconds');
    console.log('');
    console.log('Device selection:');
    console.log('  For any command, there are four possible conditions based on the flags you\'ve specified:');
    console.log('    1. Neither -t nor -d: Will act on the first device found; this is for households');
    console.log('        with a single device on the network');
    console.log('    2. Just -t: Will act on every device found within <time> millseconds');
    console.log('    3. Just -d: Will search for at most 10 seconds (the default timeout) for and only act on') ;
    console.log('        the provided device, quitting if found');
    console.log('    4. Both -t and -d: Will search for at most <time> seconds for and only act on the');
    console.log('        provided device, qutting early if found.');
    console.log('');
    console.log('Key names:');
    console.log('  Button names are case insensitive, and can be one of:');
    console.log('    up, down, left, right, enter, back, option, ps');
    console.log('  You cannot send the actual x, square, etc. buttons');
    console.log('  A string of key presses may be provided, separated by spaces,');
    console.log('   and they will be sent sequentially.');
    console.log('  In addition, a key name may be followed by a colon and a duration in ');
    console.log('   milliseconds to hold that key, eg: ps4-waker remote ps:1000');
    return;
}

var detectOpts = {
    timeout: argv.timeout || DEFAULT_TIMEOUT,
    bindAddress: argv.bind,
    bindPort: argv['bind-port']
};


//
// Main
//

var action;

if (argv.pin) {
    // manual pin-code entry is a special case
    action = (d) => {
        let waker = d._waker();
        waker.readCredentials(function(err, creds) {
            if (err) {
                // just trigger the need-credentials flow
                waker.emit('need-credentials', d._info);
                return;
            }

            _registerDevice(d, creds);
        });
    };
} else if (~argv._.indexOf('osk-submit')) {
    var submit = argv._.indexOf('osk-submit') + 1;
    var text = argv._[submit];

    action = doAndClose(device => {
        return device.getKeyboard().then(osk => {
            if (text) {
                return osk.setText(text);
            } else {
                return Promise.resolve(osk);
            }
        }).then(osk => {
            return osk.submit();
        }).then(() => {
            return delayMillis(450);
        });
    });
} else if (~argv._.indexOf('search')) {
    // search is also a bit of a special case
    action = function(device) {
        logResult(device._info);
    };
} else if (~argv._.indexOf('start')) {
    var start = argv._.indexOf('start') + 1;
    var title = argv._[start];

    if (title) {
        action = doAndClose(device => device.startTitle(title));
    } else {
        logError("A title id must be provided to start");
        process.exit(1);
    }

} else if (~argv._.indexOf('standby')) {
    action = doAndClose(device => device.turnOff());
} else if (~argv._.indexOf('remote')) {

    var remote = argv._.indexOf('remote') + 1;
    var keyNames = argv._.slice(remote).map(rawKey => {
        let parts = rawKey.split(":");
        if (parts.length === 1) {
            // simple key
            return rawKey;
        } else {
            // held key
            return [parts[0], parseInt(parts[1])];
        }
    });

    action = doAndClose(device => device.sendKeys(keyNames));

} else {
    // default is simple "wake"
    action = doAndClose(device => device.turnOn());
}

if (action) {
    // accept the device either if we don't care, or if it's
    //  the device we're looking for
    var condition = (device, rinfo) => !argv.device || rinfo.address == argv.device;

    // if either a device is provided OR there's no timeout,
    //  we just quickly stop on the first found; otherwise,
    //  just keep going
    var detectorFunction = argv.device || argv.timeout === undefined
        ? Detector.findFirst
        : Detector.findWhen;

    detectorFunction(condition, detectOpts, function(err, device, rinfo) {
        if (err) {
            logError(err.message);
            return;
        }

        action(_createDevice(device, rinfo));
    });
    return;
}


//
// Util methods
//

function delayMillis(millis) {
    return new Promise((resolve) => {
        setTimeout(resolve.bind(resolve, true), millis);
    });
}

function logError(err, ...args) {
    // TODO --json flag?
    console.error(err, ...args);
}

function logEvent(msg, ...args) {
    // TODO --json flag?
    console.log(msg, ...args);
}

function logResult(result) {
    // TODO --json flag?
    if (typeof(result) === 'string') {
        console.log(result);
    } else {
        console.log(JSON.stringify(result, null, 2));
    }
}

/**
 * Convenience wrapper for a function that takes a Device
 *  and performs and action on it, returning a Promise.
 *  Once the Promise resolves or rejects, the Device is
 *  close()'d; on error, we call logError and exit with
 *  an error code
 */
function doAndClose(cb) {
    return function(device) {
        var promise = cb(device);

        promise.then(() => device.close())
        .catch(e => {
            logError(e);
            device.close();
            process.exit(1);
        });
    };
}

//
// Internal factories, etc.
//

function _createDevice(deviceInfo, rinfo) {
    let d = new Device(Object.assign({
        address: rinfo.address,
        credentials: argv.credentials,
        autoLogin: !argv['skip-login'],
    }, detectOpts));

    // store this so we don't have to re-fetch for search
    d._info = deviceInfo;
    d._info.address = rinfo.address;

    _setupLogging(d);
    _setupCredentialHandling(d);

    return d;
}

function _setupCredentialHandling(d) {
    d.on('need-credentials', () => {
        if (argv.failfast) {
            logError("No credentials found.");
            process.exit(1);
            return;
        }

        // just assume we need to register as well
        if (d._info.status.toUpperCase() !== 'OK') {
            logError("Device must be awake for initial registration. Please turn it on manually and try again.");
            process.exit(2);
        }

        logEvent("No credentials; Use the PS4 Second Screen App and try to connect to PS4-Waker");
        d._waker().requestCredentials(function(err, creds) {
            if (err) return logError(err);

            logEvent("Got credentials! ", creds);

            // okay, now register
            _registerDevice(d, creds);
        });
    });
}

function _setupLogging(d) {
    // TODO if (--json) return;

    d.on('device-notified', function(device) {
        console.log("WAKEUP sent to device...", device.address);
    });

    d.on('logging-in', function() {
        console.log("Logging in...");
    });

    d.on('sent-key', k => {
        console.log("Sent key", k);
    });

    d.on('error', function(err) {
        logError('Unable to connect to PS4 at',
            d._info.address, err);
    });
}

function _registerDevice(d, creds) {
    // I believe we (sadly) need to bypass the Device here,
    //  since its openSocket() expects to login.
    let address = d._info.address;
    let sock = Socket({
        accountId: creds['user-credential']
      , host: address

        // if we're already registered, default "" is okay:
        // also, it MUST be a string
      , pinCode: '' + (argv.pin || "")
    });
    sock.on('login_result', function(packet) {
        if (packet.result === 0) {
            logResult("Logged into device! Future uses should succeed");
            process.exit(0);
        } else if (packet.error === "PIN_IS_NEEDED"
                || packet.error === "PASSCODE_IS_NEEDED") {
            // NB: pincode auth seems to work just fine
            //  even if passcode was requested. Shrug.

            logEvent("Go to 'Settings -> PlayStation(R) App Connection Settings -> Add Device'" +
                " on your PS4 to obtain the PIN code.");

            // prompt the user
            require('readline').createInterface({
                input: process.stdin
              , output: process.stdout
            }).question("Pin code> ", function(pin) {
                if (!pin) {
                    logError("Pin is required");
                    process.exit(4);
                }

                sock.login(pin);
            });

        } else {
            logError("Unexpected error:" +
                packet.result + " / " + packet.error);
            process.exit(3);
        }
    })
    .on('error', function(err) {
        logError('Unable to connect to PS4 at ' + address, err);
        process.exit(1);
    });
}
