
# Changelog

All notable changes to this project will be documented in this file. This project adheres to [Semantic Versioning](http://semver.org/).

## [3.0.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v3.0.0) (2026-04-23)

### Major Changes
- **Matter API support**: Adds Homebridge v2+ Matter API support with runtime fallback to HAP for legacy Homebridge versions.
- **Config toggles**: New `enableMatter` and `preferMatter` options (default: true) for seamless migration and compatibility.
- **Platform selection proxy**: Automatic runtime selection between Matter and HAP platforms, fully tested.
- **Updated dependencies**: lutron-leap-js updated.

### Migration Notes
- Homebridge v1: HAP-only mode is used automatically.
- Homebridge v2: Matter is enabled by default; fallback to HAP if needed.
- See README for migration and troubleshooting tips.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.8.2...v3.0.0

## [2.8.2](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.8.2) (2025-09-18)

### What's Changed
- No notable changes

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.8.1...v2.8.2

## [2.8.1](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.8.1) (2025-03-04)

### What's Changed
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.8.0...v2.8.1

## [2.8.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.8.0) (2025-01-25)

### What's Changed
- Bump Node Version to `v20` or `v22`
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.7.0...v2.8.0

## [2.7.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.7.0) (2025-01-25)

### What's Changed
- Convert to ESModule
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.6.0...v2.7.0

## [2.6.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.6.0) (2024-07-04)

### What's Changed
- Hide double/long press action in Home app when disabled (#143) (#157) @donavanbecker
- Bump socket.io-parser and homebridge-config-ui-x (#141) @dependabot
- Bump systeminformation and homebridge-config-ui-x (#140) @dependabot
- Bump class-validator and homebridge-config-ui-x (#139) @dependabot
- Bump fastify and homebridge-config-ui-x (#138) @dependabot
- Bump @babel/traverse from 7.22.20 to 7.23.2 (#130) @dependabot
- update README to include support for 4 button scene keypads (#131) @DonutEspresso
- Add `Name` & `ConfiguredName` to AccessoryInformation so Names sync from Lutron app to Home app. (@donavanbecker)
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.5.3...v2.6.0

## [2.5.3](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.5.3) (2023-09-24)

### What's Changed
- Many thanks for @Bleufarmer for sponsoring support for the new paddle switch Pico!

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.5.0...v2.5.3

## [2.5.2](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.5.2) (2023-09-18)

### What's Changed
- Explicitly tell npm to ignore tags file already ignored by git

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.5.1...v2.5.2

## [2.5.1](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.5.1) (2023-09-17)

### What's Changed
- Greatly increase the max listeners
- Update to use corrected lutron-leap v3.4.2

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.5.0...v2.5.1

## [2.5.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.5.0) (2023-09-17)

### What's Changed
- Thanks to @thibaulf, reconnection to the Smart Hub is fixed! You should see no more need to restart Homebridge due to your Picos and occupancy sensors stopping working.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.4.3...v2.5.0

## [2.4.3](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.4.3) (2022-11-24)

### What's Changed
- This release makes the plugin not show things as errors that aren't errors. Now you can rest a bit easier when reading logs. :)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.4.2...v2.4.3

## [2.4.2](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.4.2) (2022-08-19)

### What's Changed
- This is a bugfix release that makes the plugin properly remove Picos and Blinds from HomeKit when they're configured to be filtered.
- Improve btrk error log line
- Fix broken lutron-leap-js ver spec
- Refactor to reduce scary log lines and noise

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.4.1...v2.4.2

## [2.4.1](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.4.1) (2022-07-29)

### What's Changed
- Fix filtered devices that don't disappear

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.4.0...v2.4.1

## [2.4.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.4.0) (2022-07-24)

### What's Changed
- Pico remotes now support long- and double-press in HomeKit! After you update, you'll see the new options in your HomeKit app. Now you can attach scenes and actions to single-press, double-press, and press-and-hold actions on your Picos. Don't like it? No problem! You can disable them, as well as configure the speeds, individually in the settings. By default, this is turned on after this update.
- Picos that are paired in the Lutron app can be hidden! If you've got Picos that already have a job, either set up in the Lutron app or paired directly with a device, you can now exclude/hide them from HomeKit on a global basis. This is not turned on by default.
- Serena Tilt-Only Wood Blinds can be excluded from plug-in support! Ever since Lutron added native HomeKit support for the Serena wood blinds to the Lutron app, that functionality has been redundant. Now there is an option in the settings to exclude them from the plug-in. This is not turned on by default.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.9...v2.4.0

## [2.3.9](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.9) (2022-07-29)

### What's Changed
- This release adds support for two-zone, four-button Pico remotes. Many thanks to @tneems, who contributed the code!
- Fix cache restore for Pico4Button2Group (#52)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.8...v2.3.9

## [2.3.8](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.8) (2022-06-23)

### What's Changed
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.7...v2.3.8

## [2.3.7](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.7) (2022-05-09)

### What's Changed
- Update lutron-leap-js to 3.0.6

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.6...v2.3.7

## [2.3.6](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.6) (2022-05-07)

### What's Changed
- Add support for Pico 4-button scene and zone remotes.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.5...v2.3.6

## [2.3.5](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.5) (2022-05-06)

### What's Changed
- This is a minor release that should improve stability.
    - Adopt lutron-leap-js 3.0.5

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.4...v2.3.5

## [2.3.4](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.4) (2022-04-10)

### What's Changed
- Adopt fixed lutron-leap-js lib

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.3...v2.3.4

## [2.3.3](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.3) (2022-03-16)

### What's Changed
- Update lutron-leap-js to 3.0.2 for client fixes

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.2...v2.3.3

## [2.3.2](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.2) (2022-03-13)

### What's Changed
- Check for lower-case bridge IDs when one is announced

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.1...v2.3.2

## [2.3.1](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.1) (2022-03-13)

### What's Changed
- Bump lutron-leap-js version for increased ping

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.3.0...v2.3.1

## [2.3.0](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/releases/tag/v2.3.0) (2022-03-02)

### What's Changed
- This release adds support for PD-OSENS Caseta occupancy sensors in Homekit! Now you can use your Caseta occupancy sensors without having to pair them to another device. They will appear in Homekit like any other dedicated motion sensor.
- This release also adds support for one-click pairing with Caseta Smart Bridge 2 devices. No more downloading Python and running scripts and copying files. Now it's all in a slick new UI.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/compare/v2.2.3...v2.3.0
