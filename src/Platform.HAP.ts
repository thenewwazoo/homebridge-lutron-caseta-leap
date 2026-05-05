import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'
import type {
  BridgeNetInfo,
  DeviceDefinition,
  OneDeviceStatus,
  Response,
} from 'lutron-leap'
import type TypedEmitter from 'typed-emitter'

import type { ButtonPressLogLevel, LogLevelOption } from './Logger.js'

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import process from 'node:process'
import v8 from 'node:v8'

import { APIEvent } from 'homebridge'
import {
  BridgeFinder,
  LEAP_PORT,
  LeapClient,
  SmartBridge,
} from 'lutron-leap'

import { createFilteredLogger } from './Logger.js'
import { OccupancySensor } from './OccupancySensor.js'
import { PicoRemote } from './PicoRemote.js'
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

interface PlatformEvents {
  [event: string]: (...args: any[]) => void
  unsolicited: (response: Response) => void
}

// see config.schema.json
export interface GlobalOptions {
  filterPico: boolean
  excludedDeviceTypes: string[]
  clickSpeedLong: 'quick' | 'default' | 'relaxed' | 'disabled'
  clickSpeedDouble: 'quick' | 'default' | 'relaxed' | 'disabled'
  logSSLKeyDangerous: boolean
  // Plugin-level log verbosity. See src/Logger.ts for what each value does.
  matterAllowNonCompliantSinglePress?: boolean
  logLevel: LogLevelOption
  // Specifically governs button-press log lines (raw Press/Release events
  // and interpreted short/long/double press events). Independent of logLevel
  // so users can silence presses without quieting the rest, or surface them
  // for automation setup without enabling global Homebridge debug.
  buttonPressLogging: ButtonPressLogLevel
}

interface BridgeAuthEntry {
  bridgeid: string
  ca: string
  key: string
  cert: string
}

export enum DeviceWireResultType {
  Success,
  Skipped,
  Error,
}

export type DeviceWireResult = WireSuccess | DeviceSkipped | WireError

export interface WireSuccess {
  kind: DeviceWireResultType.Success
  name: string
}

export interface DeviceSkipped {
  kind: DeviceWireResultType.Skipped
  reason: string
}

export interface WireError {
  kind: DeviceWireResultType.Error
  reason: string
}

export class LutronCasetaLeap
  extends (EventEmitter as new () => TypedEmitter<PlatformEvents>)
  implements DynamicPlatformPlugin {
  protected readonly accessories: Map<string, PlatformAccessory> = new Map()
  private finder: BridgeFinder | null = null
  private options: GlobalOptions
  private secrets: Map<string, BridgeAuthEntry>
  private bridgeMgr: Map<string, SmartBridge> = new Map()
  // Log is declared as a regular field rather than a constructor parameter
  // property because we need to wrap it (with the user's logLevel filter)
  // before the rest of the constructor — and parameter properties are
  // assigned implicitly at the start of the constructor, before user code
  // runs. Wrapping at the platform level cascades to every device class
  // that reads `this.platform.log`.
  public readonly log: Logging

  // UUIDs of devices whose initialize() succeeded. Used by processAllDevices()
  // to skip already-wired devices on re-scans (bridge re-announcements or
  // deviceheard events) so that PicoRemote/OccupancySensor 'disconnected' and
  // 'unsolicited' listeners do not accumulate.
  protected wiredDevices: Set<string> = new Set()
  // Bridges currently being scanned. Prevents concurrent processAllDevices()
  // calls for the same bridge from overlapping.
  private activeScanBridges: Set<string> = new Set()
  // Bridges that requested a re-scan while one was already in progress.
  // processAllDevices() checks this after each scan and runs a follow-up pass
  // so that devices that failed during an interrupted scan are retried.
  private pendingScanBridges: Set<string> = new Set()
  // Pre-bound reference to handleUnsolicitedMessage so we can pass the same
  // function instance to both bridge.on() and bridge.removeListener(), which
  // prevents duplicate 'unsolicited' listeners from accumulating when
  // processAllDevices() is called multiple times for the same bridge.
  private boundHandleUnsolicited!: (bridgeID: string, response: Response) => void

  constructor(log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
    super()

    // Read options first so we know which verbosity level to wrap at, then
    // wrap, then use this.log for everything else. createFilteredLogger
    // returns the original instance unchanged when level is 'normal' (the
    // default), so the only-overhead path is the active-filter case.
    this.options = this.optionsFromConfig(config)
    this.log = createFilteredLogger(log, this.options.logLevel)

    this.log.info('Homebridge Lutron starting up...')

    // Pre-bind once so the same function reference is used in both
    // bridge.on() and bridge.removeListener() — required for dedup.
    this.boundHandleUnsolicited = this.handleUnsolicitedMessage.bind(this)

    // The lutron-leap ping loop creates a `timeoutPromise` inside
    // Promise.race(). When the LEAP request rejects first (e.g. because
    // drain() was called during bridge reconfiguration), Promise.race
    // settles and its .catch() handler runs — but `timeoutPromise` itself
    // still rejects ~10 s later with no handler attached. Node.js v15+
    // treats unhandled rejections as fatal (exit code 1), which restarts
    // the child bridge and corrupts the cached-accessories file, causing
    // Picos to lose their HomeKit room assignments and automation links.
    //
    // The fix cannot be applied inside lutron-leap itself without upstream
    // changes, and wrapping each LEAP call in a try-catch would not
    // intercept the rejection because it originates inside a setTimeout
    // callback that fires after the awaiting promise chain has already
    // settled.
    //
    // The handler below matches only the two known lutron-leap rejection
    // strings ('Ping timeout' from SmartBridge and 'request with tag…timed
    // out' from LeapClient). All other unhandled rejections are re-thrown
    // so that genuine process-fatal errors are not silently swallowed —
    // this is important when the plugin runs in the Homebridge main process
    // rather than a dedicated child bridge.
    if (process.listenerCount('unhandledRejection') === 0) {
      process.on('unhandledRejection', (reason: unknown) => {
        // lutron-leap SmartBridge ping timeout (a plain string, not an Error)
        if (reason === 'Ping timeout') {
          this.log.debug('Suppressed lutron-leap ping timeout (unhandled rejection):', reason)
          return
        }
        // lutron-leap LeapClient request timeout (an Error with a known message pattern)
        if (reason instanceof Error && /request with tag.*timed out/.test(reason.message)) {
          this.log.debug('Suppressed lutron-leap request timeout (unhandled rejection):', reason.message)
          return
        }
        // Unknown unhandled rejection — schedule a throw on the next tick so
        // Node.js handles it as a fatal uncaught exception. Throwing directly
        // inside the 'unhandledRejection' handler in Node.js 15+ causes a
        // second unhandledRejection event rather than a process exit, so we
        // use process.nextTick() to break out of the handler's call stack.
        this.log.warn('Unhandled promise rejection (not a known lutron-leap timeout):', reason)
        process.nextTick(() => { throw reason })
      })
    }

    process.on('warning', e => this.log.warn(`Got ${e.name} process warning: ${e.message}:\n${e.stack}`))

    this.secrets = this.secretsFromConfig(config)
    if (this.secrets.size === 0) {
      // Bumped from warn to error: with no secrets the plugin can do
      // nothing, so this must bypass any user-configured 'errors-only'
      // filter and demand attention. (Previously a warn, which would have
      // been suppressed under the new errors-only logLevel.)
      this.log.error('No bridge auth configured. Retiring.')
      return
    }

    // Each device will subscribe to 'unsolicited', which means we very
    // quickly hit the limit for EventEmitters. Set this limit to
    // a very high number (see [#123](https://github.com/homebridge-plugins/homebridge-lutron/issues/123))
    this.setMaxListeners(400 * this.secrets.size)

    /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.log.info('Finished launching; starting up automatic discovery')

      this.finder = new BridgeFinder()
      this.finder.on('discovered', this.handleBridgeDiscovery.bind(this))
      this.finder.on('failed', (error) => {
        this.log.error('Could not connect to discovered hub:', error)
      })
      this.finder.beginSearching()
    })

    process.on('SIGUSR2', () => {
      const fileName = `/tmp/lutron.${Date.now()}.heapsnapshot`
      const usage = process.memoryUsage()
      this.log.warn(`Current memory usage:
                          rss=${usage.rss},
                          heapTotal=${usage.heapTotal},
                          heapUsed=${usage.heapUsed},
                          external=${usage.external},
                          arrayBuffers=${usage.arrayBuffers}`)
      this.log.warn(`Got request to dump heap. Dumping to ${fileName}`)
      const snapshotStream = v8.getHeapSnapshot()
      const fileStream = fs.createWriteStream(fileName)
      snapshotStream.pipe(fileStream)
      this.log.info(`Heap dump to ${fileName} finished.`)
    })

    this.log.info('Homebridge Lutron plugin finished early initialization')
  }

  optionsFromConfig(config: PlatformConfig): GlobalOptions {
    const rawExcludedDeviceTypes = config.options?.excludedDeviceTypes
    const excludedDeviceTypes = Array.isArray(rawExcludedDeviceTypes)
      ? rawExcludedDeviceTypes
          .filter((value): value is string => typeof value === 'string')
          .map(value => value.trim())
          .filter(value => value.length > 0)
      : []

    return Object.assign(
      {
        filterPico: false,
        excludedDeviceTypes: [],
        clickSpeedDouble: 'default',
        clickSpeedLong: 'default',
        logSSLKeyDangerous: false,
        // Defaults reflect the post-reclassification "sane quiet by default"
        // posture. logLevel 'normal' means the wrapper is a passthrough; the
        // quietness comes from the call sites being correctly classified.
        // buttonPressLogging 'info' keeps press events visible in normal logs.
        // Users can set 'debug' to only show presses with global Homebridge
        // debug enabled, or 'silent' to drop them entirely.
        logLevel: 'normal',
        buttonPressLogging: 'info',
      },
      config.options,
      { excludedDeviceTypes },
    )
  }

  private isDeviceTypeExcluded(deviceType: string): boolean {
    return this.options.excludedDeviceTypes.includes(deviceType)
  }

  secretsFromConfig(config: PlatformConfig): Map<string, BridgeAuthEntry> {
    const out = new Map()
    for (const entry of config.secrets as Array<BridgeAuthEntry>) {
      out.set(entry.bridgeid.toLowerCase(), {
        ca: entry.ca,
        key: entry.key,
        cert: entry.cert,
        bridgeid: entry.bridgeid,
      })
    }
    return out
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory)
  }

  // ----- CUSTOM METHODS

  private async handleBridgeDiscovery(bridgeInfo: BridgeNetInfo) {
    let replaceClient = false
    const bridgeID = bridgeInfo.bridgeid.toLowerCase()

    if (this.bridgeMgr.has(bridgeID)) {
      // this is an existing bridge re-announcing itself, so we'll recycle the connection to it
      if (this.bridgeMgr.get(bridgeID)!.bridgeReconfigInProgress === true) {
        // Per mDNS re-announcement noise — fires constantly during steady
        // state. Was info; now debug. (See PR conversation: this trio of
        // bridge-state lines was the user's primary complaint about info-
        // level noise.)
        this.log.debug('Bridge', bridgeInfo.bridgeid, 'reconfiguration in progress, do nothing.')
        return
      }
      // Same — fires on every mDNS re-announce after the first. info → debug.
      this.log.debug('Bridge', bridgeInfo.bridgeid, 'already known, will skip setup.')
      replaceClient = true
    }

    if (this.secrets.has(bridgeID)) {
      const these = this.secrets.get(bridgeID)!
      this.log.debug('bridge', bridgeInfo.bridgeid, 'has secrets', JSON.stringify(these))

      let logfile: fs.WriteStream | undefined
      if (this.options.logSSLKeyDangerous) {
        logfile = fs.createWriteStream(`/tmp/${bridgeInfo.bridgeid}-tlskey.log`, { flags: 'a' })
      }

      const client = new LeapClient(bridgeInfo.ipAddr, LEAP_PORT, these.ca, these.key, these.cert, logfile)

      if (replaceClient) {
        // when we close the client connection, it disconnects, which
        // causes it to emit a disconnection event. this event will
        // propagate to the bridge that owns it, which will emit its
        // own disconnect event, triggering re-subscriptions (at the
        // LEAP layer) by buttons and occupancy sensors.
        //
        // I think there's a race here, in that the re-subscription
        // will trigger the client reconnect, possibly before the
        // client object in the bridge is replaced. As such, we need to
        // replace the client object with the new client *before* we
        // tell the old client to disconnect. because the bridge
        // doesn't tie disconnect events to the client that emitted
        // them (why would it?  bridges never have more than one
        // connection), we should then be able to rely on the
        // disconnect event machinery to set things back up for us.
        // convenient!

        // this should, then, look like this:
        //  - store new client in bridge
        //  - close old client
        //  - old client emits disconnect
        //  - bridge gets disconnect, emits disconnect
        //  - devices ask bridge to re-subscribe
        //  - bridge uses new client to re-subscribe
        //  - old client goes out of scope
        // Bookend an internal reconfigure operation. Useful when debugging
        // a reconfigure issue, but normal-path noise otherwise. info → debug.
        this.log.debug('Bridge', bridgeInfo.bridgeid, 'entering reconfiguration')
        await this.bridgeMgr.get(bridgeID)!.reconfigureBridge(client)
        this.log.debug('Bridge', bridgeInfo.bridgeid, 'exit reconfiguration')
        // reconfigureBridge() emits 'disconnected' so already-wired devices
        // re-subscribe via their own handlers. Call processAllDevices() to
        // also retry any devices whose initialize() was interrupted by the
        // previous reconfiguration (they won't be in wiredDevices yet).
        this.processAllDevices(this.bridgeMgr.get(bridgeID)!)
      } else {
        const bridge = new SmartBridge(bridgeID, client)

        // every pico and occupancy sensor needs to subscribe to
        // 'disconnected', and that may be a lot of devices.
        // see [#123](https://github.com/homebridge-plugins/homebridge-lutron/issues/123)
        bridge.setMaxListeners(400)

        this.bridgeMgr.set(bridge.bridgeID, bridge)
        this.processAllDevices(bridge)
      }
    } else {
      // Multi-bridge scenario noise — if the user has 2 bridges and only
      // configured 1, the unconfigured one will hit this branch on every
      // mDNS announce. info → debug.
      this.log.debug('no credentials from bridge ID', bridgeInfo.bridgeid)
    }
  }

  // Wrap getDeviceInfo() with bounded exponential backoff. The plain bridge call
  // gives up after one failure, leaving the plugin degraded until mDNS re-announce
  // or a deviceheard event — fragile during bridge firmware updates and brief
  // network blips. Home Assistant's lutron_caseta delegates retry to Core's
  // config-entry harness; Homebridge has no equivalent, so we loop in-plugin.
  // ~65s total budget is comparable to HA's ~59s single-attempt window
  // (CONNECT_TIMEOUT 9s + CONFIGURE_TIMEOUT 50s).
  private async getDeviceInfoWithRetry(bridge: SmartBridge): Promise<DeviceDefinition[]> {
    const delaysMs = [5_000, 15_000, 45_000] // 4 attempts total: immediate, +5s, +15s, +45s
    let lastError: unknown
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      if (attempt > 0) {
        const delay = delaysMs[attempt - 1]
        this.log.info(`Retrying device inventory fetch in ${delay / 1000}s (attempt ${attempt + 1}/${delaysMs.length + 1})`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      try {
        return await bridge.getDeviceInfo()
      } catch (error) {
        lastError = error
        this.log.warn(`Device inventory fetch failed (attempt ${attempt + 1}/${delaysMs.length + 1}):`, error)
      }
    }
    throw lastError
  }

  private processAllDevices(bridge: SmartBridge) {
    // Prevent overlapping scans for the same bridge. If a scan is already
    // running when this is called (e.g. a second mDNS re-announce fires
    // while the first processAllDevices() pass is still in flight), record a
    // pending request so the running scan queues a follow-up pass when it
    // finishes — ensuring any devices that failed during the interrupted scan
    // are eventually retried.
    if (this.activeScanBridges.has(bridge.bridgeID)) {
      this.pendingScanBridges.add(bridge.bridgeID)
      this.log.debug('Bridge', bridge.bridgeID, 'scan already in progress; queuing a follow-up refresh')
      return
    }
    this.activeScanBridges.add(bridge.bridgeID)
    this.pendingScanBridges.delete(bridge.bridgeID)

    // Use remove+add so that repeated calls always result in exactly one
    // 'unsolicited' listener on the bridge, even after reconfiguration or
    // deviceheard-triggered rescans.
    bridge.removeListener('unsolicited', this.boundHandleUnsolicited)
    bridge.on('unsolicited', this.boundHandleUnsolicited)

    this.getDeviceInfoWithRetry(bridge).then(async (devices: DeviceDefinition[]) => {
      // Filter out devices that already completed initialize() successfully.
      // Wired devices have their own 'disconnected' handler that calls
      // bridge.subscribeToButton() / sensor.subscribe() after reconnect, so
      // they don't need to go through processDevice() again. Skipping them
      // prevents duplicate 'disconnected' and 'unsolicited' listeners from
      // accumulating on PicoRemote and OccupancySensor instances each time
      // the bridge re-announces or a deviceheard event fires.
      const unwiredDevices = devices.filter(
        d => !this.wiredDevices.has(this.api.hap.uuid.generate(d.SerialNumber.toString())),
      )
      const results: PromiseSettledResult<string>[] = await Promise.allSettled(
        unwiredDevices.map((device: DeviceDefinition) => this.processDevice(bridge, device)),
      )
      for (const result of results) {
        switch (result.status) {
          case 'fulfilled': {
            // Fires per device per scan (e.g., 11 lines on every refresh
            // for a setup with 11 Picos). The "Found a {DeviceType} ..."
            // info lines emitted earlier already announce discovery; this
            // line is just confirmation that wiring didn't throw, which
            // is the normal outcome. info → debug.
            this.log.debug(`Device setup finished: ${result.value}`)
            break
          }
          case 'rejected': {
            this.log.error(`Failed to process device: ${result.reason}`)
            break
          }
        }
      }
    }).catch((error) => {
      // Log at error (not warn) so users see when the plugin has given up — they
      // may need to restart Homebridge if the bridge does not recover on its own.
      this.log.error('Failed to fetch device inventory after retries; skipping this scan. Restart Homebridge if the bridge does not recover on its own:', error)
    }).finally(() => {
      this.activeScanBridges.delete(bridge.bridgeID)
      // If a re-scan was requested while this one was running, start it now
      // so any devices that failed during an interrupted scan are retried.
      if (this.pendingScanBridges.has(bridge.bridgeID)) {
        this.pendingScanBridges.delete(bridge.bridgeID)
        this.log.debug('Bridge', bridge.bridgeID, 'running queued follow-up device scan')
        this.processAllDevices(bridge)
      }
    })
  }

  async processDevice(bridge: SmartBridge, d: DeviceDefinition): Promise<string> {
    const fullName = d.FullyQualifiedName.join(' ')
    const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString())

    let accessory: PlatformAccessory | undefined = this.accessories.get(uuid)
    let is_from_cache = true
    if (accessory === undefined) {
      is_from_cache = false
      // new device, create an accessory
      const PlatformAccessoryCtor = this.api.platformAccessory
      accessory = new PlatformAccessoryCtor(fullName, uuid)
      this.log.debug(`Device ${fullName} not found in accessory cache`)
    }

    const result = await this.wireAccessory(accessory, bridge, d)
    accessory.displayName = fullName
    switch (result.kind) {
      case DeviceWireResultType.Error: {
        if (is_from_cache) {
          this.log.warn(`Could not refresh device data for cached device ${fullName}; leaving accessory registered: ${result.reason}`)
          return Promise.resolve(`Leaving cached accessory registered (refresh failed): ${fullName}`)
        }
        return Promise.reject(new Error(`Failed to wire device ${fullName}: ${result.reason}`))
      }
      case DeviceWireResultType.Skipped: {
        const isExplicitlyExcluded = result.reason.startsWith('Device type excluded by config: ')
        // Mirror the Error-path fix from #207 (v3.0.4): never unregister a cached
        // accessory on a refresh-time classification miss. Skipped fires for transient
        // bridge responses missing AffectedZones (filterPico path) and for filter
        // toggles, both of which can flip across runs. Leaving the accessory registered
        // matches Home Assistant's lutron_caseta philosophy — bridge inventory, not
        // refresh state, is the source of truth for removal. Users still delete
        // intentionally-filtered devices via the cached-accessory cleanup documented
        // in the README.
        if (is_from_cache) {
          if (isExplicitlyExcluded) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
            this.accessories.delete(accessory.UUID)
            this.log.info(`Unregistered cached accessory for excluded device type ${d.DeviceType}: ${fullName}`)
            return Promise.resolve(`Removed cached accessory for excluded device type: ${fullName}`)
          }
          this.log.warn(`Skipping cached device ${fullName}; leaving accessory registered: ${result.reason}`)
          return Promise.resolve(`Leaving cached accessory registered (skipped): ${fullName}`)
        }
        return Promise.resolve(`Skipped setting up device: ${result.reason}`)
      }
      case DeviceWireResultType.Success: {
        // Mark this device as successfully wired so subsequent processAllDevices()
        // passes (from re-announcements or deviceheard events) can skip it.
        // Already-wired devices re-subscribe via their own 'disconnected' handler
        // after reconfigureBridge() emits 'disconnected', so they don't need
        // initialize() to run again.
        this.wiredDevices.add(uuid)
        if (!is_from_cache) {
          this.accessories.set(accessory.UUID, accessory)
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.debug(`registered new device ${fullName} because it was new`)
        }
        return Promise.resolve(is_from_cache
          ? `Restoring existing accessory from cache: ${fullName}`
          : `Adding new accessory: ${fullName}`)
      }
    }
  }

  async wireAccessory(
    accessory: PlatformAccessory,
    bridge: SmartBridge,
    device: DeviceDefinition,
  ): Promise<DeviceWireResult> {
    const fullName = device.FullyQualifiedName.join(' ')
    accessory.context.device = device
    accessory.context.bridgeID = bridge.bridgeID

    if (this.isDeviceTypeExcluded(device.DeviceType)) {
      return Promise.resolve({
        kind: DeviceWireResultType.Skipped,
        reason: `Device type excluded by config: ${device.DeviceType}`,
      })
    }

    switch (device.DeviceType) {
      case 'WallDimmer': {
        this.log.info(`Found a WallDimmer ${fullName}`)
        const dimmer = new (await import('./WallDimmer.js')).WallDimmer(this, accessory, bridge, device)
        if (typeof dimmer.initialize === 'function') {
          return dimmer.initialize()
        }
        return {
          kind: DeviceWireResultType.Success,
          name: fullName,
        }
      }
      case 'WallSwitch': {
        this.log.info(`Found a WallSwitch ${fullName}`)
        const wallSwitch = new (await import('./WallSwitch.js')).WallSwitch(this, accessory, bridge, device)
        if (typeof wallSwitch.initialize === 'function') {
          return wallSwitch.initialize()
        }
        return {
          kind: DeviceWireResultType.Success,
          name: fullName,
        }
      }
      // serena blinds
      case 'SerenaTiltOnlyWoodBlind': {
        this.log.info('Found a Serena blind:', fullName)

        // SIDE EFFECT: this constructor mutates the accessory object
        new SerenaTiltOnlyWoodBlinds(this, accessory, bridge)

        return {
          kind: DeviceWireResultType.Success,
          name: fullName,
        }
      }

      // supported Pico remotes
      case 'Pico2Button':
      case 'Pico2ButtonRaiseLower':
      case 'Pico3Button':
      case 'Pico3ButtonRaiseLower':
      case 'Pico4Button':
      case 'Pico4Button2Group':
      case 'Pico4ButtonScene':
      case 'Pico4ButtonZone':
      case 'PaddleSwitchPico': {
        this.log.info(`Found a ${device.DeviceType} remote ${fullName}`)

        // SIDE EFFECT: this constructor mutates the accessory object
        const remote = new PicoRemote(this, accessory, bridge, this.options)
        return remote.initialize()
      }

      // occupancy sensors
      case 'RPSOccupancySensor': {
        this.log.info(`Found a ${device.DeviceType} occupancy sensor ${fullName}`)

        const sensor = new OccupancySensor(this, accessory, bridge)
        return sensor.initialize()
      }

      // known devices that are not exposed to homekit, pending support
      case 'FourGroupRemote': {
        return Promise.resolve({
          kind: DeviceWireResultType.Skipped,
          reason: `Device type ${device.DeviceType} not yet supported, skipping setup. Please file a request ticket`,
        })
      }

      // any device we don't know about yet
      default:
        return Promise.resolve({
          kind: DeviceWireResultType.Skipped,
          reason: `Device type ${device.DeviceType} not supported by this plugin`,
        })
    }
  }

  handleUnsolicitedMessage(bridgeID: string, response: Response) {
    this.log.debug('bridge', bridgeID, 'got unsolicited message', response)

    if (response.CommuniqueType === 'UpdateResponse' && response.Header.Url === '/device/status/deviceheard') {
      const heardDevice = (response.Body! as OneDeviceStatus).DeviceStatus.DeviceHeard
      this.log.info(`New ${heardDevice.DeviceType} s/n ${heardDevice.SerialNumber}. Triggering refresh in 30s.`)
      const bridge = this.bridgeMgr.get(bridgeID)
      if (bridge !== undefined) {
        setTimeout(() => this.processAllDevices(bridge), 30000)
      }
    } else {
      this.emit('unsolicited', response)
    }
  }
}
