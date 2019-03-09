
const { CommandOnDevice } = require('./base');

module.exports = class WakeCommand extends CommandOnDevice {
    async onDevice(ui, device) {
        return device.turnOn();
    }
};
