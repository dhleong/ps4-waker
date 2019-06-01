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
    }

    async onDevice(ui, device) {
        this.devices.push(device);

        const sock = this._createFakeSocket();
        ['ready', 'login_result'].forEach((event) => {
            // forward like a real device would do
            sock.on(event, (...args) => device.emit(event, ...args));
        });

        // eslint-disable-next-line
        device._socket = sock;

        const promise = new Promise((resolve) => {
            device.once('ready', () => resolve());
            device.once('exit', () => resolve());
        });

        if (this.needsCredentials) {
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
        } else {
            this._emitNextLoginResult(sock);
        }

        return promise;
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
        setTimeout(() => this._emitNextLoginResult(this._openedSocket), 1);
    }

    _openSocket() {
        this._openedSocket = this._createFakeSocket();
        return this._openedSocket;
    }

    _emitNextLoginResult(socket) {
        const packet = this.loginResultPackets.shift();
        if (!packet) throw new Error('Insufficient pending login results');

        socket.emit('login_result', packet);

        if (packet && packet.result === 0) {
            socket.emit('ready');
        }
    }

    _createFakeSocket() {
        const socket = new EventEmitter();
        socket.close = () => {
            setTimeout(() => socket.emit('disconnected'));
        };
        socket.login = () => {
            this._emitNextLoginResult(socket);
        };
        return socket;
    }

};
