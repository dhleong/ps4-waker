const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

/**
 * Default user interface type that logs things directly; tests could
 * use the same interface and implement differently, as could a JSON
 * output mode.
 */
class StandardUserInterface {
    /**
     * Create an instance that does not contain any options, and
     * is only to be used for log* methods, etc.
     */
    static createForUI() {
        return new StandardUserInterface({});
    }

    constructor(options, detectOpts) {
        if (!options) throw new Error('`options` is required');

        this.options = options;
        this.detectOpts = detectOpts || options;
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

    logEvent(...args) {
        console.log(...args);
    }

    logResult(result) {
        if (typeof result === 'string') {
            console.log(result);
        } else {
            console.log(JSON.stringify(result, null, 2));
        }
    }

    requireRoot(err, effectiveCredentialsPath) {
        if (this.options.failfast) {
            this.logError(err);
            return;
        }

        const args = process.argv.concat(['--user-id', process.getuid()]);
        if (!this.options.credentials || !this.options.credentials.length) {
            // if we aren't already explicitly passing a credentials file
            // path, do so now (to avoid potential confusion)
            args.push('-c');
            args.push(effectiveCredentialsPath);
        } else {
            // if we *did* provide credentials, we need to make sure
            // the full path is resolved, just in case sudo changes
            // things in weird ways (for example, if they used ~ in
            // the path, and being sudo changes the meaning of that)
            const cIndex = args.indexOf('-c');
            const credsIndex = args.indexOf('--credentials');
            const indexOfFlag = cIndex !== -1 ? cIndex : credsIndex;
            const indexOfPath = indexOfFlag + 1;
            args[indexOfPath] = path.resolve(args[indexOfPath]);
        }

        this.logEvent(err.message);
        this.logEvent('Attempting to request root permissions now (we will relinquish them as soon as possible):');
        this.logEvent(`  sudo ${args.join(' ')}`);

        const result = spawnSync('sudo', args, {
            stdio: 'inherit',
        });

        if (result.error) {
            if (result.error.errno === 'ENOENT') {
                // sudo not available; just dump the original error
                this.logError(err.stack);
            } else {
                this.logError(err);
            }
        }

        this.exitWith(result.status);
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
