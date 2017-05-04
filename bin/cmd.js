#!/usr/bin/env node

var Detector = require('../lib/detector')
  , Device = require('../lib/device')

  , DEFAULT_TIMEOUT = 10000
  , HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || ''
  , CREDS_DEFAULT = require('path').join(HOME, '.ps4-wake.credentials.json');

const argv = require('minimist')(process.argv.slice(2), {
    default: {
        credentials: CREDS_DEFAULT,
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


//
// Main
//

var action;

if (~argv._.indexOf('search')) {
    // search is a special case.
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
    var keyNames = argv._.slice(remote).map((key) => key.toUpperCase());

    action = doAndClose(device => device.sendKeys(keyNames));
} else {
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

function logError(err) {
    // TODO --json flag?
    console.error(err);
}

function logResult(result) {
    // TODO --json flag?
    console.log(JSON.stringify(result, null, 2));
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
        credentials: rinfo.credentials,
    }, detectOpts));

    // store this so we don't have to re-fetch for search
    d._info = deviceInfo;
    d._info.address = rinfo.address;

    _setupLogging(d);
    _setupCredentialHandling(d);

    return d;
}

function _setupCredentialHandling(d) {
    // TODO handle initial auth

    d.on('need-credentials', () => {
        if (argv.failfast) {
            logError("No credentials found.");
            process.exit(1);
            return;
        }

        console.warn("TODO credential handling");
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

    d.on('error', function(err) {
        logError('Unable to connect to PS4 at',
            d._info.address, err);
    });
}
