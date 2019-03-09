const util = require('util');
const events = require('events');
const fs = require('fs');

const debug = require('debug')('ps4:waker');

const Detector = require('./detector');
const Dummy = require('./dummy');
const ps4lib = require('./ps4lib');
const newSocket = require('./ps4socket');

const StandardUserInterface = require('./cli/ui/standard');

const MIN_WAIT_FOR_WAKE = 30000;
const MAX_RETRIES = 5;
const CRED_KEYS = ['client-type', 'auth-type', 'user-credential'];

/**
 * Construct a new Waker instance, which may be
 *  used to wake a PS4 and login to it. If desired,
 *  you may also retain the ps4socket connection
 *  used to login for other purposes (such as
 *  launching apps, or putting the system in standby).
 *
 * @param credentials Either a string path to a credentials
 *                    file, or an object containing the
 *                    credentials (formatted the same way that
 *                    they'd be stored in the credentials.json)
 * @param config A config object/map. Valid keys:
 *  - autoLogin: (default: true) If true, will open a socket
 *               connection and cause the PS4 to login with
 *               the credentials provided for waking
 *  - errorIfAwake: (default: true) If true, returns an Error
 *                  to the callback from wake() if the PS4 was
 *                  not in standby mode. If you're using Waker
 *                  to get a ps4socket, you may want to
 *                  specify `false` here so you can get a socket
 *                  regardless of whether the PS4 is in standby
 *  - keepSocket: (default: false) If true, the callback from
 *                wake will have a single, extra parameter
 *                on successful connection, which will be
 *                a reference to a valid ps4socket if it is
 *                non-null. autoLogin must also be true for
 *                this to work. If false, the callback will
 *                only have the usual error parameter, and any
 *                socket opened (IE: if autoLogin is true)
 *                will be closed after logging in.
 *
 * @see lib/ps4socket for the things you can do with the socket
 */
function Waker(credentials, config) {
    this.credentials = credentials;

    this.config = {
        autoLogin: true,
        errorIfAwake: true,
        keepSocket: false,
        debug: false,

        ...config,
    };

    this.ui = config.ui || StandardUserInterface.createForUI();
}
util.inherits(Waker, events.EventEmitter);

/**
 * Attempt to wake a specific PS4, or any PS4.
 * @param detectOpts @see Detector#detect(); If you provide a
 *                   device, any `timeout` set in this is ignored
 * @param device (optional) A device object. If not provided,
 *               we will attempt to locate *any* PS4 and wake
 *               the first one found within `timeout`. Should
 *               look like:
 *
 *                  {
 *                    status: "Standby",
 *                    address: "192.168.4.2",
 *                    host-name: "My PS4",
 *                    port: 9001
 *                  }
 *
 * @param callback Standard node.js-style callback. Will be
 *                 called with 1 or 2 parameters, depending
 *                 on the configuration (see the config param
 *                 on the Waker constructor)
 */
Waker.prototype.wake = function(detectOpts, device, callback) {
    // fix up/validate input
    if (!(typeof (detectOpts) === 'number'
        || typeof (callback) === 'function'
        || (typeof (detectOpts) === 'object'
            && device
            && (device['host-name'] || typeof (device) === 'function')))) {
        // thanks to backwards compat, this is a bit gross. In other words,
        // detectOpts was definitely provided IFF it's a number OR it's
        // an object and: callback is a function OR
        // device is a function (IE: `device` was actually
        // omitted and we were called as `wake(opts, callback)`) OR
        // device has the `host-name` field, which should be returned by
        // the PS4 in a `device` object.
        // If neither of these cases were true, no opts were provided,
        // we have to shift the args, and detectOpts can just be `undefined`
        callback = device;
        device = detectOpts;
        detectOpts = undefined;
    }
    if (typeof (device) === 'function') {
        callback = device;
        device = undefined;
    }
    if (!callback) {
        throw new Error('callback parameter is required');
    }

    // already got your device? just wake it
    if (device) {
        this._doWake(device, detectOpts, callback);
        return;
    }

    // get the first device we can find
    Detector.findAny(detectOpts, (err, foundDevice, rinfo) => {
        if (err) {
            callback(err);
            return;
        }

        foundDevice.address = rinfo.address;
        foundDevice.port = device['host-request-port'];
        this._doWake(foundDevice, detectOpts, callback);
    });
};

// eslint-disable-next-line
Waker.prototype._doWake = function(device, detectOpts, callback) {
    this.readCredentials((err, creds) => {
        if (err && this.listeners('need-credentials')) {
            this.emit('need-credentials', device);
            return;
        }
        if (err) {
            // no listeners? just hop to it
            this.requestCredentials(this._doWake.bind(this, device, detectOpts, callback));
            return;
        }

        // we have credentials!
        if (device.status && device.status !== 'Standby' && this.config.errorIfAwake) {
            callback(new Error(`${device['host-name']} is already awake! (${device.status})`));
            return;
        }

        this.sendWake(device, detectOpts, creds, callback);
    });
};

/**
 * Read credentials from the provided constructor
 *  argument. Transparently handles the case that a
 *  credentials object was passed instead of a path
 *  to a file, so you can use this regardless of
 *  how the Waker was constructed. Most users will
 *  likely not need to use this function directly,
 *  as we will use it internally to get the credentials.
 *
 * @param callback Standard node.js callback, will be
 *                 fired as (err, creds), where `err`
 *                 will be non-null if something went
 *                 wrong reading the credentials, and
 *                 `creds` will be the credentials object
 *                 on success.
 */
Waker.prototype.readCredentials = function(callback) {
    if (this.credentials !== null && typeof (this.credentials) === 'object') {
        callback(null, this.credentials);
    } else {
        fs.readFile(this.credentials, (err, buf) => {
            if (err) return callback(err);

            return callback(null, JSON.parse(buf.toString()));
        });
    }
};

/**
 * Constructs a "dummy" PS4 on the network for the purpose
 *  of acquiring the appropriate credentials. It may be
 *  preferrable to just install ps4-waker globally and
 *  use the ps4-waker executable to acquire credentials,
 *  instead of calling this directly.
 *
 * While the acquired credentials (if any) will be passed
 *  to the callback always, if a file path was provided
 *  for the `credentials` param in the Waker constructor,
 *  they will also be written to that file. If an object
 *  was provided, however the credentials will ONLY be
 *  passed to the callback.
 *
 * @param callback Standard node.js callback function,
 *                 called as (err, creds), where `err`
 *                 will be non-null if something went wrong,
 *                 and `creds` will be a credentials object
 *                 if it worked.
 */
Waker.prototype.requestCredentials = function(callback) {
    const dummy = new Dummy();
    dummy.setStandby();
    dummy.once('wakeup', (packet) => {
        const creds = CRED_KEYS.reduce((data, key) => {
            data[key] = packet[key];
            return data;
        }, {});

        if (typeof (this.credentials) === 'object') {
            callback(null, creds);
        } else {
            fs.writeFile(this.credentials, JSON.stringify(creds), (err) => {
                if (err) return callback(err);

                return callback(null, creds);
            });
        }

        dummy.close();
    });
    dummy.once('error', (err) => {
        callback(err);
    });
    dummy.once('ready', () => {
        this.ui.logEvent('"PS4-Waker" device should now be available...');
    });
    dummy.listen();

    // once we're done, try to drop root privileges
    if (this.ui.options['user-id'] && process.setuid) {
        process.setuid(this.ui.options['user-id']);
        this.ui.logEvent('Relinquished root privileges');
    }
};

/**
 * Send a WAKEUP request directly to the given device,
 *  using the provided credentials. Must users should
 *  probably prefer wake()
 *
 * @param device Device object (@see wake())
 * @param detectOpts @see Detector#detect()
 * @param creds Credentials object, as in the Waker constructor.
 *              It MUST be the inflated object, however; a string
 *              file path will not work here.
 * @param callback @see wake()
 */
Waker.prototype.sendWake = function(device, detectOpts, creds, callback) {
    if (!detectOpts || typeof (detectOpts) === 'number') {
        detectOpts = {
            timeout: detectOpts,
        };
    } else if (detectOpts && typeof (detectOpts) !== 'object') {
        // not undefined, not a number, and not an object.
        // barf all over the input
        throw new Error(`Illegal value for detectOpts: ${detectOpts}`);
    }

    // ensure the timeout is *at least* our minimum
    detectOpts.timeout = Math.max(detectOpts.timeout, MIN_WAIT_FOR_WAKE);

    // make sure to use standard port
    device.port = ps4lib.DDP_PORT;

    // send the wake command
    this.udp = ps4lib.udpSocket();

    this.udp.bind(undefined, detectOpts.bindAddress, () => {
        this.udp.setBroadcast(true); // maybe?

        debug('sending WAKEUP to', device);
        this.udp.discover('WAKEUP', creds, device);
        this._whenAwake(device, detectOpts, () => {
            this._login(device, creds, detectOpts, callback);
        });
    });
};

// eslint-disable-next-line
Waker.prototype._whenAwake = function(device, detectOpts, callback) {
    this.emit('device-notified', device);

    const statusCheckDelay = 1000;
    const start = new Date().getTime();
    const loop = (err, d) => {
        d = d || {};
        if (d.statusLine !== ps4lib.STATUS_AWAKE) {
            const now = new Date().getTime();
            const delta = now - start;
            const newTimeout = detectOpts.timeout - delta - statusCheckDelay;
            if (newTimeout > 0) {
                detectOpts.timeout = newTimeout;
                setTimeout(() => {
                    Detector.find(device.address, detectOpts, loop);
                }, statusCheckDelay);
            } else {
                this.udp.close();
                callback(new Error("Device didn't wake in time"));
            }
            return;
        }

        this.udp.close();
        callback(null);
    };

    // begin the loop
    loop(null);
};

// NB: weird arg order due to binding
// eslint-disable-next-line
Waker.prototype._login = function(device, creds, loginOpts, callback, err) {
    if (err || !this.config.autoLogin) {
        callback();
        return;
    }

    this.emit('logging-in', device);
    const socket = newSocket({
        accountId: creds['user-credential'],
        host: device.address,
        passCode: loginOpts.passCode || '',
        pinCode: '', // assume we're registered...?
    });
    socket.retries = 0;
    socket.once('login_result', (packet) => {
        if (packet.result !== 0) {
            this.emit('login_result', packet);
        }

        if (this.config.keepSocket) {
            callback(null, socket);
        } else {
            socket.close();
            callback(null);
        }
    }).on('error', (e) => {
        socket.retries += 1;
        if (socket.retries < MAX_RETRIES && e.code === 'ECONNREFUSED') {
            this.ui.logEvent('Login connect refused; retrying soon');
            setTimeout(() => {
                // try again; system may just not be up yet
                socket.connect(device.address);
            }, 1000);
            return;
        }

        this.ui.logError('Error logging in:', e);
        callback(null); // technically, wake was successful
    });
};

module.exports = Waker;
