const { CommandOnDevice } = require('./base');

module.exports = class SearchCommand extends CommandOnDevice {

    get requiresLogin() { return false; }

    async onDevice(ui, device) {
        ui.logResult(device.lastInfo);
    }
};
