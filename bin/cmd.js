#!/usr/bin/env node

var Waker = require('../')

  , HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
  , PSN_CONF_DEFAULT = require('path').join(HOME, '.psn-config.json')
  , CREDS_DEFAULT = require('path').join(HOME, '.ps4-wake.credentials.json');

var argv = require('minimist')(process.argv.slice(2), {
    default: {
        credentials: CREDS_DEFAULT
      , timeout: 5000
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
    console.log('  --psn [config.json]          Use PSN-based credential fetching');
    console.log('  --credentials | -c           Specify credentials file');
    console.log('  --device | -d                Specify IP address of a specific PS4');
    console.log('  --failfast                   Don\'t request credentials if none');
    console.log('  --timeout | -t               Timeout in milliseconds');
    console.log('');
    return;
}

var waker = new Waker(argv.credentials);

var doWake = function() {
    waker.wake(argv.timeout, argv.device, function(err) {
        if (err) return console.error(err);

        console.log("Done!");
    });
}

/** NB: callback will NOT fire on failure */
var readPsnUser = function(callback) {
    var read = require('read');
    read({prompt: "username>"}, function(err, username) {
        if (err || !username) return console.log("error: username is required", err);

        read({prompt: "password>", silent: true}, function(err, password) {
            if (err || !password) return console.log("error: password is required", err);

            callback(username, password);
        });
    });
};

var handlePsnCredentials = function() {
    var psnPath = (argv.psn === true) ? PSN_CONF_DEFAULT : argv.psn;
    console.log("No credentials; Please login to your PSN account");
    require('fs').readFile(psnPath, function(err, buf) {
        if (err) return console.error("ERROR: No PSN config at", psnPath);

        try {
            var config = JSON.parse(buf);
        } catch (e) {
            console.error("No PSN config at", psnPath);
            console.error(e);
            return;
        }

        readPsnUser(function(user, pass) {
            
            require('../lib/psnlib')(config)
            .getCredentialsForAccount(user, pass)
            .then(function(credentials) {
                console.log('Got', credentials);
                return require('q').ninvoke(waker, 'writeCredentials', credentials);
            })
            .then(doWake)
            .fail(function(err) {
                console.error('Could not get credentials', err);
            });
        });
    });
};

waker.on('need-credentials', function() {
    if (argv.failfast) {
        console.error("No credentials found.");
        process.exit(1);
        return;
    }
    
    if (argv.psn) {
        handlePsnCredentials();
    } else {
        console.log("No credentials; Use Playstation App and try to connect to PS4-Waker");
        waker.requestCredentials(function(err, creds) {
            if (err) return console.error(err);
            
            console.log("Got credentials!", creds);
            doWake();
        });
    }
});

// do it!
doWake();
