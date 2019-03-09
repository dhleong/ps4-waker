#!/usr/bin/env node

const { StandardUserInterface } = require('./cli/ui/standard');

// const SearchCommand = require('./cli/search');
const WakeCommand = require('./cli/wake');

async function exec(ui, CmdConstructor, ...args) {
    let c;
    try {
        c = new CmdConstructor(...args);
    } catch (e) {
        ui.logError(e);
        ui.exitWith(1);
        return;
    }

    await c.run(ui);
}

async function main() {
    const options = {
        // timeout: 10000,
    };

    const ui = new StandardUserInterface(options);

    // TODO extract options, figure out which command to run, etc.
    await exec(ui, WakeCommand);
}

// eslint-disable-next-line
main().catch(e => console.error('Unexpected error', e));
