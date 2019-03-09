const EventEmitter = require('events');
const { CommandOnDevice } = require('../../lib/cli/base');

module.exports = class TestCommand extends CommandOnDevice {

    constructor() {
        super();
        this.devices = [];
        this.detectedQueue = [];
        this.needsCredentials = false;
        this.credentialsResult = new Error();
        this.loginResultPackets = [{
            result: 0,
        }];

        this.socket = new EventEmitter();
        this.socket.login = () => {
            const result = this.loginResultPackets.shift();
            this.socket.emit('login_result', result);
        };
    }

    async onDevice(ui, device) {
        this.devices.push(device);
        if (this.needsCredentials) {
            const promise = new Promise((resolve) => {
                device.once('ready', () => resolve());
                device.once('exit', () => resolve());
            });

            // eslint-disable-next-line
            device._waker = () => ({
                requestCredentials: (callback) => {
                    if (this.credentialsResult instanceof Error) {
                        callback(this.credentialsResult);
                    } else {
                        callback(null, this.credentialsResult);
                    }
                },
            });

            device.emit('need-credentials', device.lastInfo);

            return promise;
        }

        return Promise.resolve();
    }

    async _detectorFindWhen(_, __, callback) {
        const next = this.detectedQueue.shift();
        if (!next) throw new Error('No devices enqueued');

        return callback(...next);
    }

    async _detectorFindFirst(_, __, callback) {
        return this._detectorFindWhen(_, __, callback);
    }

    // eslint-disable-next-line
    _registerDevice(ui, device, creds) {
        super._registerDevice(ui, device, creds); // eslint-disable-line
        setTimeout(() => {
            const result = this.loginResultPackets.shift();
            this.socket.emit('login_result', result);
        }, 1);
    }

    _openSocket() {
        return this.socket;
    }
};
