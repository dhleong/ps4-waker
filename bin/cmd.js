#!/usr/bin/env node

var async = require('async')
  , Waker = require('../')
  , Detector = Waker.Detector
  , Socket = Waker.Socket

  , DEFAULT_TIMEOUT = 10000
  , HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || ''
  , CREDS_DEFAULT = require('path').join(HOME, '.ps4-wake.credentials.json');

var argv = require('minimist')(process.argv.slice(2), {
    default: {
        credentials: CREDS_DEFAULT
      , pin: ''
    }
  , alias: {
        credentials: 'c'
      , device: 'd'
      , timeout: 't'
      , bind: 'b'
      , 'bind-port': 'p'
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
    console.log('  --timeout | -t <time>        Stop searching after <time> milliseconds; the default timeout') ;
    console.log('                                unspecified is 10 seconds');
    console.log('  --pin <pin-code>             Manual pin-code registration');
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
    return;
}

var detectOpts = {
    timeout: argv.timeout || DEFAULT_TIMEOUT,
    bindAddress: argv.bind,
    bindPort: argv['bind-port']
};

var action = null;
if (~argv._.indexOf('search')) {
    action = function(err, device, rinfo) {
        if (err) return console.error(err);
        device.address = rinfo.address;
        console.log(device);
    };
} else if (~argv._.indexOf('start')) {
    var start = argv._.indexOf('start') + 1;
    var title = argv._[start];
    if (title) {
        action = newSocketAction(function(sock) {
            sock.startTitle(title, function(err) {
                if (err) console.error(err);
                else console.log("Started!");
                process.exit(0);
            });   
        });
    } else {
        console.error("A title id must be started");
        process.exit(1);
    }
} else if (~argv._.indexOf('standby')) {
    action = newSocketAction(function(sock) {
        sock.requestStandby(function(err) {
            if (err) console.error(err);
            else console.log("Standby requested");
            process.exit(0);
        });
    });
} else if (~argv._.indexOf('remote')) {
    var remote = argv._.indexOf('remote') + 1;
    var keyNames = argv._.slice(remote).map((key) => key.toUpperCase());

    var invalid = keyNames.filter((key) => !(key in Socket.RCKeys));
    if (invalid.length) {
        console.error("Unknown key names: ", invalid);
        process.exit(1);
        return;
    }

    var queue = ["OPEN_RC"]
        .concat(keyNames)
        .concat(["CLOSE_RC"]);

    action = newSocketAction(function(sock) {
        // give it some time to think---if we try to OPEN_RC
        //  too soon after connecting, the ps4 seems to disregard
        setTimeout(function() {
            // send each key in series, with a delay in between
            async.forEachSeries(queue, (key, cb) => {
                var val = Socket.RCKeys[key];
                sock.remoteControl(val);
                setTimeout(cb, val == Socket.RCKeys.PS
                    ? 1000 // higher delay after PS button press
                    : 200); // too much lower and it becomes unreliable

                if (!key.endsWith("_RC")) {
                    console.log("Sent", key);
                }
            }, (err) => {
                console.log("Remote key events sent");
                // process.exit(0);
                sock.close();
            });
        }, 1500);
    });
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
            console.error(err.message);
            return;
        }

        action(null, device, rinfo);
    });
    return;
}

if (argv.timeout === undefined)
    argv.timeout = DEFAULT_TIMEOUT;

if (argv.pin)
    argv.pin = '' + argv.pin; // ensure it's a string

var waker = new Waker(argv.credentials);

function doWake() {
    var device = argv.device ? {address: argv.device} : undefined;
    waker.wake(detectOpts, device, function(err) {
        if (err) return console.error(err);

        console.log("Done!");
    });
}

function doRegister(address, creds) {

    var sock = Socket({
        accountId: creds['user-credential']
      , host: address
      , pinCode: argv.pin // if we're already registered, default "" is okay
    })
    sock.on('login_result', function(packet) {
        if (packet.result === 0) {
            console.log("Logged into device! Future uses should succeed");
            process.exit(0);
        } else if (packet.error == "PIN_IS_NEEDED"
                || packet.error == "PASSCODE_IS_NEEDED") {
            // NB: pincode auth seems to work just fine
            //  even if passcode was requested. Shrug.

            console.log("Go to 'Settings -> PlayStation(R) App Connection Settings -> Add Device'" +
                " on your PS4 to obtain the PIN code.");

            // prompt the user
            require('readline').createInterface({
                input: process.stdin
              , output: process.stdout
            }).question("Pin code> ", function(pin) {
                if (!pin) {
                    console.error("Pin is required");
                    process.exit(4);
                }

                sock.login(pin);
            });

        } else {
            console.error("Unexpected error", packet.result, packet.error);
            process.exit(3);
        }
    })
    .on('error', function(err) {
        console.error('Unable to connect to PS4 at', address, err);
        process.exit(1);
    });
}

waker.on('need-credentials', function(targetDevice) {
    if (argv.failfast) {
        console.error("No credentials found.");
        process.exit(1);
        return;
    }

    // just assume we need to register as well
    var address = targetDevice.address;
    Detector.find(address, detectOpts, function(err, device) {
        if (err || device.status.toUpperCase() != 'OK') {
            console.error("Device must be awake for initial registration");
            process.exit(2);
        }
    
        console.log("No credentials; Use Playstation App and try to connect to PS4-Waker");
        waker.requestCredentials(function(err, creds) {
            if (err) return console.error(err);
            
            console.log("Got credentials!", creds);

            // okay, now register
            doRegister(address, creds);
        });
    });
});

waker.on('device-notified', function(device) {
    console.log("WAKEUP sent to device...", device.address);
});

waker.on('logging-in', function() {
    console.log("Logging in...");
});

if (argv.pin) {
    // find the target machine and register
    var getCredsAndRegister = function(address) {
        waker.readCredentials(function(err, creds) {
            // welllll shit. just fire up the need-credentials workflow
            if (err) return waker.emit('need-credentials', {address: address});

            doRegister(address, creds);
        });
    }

    if (argv.device) {
        getCredsAndRegister(argv.device);
    } else {
        // find any and do it
        Detector.findAny(argv.timeout, function(err, device, rinfo) {
            if (err || !rinfo) {
                console.error("Couldn't find any PS4");
                process.exit(1);
            }

            getCredsAndRegister(rinfo.address);
        });
    }
} else {
    // do it!
    doWake();
}

/** 
 * Returns an action that will prepare
 *  a Socket connection and hand it to your
 *  callback. If we're unable to connect,
 *  we'll simply quit
 */
function newSocketAction(callback) {
    return function(err, device, rinfo) {
        if (err) return console.error(err);

        var waker = new Waker(argv.credentials);
        waker.readCredentials(function(err, creds) {
            if (err) {
                console.error("No credentials found");
                process.exit(1);
                return;
            }

            Socket({
                accountId: creds['user-credential']
              , host: rinfo.address
              , pinCode: argv.pin
            }).on('ready', function() {
                callback(this);
            }).on('error', function(err) {
                console.error('Unable to connect to PS4 at', 
                    rinfo.address, err);
                process.exit(1);
            });

        });
    }
}
