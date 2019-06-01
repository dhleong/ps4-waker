const chai = require('chai');

const TestUi = require('./test-ui');
const TestCommand = require('./test-command');

chai.should();

describe('Command', function() {
    let command;
    let ui;

    beforeEach(function() {
        command = new TestCommand();
        ui = new TestUi();
        ui.onExit = () => {
            command.devices.forEach(d => d.emit('exit'));
        };
    });

    it('shows error when no matching device could be found', async function() {
        command.needsCredentials = true;
        command.detectedQueue.push([new Error('Could not detect any matching PS4 device')]);
        await command.run(ui);

        ui.loggedErrors.should.not.be.empty;
        ui.loggedErrors[0].should.contain('any matching');
        ui.exitCode.should.not.equal(0);
    });

    it('ensures device is awake before registration', async function() {
        command.needsCredentials = true;
        command.detectedQueue.push([null, {
            status: 'Standby',
        }, {address: 'address'}]);
        await command.run(ui);

        ui.loggedErrors.should.not.be.empty;
        ui.loggedErrors[0].should.contain('must be awake');
        ui.exitCode.should.not.equal(0);
    });

    it('handles creds without pin', async function() {
        command.detectedQueue.push([null, {
            status: 'Ok',
        }, {address: 'address'}]);
        command.loginResultPackets = [{
            result: 1,
            error: 'PIN_IS_NEEDED',
        }, {
            result: 0
        }];

        let didPrompt = false;
        ui.prompt = async () => {
            didPrompt = true;
            return '12345678';
        };

        await command.run(ui);

        ui.loggedEvents.should.not.be.empty;
        ui.loggedEvents[0].should.contain('obtain the PIN');
        didPrompt.should.be.true;

        ui.loggedEvents.should.have.lengthOf(2);
        ui.loggedEvents[1].should.contain('succeed');
    });

    it('does not get hung up on login errors', async function() {
        command.detectedQueue.push([null, {
            status: 'Ok',
        }, {address: 'address'}]);
        command.loginResultPackets = [{
            result: 21,
            error: 'LOGIN_FAILED',
        }];

        await command.run(ui);

        ui.loggedErrors.should.not.be.empty;
        ui.exitCode.should.not.equal(0);
    });

    it('handles registration against the UI', async function() {
        command.needsCredentials = true;
        command.detectedQueue.push([null, {
            status: 'Ok',
        }, {address: 'address'}]);
        command.credentialsResult = {
            'user-credential': '1234',
        };
        command.loginResultPackets = [{
            result: 1,
            error: 'PIN_IS_NEEDED',
        }, {
            result: 0
        }];

        let didPrompt = false;
        ui.prompt = async () => {
            didPrompt = true;
            return '12345678';
        };

        await command.run(ui);

        ui.loggedEvents.should.not.be.empty;
        ui.loggedEvents[0].should.contain('No credentials;');
        ui.loggedEvents[1].should.contain('Got credentials!');
        ui.loggedEvents[2].should.contain('obtain the PIN');
        didPrompt.should.be.true;

        ui.loggedResults.should.have.lengthOf(1);
        ui.loggedResults[0].should.contain('succeed');
        ui.exitCode.should.equal(0);
    });

    it('fails early in invalid --skip-login use', async function() {
        command.detectedQueue.push([null, {
            status: 'Ok',
        }, {address: 'address'}]);

        ui.options.skipLogin = true;

        await command.run(ui);

        ui.loggedErrors.should.not.be.empty;
        ui.loggedErrors[0].should.contain('--skip-login may not be used');
        ui.exitCode.should.not.equal(0);
    });
});
