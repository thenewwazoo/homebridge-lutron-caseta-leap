# Homebridge Lutron Caseta LEAP Plugin

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

This is a Homebridge plugin that provides HomeKit integration for Lutron Caseta Smart Bridge devices including Pico remotes, occupancy sensors, and Serena wood blinds. The plugin is written in TypeScript and uses the lutron-leap-js library to communicate with Lutron bridges via the LEAP protocol.

## Beta Branch Workflow Requirements

**IMPORTANT: All Pull Requests MUST target a beta branch first, never directly to main/latest.**

### Required Labels Before Copilot Assignment
Before assigning any issue to Copilot, it MUST have one of these labels:
- `patch` - for bug fixes (increments patch version: 2.8.1 → 2.8.2)
- `minor` - for new features (increments minor version: 2.8.1 → 2.9.0)  
- `major` - for breaking changes (increments major version: 2.8.1 → 3.0.0)

### Beta Branch Strategy
1. **Always target beta branches**: PRs must be created against branches starting with `beta-*`
2. **Beta branch naming**: Use format `beta-X.Y.Z` where X.Y.Z is the target version
3. **Creating beta branches**: If no appropriate beta branch exists:
   - For patch: create `beta-X.Y.(Z+1)` (e.g., current 2.8.1 → beta-2.8.2)
   - For minor: create `beta-X.(Y+1).0` (e.g., current 2.8.1 → beta-2.9.0)
   - For major: create `beta-(X+1).0.0` (e.g., current 2.8.1 → beta-3.0.0)
4. **Branch creation**: Beta branches should be created from the latest stable release branch
5. **PR workflow**: After beta testing, beta branches are merged to main/latest for release

### Version Planning
Check current version in `package.json` and follow semantic versioning:
- **Patch** (bug fixes): Backward-compatible fixes
- **Minor** (features): Backward-compatible new features  
- **Major** (breaking): Changes that break backward compatibility

## Working Effectively

### Bootstrap and Build
- Install dependencies: `npm install` -- takes ~40 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
- Build the project: `npm run build` -- takes ~5 seconds. Very fast compilation.
- Clean build artifacts: `npm run clean` -- removes ./dist directory
- Full build pipeline: `npm run prepublishOnly` -- takes ~25 seconds. NEVER CANCEL. Set timeout to 60+ minutes.
- Check for outdated packages: `npm run check` -- runs npm install && npm outdated (may exit with code 1 if packages are outdated, this is normal)

### Testing and Quality Assurance
- Run tests: `npm run test` -- takes ~1 second. Minimal test suite (only 2 tests in 1 file).
- Run tests with coverage: `npm run test-coverage` -- takes ~2 seconds. Shows coverage report.
- Watch tests: `npm run test:watch` -- for continuous testing during development.
- Lint code: `npm run lint` -- takes ~1 second. Uses ESLint with @antfu/eslint-config.
- Fix linting issues: `npm run lint:fix` -- automatically fixes fixable lint issues.
- IMPORTANT: TypeScript compilation will catch syntax errors that ESLint may miss.

### Development Workflow
- **Beta branch requirement**: All development MUST happen on beta branches (beta-*)
- Development mode: `npm run watch` -- builds and runs with nodemon, links plugin locally
- IMPORTANT: `npm run watch` requires a proper Homebridge development environment and will try to start Homebridge
- Copy UI files: `npm run plugin-ui` -- copies HTML files to dist directory
- ALWAYS run `npm run build` before testing changes
- ALWAYS run `npm run lint` before committing
- ALWAYS create PRs against beta branches, never main/latest directly

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

**Beta Branch Integration**: PRs should target beta branches first for testing before merging to main/latest.

## Important Directories and Files

### Source Code Structure
- `src/index.ts` -- Main plugin entry point, registers platform
- `src/platform.ts` -- Core platform implementation, device discovery and management
- `src/settings.ts` -- Plugin configuration constants
- `src/PicoRemote.ts` -- Pico remote button handling
- `src/OccupancySensor.ts` -- Occupancy sensor implementation  
- `src/SerenaTiltOnlyWoodBlinds.ts` -- Serena blinds support
- `src/ButtonState.ts` -- Button press state management
- `src/OccupancySensorRouter.ts` -- Routing logic for occupancy sensors
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

### Generated/Output
- `dist/` -- Compiled JavaScript output (generated by `npm run build`)
- `docs/` -- Generated TypeDoc documentation
- `node_modules/` -- Dependencies (never commit)

## Dependencies and Requirements

### Runtime Requirements
- Node.js 20 or 22 (specified in package.json engines)
- Homebridge ^1.9.0 || ^2.0.0 || ^2.0.0-beta.26 || ^2.0.0-alpha.37

### Key Dependencies
- `lutron-leap` ^3.4.2 -- Core LEAP protocol library for bridge communication
- `@homebridge/plugin-ui-utils` ^2.0.1 -- Homebridge UI framework
- `node-forge` ^1.3.1 -- Cryptography for certificate handling
- `typed-emitter` ^2.1.0 -- TypeScript event emitter

### Development Dependencies
- `typescript` ^5.8.2 -- TypeScript compiler
- `eslint` ^9.21.0 -- Code linting
- `vitest` ^3.0.7 -- Testing framework
- `typedoc` ^0.27.9 -- Documentation generation
- `nodemon` ^3.1.9 -- Development file watching

## Common Development Tasks

### Adding New Device Support
1. Add device type case to `platform.ts` in `configureAccessory` and `handleBridgeDiscovery`
2. Create new device class file in `src/` following pattern of existing devices
3. Implement HomeKit services and characteristics in the new class
4. Add LEAP protocol commands to lutron-leap-js library if needed
5. Wire up event handlers for unsolicited bridge updates
6. Test with actual hardware

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
2. **Create or checkout appropriate beta branch** (beta-X.Y.Z based on issue label)
3. Check out the lutron-leap-js repository separately  
4. Make changes to lutron-leap-js and run `npm run build` in that repo
5. Run `npm install ../lutron-leap-js` to use local version
6. Make changes to this plugin
7. Remove cached accessories: `rm ~/.homebridge/accessories/cachedAccessories`
8. Run with debug: `DEBUG='leap:*,HAP-NodeJS:Accessory' npm run watch`
9. Lint before committing: `npm run lint`
10. **Create PR against beta branch, never main/latest directly**

## Common Issues and Solutions

### Build or Link Failures
- Ensure Node.js version 20 or 22 is installed
- Run `npm install` to ensure all dependencies are current
- Clear and rebuild: `npm run clean && npm run build`

### Linting Failures
- Run `npm run lint:fix` to auto-fix issues
- ESLint config is strict, follow existing code patterns
- Import statements must use .js extensions (ESM requirement)

### Test Failures
- Current test suite is minimal (only OccupancySensorRouter tests in 1 file)
- Tests use Vitest framework with TypeScript
- Test files follow pattern: `*.test.ts` in src/ directory
- Tests validate singleton pattern and state management for occupancy sensors
- Failures likely indicate breaking changes to core functionality
- Add tests for new features following existing vitest patterns

### Bridge Discovery Issues
- Bridge discovery uses mDNS/Bonjour/zeroconf
- Network configuration can prevent discovery (broadcast relay, VLANs, etc.)
- Bridge must be on same network segment as Homebridge server

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