
const events = require('events');
const EventEmitter = events.EventEmitter;
const chai = require('chai');
const {Device, Socket} = require('../');

const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

// var expect = chai.expect;
chai.should();

class FakeSocket extends EventEmitter {
    constructor(device) {
        super();

        this.isOpen = true;
        this._device = device;

        this.pendingStandbyResults = [];
        this.pendingStartResults = [];

        this.startedTitles = [];
    }

    close() {
        this.isOpen = false;
    }

    remoteControl(op, holdTime) {
        if (holdTime) {
            this._device.emit('send_rc_key', op, holdTime);
        } else {
            this._device.emit('send_rc_key', op);
        }
    }

    requestStandby(cb) {
        if (!this.pendingStandbyResults.length) {
            cb(new Error('No pending requestStandby results'));
            return;
        }

        var result = this.pendingStandbyResults.shift();
        cb(result);
    }

    startTitle(titleId, cb) {
        if (!this.pendingStartResults.length) {
            cb(new Error('No pending startRequest results'));
            return;
        }

        this.startedTitles.push(titleId);

        var result = this.pendingStartResults.shift();
        cb(result);
    }
}

class FakeWaker {
    constructor() {
        this.calls = [];
        this.pendingResults = [];
    }

    wake(opts, device, cb) {
        this.calls.push([opts, device]);

        if (!this.pendingResults.length) {
            throw new Error("No pendingResult set on FakeWaker");
        }

        let result = this.pendingResults.shift();

        cb(...result);
    }
}

function assertUnexpectedError(e) {
    throw e;
}

describe("Device", function() {
    var device;
    var pendingDetectPromise;
    var waker;
    var socket;
    var events;

    var _originalSetTimeout;

    beforeEach(function() {
        device = new Device();
        waker = new FakeWaker();
        socket = new FakeSocket(device);
        events = [];

        device._retryDelay = 0;
        device._detect = () => {
            if (pendingDetectPromise) {
                return pendingDetectPromise.then(d => {
                    return {device: d, rinfo: {}};
                });
            } else {
                return Promise.reject(new Error('no pending detect'));
            }
        };
        device._waker = () => waker;

        let _deviceDotEmit = device.emit.bind(device);
        device.emit = function(...args) {
            _deviceDotEmit(...args);
            events.push(args);
        };

        // patch setTimeout so we don't have to wait
        _originalSetTimeout = global.setTimeout;
        global.setTimeout = function(cb, delay) {
            device.emit('*setTimeout', delay);
            cb();
        };
    });

    afterEach(function() {
        global.setTimeout = _originalSetTimeout;
    });

    describe("[test-util]", function() {
        it("Connecting unexpectedly errors", function() {
            return device._connect().should.be.rejectedWith(/no pending detect/);
        });
    });

    describe(".isConnected", function() {
        it("=== false by default", function() {
            device.isConnected.should.be.false;
        });

        it("=== true when connected", function() {
            // NOTE: this is not a great test....
            device._socket = {};

            device.isConnected.should.be.true;
        });
    });

    // yes yes, black box testing and all that...
    // but it's just simpler to test these util
    // functions directly
    describe("._detectAwake", function() {
        it("resolves to True when awake", function() {
            pendingDetectPromise = Promise.resolve({
                status: 'OK'
            });

            return device._detectAwake().should.become(true);
        });

        it("resolves to False when standby", function() {
            pendingDetectPromise = Promise.resolve({
                status: 'Standby'
            });

            return device._detectAwake().should.become(false);
        });
    });

    describe("._connectIfAwake", function() {
        it("resolves to null when not awake", function() {
            pendingDetectPromise = Promise.resolve({
                status: 'Standby'
            });

            return device._connectIfAwake().should.become(null);
        });

        it("connects when awake", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);
            return device._connectIfAwake().should.become(socket);
        });
    });

    describe(".turnOn", function() {
        it("Rejects when no device found", function() {
            pendingDetectPromise = Promise.reject(new Error('detect timeout'));

            return device.turnOn().should.be.rejectedWith(/detect timeout/);
        });

        it("Rejects when wake fails", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([new Error('wake timeout')]);

            return device.turnOn().should.be.rejectedWith(/wake timeout/);
        });

        it("Connects to the device detected", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);

            return device.turnOn().then(() => {

                waker.calls.should.have.length(1);
                waker.calls.should.have.deep.property(
                    '[0][1].address',
                    '123.456.789.0');

            }).catch(assertUnexpectedError);
        });
    });

    describe(".turnOff", function() {
        it("does nothing when already off", function() {
            pendingDetectPromise = Promise.resolve({
                status: 'Standby'
            });

            // it would be an error if it tried to connect
            return device.turnOff().should.become(device);
        });

        it("retries once", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);
            waker.pendingResults.push([null, socket]);
            socket.pendingStandbyResults = ["Error", null];

            return device.turnOff().should.become(device);
        });

        it("Errors on second error", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);
            waker.pendingResults.push([null, socket]);
            socket.pendingStandbyResults = ["Error", "Error2"];

            return device.turnOff().should.be.rejectedWith(/Error2/);
        });
    });

    describe(".sendKeys", function() {

        beforeEach(function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);
        });

        it("rejects empty argument", function() {
            return device.sendKeys().should.be.rejectedWith(/No keys/);
        });

        it("rejects unknown keys", function() {
            return device.sendKeys(['awesome-button']).should.be.rejectedWith(/Unknown key names/);
        });

        it("rejects varargs invocation (single value)", function() {
            return device.sendKeys('awesome-button')
                .should.be.rejectedWith(/called with an array/);
        });

        it("rejects varargs invocation (tuple)", function() {
            return device.sendKeys(['awesome-button', 2500])
                .should.be.rejectedWith(/must be a string or a tuple/);
        });


        it("Sends single direction", function() {
            return device.sendKeys(['right']).then(function() {
                events.should.deep.equal([
                    ['*setTimeout', 1500],
                    ['send_rc_key', Socket.RCKeys.OPEN_RC],
                    ['*setTimeout', 200],

                    ['send_rc_key', Socket.RCKeys.RIGHT],
                    ['send_rc_key', Socket.RCKeys.KEY_OFF],
                    ['sent_key', 'RIGHT'],
                    ['*setTimeout', 200],

                    ['send_rc_key', Socket.RCKeys.CLOSE_RC],
                    ['*setTimeout', 200],
                ]);
            });
        });

        it("Holds direction", function() {
            return device.sendKeys([['left', 1000]]).then(function() {
                events.should.deep.equal([
                    ['*setTimeout', 1500],
                    ['send_rc_key', Socket.RCKeys.OPEN_RC],
                    ['*setTimeout', 200],

                    // send "down", wait, send "held", then finally clean
                    ['send_rc_key', Socket.RCKeys.LEFT],
                    ['*setTimeout', 1000],
                    ['send_rc_key', Socket.RCKeys.LEFT, 1000],
                    ['send_rc_key', Socket.RCKeys.KEY_OFF],

                    ['sent_key', 'LEFT'],
                    ['*setTimeout', 200],

                    ['send_rc_key', Socket.RCKeys.CLOSE_RC],
                    ['*setTimeout', 200],
                ]);
            });
        });

        it("Sends single ps press", function() {
            return device.sendKeys(['ps']).then(function() {
                events.should.deep.equal([
                    ['*setTimeout', 1500],
                    ['send_rc_key', Socket.RCKeys.OPEN_RC],
                    ['*setTimeout', 200],

                    ['send_rc_key', Socket.RCKeys.PS],
                    ['send_rc_key', Socket.RCKeys.KEY_OFF],

                    ['sent_key', 'PS'],
                    ['*setTimeout', 1000],

                    ['send_rc_key', Socket.RCKeys.CLOSE_RC],
                    ['*setTimeout', 200],
                ]);
            });
        });

        it("holds PS button", function() {
            return device.sendKeys([['ps', 1000]]).then(function() {
                events.should.deep.equal([
                    ['*setTimeout', 1500],
                    ['send_rc_key', Socket.RCKeys.OPEN_RC],
                    ['*setTimeout', 200],

                    // send "down", wait, send "held"
                    ['send_rc_key', Socket.RCKeys.PS],
                    ['*setTimeout', 1000],
                    ['send_rc_key', Socket.RCKeys.PS, 1000],
                    // NOTE: we do NOT clear with KEY_OFF

                    ['sent_key', 'PS'],
                    ['*setTimeout', 1000],

                    ['send_rc_key', Socket.RCKeys.CLOSE_RC],
                    ['*setTimeout', 200],
                ]);
            });
        });
    });

    describe("startTitle", function() {
        beforeEach(function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResults.push([null, socket]);
        });

        it("works", function() {
            socket.pendingStartResults.push(null);

            return device.startTitle("CUSA00123").then(res => {
                res.should.deep.equal(device);
                socket.startedTitles.should.deep.equal([
                    'CUSA00123'
                ]);
            })
            .catch(assertUnexpectedError);
        });
    });
});
