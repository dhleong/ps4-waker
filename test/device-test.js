
const events = require('events');
const EventEmitter = events.EventEmitter;
const chai = require('chai');
const Device = require('../').Device;

const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

// var expect = chai.expect;
chai.should();

class FakeSocket extends EventEmitter {
    constructor() {
        super();
    }

    close() {
    }
}

class FakeWaker {
    constructor() {
        this.calls = [];
        this.pendingResult = null;
    }

    wake(opts, device, cb) {
        this.calls.push([opts, device]);

        if (!this.pendingResult) {
            throw new Error("No pendingResult set on FakeWaker");
        }

        cb(...this.pendingResult);
        this.pendingResult = null;
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

    beforeEach(function() {
        device = new Device();
        waker = new FakeWaker();
        socket = new FakeSocket();

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

            waker.pendingResult = [null, socket];
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

            waker.pendingResult = [new Error('wake timeout')];

            return device.turnOn().should.be.rejectedWith(/wake timeout/);
        });

        it("Connects to the device detected", function() {
            pendingDetectPromise = Promise.resolve({
                address: '123.456.789.0',
                status: 'OK'
            });

            waker.pendingResult = [null, socket];

            return device.turnOn().then(() => {

                waker.calls.should.have.length(1);
                waker.calls.should.have.deep.property(
                    '[0][1].address',
                    '123.456.789.0');

            }).catch(assertUnexpectedError);
        });
    });

    describe(".turnOff", function() {
        // TODO
        it("retries once");
    });
});
