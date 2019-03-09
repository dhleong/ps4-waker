const readline = require('readline');

/**
 * Default user interface type that logs things directly; tests could
 * use the same interface and implement differently, as could a JSON
 * output mode.
 */
class StandardUserInterface {

    constructor(options) {
        if (!options) throw new Error('`options` is required');

        this.options = options;
        this.detectOpts = options;
    }

    delayMillis(millis) {
        return new Promise((resolve) => {
            setTimeout(resolve, millis);
        });
    }

    /* eslint-disable no-console */

    logError(e, ...args) {
        console.error(e, ...args);
    }

    logResult(result) {
        if (typeof result === 'string') {
            console.log(result);
        } else {
            console.log(JSON.stringify(result, null, 2));
        }
    }

    /* eslint-enable no-console */

    async prompt(prompt) {
        return new Promise((resolve) => {
            readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            }).question(prompt, resolve);
        });
    }

    exitWith(code) {
        process.exit(code);
    }
}

module.exports = StandardUserInterface;
