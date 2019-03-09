module.exports = class TestUi {

    constructor(options, args) {
        this.options = Object.assign({}, options);
        this.args = args || [];
        this.detectOpts = this.options;

        this.loggedErrors = [];
        this.loggedEvents = [];
        this.loggedResults = [];

        this.onExit = () => {};
        this.promptResult = null;
    }

    async delayMillis() {
        // just nop
    }

    logError(e, ...args) {
        this.loggedErrors.push([e, ...args].join(' '));
    }

    logEvent(event) {
        this.loggedEvents.push(event);
    }

    logResult(result) {
        this.loggedResults.push(result);
    }

    exitWith(code) {
        this.exitCode = code;
        this.onExit();
    }
};
