const { CommandOnDevice } = require('./base');

module.exports = class RemoteCommand extends CommandOnDevice {

    constructor(args) {
        super();

        this.keyNames = args.map((rawKey) => {
            const parts = rawKey.split(':');
            if (parts.length === 1) {
                // simple key
                return rawKey;
            }

            // held key
            return [parts[0], parseInt(parts[1], 10)];
        });
    }

    async onDevice(ui, device) {
        return device.sendKeys(this.keyNames);
    }
};
