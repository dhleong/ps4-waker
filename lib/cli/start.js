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
        return device.startTitle(this.titleId);
    }
};
