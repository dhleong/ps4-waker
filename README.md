ps4-waker
=========

Wake your PS4 over LAN with help from the Playstation App. Acknowledgements
to [Darryl Sokoloski](https://github.com/dsokoloski/ps4-wake) for his work
with the basic wake packet structures, etc. Unlike his implementation, however,
it is not necessary to own a Vita or to look at any packets with `ps4-waker`.

### Requirements

- A PS4, of course
- The Playstation App, installed and setup on your phone or tablet of choice
- A computer with a network card whose MAC address can be spoofed
- All of the above on the same LAN

### Usage

[![NPM](https://nodei.co/npm/ps4-waker.png?mini=true)](https://nodei.co/npm/ps4-waker/)

Installing globally provides the `ps4-waker` executable:

```
ps4-waker - Wake your PS4 (with help from the Playstation App)

Usage:
  ps4-waker [options]
  ps4-waker --help | -h                       Shows this help message.
  ps4-waker --version | -v                    Show package version.

Options:
  --credentials | -c           Specify credentials file
  --device | -d                Specify IP address of a specific PS4
  --failfast                   Don't request credentials if none
  --timeout | -t               Timeout in milliseconds
```

For most cases, simply run the executable with no arguments. On first run,
you will be asked to connect to the "PS4-Waker" Playstation. After that, future
executions should just work.

### How it works

In order to get the credentials, `ps4-waker` pretends to be another PS4 on your
local network, responding to the right broadcasts with the appropriate messages,
and simulating the connection handshake that the app makes with a real PS4.

Then, it spoofs the mac address of the device that connected to it, as the PS4
appears to match the credentials with the device. Finally, it simply sends the
correct "wake" packet to the real PS4, and restores the original MAC address.

### Notes

This has been tested on a MacBook Pro running the OSX Mavericks. Pull requests
are welcome if extra twiddling is needed for smooth operation on Windows or Linux.

### Disclaimer

I take no responsibility for your usage of this code, whatsoever. By using this
code, directly or indirectly, you agree that I shall not be held responsible 
in any way for anything that may happen to you or any of your devices, etc.
as a result, directly or indirectly, of your use of this project, in any way 
whatsoever, etc. etc.
