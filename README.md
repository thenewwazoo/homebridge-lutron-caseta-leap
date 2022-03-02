# LutronCasetaLeap

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

This is a plugin that interfaces between Homebridge (and HomeKit) and the [Lutron Caséta Smart Bridge](https://www.casetawireless.com/products/expansion-kits-and-smart-bridge). Specifically, this adds support for:

* [Serena Smart Wood Blinds](https://www.serenashades.com),
* [Pico Remotes](https://www.lutron.com/en-US/Products/Pages/Components/PicoWirelessController/Models.aspx)
* [Caseta Occupancy Sensors](https://www.lutron.com/en-US/Pages/Sensors/touchless.aspx)

Because HomeKit control for dimmers and switches, etc, are natively supported by the Smart Bridge, this plugin doesn't implement them. If you want to help out and add support, please see the [To-do and contributions](#to-do-and-contributions) section at the bottom of this document.

This plugin makes use of the [lutron-leap-js](https://github.com/thenewwazoo/lutron-leap-js) library, which implements the Lutron LEAP protocol, used by the Lutron mobile apps and third-party integrations. It has been tested with the non-Pro and Pro bridges, and may also be able to work with RA2 (but has not been tested).

## Installation and Setup

Either run `npm -i homebridge-lutron-caseta-leap` in your Homebridge installation directory or install it using [`homebridge-config-ui-x`](https://github.com/oznu/homebridge-config-ui-x#readme).

Once that's done, open the configuration screen:

![view of all installed plugins](assets/plugin_top_view.png)

Click "Settings" for this plugin. You should see your bridges listed. I only have one, but if you have more, they'll appear here. They are discovered automatically.

![view of discovered bridges](assets/unassociated.png)

Click on "Associate", and then press the button on the back of your Smart Bridge 2 device within 30 seconds. The UI will update, and if all goes well, you will see:

![view of a single successfully-connected bridge](assets/associated.png)

Click the save button at the bottom, and you're done.

## User Information

### Adding and Removing Devices

In order to add a device to the hub, you must use the Lutron app to pair the device. This plugin will re-scan the known devices 30 seconds after you announce the device. This means you must **complete adding the device in less than 30 seconds** in order for the device to appear in HomeKit without restarting the plugin. If you _do_ miss that deadline, don't worry: the device will appear after you restart Homebridge.

To remove a device from Homebridge after you're removed it from the Smart Bridge 2, you must [delete the cached accessory out of Homebridge manually](https://github.com/oznu/homebridge-config-ui-x/issues/525).

### Pico Remote Button Mapping

Pico buttons are mapped according to the following diagram:

![iOS Home App and Eve app screenshots showing arrows pointing from the button entries in the apps to the physical buttons on a picture of a pico remote](assets/buttons_map.png)

The iOS Home app doesn't actually show button names (e.g. "On"), but only shows "Button 1". Other, better, iOS Homekit apps do, though. In any case, buttons are mapped from top-to-bottom. The top-most physical button is button 1, and is shown at the top of the list in the app.

I don't own one of every remote type, so I've had to make guesses about the other supported remotes, and defer implementing some others. Currently supported are:

* [2 Button](https://www.lutron.com/en-US/pages/SupportCenter/support.aspx?modelNumber=PJ2-2B&Section=Documents)
* [2-Button with raise/lower](https://www.lutron.com/en-US/pages/SupportCenter/support.aspx?modelNumber=PJ2-2BRL&Section=Documents)
* [3-Button](https://www.lutron.com/en-US/pages/SupportCenter/support.aspx?modelNumber=PJ2-3B&Section=Documents) (*untested*)
* [3-Button with raise/lower](https://www.lutron.com/en-US/pages/SupportCenter/support.aspx?modelNumber=PJ2-3BRL&Section=Documents)

I'd love to have complete, tested support of all remote types. If you have hardware that is partially- or un-supported and, adding support is fast and easy. I would also be happy to add support for hardware that is provided to me.

### Homekit and Lutron App collision

Right now, all known Pico remotes are shown in the Home app. This means their functionality is duplicated, in a sense. Configuration in Homekit has no effect on operation with paired accessories, or anything else in the Lutron app. Let me know if you'd like to hide remotes that are paired, as it's possible but not currently enabled.

## Support

If you need find a bug, need help with this plugin, or have questions, the best way to reach me is via a Github Issue. Please don't be shy about opening one. You can also reach me via the email address in my Github profile.

This plugin doesn't often change, but when I add big features or make big changes, I will occasionally join the [`#lutron-caseta-leap`](https://discord.com/channels/432663330281226270/927991341923852389) channel on the [Homebridge Discord server](https://discord.gg/RcV7fa8).

## Enabling debugging

In order to enable debugging, set the DEBUG environment variable in the Homebridge UI to `leap:*`. This will make this plugin, and its main library `lutron-leap-js`, noisier. Logging at this level is required for diagnosis and new hardware support.

## To-do and contributions

The following items are on my wishlist:
* Add support for double- and long-presses on Pico remotes
* Extend the Serena blind support to enable the tilt characteristic directly (in addition to faking lift w/ tilt)
* Add support for motion sensors (would require hardware donation)
* Add/validate support for RA2 bridges (would require hardware donation)
* Add support for authentication key auto-configuration

I welcome contributions! I wrote this to scratch an itch (no Serena wood blind support), but would be fine with additional devices. To add a device:
* Add a case to `LutronCasetaLeap.configureAccessory` and `handleBridgeDiscovery` for your new device type.
* Add a class for your device. The constructor should wire up event handlers and manage services and characteristics.
* Add relevant methods to the [`SmartBridge`](https://github.com/thenewwazoo/lutron-leap-js/blob/main/src/SmartBridge.ts) class in the `lutron-leap-js` project to control the device. These methods should construct command requests.
* Add an "unsolicited events" and/or "subscribed event" handler in your new device class to update itself when new information arrives from the bridge, and to update characteristic values.

## Development setup

(rough notes)

* Check this out
* Check out the lutron-leap-js repo
* Make changes there and `npm run build` it
* `npm install ../lutron-leap-js`
* Make changes here
* `rm ~/.homebridge/accessories/cachedAccessories; DEBUG='leap:*,HAP-NodeJS:Accessory' npm run watch`
* `npm run lint`

## Legacy Configuration

> :warning: **This only applies if the UI doesn't work for you**: If that's the case, please file a ticket too.

### Get your bridge ID

The bridge ID is the serial number, and is printed on the underside of the bridge, indicated here in green:

![picture of the underside of a bridge, showing the sticker with the ID on it](assets/bridge.png)

### Get your bridge credentials

The easiest way is to use the [`get_lutron_cert.py`](https://github.com/gurumitts/pylutron-caseta/blob/dev/get_lutron_cert.py) script that comes with the [`pylutron-caseta`](https://github.com/gurumitts/pylutron-caseta) project, without which this would not have been possible.

*NOTE*: these instructions require Python 3, which you may need to [install it yourself](https://www.python.org/downloads/).

*NOTE*: these instructions may be out of date! If this doesn't work, please read the script itself.

To use the script, you'll want to check out the repo:
```
git clone https://github.com/gurumitts/pylutron-caseta.git && cd pylutron-caseta
```

Then, create a venv and install the depedencies:
```
python3 -m venv env
. env/bin/activate
pip install pyOpenSSL==19.1.0
pip install .
```

Then run the helper script:
```
python get_lutron_cert.py
```

Each file corresponds to a configuration item:
* `caseta-bridge.crt` => CA certificate
* `caseta.key` => Private key
* `caseta.crt` => Signed certificate

## Legacy Configuration File

Each bridge on your network that you wish to control needs its own configuration entry.

### Using `homebridge-config-ui-x`

If you're using the GUI, you'll want to fill out the form, copying and pasting in the appropriate fields:

![a screenshot of the configuration UI, with fields filled with the contents of certificate files](assets/config.png)

The UI will handle multi-line input, so just paste it in.

Click the "ADD SECRETS" button to add additional bridges.

### Using `config.json`

The shape of the configuration is:

```json
{
    "platform": "LutronCasetaLeap",
        "secrets": [
            {
                "bridgeid": "0a1b2c3d",
                "ca": "-----BEGIN CERTIFICATE-----\nMII...",
                "key": "-----BEGIN PRIVATE KEY-----\nMII...",
                "cert": "-----BEGIN CERTIFICATE-----\nMII..."
            },
            { ... }
        ]
}
```

The authn strings are newline-escaped versions of the files you generated.

