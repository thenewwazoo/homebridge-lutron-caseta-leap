# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `rimraf ./dist && tsc && npm run plugin-ui`. The `plugin-ui` step rsyncs `src/homebridge-ui/public/index.html` into `dist/` (the custom settings UI). Skipping it produces a broken published package.
- `npm run lint` — ESLint over the whole repo with `--max-warnings=0`. CI fails on any warning. `npm run lint:fix` to autofix.
- `npm test` — vitest, colocated `src/**/*.test.ts` files. `npm run test:watch` and `npm run test-coverage` also available.
- `npm run watch` — build, `npm link`, then `nodemon`: recompiles and restarts `homebridge -U ./test/hbConfig -D` on `src/**/*.ts` changes. `./test/hbConfig` is gitignored; create it locally with a `config.json` holding a paired bridge.
- `npm run docs` — typedoc into `docs/` (gitignored — generated output is never committed).
- `npm run prepublishOnly` — lint then build; runs automatically on publish.

CI (`.github/workflows/build.yml`) runs install + lint on Node 22.x/24.x. Releases publish via `.github/workflows/release.yml`: a GitHub release (tag `vX.Y.Z`) publishes to npm's `latest` tag; pushes to `beta-X.Y.Z` / `alpha-X.Y.Z` branches publish incrementing prerelease versions to the `beta` / `alpha` tags.

Supported Node: `^22.12.0 || ^24.0.0`. Homebridge: `^1.11.4 || ^2.0.0`.

## Architecture

Homebridge dynamic platform plugin (`platform: "LutronCasetaLeap"`, package `@homebridge-plugins/homebridge-lutron`) exposing Lutron Caséta / RA2 Select devices to HomeKit through a Lutron Smart Bridge (Bridge 2 / Pro) over the local LEAP protocol, using the [`lutron-leap`](https://www.npmjs.com/package/lutron-leap) library.

### HAP/Matter platform selection

`src/index.ts` registers a runtime proxy (`createPlatformProxy` in `src/utils.ts`) that instantiates `LutronCasetaLeapMatterPlatform` (`src/Platform.Matter.ts`) when the config's `enableMatter` is set and Homebridge reports Matter available **and** enabled, otherwise the HAP `LutronCasetaLeap` platform (`src/Platform.HAP.ts`). Matter API calls must stay optional-chained. `normalizeConfig` in `utils.ts` applies the Matter-flag defaults.

### Bridge connection and pairing

The bridge speaks LEAP over a mutually-authenticated TLS socket, so each bridge needs a certificate pair. `src/homebridge-ui/server.ts` (a `HomebridgePluginUiServer`) drives pairing from the settings UI: `BridgeFinder` discovers bridges on the network, `PairingClient` performs the button-press association, and `node-forge` generates the CA/key/cert stored back into the plugin config. `Platform.HAP.ts` then opens a `LeapClient` per bridge and enumerates devices.

### Device classes

Each supported Lutron device type maps to a class that wires HomeKit services onto the accessory: `WallDimmer` and `WallSwitch` (lights), `SerenaTiltOnlyWoodBlinds` (window coverings), `PicoRemote` (stateless programmable switches — button mapping lives in `PicoRemote.ts` with `ButtonState.ts`), and `OccupancySensor` (with `OccupancySensorRouter.ts` fanning a single sensor area out to multiple HomeKit sensors). `Platform.HAP.ts` matches each discovered `DeviceType` to its class in `wireDevice`.

### Logging

Logging goes through `src/Logger.ts` / the platform log so the user's Homebridge logging settings are respected — prefer it over `console`.

## Conventions

- TypeScript ESM (`"type": "module"`): relative imports use `.js` extensions even from `.ts` source.
- ESLint is `@antfu/eslint-config` (flat config in `eslint.config.js`): single quotes, 1tbs braces, `curly` multi-line only (single-line guards must use full multi-line braces), sorted imports. Run `npm run lint:fix` before committing.
- `config.schema.json` defines the Homebridge UI form and must stay in sync with the `LutronCasetaLeapPluginConfig` interface in `src/settings.ts`.
- Licensed Apache-2.0 — keep the LICENSE and any upstream attribution intact.
