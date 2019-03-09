
const { CommandOnDevice } = require('./base');

module.exports = class StandbyCommand extends CommandOnDevice {
    async onDevice(ui, device) {
        return device.turnOff();
    }
};
