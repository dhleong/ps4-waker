const { CommandOnDevice } = require('./base');

module.exports = class OskSubmitCommand extends CommandOnDevice {

    constructor(args) {
        super();

        this.text = args[0]; // eslint-disable-line prefer-destructuring
    }

    async onDevice(ui, device) {
        const osk = await device.getKeyboard();

        if (this.text) {
            await osk.setText(this.text);
        }

        await osk.submit();
        await ui.delayMillis(450);
    }

};
