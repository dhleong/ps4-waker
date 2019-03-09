
const { CommandOnDevice } = require('./base');

module.exports = class SearchCommand extends CommandOnDevice {
    async onDevice(ui, device) {
        ui.logResult(device.lastInfo);
    }
};
