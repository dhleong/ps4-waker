var events = require('events')
  , EventEmitter = events.EventEmitter
  , Detector = require('./detector')
  , Socket = require('./ps4socket')
  , Waker = require('./waker')

  , DEFAULT_TIMEOUT = 10000
  , HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE || ''
  , DEFAULT_CREDS = require('path').join(HOME, '.ps4-wake.credentials.json');

function delayMillis(millis) {
    return new Promise((resolve) => {
        setTimeout(resolve.bind(resolve, true), millis);
    });
}

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
     * - credentials: (optional) Path to a ps4-wake.credentials.json
     *                file to use. If not provided, uses one in the
     *                home directory of the current user.
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

        this.opts = Object.assign({
            credentials: DEFAULT_CREDS,
            timeout: DEFAULT_TIMEOUT,
            debug: false,
        }, opts);

        this._socket = null;
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
    close() {
        if (this._socket) {
            this._socket.close();
        }
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
        let result = await this._detect();
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
        keyNames = keyNames.map(key => {
            if (Array.isArray(key)) {
                key[0] = key[0].toUpperCase();
                return key;
            } else {
                return [key.toUpperCase(), 0];
            }
        });

        let invalid = keyNames.filter(key => !(key[0] in Socket.RCKeys));
        if (invalid.length) {
            throw new Error("Unknown key names: " + invalid);
        }

        let socket = await this.openSocket();

        // give it some time to think---if we try to OPEN_RC
        //  too soon after connecting, the ps4 seems to disregard
        await delayMillis(1500);

        socket.remoteControl(Socket.RCKeys.OPEN_RC);
        await delayMillis(200);

        for (var i=0; i < keyNames.length; ++i) {
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

            const [key, holdTime] = keyNames[i];
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
                this.emit('sent_key', key);
            }

            await delayMillis(val === Socket.RCKeys.PS
                ? 1000 // higher delay after PS button press
                : 200  // too much lower and it becomes unreliable
            );
        }

        socket.remoteControl(Socket.RCKeys.CLOSE_RC);
        await delayMillis(200);

        return this;
    }

    /**
     * Start running the application with the given ID on this
     *  device, turning the device on if necessary. Resolves
     *  to this object.
     */
    async startTitle(titleId) {
        let socket = await this.openSocket();

        return new Promise((resolve, reject) => {
            socket.startTitle(titleId, err => {
                if (err) return reject(err);
                resolve(this);
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
    async turnOff(/* _existingResolve */) {
        let socket = await this._connectIfAwake();
        if (!socket) {
            // it's already off
            return this;
        }

        let isRetry = arguments.length > 0;
        let doRequestStandby = (resolve, reject) => {
            socket.requestStandby(err => {
                if (err && isRetry) {
                    reject(err);

                } else if (err) {
                    // error; disconnecting and retrying
                    socket.close();
                    this._socket = null;

                    setTimeout(() => this.turnOff(resolve, reject), 500);
                } else {
                    resolve(this);
                }
            });
        };

        if (isRetry) {
            // we were provided a (resolve, reject) pair from the
            // retry above.
            doRequestStandby(arguments[0], arguments[1]);
        } else {
            return new Promise(doRequestStandby);
        }
    }

    /**
     * If this device is awake, connect to it and
     *  resolve to the socket; otherwise, resolve
     *  to null.
     */
    async _connectIfAwake() {
        let isAwake = await this._detectAwake();
        if (!isAwake) return null;

        return this._connect();
    }

    /**
     * Connect to this device, waking it if necessary;
     * @return the socket
     */
    async _connect() {
        if (this._socket) return this._socket;

        // find the right device, if any
        let result = this._detect();

        return new Promise((resolve, reject) => {
            this._waker().wake(this.opts, result.device, (err, socket) => {
                if (err) return reject(err);
                if (!socket) return reject(new Error("No socket"));

                if (this._socket) {
                    // close existing socket
                    this._socket.close();
                }

                // forward socket events:
                socket.on('connected', () => {
                    this.emit('connected', this);
                }).on('ready', () => {
                    this.emit('ready', this);
                }).on('login_result', (result) => {
                    this.emit('login_result', result);
                }).on('login_retry', () => {
                    this.emit('login_retry', this);
                }).on('error', err => {
                    this.emit('error', err);
                }).on('disconnected', () => {
                    this._socket = null;
                    this.emit('disconnected', this);
                });

                this._socket = socket;
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
        let result = await this._detect();
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
            let fn = this.opts.address
                ? Detector.find.bind(Detector, this.opts.address)
                : Detector.findAny.bind(Detector);

            fn(this.opts, (err, device, rinfo) => {
                if (err) return reject(err);

                // NOTE: we probably don't need to pass along rinfo...
                device.address = rinfo.address;
                device.port = device['host-request-port'];
                resolve({device: device, rinfo: rinfo});
            });
        });
    }

    /** Create a new Waker instance */
    _waker() {
        return new Waker(this.opts.credentials, {
            keepSocket: true
          , errorIfAwake: false
          , debug: this.opts.debug
        }).on('need-credentials', d => {
            this.emit('need-credentials', d);
        }).on('device-notified', d => {
            this.emit('device-notified', d);
        }).on('logging-in', d => {
            this.emit('logging-in', d);
        });
    }

}

module.exports = Device;
