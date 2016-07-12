ps4-waker
=========

Wake your PS4 over LAN (and a few other tricks) with help from 
the Playstation App.

### Requirements

- A PS4, of course
- The Playstation App, installed on your phone or tablet of choice
- A computer
- All of the above on the same LAN

### Usage

[![NPM](https://nodei.co/npm/ps4-waker.png?mini=true)](https://nodei.co/npm/ps4-waker/)

Installing globally provides the `ps4-waker` executable:

```
ps4-waker - Wake your PS4 (with help from the Playstation App)

Usage:
  ps4-waker [options]
  ps4-waker search [-t]                       Search for devices
  ps4-waker standby [-d <ip>]                 Request the device enter standby/rest mode
  ps4-waker start [titleId]                   Start a specified title id
  ps4-waker --help | -h                       Shows this help message.
  ps4-waker --version | -v                    Show package version.

Options:
  --bind | -b                  Bind to a specific ip, if you have multiple
  --credentials | -c           Specify credentials file
  --device | -d                Specify IP address of a specific PS4
  --failfast                   Don't request credentials if none
  --timeout | -t               Timeout in milliseconds
  --pin <pin-code>             Manual pin-code registration

Searching:
  If no timeout is provided to search, it will stop on the first result
```

For most cases, simply run the executable with no arguments. On first run,
you will be asked to connect to the "PS4-Waker" Playstation, and to turn on
your PS4 and go to the "add devices" screen to get a pin code, and enter that. 
After that, future executions should just work.

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
PS4 detection as `require('ps4-waker').Detector`. In the future, these may
be broken out into a separate library, perhaps with more features from the app,
such as "on screen keyboard" simulation. 
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
