#!/usr/bin/env node

/* eslint no-console:0 */

const minimist = require('minimist');

// interfaces:
const StandardUserInterface = require('./cli/ui/standard');

// commands:
/* eslint-disable global-require */
const commands = {
    check: require('./cli/check'),
    'osk-submit': require('./cli/osk'),
    pin: require('./cli/pin'),
    remote: require('./cli/remote'),
    search: require('./cli/search'),
    standby: require('./cli/standby'),
    start: require('./cli/start'),
    wake: require('./cli/wake'),
};
/* eslint-enable global-require */

// constants:
const DEFAULT_TIMEOUT = 10000;

// utils:
function showUsage() {
    console.log(`
ps4-waker - Wake your PS4 (and more!) with help from the Playstation App

Usage:
  ps4-waker [options]                       Wake PS4 device(s)
  ps4-waker [options] check                 Check a device's status
  ps4-waker [options] osk-submit [text]     Submit the OSK, optionally
                                            providing the text
  ps4-waker [options] remote <key-name...>  Send remote key-press event(s)
  ps4-waker [options] search                Search for devices
  ps4-waker [options] standby               Request the device enter
                                            standby/rest mode
  ps4-waker [options] start <titleId>       Start a specified title id
  ps4-waker --help | -h | -?                Shows this help message.
  ps4-waker --version | -v                  Show package version.

Options:
  --bind | -b <ip>             Bind to a specific network adapter IP, if
                               you have multiple
  --bind-port | -p <port>      Bind on a specific port, if you need to
                               route specifically
  --credentials | -c <file>    Specify credentials file
  --device | -d <ip>           Specify IP address of a specific PS4
  --failfast                   Don't request credentials if none
  --skip-login                 Don't automatically login
  --pin <pin-code>             Manual pin-code registration
  --pass <passcode>            Provide passcode for login, if needed
  --timeout | -t <time>        Stop searching after <time> milliseconds;
                               the default timeout, if unspecified, is 10
                               seconds

Device selection:
  For any command, there are four possible conditions based on the flags
  you've specified:
    1. Neither -t nor -d: Will act on the first device found; this is for
       households with a single device on the network
    2. Just -t: Will act on every device found within <time> millseconds
    3. Just -d: Will search for at most 10 seconds (the default timeout)
       for and only act on the provided device, quitting if found
    4. Both -t and -d: Will search for at most <time> seconds for and only
       act on the provided device, qutting early if found.

Checking device status:
  The "check" command provides output similar to "search," but only for
  the first matching device found (see above). In addition, it will exit
  with code '0' only if the device is awake; if it is in standby, it
  will exit with code '1', and in any other situation it will exit with
  code '2'. This command is intended to simplify initial state detection
  for home automation users.

Key names:
  Button names are case insensitive, and can be one of:
    up, down, left, right, enter, back, option, ps
  You cannot send the actual x, square, etc. buttons.
  A string of key presses may be provided, separated by spaces, and they
   will be sent sequentially.
  In addition, a key name may be followed by a colon and a duration in
   milliseconds to hold that key, eg: ps4-waker remote ps:1000
`.trim());
}

function createInterface(options) {
    const detectOpts = {
        timeout: options.timeout || DEFAULT_TIMEOUT,
        bindAddress: options.bind,
        bindPort: options['bind-port'],
    };

    // always use the standard one, for now
    return new StandardUserInterface(options, detectOpts);
}

async function exec(ui, CmdConstructor, ...args) {
    let c;
    try {
        c = new CmdConstructor(args);
    } catch (e) {
        ui.logError(e);
        ui.exitWith(1);
        return;
    }

    await c.run(ui);
}

// main:
async function main(argv) {
    const options = minimist(argv, {
        default: {
            passCode: '',
            pin: '',
        },
        alias: {
            credentials: 'c',
            device: 'd',
            pass: 'passCode',
            timeout: 't',
            bind: 'b',
            'bind-port': 'p',
            'skip-login': 'skipLogin',
        },
        string: ['pass', 'pin'],
    });

    if (options.v || options.version) {
        // eslint-disable-next-line global-require
        console.log(require('../package.json').version);
        process.exit(0);
    }

    if (options.h || options.help || options['?']) {
        showUsage();
        process.exit(0);
    }

    const ui = createInterface(options);

    if (options.pin) {
        // special case
        await exec(ui, commands.pin, options.pin);
        return;
    }

    const commandName = options._[0] || 'wake';
    const args = options._.slice(1);

    const cmd = commands[commandName];
    if (!cmd) {
        ui.logError('No such command:', commandName);
        return;
    }

    // execute the command
    await exec(ui, cmd, ...args);
}

main(process.argv.slice(2))
    .catch((e) => console.error('Unexpected error', e));
