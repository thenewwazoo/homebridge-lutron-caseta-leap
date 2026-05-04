# Homebridge Lutron Caseta LEAP Plugin

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

This is a Homebridge plugin that provides HomeKit and Matter integration for Lutron Caseta Smart Bridge 2 devices. The plugin is written in TypeScript and uses the lutron-leap-js library to communicate with Lutron bridges via the LEAP protocol.

**Current Focus:** Full Matter support alongside HAP (HomeKit Accessory Protocol). All new devices support both HAP and Matter simultaneously.

## Device Support

### Currently Supported Devices
- **WallDimmer** — Lutron dimmers (Matter: DimmableLight)
- **WallSwitch** — Lutron switches (Matter: OnOffLight)
- **SerenaTiltOnlyWoodBlind** — Serena wood blinds, tilt-only (Matter: WindowCovering)
- **RPSOccupancySensor** — Lutron occupancy sensors (Matter: OccupancySensor)
- **Pico Remotes** — All Pico remote models:
  - Pico2Button, Pico2ButtonRaiseLower
  - Pico3Button, Pico3ButtonRaiseLower
  - Pico4Button, Pico4Button2Group, Pico4ButtonScene, Pico4ButtonZone
  - PaddleSwitchPico
  - (Matter: GenericSwitch)

### Devices Not Yet Supported (Contributions Welcome)
- Color temperature lighting
- Additional blind types (vertical rails, honeycomb, etc.)
- Motorized shades with position feedback

## Matter and HomeKit Integration

### Matter Implementation
The plugin implements dual-mode device registration:
- **HAP mode** (HomeKit Accessory Protocol): Base implementation via `LutronCasetaLeap` class
- **Matter mode**: Extended via `LutronCasetaLeapMatterPlatform` class that overrides `processDevice()`

When Homebridge's Matter API is available, `LutronCasetaLeapMatterPlatform.processDevice()` registers accessories with both HAP and Matter simultaneously. If Matter API is not available, the plugin transparently falls back to HAP-only mode.

### Matter Device Type Mapping
All Matter device types use `api.matter.deviceTypes.*` objects from the homebridge-matter API:

| Device Type | HAP Service | Matter DeviceType | Matter Clusters |
|---|---|---|---|
| WallDimmer | Lightbulb | `DimmableLight` | onOff, levelControl |
| WallSwitch | Switch | `OnOffLight` | onOff |
| SerenaTiltOnlyWoodBlind | WindowCovering | `WindowCovering` | windowCovering |
| RPSOccupancySensor | OccupancySensor | `OccupancySensor` | occupancySensing |
| Pico Remotes | StatelessProgrammableSwitch | `GenericSwitch` | switch |

### Authoritative Matter References

1. https://matter-js.github.io/docs/index.html
2. https://github.com/homebridge-plugins/homebridge-matter: Official Homebridge Matter plugin repository with extensive documentation and examples
  - For all Matter cluster, attribute, and device type specifications, use the official homebridge-matter wiki:
    - [Introduction](https://github.com/homebridge-plugins/homebridge-matter/wiki/Introduction)
    - [Core Concepts](https://github.com/homebridge-plugins/homebridge-matter/wiki/Core-Concepts)
    - [Getting Started](https://github.com/homebridge-plugins/homebridge-matter/wiki/Getting-Started)
    - [State Management](https://github.com/homebridge-plugins/homebridge-matter/wiki/State-Management)
    - [Monitoring External Changes](https://github.com/homebridge-plugins/homebridge-matter/wiki/Monitoring-External-Changes)
    - [Best Practices](https://github.com/homebridge-plugins/homebridge-matter/wiki/Best-Practices)
    - [Advanced Patterns](https://github.com/homebridge-plugins/homebridge-matter/wiki/Advanced-Patterns)
    - [API Reference](https://github.com/homebridge-plugins/homebridge-matter/wiki/API-Reference)
    - [Matter Types](https://github.com/homebridge-plugins/homebridge-matter/wiki/Matter-Types)
    - [Value Conversions](https://github.com/homebridge-plugins/homebridge-matter/wiki/Value-Conversions)

  - **Device References:**
    - [Lighting Devices (§4)](https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-4-Lighting) — DimmableLight, OnOffLight
    - [Switches (§6)](https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-6-Switches) — OnOffSwitch
    - [Sensors (§7)](https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-7-Sensors) — OccupancySensor
    - [Closure Devices (§8)](https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-8-Closure) — WindowCovering

## Working Effectively

### Bootstrap and Build
- Install dependencies: `npm install` -- takes ~40 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
- Build the project: `npm run build` -- takes ~5 seconds. Very fast compilation.
- Clean build artifacts: `npm run clean` -- removes ./dist directory
- Full build pipeline: `npm run prepublishOnly` -- takes ~25 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
- Check for outdated packages: `npm run check` -- runs npm install && npm outdated (may exit with code 1 if packages are outdated, this is normal)

### Testing and Quality Assurance
- Run tests: `npm run test` -- takes ~1 second. Validates utility functions and OccupancySensorRouter singleton pattern.
- Run tests with coverage: `npm run test-coverage` -- takes ~2 seconds. Shows coverage report.
- Watch tests: `npm run test:watch` -- for continuous testing during development.
- Lint code: `npm run lint` -- takes ~1 second. Uses ESLint with @antfu/eslint-config.
- Fix linting issues: `npm run lint:fix` -- automatically fixes fixable lint issues.
- IMPORTANT: TypeScript compilation will catch syntax errors that ESLint may miss.

### Development Workflow
- Development mode: `npm run watch` -- builds and runs with nodemon, links plugin locally
- IMPORTANT: `npm run watch` requires a proper Homebridge development environment and will try to start Homebridge
- Copy UI files: `npm run plugin-ui` -- copies HTML files to dist directory
- ALWAYS run `npm run build` before testing changes
- ALWAYS run `npm run lint` before committing

### Documentation
- Generate docs: `npm run docs` -- takes ~6 seconds. Uses TypeDoc.
- Validate docs: `npm run docs:lint` -- checks for documentation warnings/errors
- Theme docs: `npm run docs:theme` -- applies default-modern theme

## Validation

### Manual Testing Requirements
After making code changes, ALWAYS validate by:
1. Running `npm run build` to ensure compilation succeeds
2. Running `npm run lint` to check code style
3. Running `npm run test` to verify existing functionality
4. If changing UI components, validate the configuration UI works properly
5. For bridge communication changes, test with actual Lutron hardware if possible
6. For Matter changes, verify Matter registration succeeds in Homebridge logs

### End-to-End Validation Workflow
To verify the complete development workflow works:
```bash
npm run clean && npm run build && npm run test && npm run lint && npm run docs && npm run docs:lint
```
This complete sequence should take under 30 seconds and validates all critical functionality.

### CI/CD Pipeline Validation
The GitHub Actions workflow (.github/workflows/build.yml) runs:
1. Node.js build and test using homebridge/.github standard workflow (without coverage)
2. ESLint validation (depends on build_and_test job)
Both must pass for PRs to be merged. The workflow runs on pushes to 'latest' branch and all pull requests.

## Important Directories and Files

### Source Code Structure
- `src/index.ts` -- Main plugin entry point, registers platform (choose HAP or Matter mode)
- `src/Platform.HAP.ts` -- Core HAP-only platform implementation, device discovery and management
- `src/Platform.Matter.ts` -- Matter platform that extends HAP, adds Matter registration for all supported device types
- `src/settings.ts` -- Plugin configuration constants
- `src/WallDimmer.ts` -- Dimmable light device (Matter: DimmableLight)
- `src/WallSwitch.ts` -- On/off switch device (Matter: OnOffLight)
- `src/SerenaTiltOnlyWoodBlinds.ts` -- Serena wood blinds with tilt control (Matter: WindowCovering)
- `src/OccupancySensor.ts` -- Occupancy/motion sensor (Matter: OccupancySensor)
- `src/PicoRemote.ts` -- Pico remote button handling for all remote types (Matter: OnOffSwitch)
- `src/ButtonState.ts` -- Button press state machine and click detection
- `src/OccupancySensorRouter.ts` -- Singleton routing logic for occupancy sensor events
- `src/Logger.ts` -- Logging utilities respecting user verbosity settings
- `src/utils.ts` -- Utility functions for UUID generation and device lookup
- `src/homebridge-ui/` -- Custom Homebridge configuration UI
- `src/homebridge-ui/server.ts` -- UI backend server for bridge discovery/pairing
- `src/homebridge-ui/public/index.html` -- Frontend configuration interface

### Configuration and Build
- `package.json` -- Dependencies, scripts, and metadata
- `tsconfig.json` -- TypeScript compiler configuration
- `eslint.config.js` -- ESLint configuration using @antfu/eslint-config
- `config.schema.json` -- Homebridge configuration schema
- `nodemon.json` -- Development watch configuration
- `typedoc.json` -- Documentation generation settings
- `.github/copilot-instructions.md` -- This file

### Generated/Output
- `dist/` -- Compiled JavaScript output (generated by `npm run build`)
- `docs/` -- Generated TypeDoc documentation
- `node_modules/` -- Dependencies (never commit)

## Dependencies and Requirements

### Runtime Requirements
- Node.js 22 or 24 (specified in package.json engines)
- Homebridge ^1.11.4 || ^2.0.0-beta.106

### Key Dependencies
- `lutron-leap` ^3.4.2 -- Core LEAP protocol library for bridge communication
- `@homebridge/plugin-ui-utils` ^2.0.1 -- Homebridge UI framework
- `node-forge` ^1.3.1 -- Cryptography for certificate handling
- `typed-emitter` ^2.1.0 -- TypeScript event emitter

### Development Dependencies
- `typescript` ^5.8.2 -- TypeScript compiler
- `eslint` ^10.3.0 -- Code linting
- `vitest` ^4.0.0+ -- Testing framework
- `typedoc` ^0.27.9+ -- Documentation generation
- `nodemon` ^3.1.9 -- Development file watching

## Common Development Tasks

### Adding New Device Support
1. Add device type case to `Platform.HAP.ts` in `configureAccessory` and `handleBridgeDiscovery`
2. Create new device class file in `src/` following pattern of existing devices
3. Implement HomeKit services and characteristics in the new class
4. Add Matter device type and clusters via `Platform.Matter.ts` override
5. Add LEAP protocol commands to lutron-leap-js library if needed
6. Wire up event handlers for unsolicited bridge updates
7. Test with actual hardware

### Adding Matter Support to Existing Device
1. Create or update device's `getMatterClusters()` method to return Matter clusters object
2. Add case statement to `Platform.Matter.ts` processDevice switch with `mApi.deviceTypes.*` assignment
3. Set `(accessory as any).clusters` directly on the accessory (for single-endpoint) or `(accessory as any).parts` (for composed)
4. Validate deviceType uses `api.matter.deviceTypes.*` object, not number array
5. For composed devices, ensure each part has an `id: string` field
6. Test both HAP and Matter registration via Homebridge logs

### UI Configuration Changes
1. Modify `src/homebridge-ui/public/index.html` for frontend changes (bridge discovery/pairing UI)
2. Update `src/homebridge-ui/server.ts` for backend API changes (handles bridge discovery and certificate generation)
3. Update `config.schema.json` for new configuration options
4. Run `npm run build` to copy UI files to dist (includes plugin-ui step)
5. Test configuration UI in Homebridge

### Debugging
- Enable debug logging in Homebridge UI: set DEBUG environment variable to `leap:*`
- This enables verbose logging for both the plugin and lutron-leap-js library
- Log files are limited to 1MB in Homebridge
- For development, use: `DEBUG='leap:*,HAP-NodeJS:Accessory' npm run watch`

## Development Notes from README

The rough development workflow according to the maintainer:
1. Check out this repository
2. Check out the lutron-leap-js repository separately
3. Make changes to lutron-leap-js and run `npm run build` in that repo
4. Run `npm install ../lutron-leap-js` to use local version
5. Make changes to this plugin
6. Remove cached accessories: `rm ~/.homebridge/accessories/cachedAccessories`
7. Run with debug: `DEBUG='leap:*,HAP-NodeJS:Accessory' npm run watch`
8. Lint before committing: `npm run lint`

## Common Issues and Solutions

### Build or Link Failures
- Ensure Node.js version 22 or 24 is installed
- Run `npm install` to ensure all dependencies are current
- Clear and rebuild: `npm run clean && npm run build`

### Linting Failures
- Run `npm run lint:fix` to auto-fix issues
- ESLint config is strict, follow existing code patterns
- Import statements must use .js extensions (ESM requirement)

### Test Failures
- Current test suite validates utility functions and OccupancySensorRouter singleton pattern
- Tests use Vitest framework with TypeScript
- Test files follow pattern: `*.test.ts` in src/ directory
- Failures likely indicate breaking changes to core functionality
- Add tests for new features following existing vitest patterns

### Bridge Discovery Issues
- Bridge discovery uses mDNS/Bonjour/zeroconf
- Network configuration can prevent discovery (broadcast relay, VLANs, etc.)
- Bridge must be on same network segment as Homebridge server

### Matter Registration Failures
- Ensure `deviceType` is set via `mApi.deviceTypes.*` object, not a number array (causes "behaviors" must be array error)
- For composed devices (parts array), each part must have an `id: string` field (causes "missing required field 'id'" error)
- Verify all returned clusters match Matter spec — use homebridge-matter wiki to validate cluster attributes
- Check Homebridge logs for Matter registration errors during startup

NEVER CANCEL long-running commands. Measured timings on standard development machine:
- `npm install`: ~40 seconds 
- `npm run build`: ~5 seconds (includes clean, tsc, plugin-ui)
- `npm run test`: ~1 second  
- `npm run test-coverage`: ~2 seconds
- `npm run lint`: ~1 second
- `npm run docs`: ~6 seconds
- `npm run prepublishOnly`: ~25 seconds (full pipeline)
- Complete end-to-end validation: ~30 seconds

All operations complete quickly except npm install. Use timeout of 60+ minutes for npm install, 60+ seconds for other commands.