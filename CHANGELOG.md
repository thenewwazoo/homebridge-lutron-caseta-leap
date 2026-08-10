## v3.1.8 (2026-08-09)

### Changed

- chore: keep test files out of the published package
- chore(github): run the build and tests in ci, on node 22, 24 and 26
- chore: use the same lint setup across every plugin
- chore: add a changelog:sync script to populate the pending section from the commits
- chore: count a repeated commit subject once when syncing the changelog
- chore(github): check the changelog against the commits in ci
- chore(deps): dependency updates
- chore: remove personal funding links
- docs: add node 26 to the supported node versions
- chore: exclude test files and the test config from the published package
- fix: repair stale LEAP connections with a per-bridge ping watchdog (#267) (@simplytoast1)
- fix: send pico button presses to matter, instead of nothing at all
- fix: let an occupancy sensor recover after a failed subscription, without a restart
- fix: report why bridge pairing failed, instead of an unrelated error
- fix: offer the press-speed settings the plugin actually reads
- fix: stop re-registering a cached pico on every start, which loses its matter placement

## v3.1.7 (2026-07-27)

### Changed

- chore(deps): dependency updates
- docs(github): name this plugin's devices in the issue forms instead of meater
- feat(matter): add an opt-in option to show pico remotes as single-press only, for a simpler home app tile
- fix(schema): declare required fields the standard way so the homebridge ui stops reporting a config validation failure
- chore: declare the supports-hap transport keyword for the homebridge ui
- chore(deps): dependency updates
- docs(changelog): list every unreleased commit in the pending section

## v3.1.6 (2026-07-25)

### Changed

- chore(github): release on a published github release, not every push to latest
- chore(github): align workflows, funding and issue templates with the other org plugins
- chore: standardise the eslint setup and apply the org lint rules
- chore: align the npm publishing files with the other org plugins
- chore: standardise the package manifest with the other org plugins
- docs: add claude and copilot instructions files
- docs: use the standard org readme banner
- chore(deps): dependency updates
- chore(github): use the shared homebridge action to deprecate past pre-releases

## [3.1.3](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.1.3) (2026-05-04)

### Bug Fixes
* filterPico two-stage check: replace the always-true `AffectedZones !== undefined` guard (which incorrectly skipped audio Picos, fan Picos, and scene-only Picos) with a proper two-stage filter — Stage 1 checks for non-empty `AffectedZones` arrays (zone-wired Picos); Stage 2 fetches each button's `ProgrammingModel` → `Preset` and checks for any non-empty `*Assignments` array (scene-programmed Picos) ([#233](https://github.com/homebridge-plugins/homebridge-lutron/pull/233))

### Other Changes
* plugin/package rename: publish under `@homebridge-plugins/homebridge-lutron` and align plugin identity (`PLUGIN_NAME`, UI certificate commonName, npm metadata) with the new package name
* lint compatibility: resolve constructor-name linting by instantiating Homebridge platform accessories via an uppercase constructor alias (`PlatformAccessoryCtor`)
* branding/docs normalization: update README/docs user-facing naming to "Homebridge Lutron" / "Lutron", refresh generated TypeDoc output, and update repository/wiki/release links to `homebridge-plugins/homebridge-lutron`
* dependency metadata: bump Homebridge beta compatibility from `^2.0.0-beta.110` to `^2.0.0-beta.111`

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.1.2...v3.1.3

## [3.1.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.1.2) (2026-05-03)

### Bug Fixes

* Pico Matter: set `multiPressMax` to `2` unconditionally — the Matter spec requires this attribute to be `>= 2`, so using `1` when double-press is disabled caused a `[constraint] Constraint "min 2": Value 1 is not within bounds` validation error and prevented all Pico remotes from registering in Matter mode
* button-press visibility: restore default button press logging to `info` so physical Pico presses are visible in normal Homebridge logs without requiring global debug mode
* config simplification: remove redundant `preferMatter` toggle and use `enableMatter` as the single Matter on/off control with HAP fallback behavior unchanged

### Maintenance

* config UI: reorder sections for clearer flow (general options, Matter toggle, device exclusions, logging, then bridge secrets)
* docs/comments: align Logger and button-tracker default descriptions with the updated `buttonPressLogging` default behavior

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.1.1...v3.1.2

## [3.1.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.1.1) (2026-05-03)

### Features

* expand Matter device registration/mapping across supported device families (WallDimmer, WallSwitch, Serena tilt-only blinds, occupancy sensors, and Pico remotes) using `api.matter.deviceTypes.*`
* refactor platform layout into dedicated HAP and Matter modules (`Platform.HAP.ts`, `Platform.Matter.ts`) and add Matter cluster helpers in device classes

### Bug Fixes

* Matter registration: set required accessory metadata on root object (fixes missing `manufacturer` validation failures)
* Matter registration: constrain bridged accessory display names to Matter nodeLabel length limits (fixes `Behaviors have errors` on long room/device names)
* Pico Matter composed endpoints: explicitly apply GenericSwitch `SwitchServer` behavior (`GenericSwitch.with(SwitchServer)`), restoring expected per-button rendering in Apple Home
* Pico Matter behavior: move to GenericSwitch state updates for button presses, expand Pico button map coverage, and include Pico4Button in Matter GenericSwitch registration mapping
* add `options.excludedDeviceTypes` support to skip selected device types in both HAP and Matter registration paths (including removing cached accessories for explicitly excluded types)
* remove legacy `options.filterBlinds` toggle and rely on `options.excludedDeviceTypes` for Serena blind exclusion
* excluded-device cleanup: in Matter mode, unregister excluded cached accessories from both HAP and Matter registries for deterministic removal
* Pico button mapping robustness: improve `Pico3ButtonRaiseLower` alias resolution (including `Favorite` center-button naming variants) and skip unknown button definitions without failing whole-remote initialization
* Matter command handling: add explicit handlers so WallDimmer and WallSwitch On/Off/Level commands always dispatch LEAP `GoToLevel` requests
* Matter blind control: add `windowCovering.goToTiltPercentage` handler for Serena tilt-only blinds to map Matter tilt commands to LEAP blind tilt writes
* Matter external-state sync: propagate unsolicited bridge updates back into Matter cluster state for WallDimmer (`onOff` + `levelControl`), WallSwitch (`onOff`), Serena tilt-only blinds (`windowCovering` tilt), and occupancy sensors (`occupancySensing`)
* Pico Matter composed endpoint polish: use `BridgedNode` as Pico parent in composed mode and provide part `displayName` values to avoid undefined child labels in UI

### Maintenance

* align imports/file naming with ESM casing expectations and update docs output
* bump Homebridge beta compatibility to `^2.0.0-beta.110` and refresh lint/tooling dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.1.0...v3.1.1

## [3.1.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.1.0) (2026-04-29)

### Features

* configurable log verbosity (logLevel + buttonPressLogging) ([#228](https://github.com/homebridge-plugins/homebridge-lutron/issues/228)) ([40b1fd9](https://github.com/homebridge-plugins/homebridge-lutron/commit/40b1fd9116c2b8b4877d70001ddac4f6c3f7ee5c)) 

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.5...v3.1.0

## [3.0.5](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.5) (2026-04-27)

### Bug Fixes

* cached accessory loss on Skipped, listener leak, inventory retry ([#227](https://github.com/homebridge-plugins/homebridge-lutron/issues/227)) ([4856be2](https://github.com/homebridge-plugins/homebridge-lutron/commit/4856be2accc95aec4a1cf778b4bef1610540ee0e))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.4...v3.0.5

## [3.0.4](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.4) (2026-04-25)

### Bug Fixes

* This accessory will not be registered. ([fb3c249](https://github.com/homebridge-plugins/homebridge-lutron/commit/fb3c2492cdcb30b2abe58aa9368be7e410d396c2))
* This accessory will not be registered. ([#225](https://github.com/homebridge-plugins/homebridge-lutron/issues/225)) ([ff7cadf](https://github.com/homebridge-plugins/homebridge-lutron/commit/ff7cadfe493d38933740398a4a6f4faf6ad0b6f3)) 

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.3...v3.0.4

## [3.0.3](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.3) (2026-04-23)

### What's Changed
* fix: This accessory will not be registered. 

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.2...v3.0.3

## [3.0.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.2) (2026-04-23)

### What's Changed
* fix: This accessory will not be registered. ([fb3c249](https://github.com/homebridge-plugins/homebridge-lutron/commit/fb3c2492cdcb30b2abe58aa9368be7e410d396c2))

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.1...v3.0.2

## [3.0.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.1) (2026-04-23)

## What's Changed
* Don’t automatically unregister on error getting device info by @dfct in https://github.com/homebridge-plugins/homebridge-lutron/pull/207

## New Contributors
* @dfct made their first contribution in https://github.com/homebridge-plugins/homebridge-lutron/pull/207

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v3.0.0...v3.0.1

## [3.0.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v3.0.0) (2026-04-23)

### Major Changes
- **Matter API support**: Adds Homebridge v2+ Matter API support with runtime fallback to HAP for legacy Homebridge versions.
- **Config toggles**: New `enableMatter` and `preferMatter` options (default: true) for seamless migration and compatibility.
- **Platform selection proxy**: Automatic runtime selection between Matter and HAP platforms, fully tested.
- **Updated dependencies**: lutron-leap-js updated.

### Migration Notes
- Homebridge v1: HAP-only mode is used automatically.
- Homebridge v2: Matter is enabled by default; fallback to HAP if needed.
- See README for migration and troubleshooting tips.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.8.2...v3.0.0

## [2.8.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.8.2) (2025-09-18)

### What's Changed
- No notable changes

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.8.1...v2.8.2

## [2.8.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.8.1) (2025-03-04)

### What's Changed
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.8.0...v2.8.1

## [2.8.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.8.0) (2025-01-25)

### What's Changed
- Bump Node Version to `v20` or `v22`
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.7.0...v2.8.0

## [2.7.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.7.0) (2025-01-25)

### What's Changed
- Convert to ESModule
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.6.0...v2.7.0

## [2.6.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.6.0) (2024-07-04)

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

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.5.3...v2.6.0

## [2.5.3](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.5.3) (2023-09-24)

### What's Changed
- Many thanks for @Bleufarmer for sponsoring support for the new paddle switch Pico!

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.5.0...v2.5.3

## [2.5.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.5.2) (2023-09-18)

### What's Changed
- Explicitly tell npm to ignore tags file already ignored by git

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.5.1...v2.5.2

## [2.5.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.5.1) (2023-09-17)

### What's Changed
- Greatly increase the max listeners
- Update to use corrected lutron-leap v3.4.2

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.5.0...v2.5.1

## [2.5.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.5.0) (2023-09-17)

### What's Changed
- Thanks to @thibaulf, reconnection to the Smart Hub is fixed! You should see no more need to restart Homebridge due to your Picos and occupancy sensors stopping working.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.4.3...v2.5.0

## [2.4.3](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.4.3) (2022-11-24)

### What's Changed
- This release makes the plugin not show things as errors that aren't errors. Now you can rest a bit easier when reading logs. :)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.4.2...v2.4.3

## [2.4.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.4.2) (2022-08-19)

### What's Changed
- This is a bugfix release that makes the plugin properly remove Picos and Blinds from HomeKit when they're configured to be filtered.
- Improve btrk error log line
- Fix broken lutron-leap-js ver spec
- Refactor to reduce scary log lines and noise

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.4.1...v2.4.2

## [2.4.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.4.1) (2022-07-29)

### What's Changed
- Fix filtered devices that don't disappear

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.4.0...v2.4.1

## [2.4.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.4.0) (2022-07-24)

### What's Changed
- Pico remotes now support long- and double-press in HomeKit! After you update, you'll see the new options in your HomeKit app. Now you can attach scenes and actions to single-press, double-press, and press-and-hold actions on your Picos. Don't like it? No problem! You can disable them, as well as configure the speeds, individually in the settings. By default, this is turned on after this update.
- Picos that are paired in the Lutron app can be hidden! If you've got Picos that already have a job, either set up in the Lutron app or paired directly with a device, you can now exclude/hide them from HomeKit on a global basis. This is not turned on by default.
- Serena Tilt-Only Wood Blinds can be excluded from plug-in support! Ever since Lutron added native HomeKit support for the Serena wood blinds to the Lutron app, that functionality has been redundant. Now there is an option in the settings to exclude them from the plug-in. This is not turned on by default.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.9...v2.4.0

## [2.3.9](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.9) (2022-07-29)

### What's Changed
- This release adds support for two-zone, four-button Pico remotes. Many thanks to @tneems, who contributed the code!
- Fix cache restore for Pico4Button2Group (#52)

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.8...v2.3.9

## [2.3.8](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.8) (2022-06-23)

### What's Changed
- Housekeeping and updated dependencies

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.7...v2.3.8

## [2.3.7](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.7) (2022-05-09)

### What's Changed
- Update lutron-leap-js to 3.0.6

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.6...v2.3.7

## [2.3.6](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.6) (2022-05-07)

### What's Changed
- Add support for Pico 4-button scene and zone remotes.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.5...v2.3.6

## [2.3.5](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.5) (2022-05-06)

### What's Changed
- This is a minor release that should improve stability.
    - Adopt lutron-leap-js 3.0.5

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.4...v2.3.5

## [2.3.4](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.4) (2022-04-10)

### What's Changed
- Adopt fixed lutron-leap-js lib

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.3...v2.3.4

## [2.3.3](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.3) (2022-03-16)

### What's Changed
- Update lutron-leap-js to 3.0.2 for client fixes

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.2...v2.3.3

## [2.3.2](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.2) (2022-03-13)

### What's Changed
- Check for lower-case bridge IDs when one is announced

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.1...v2.3.2

## [2.3.1](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.1) (2022-03-13)

### What's Changed
- Bump lutron-leap-js version for increased ping

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.3.0...v2.3.1

## [2.3.0](https://github.com/homebridge-plugins/homebridge-lutron/releases/tag/v2.3.0) (2022-03-02)

### What's Changed
- This release adds support for PD-OSENS Caseta occupancy sensors in Homekit! Now you can use your Caseta occupancy sensors without having to pair them to another device. They will appear in Homekit like any other dedicated motion sensor.
- This release also adds support for one-click pairing with Caseta Smart Bridge 2 devices. No more downloading Python and running scripts and copying files. Now it's all in a slick new UI.

**Full Changelog**: https://github.com/homebridge-plugins/homebridge-lutron/compare/v2.2.3...v2.3.0
