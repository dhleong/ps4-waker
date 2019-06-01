const { CommandOnDevice } = require('./base');

module.exports = class PinSubmitCommand extends CommandOnDevice {

    constructor(args) {
        super();

        this.pinCode = args[0]; // eslint-disable-line
        if (!this.pinCode) {
            throw new Error('A pin code must be provided');
        }
    }

    async onDevice(ui, device) {
        let creds;
        try {
            creds = await this._readCredentials(device);
        } catch (e) {
            // no credentials; request them
            return this._requestCredentials(ui, device);
        }

        // trigger pinCode registration flow
        return this._registerDevice(ui, device, creds);
    }

};
