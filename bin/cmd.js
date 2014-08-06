#!/usr/bin/env node

var Waker = require('../')
  , Detector = Waker.Detector
  , Socket = Waker.Socket

  , HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
  , CREDS_DEFAULT = require('path').join(HOME, '.ps4-wake.credentials.json');

var argv = require('minimist')(process.argv.slice(2), {
    default: {
        credentials: CREDS_DEFAULT
      , timeout: 5000
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
    return;
}

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
        } else if (packet.error == "PIN_IS_NEEDED") {

            // prompt the user
            require('readline').createInterface({
                input: process.stdin
              , output: process.stdout
            }).question("Pin code> ", function(pin) {
                if (!pin) {
                    console.error("Pin is required");
                    process.exist(4);
                }

                sock.register(pin);
            });

        } else {
            console.error("Unexpected error", packet.result, packet.error);
            process.exit(3);
        }
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
        if (err || device.status != 'OK') {
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
