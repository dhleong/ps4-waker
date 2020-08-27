const { CommandOnDevice } = require('./base');

module.exports = class WakeCommand extends CommandOnDevice {

    get requiresLogin() { return false; }

    async onDevice(ui, device) {
        // don't timeout, since this is also used for initial
        // registration, and we want to wait for pin entry
        return device.turnOn(/* timeOut = */false);
    }
};
