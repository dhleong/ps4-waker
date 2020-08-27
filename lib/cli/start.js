const { CommandOnDevice } = require('./base');

module.exports = class StartCommand extends CommandOnDevice {

    constructor(args) {
        super();

        this.titleId = args[0]; // eslint-disable-line
        if (!this.titleId) {
            throw new Error('A title id must be provided to start');
        }
    }

    async onDevice(ui, device) {
        if (device.lastInfo['running-app-titleid'] === this.titleId) {
            ui.logEvent('Requested titleId already running');
            return device;
        }

        if (device.lastInfo['running-app-titleid']) {
            const appName = device.lastInfo['running-app-name'];
            ui.logEvent(`"${appName}" already running; quitting it first...`);
            await device.sendKeys(['ps']);
        }

        return device.startTitle(this.titleId);
    }
};
