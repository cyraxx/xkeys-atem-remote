# xkeys-atem-remote

**A way to remote control Blackmagic Design ATEM switchers using XKeys USB keypads.
It is configurable to your needs and designed to play nice with other applications (e.g. vMix) accessing the XKeys at the same time.**

Should run on any platform supported by [node-hid](https://github.com/node-hid/node-hid) (tested on macOS and Windows 10).

## Demo

[![](http://img.youtube.com/vi/EDOVnH0-Fw4/0.jpg)](http://www.youtube.com/watch?v=EDOVnH0-Fw4 "Demo Video")<br>
*ATEM Software Control shown for demonstration purposes only. The script talks directly to the switcher and does not require the ATEM software to be running.*

## Features

Currently supports:
* Source selection
* Cut and Auto transitions
* T-bar transitions (for XKE-124 T-bar)
* Transition mode selection
* Wipe pattern selection
* FTB
* XKeys backlight intensity control

Additional functions are pretty trivial to implement, these are just the ones I happened to need so far.

Note that M/Es are not currently supported (every command is sent to M/E 0 and in state updates from the switcher the M/E is ignored).

## LED backlight

Where applicable, button backlights are used as indicators similar to a regular switcher control panel.

When the connection to the ATEM is lost, all source keys will start flashing. The connection is automatically re-established in the background.

# Usage

## Installation

* Install [node.js](https://nodejs.org/) and [yarn](https://classic.yarnpkg.com/en/docs/install/)
* Run `yarn install`
* Edit `config.json5` to your liking

## Running

* Run `node index.js`

# Acknowledgements

Based on the [atem](https://github.com/Dev1an/Atem) and [xkeys](https://github.com/SuperFlyTV/xkeys) node modules.

Custom ATEM packets implemented using the [SKAARHOJ protocol documentation](https://www.skaarhoj.com/fileadmin/BMDPROTOCOL.html).
