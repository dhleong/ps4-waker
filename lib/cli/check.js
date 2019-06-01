const { CommandOnDevice } = require('./base');

module.exports = class CheckCommand extends CommandOnDevice {

    get requiresLogin() { return false; }

    async onDevice(ui, device) {
        const info = device.lastInfo;
        ui.logResult(info);

        switch (info.statusCode) {
        case '200':
            ui.exitWith(0);
            break;
        case '620':
            // "standby"
            ui.exitWith(1);
            break;
        default:
            ui.exitWith(2);
        }
    }
};
