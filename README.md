ps4-waker [![Build Status](http://img.shields.io/travis/dhleong/ps4-waker.svg?style=flat)](https://travis-ci.org/dhleong/ps4-waker)
=========

Wake your PS4 over LAN (and a few other tricks) with help from
the Playstation App.

### Requirements

- A PS4, of course
- The PS4 Second Screen App, installed on your phone or tablet of choice
- A computer
- All of the above on the same LAN

### Usage

[![NPM](https://nodei.co/npm/ps4-waker.png?mini=true)](https://nodei.co/npm/ps4-waker/)

Installing globally provides the `ps4-waker` executable:

```
ps4-waker - Wake your PS4 (and more!) with help from the Playstation App

Usage:
  ps4-waker [options]                                   Wake PS4 device(s)
  ps4-waker [options] osk-submit (text)                 Submit the OSK, optionally providing the text
  ps4-waker [options] remote <key-name> (...<key-name>) Send remote key-press event(s)
  ps4-waker [options] search                            Search for devices
  ps4-waker [options] standby                           Request the device enter standby/rest mode
  ps4-waker [options] start <titleId>                   Start a specified title id
  ps4-waker --help | -h | -?                  Shows this help message.
  ps4-waker --version | -v                    Show package version.

Options:
  --bind | -b <ip>             Bind to a specific network adapter IP, if you have multiple
  --bind-port | -p <port>      Bind on a specific port, if you need to route specifically
  --credentials | -c <file>    Specify credentials file
  --device | -d <ip>           Specify IP address of a specific PS4
  --failfast                   Don't request credentials if none
  --timeout | -t <time>        Stop searching after <time> milliseconds; the default timeout 
                                unspecified is 10 seconds
  --pin <pin-code>             Manual pin-code registration

Device selection:
  For any command, there are four possible conditions based on the flags you've specified:
    1. Neither -t nor -d: Will act on the first device found; this is for households
        with a single device on the network
    2. Just -t: Will act on every device found within <time> millseconds
    3. Just -d: Will search for at most 10 seconds (the default timeout) for and only act on
        the provided device, quitting if found
    4. Both -t and -d: Will search for at most <time> seconds for and only act on the
        provided device, qutting early if found.

Key names:
  Button names are case insensitive, and can be one of:
    up, down, left, right, enter, back, option, ps
  You cannot send the actual x, square, etc. buttons
  A string of key presses may be provided, separated by spaces,
   and they will be sent sequentially.
  In addition, a key name may be followed by a colon and a duration in
   milliseconds to hold that key, eg: ps4-waker remote ps:1000
```

For most cases, simply run the executable with no arguments. On first run,
you will be asked to connect to the "PS4-Waker" Playstation, and to turn on
your PS4 and go to the "add devices" screen to get a pin code, and enter that.
After that, future executions should just work.

### Scripting API

For finer control, especially in a home-automation context, you may want to use
the `Device` API. The `Device` API is a high-level abstraction on top of the old
Waker and Detector APIs (which are still around, of course, if you need them).
You use it like this:

```javascript
const {Device} = require('ps4-waker');

var ps4 = new Device();
ps4.turnOn().then(() => ps4.close());
```

Most methods on the `Device` object return a Promise and can be used with async/await.
The `Device` will automatically attempt to maintain an active connection to your device
until you explicitly `close()` it or call `turnOff()`. This will let you issue
subsequent commands like `.startTitle()` or `.sendKeys()` without seeing the annoying
"A companion app has connected/disconnected" messages all the time.

The API alone cannot register with your device automatically, but it has the same
defaults for credentials file location as the CLI, so you can do the initial
registration on the CLI and expect the API to work (provided you pass the same
configuration).

For more information, including how to specify specific devices on multi-device
networks, see the documentation comments in [device.js](lib/device.js).

### How it works

In order to get the credentials, `ps4-waker` pretends to be another PS4 on your
local network, responding to the right broadcasts with the appropriate messages,
and simulating the connection handshake that the app makes with a real PS4.

With those in hand, `ps4-waker` connects to the real PS4 and communicates
with the same TCP protocol the app uses to authenticate itself as a connected
Device---it will show up as "PS4 Waker" in your device management.

Once registered as a connected Device, it can simply send the correct "wake"
packet with the initially-fetched credentials.

### Notes

This has been tested on a MacBook Pro running the OSX Yosemite. Using the new
TCP connection, we don't need to do any wacky MAC spoofing, so any machine
should work. Pull requests are welcome, however, if extra twiddling is needed 
for smooth operation on Windows or Linux.

The TCP connection API is exposed via `require('ps4-waker').Socket`, and the
PS4 detection as `require('ps4-waker').Detector`. As noted above, though,
for most cases you probably should prefer the `Device` API via
`require('ps4-waker').Device`.
See the sources in the lib directory for more information on these modules.

### Acknowledgements

Acknowledgements
to [Darryl Sokoloski](https://github.com/dsokoloski/ps4-wake) for his work
with the basic wake packet structures, etc. Unlike his implementation, however,
it is not necessary to own a Vita or to look at any packets with `ps4-waker`.

### Disclaimer

I take no responsibility for your usage of this code, whatsoever. By using this
code, directly or indirectly, you agree that I shall not be held responsible
in any way for anything that may happen to you or any of your devices, etc.
as a result, directly or indirectly, of your use of this project, in any way
whatsoever, etc. etc.
