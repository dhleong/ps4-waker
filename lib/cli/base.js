const { Detector, Device, Socket } = require('../../');

const LOGGED_IN_MESSAGE = 'Logged into device! Future uses should succeed';

function setupLogging(ui, d) {
    d.on('device-notified', (device) => {
        ui.logEvent('WAKEUP sent to device...', device.address);
    });

    d.on('error', (err) => {
        ui.logError(`Unable to connect to PS4 at ${d.lastInfo.address}`, err);
    });

    d.on('logging-in', () => {
        ui.logEvent('Logging in...');
    });

    d.on('sent-key', (k) => {
        ui.logEvent('Sent key', k);
    });
}

class CommandOnDevice {

    async run(ui) {
        return this._search(ui, async (device) => {
            await this.onDevice(ui, device);
            device.close();
        });
    }

    // eslint-disable-next-line
    async onDevice(ui, device) {
        throw new Error('Not Implemented');
    }

    async _search(ui, onEach) {
        const { options, detectOpts } = ui;

        // accept the device either if we don't care, or if it's
        //  the device we're looking for
        const condition = (device, rinfo) => !options.device
            || rinfo.address === options.device;

        // if either a device is provided OR there's no timeout,
        //  we just quickly stop on the first found; otherwise,
        //  just keep going
        const detectorFunction = options.device || options.timeout === undefined
            ? this._detectorFindFirst.bind(this)
            : this._detectorFindWhen.bind(this);

        const allPromises = [];

        await detectorFunction(condition, detectOpts, (err, device, rinfo) => {
            if (err) {
                this.logError(err.message);
                return;
            }

            allPromises.push(
                onEach(this._createDevice(ui, device, rinfo)),
            );
        });

        await Promise.all(allPromises);
    }

    _createDevice(ui, deviceInfo, rinfo) {
        const {
            credentials,
            skipLogin,
            passCode,
        } = ui.options;

        const d = new Device(Object.assign({
            address: rinfo.address,
            autoLogin: !skipLogin,
            credentials,
            passCode,
            ui,
        }, ui.detectOpts));

        d.lastInfo = deviceInfo;
        d.lastInfo.address = rinfo.address;

        d.on('need-credentials', () => {
            this._requestCredentials(ui, d);
        });

        d.on('login_result', (packet) => {
            if (packet.result !== 0) {
                d.justPerformedRegistration = true;

                // eslint-disable-next-line
                this._handleLoginError(ui, d._socket, packet, false);
            } else if (d.justPerformedRegistration) {
                ui.logEvent(LOGGED_IN_MESSAGE);
            }
        });

        setupLogging(ui, d);

        return d;
    }

    _readCredentials(device) {
        const waker = device._waker(); // eslint-disable-line

        return new Promise((resolve, reject) => {
            waker.readCredentials((err, creds) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(creds);
            });
        });
    }

    async _requestCredentials(ui, device) {
        if (ui.options.failfast) {
            ui.logError('No credentials found.');
            ui.exitWith(1);
            return;
        }

        // just assume we need to register as well
        const info = device.lastInfo;
        if (info.status.toUpperCase() !== 'OK') {
            ui.logError('Device must be awake for initial registration. Please turn it on manually and try again.');
            ui.exitWith(2);
            return;
        }

        const waker = device._waker(); // eslint-disable-line
        ui.logEvent('No credentials; Use the PS4 Second Screen App and try to connect to PS4-Waker');

        const credsResult = await new Promise((resolve) => {
            waker.requestCredentials((err, creds) => {
                if (err) {
                    ui.logError(err);
                    resolve(null);
                    return;
                }

                resolve(creds);
            });
        });

        if (!credsResult) {
            ui.exitWith(1);
            return;
        }

        ui.logEvent('Got credentials! ', credsResult);

        // okay, now register
        await this._registerDevice(ui, device, credsResult);
    }

    _registerDevice(ui, device, creds) {
        // I believe we (sadly) need to bypass the Device here,
        //  since its openSocket() expects to login.

        const info = device.lastInfo;
        const argv = ui.options;

        const { address } = info;
        const sock = this._openSocket({
            accountId: creds['user-credential'],
            host: address,

            // if we're already registered, default "" is okay:
            // also, it MUST be a string
            pinCode: `${argv.pin || ''}`,

            // only necessary if you've enabled it on your account
            passCode: `${argv.pass || ''}`,
        });

        // NOTE: this looks similar to the handlers attached to the
        // Device, but this socket is not attached to that, since
        // it's *only* for registration

        sock.on('login_result', (packet) => {
            if (packet.result === 0) {
                ui.logResult(LOGGED_IN_MESSAGE);
                ui.exitWith(0);
            } else {
                this._handleLoginError(ui, sock, packet, true);
            }
        }).on('error', (err) => {
            ui.logError(`Unable to connect to PS4 at ${address}`, err);
            ui.exitWith(1);
        });
    }

    _openSocket(args) {
        return new Socket(args);
    }

    async _handleLoginError(ui, sock, packet, exitProcess) {
        switch (packet.error) {
        case 'PIN_IS_NEEDED':
            await this._requestPin(ui, sock);
            break;

        case 'PASSCODE_IS_NEEDED':
            ui.logError('Login error: Passcode is required');

            if (exitProcess) {
                ui.exitWith(4);
            }
            break;

        case 'PASSCODE_IS_UNMATCHED':
            ui.logError('Login error: Incorrect Passcode');

            if (exitProcess) {
                ui.exitWith(5);
            }
            break;

        default:
            ui.logError(`Unexpected error:${packet.result} / ${packet.error}`);
            if (exitProcess) {
                ui.exitWith(3);
            }
        }
    }

    async _requestPin(ui, sock) {
        ui.logEvent(
            "Go to 'Settings -> Mobile App Connection Settings -> Add Device'"
            + ' on your PS4 to obtain the PIN code.',
        );

        // prompt the user
        const pin = await ui.prompt('Pin code> ');
        if (!pin) {
            ui.logError('Pin is required');
            ui.exitWith(4);
            return;
        }

        sock.login(pin);
    }

    /*
     * Facade for stub-ability
     */

    _detectorFindFirst(...args) {
        return Detector.findFirst(...args);
    }

    _detectorFindWhen(...args) {
        return Detector.findWhen(...args);
    }

}

module.exports = {
    CommandOnDevice,
};
