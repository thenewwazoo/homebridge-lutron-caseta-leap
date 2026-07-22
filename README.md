<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-lutron"><img alt="homebridge-lutron" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-lutron/latest/branding/Homebridge_x_Lutron.png" width="600px"></a>
</p>
<span align="center">

## homebridge-lutron

Homebridge plugin to integrate Lutron Caséta devices into HomeKit

[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-lutron/latest?label=latest)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-lutron)
[![npm](https://img.shields.io/npm/v/@homebridge-plugins/homebridge-lutron/beta?label=beta)](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions)<br>
[![npm](https://img.shields.io/npm/dt/@homebridge-plugins/homebridge-lutron)](https://www.npmjs.com/package/@homebridge-plugins/homebridge-lutron)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.gg/bHjKNkN)

</span>

### Plugin Information

- This plugin allows you to view and control your [Lutron Caséta](https://www.casetawireless.com) devices within HomeKit. The plugin:
  - connects to a Lutron Smart Bridge (Caséta Smart Bridge 2 / Pro, or RA2 Select) over your local network using the LEAP protocol
  - pairs with the bridge from the plugin settings screen by a physical button press, so no cloud account is required
  - can optionally expose devices over Matter as well as HomeKit

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v22` or `v24` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v2` - refer to link for more information and installation instructions.
  - A Lutron Smart Bridge that supports the LEAP protocol (the Caséta Smart Bridge 2 `L-BDG2-WH`, Smart Bridge Pro `L-BDGPRO2-WH`, or RA2 Select main repeater). The original non-LEAP Smart Bridge is not supported.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-lutron/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-lutron/wiki/Configuration)
- [Beta Version](https://github.com/homebridge-plugins/homebridge-lutron/wiki/Beta-Version)
- [Node Version](https://github.com/homebridge-plugins/homebridge-lutron/wiki/Node-Version)

### Supported Devices

- Wall dimmers
- Wall switches
- Pico remotes (2, 3 and 4 button, including raise/lower and scene variants)
- Serena tilt-only wood blinds
- Occupancy / vacancy sensors

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-lutron/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-lutron/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-lutron/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To Brandon Matthews: the original creator of this plugin and the author of the underlying [`lutron-leap`](https://www.npmjs.com/package/lutron-leap) library.
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with Lutron and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
