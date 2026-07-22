# Copilot instructions

Guidance for AI coding agents working in this repository. The fuller version of this document is [CLAUDE.md](../CLAUDE.md) at the repo root — keep the two in sync.

## Commands

- Build: `npm run build` (`rimraf ./dist` → `tsc` → copy plugin UI html). All steps are required for a working package.
- Lint: `npm run lint` (`eslint . --max-warnings=0`, CI fails on warnings); `npm run lint:fix` to autofix.
- Test: `npm test` (vitest, colocated `src/**/*.test.ts`).
- Local dev loop: `npm run watch` (rebuild + restart `homebridge -U ./test/hbConfig -D` on changes; `./test/hbConfig` is gitignored, create locally with a paired bridge).

## Key architecture facts

- Homebridge dynamic platform plugin (`platform: "LutronCasetaLeap"`) exposing Lutron Caséta devices through a Lutron Smart Bridge over the local LEAP protocol via the `lutron-leap` library.
- `src/index.ts` registers a runtime HAP/Matter proxy (`createPlatformProxy` in `src/utils.ts`); keep `api.matter?.…` / Matter calls optional-chained.
- Pairing: `src/homebridge-ui/server.ts` discovers bridges (`BridgeFinder`), associates via button press (`PairingClient`), and generates the TLS cert pair with `node-forge`, stored back into the plugin config.
- Device types map to classes wired in `Platform.HAP.ts`: `WallDimmer`, `WallSwitch`, `SerenaTiltOnlyWoodBlinds`, `PicoRemote` (stateless switches, with `ButtonState.ts`), `OccupancySensor` (+ `OccupancySensorRouter.ts`).
- Log through `src/Logger.ts` / the platform log so user logging settings are respected.

## Conventions

- TypeScript ESM: relative imports need `.js` extensions.
- ESLint `@antfu/eslint-config`: single quotes, sorted imports, multi-line braces on guards; run `npm run lint:fix` before committing.
- `config.schema.json` must stay in sync with `LutronCasetaLeapPluginConfig` in `src/settings.ts`.
- Licensed Apache-2.0 — keep the LICENSE and upstream attribution intact.
