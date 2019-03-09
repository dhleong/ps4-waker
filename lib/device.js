const { EventEmitter } = require('events');
const { join: joinPath } = require('path');

const Detector = require('./detector');
const OnScreenKeyboard = require('./osk');
const Socket = require('./ps4socket');
const Waker = require('./waker');
const { delayMillis } = require('./util');

const DEFAULT_TIMEOUT = 10000;
const POST_CONNECT_SENDKEY_DELAY = 1500;

// min delay between sendKey sends
const MIN_SENDKEY_DELAY = 200;

const HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || '';


const DEFAULT_CREDS = joinPath(HOME, '.ps4-wake.credentials.json');

/**
 * Device is a high-level abstraction on top of a single
 *  PS4 device. It maintains a single, active connection
 *  to the device so repeated commands won't cause lots of
 *  annoying "connected" and "disconnected" messages to pop
 *  up on your device.
 *
 * Device is also an EventEmitter, and emits events from
 *  Waker and Socket.
 */
class Device extends EventEmitter {
    /**
     * Construct a new Device. Accepts an options map with
     *  the following keys:
     *
     * - address: (optional) IP address of a specific device.
     *            If omitted, will operate on the first device
     *            detected
     * - autoLogin: (default: true) If false, will skip logging
     *              into an account when waking the device.
     *              NOTE: if autoLogin is false, ONLY the following
     *              functions will work:
     *                  - turnOn()
     *                  - getDeviceStatus()
     *              Everything else will encounter errors!
     * - credentials: (optional) Path to a ps4-wake.credentials.json
     *                file to use. If not provided, uses one in the
     *                home directory of the current user.
     * - passCode: (optional) 4-digit string, if the account whose
     *             credentials we're using has set one
     * - timeout: How long network operations can be stalled before
     *            we give up on them and throw an error
     *
     * In addition, it respects the following keys from `detectOpts`,
     *  normally passed to Detector:
     *
     * - bindAddress: Address on which to bind the local udp detection
     *                socket, in case of multiple network interfaces.
     *                If omitted, will bind on the default interface.
     *                SEe dgram.Socket.bind() option `address`
     * - bindPort: Port on which to bind the local udp detection socket,
     *             in case you need to explicitly route. If omitted,
     *             will bind on any available port the system wishes
     *             to assign.
     */
    constructor(opts) {
        super();

        this.opts = {
            autoLogin: true,
            credentials: DEFAULT_CREDS,
            passCode: '',
            timeout: DEFAULT_TIMEOUT,
            debug: false,

            ...opts,
        };

        if (!this.opts.credentials || !this.opts.credentials.length) {
            this.opts.credentials = DEFAULT_CREDS;
        }
        if (!this.opts.timeout && this.opts.timeout !== 0) {
            this.opts.timeout = DEFAULT_TIMEOUT;
        }

        this._retryDelay = 500;

        // init clean state
        this._onClose();
    }

    /**
     * @return True if we believe we currently have an
     *  active connection to the device.
     */
    get isConnected() {
        return !!this._socket;
    }

    /**
     * Immediately close any active connection to this Device
     */
    async close() {
        const socket = this._socket;

        this.__waker = null;
        this._socket = null;
        if (!socket) return Promise.resolve();

        socket.close();
        return new Promise((resolve, reject) => {
            socket.once('error', (err) => {
                reject(err);
            });

            socket.once('disconnected', () => {
                resolve();
            });
        });
    }

    /**
     * Fetch the raw device status message from the device.
     *  If this device was detected, resolves to an object
     *  that looks like:
     *
     *  {
     *      status: "Standby",
     *      statusCode: "620",
     *      statusLine: "620 Server Standby",
     *      address: "192.168.2.3",
     *      device-discovery-protocol-version: "00020020",
     *      host-name: "My PS4",
     *      host-type: "PS4",
     *      port: "997",
     *      system-version: "04550011",
     *  }
     */
    async getDeviceStatus() {
        const result = await this._detect();
        return result.device;
    }

    /**
     * Get an active Socket instance connected to this device,
     *  turning the device on if necessary. This is a low-level
     *  method that probably won't be necessary for most users.
     */
    async openSocket() {
        return this._connect();
    }

    /**
     * Get an instance of OnScreenKeyboard, if it is possible to
     *  do so. If there is no text field on screen, this will
     *  reject with an error.
     */
    async getKeyboard() {
        if (this._osk) return this._osk;

        const socket = await this.openSocket();

        // ensure we're logged in properly
        await this.login();

        return new Promise((resolve, reject) => {
            /* eslint-disable consistent-return */
            socket.startOsk((err, packet) => {
                if (err) return reject(err);

                const osk = new OnScreenKeyboard(this, packet);
                osk.once('close', () => {
                    this._osk = null;
                });

                resolve(this._osk = osk);
            });
            /* eslint-enable consistent-return */
        });
    }

    /**
     * Send a sequence of remote key presses to this device,
     *  turning the device on if necessary. Resolves to this object.
     *  Key names are case insensitive, and can be one of:
     *
     *   up, down, left, right, enter, back, option, ps
     *
     * In addition, a key may instead be a tuple of [key, holdTime],
     *  where holdTime is an int indicating how long, in milliseconds,
     *  the key should be held for
     */
    async sendKeys(keyNames) {
        // validate keys:
        if (!keyNames || !keyNames.length) {
            throw new Error('No keys provided');
        }

        if (arguments.length !== 1 || !Array.isArray(keyNames)) {
            throw new Error('sendKeys must be called with an array');
        }

        const cleanKeys = keyNames.map((key) => {
            if (Array.isArray(key)) {
                return [key[0].toUpperCase(), key[1]];
            }
            if (typeof (key) !== 'string') {
                throw new Error(`Invalid key: ${key}; must be a string or a tuple`);
            }
            return [key.toUpperCase(), 0];
        });

        const invalid = cleanKeys.filter(key => !(key[0] in Socket.RCKeys));
        if (invalid.length) {
            throw new Error(`Unknown key names: ${invalid.map(key => key[0])}`);
        }

        const socket = await this.openSocket();

        // ensure we're logged in properly
        await this.login();

        const msSinceConnect = Date.now() - this._connectedAt;
        const delay = POST_CONNECT_SENDKEY_DELAY - msSinceConnect;
        if (delay > 0) {
            // give it some time to think---if we try to OPEN_RC
            //  too soon after connecting, the ps4 seems to disregard
            await delayMillis(delay);
        }

        socket.remoteControl(Socket.RCKeys.OPEN_RC);
        await delayMillis(MIN_SENDKEY_DELAY);

        /* eslint-disable no-await-in-loop */
        for (const [key, holdTime] of cleanKeys) {
            // near as I can tell, here's how this works:
            // - For a simple tap, you send the key with holdTime=0,
            //   followed by KEY_OFF and holdTime = 0
            // - For a long press/hold, you still send the key with
            //   holdTime=0, the follow it with the key again, but
            //   specifying holdTime as the hold duration.
            // - After sending a direction, you should send KEY_OFF
            //   to clean it up (since it can just be held forever).
            //   Doing this after a long-press of PS just breaks it,
            //   however.

            const val = Socket.RCKeys[key];
            socket.remoteControl(val, 0);

            if (holdTime) {
                await delayMillis(holdTime);
                socket.remoteControl(val, holdTime);
            }

            // clean up the keypress. As mentioned above, after holding
            //  a direction, sending KEY_OFF seems to make further
            //  presses more reliable; doing that after holding PS button
            //  breaks it, however.
            if (!holdTime || val !== Socket.RCKeys.PS) {
                socket.remoteControl(Socket.RCKeys.KEY_OFF, 0);
            }

            if (!key.endsWith('_RC')) {
                this.emit('sent-key', key);
            }

            await delayMillis(
                val === Socket.RCKeys.PS
                    ? 1000 // higher delay after PS button press
                    : MIN_SENDKEY_DELAY, // too much lower and it becomes unreliable
            );
        }
        /* eslint-enable no-await-in-loop */

        socket.remoteControl(Socket.RCKeys.CLOSE_RC);
        await delayMillis(MIN_SENDKEY_DELAY);

        return this;
    }

    /**
     * Start running the application with the given ID on this
     *  device, turning the device on if necessary. Resolves
     *  to this object.
     */
    async startTitle(titleId) {
        const socket = await this.openSocket();

        // ensure we're logged in properly
        await this.login();

        return new Promise((resolve, reject) => {
            socket.startTitle(titleId, (err) => {
                if (err) return reject(err);
                return resolve(this);
            });
        });
    }

    /**
     * Turn on this device, if it isn't already.
     *  Resolves to this object.
     */
    async turnOn() {
        await this._connect();
        return this;
    }

    /**
     * Turn off this device (put it into standby)
     *  if it isn't already. Resolves to this object.
     */
    async turnOff(/* _existingResolve */) { // eslint-disable-line
        const socket = await this._connectIfAwake();
        if (!socket) {
            // it's already off
            return this;
        }

        // ensure we're logged in properly
        await this.login();

        const isRetry = arguments.length > 0;
        const doRequestStandby = (resolve, reject) => {
            socket.requestStandby((err) => {
                if (err && isRetry) {
                    reject(err);
                } else if (err) {
                    // error; disconnecting and retrying
                    socket.close();
                    this._onClose();

                    setTimeout(() => this.turnOff(resolve, reject), this._retryDelay);
                } else {
                    resolve(this);
                }
            });
        };

        if (isRetry) {
            // we were provided a (resolve, reject) pair from the
            // retry above.
            // eslint-disable-next-line
            doRequestStandby(arguments[0], arguments[1]);
        } else {
            return new Promise(doRequestStandby);
        }
    }

    /**
     * Connect to the device and wake it, if it's not already
     *  awake, and ensure we're logged in. In general, methods
     *  that require logged-in state (such as `turnOff()`) will
     *  call this for you, so you probably don't need to worry
     *  about it yourself.
     */
    async login() {
        const errorFromResult = (result) => {
            if (!result.error) return null;
            return new Error(`Failed to login: ${result.error} (${result.result})`);
        };
        if (this._socket) {
            const { _loginResult } = this._socket;
            if (_loginResult) {
                const e = errorFromResult(_loginResult);
                if (e) throw e;
                return this;
            }
        }

        return new Promise((resolve, reject) => {
            this.once('login_result', (packet) => {
                const e = errorFromResult(packet);
                if (e) reject(e);
                else resolve(this);
            });

            this._connect(/* autoLogin: */ true);
        });
    }

    /**
     * If this device is awake, connect to it and
     *  resolve to the socket; otherwise, resolve
     *  to null.
     */
    async _connectIfAwake() {
        const isAwake = await this._detectAwake();
        if (!isAwake) return null;

        return this._connect();
    }

    /**
     * Connect to this device, waking it if necessary;
     * @return the socket, or `undefined` if autoLogin is false
     */
    async _connect(autoLogin) {
        if (this._socket) return this._socket;

        // find the right device, if any
        const result = await this._detect();

        const opts = {
            ...this.opts,
        };
        if (autoLogin !== undefined) {
            opts.autoLogin = autoLogin;
        }

        return new Promise((resolve, reject) => {
            // we don't need to return anything from this callback:
            // eslint-disable-next-line
            this._waker().wake(opts, result.device, (err, socket) => {
                if (err) return reject(err);
                if (!opts.autoLogin) return resolve();
                if (!socket) return reject(new Error('No socket'));

                if (this._socket) {
                    // close existing socket
                    this._socket.close();
                    this._onClose();
                }

                // forward socket events:
                socket.on('connected', () => {
                    this.emit('connected', this);
                }).on('ready', () => {
                    this.emit('ready', this);
                }).on('login_result', (loginResult) => {
                    // NOTE: we're more likely to get this event from the waker
                    this.emit('login_result', loginResult);
                }).on('login_retry', () => {
                    this.emit('login_retry', this);
                }).on('error', (e) => {
                    this.emit('error', e);
                }).on('disconnected', () => {
                    this._onClose();
                    this.emit('disconnected', this);
                });

                this._socket = socket;
                this._connectedAt = Date.now();
                resolve(socket);

                // checking socket.client is a hack to
                //  confirm that we're already connected
                if (socket.client) {
                    // in fact, if we have a socket here
                    //  it should be connected...
                    this.emit('connected', this);
                }
            });
        });
    }

    /**
     * Returns a Promise that resolves to `true` if
     *  this device is awake, and `false` if not;
     *  rejects if the device could not be found.
     */
    async _detectAwake() {
        const result = await this._detect();
        return result.device.status.toUpperCase() === 'OK';
    }

    /**
     * Detect any device that matches our this.opts.
     * Resolves to a map that looks like:
     *  {
     *      device: <see getDeviceStatus()>,
     *      rinfo: info
     *  }
     * TODO: more information please
     */
    async _detect() {
        return new Promise((resolve, reject) => {
            // if the address opt was provided, detect that
            //  specific device. Otherwise, detect whatever
            const fn = this.opts.address
                ? Detector.find.bind(Detector, this.opts.address)
                : Detector.findAny.bind(Detector);

            fn(this.opts, (err, device, rinfo) => {
                if (err) return reject(err);

                // NOTE: we probably don't need to pass along rinfo...
                device.address = rinfo.address; // eslint-disable-line
                device.port = device['host-request-port']; // eslint-disable-line
                return resolve({ device, rinfo });
            });
        });
    }

    /** reset state when disconnected */
    _onClose() {
        this._socket = null;
        this._osk = null;
        this._connectedAt = 0;
    }

    /** Create a new Waker instance */
    _waker() {
        if (this.__waker) return this.__waker;

        // eslint-disable-next-line
        return this.__waker = new Waker(this.opts.credentials, {
            autoLogin: this.opts.autoLogin,
            debug: this.opts.debug,
            errorIfAwake: false,
            keepSocket: true,
        }).on('need-credentials', (d) => {
            this.emit('need-credentials', d);
        }).on('device-notified', (d) => {
            this.emit('device-notified', d);
        }).on('logging-in', (d) => {
            this.emit('logging-in', d);
        }).on('login_result', (packet) => {
            // yuck
            this.emit('login_result', packet);
        });
    }
}

module.exports = Device;
