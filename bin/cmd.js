#!/usr/bin/env node

var Waker = require('../')
  , Detector = Waker.Detector
  , Socket = Waker.Socket

  , DEFAULT_TIMEOUT = 5000
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
    }
});

if (argv.v || argv.version) {
    console.log(require('../package.json').version);
    return;
}

if (argv.h || argv.help) {
    console.log('ps4-waker - Wake your PS4 (with help from the Playstation App)');
    console.log('');
    console.log('Usage:');
    console.log('  ps4-waker [options]');
    console.log('  ps4-waker search [-t]                       Search for devices');
    console.log('  ps4-waker standby [-d <ip>]                 Request the device enter standby/rest mode');
    console.log('  ps4-waker start [titleId]                   Start a specified title id');
    console.log('  ps4-waker --help | -h                       Shows this help message.');
    console.log('  ps4-waker --version | -v                    Show package version.');
    console.log('');
    console.log('Options:');
    console.log('  --credentials | -c           Specify credentials file');
    console.log('  --device | -d                Specify IP address of a specific PS4');
    console.log('  --failfast                   Don\'t request credentials if none');
    console.log('  --timeout | -t               Timeout in milliseconds');
    console.log('  --pin <pin-code>             Manual pin-code registration');
    console.log('');
    console.log('Searching:');
    console.log('  If no timeout is provided to search, it will stop on the first result');
    console.log('');
    return;
}

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
}

if (action) {
    if (argv.timeout) {
        var detected = {};
        new Detector()
        .on('device', function(device, rinfo) {
            if (detected[device.address])
                return;

            detected[device.address] = true;

            if (!argv.device || device.address == argv.device) {
                this.removeAllListeners('close');
                action(null, device, rinfo);
            }
        })
        .on('close', function() {
            console.error("Could not detect any PS4 device");
        })
        .detect(argv.timeout);
    } else {
        Detector.findAny(DEFAULT_TIMEOUT, action);
    }
    return;
}

if (argv.timeout === undefined)
    argv.timeout = DEFAULT_TIMEOUT;

if (argv.pin)
    argv.pin = '' + argv.pin; // ensure it's a string

var waker = new Waker(argv.credentials);

function doWake() {
    var device = argv.device ? {address: argv.device} : undefined;
    waker.wake(argv.timeout, device, function(err) {
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
    Detector.find(address, argv.timeout, function(err, device) {
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

waker.on('device-notified', function() {
    console.log("WAKEUP sent to device...");
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
