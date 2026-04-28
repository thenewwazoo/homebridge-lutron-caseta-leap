import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'
import type {
  BridgeNetInfo,
  DeviceDefinition,
  OneDeviceStatus,
  Response,
} from 'lutron-leap'
import type TypedEmitter from 'typed-emitter'

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

import type { ButtonPressLogLevel, LogLevelOption } from './Logger.js'

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
  filterBlinds: boolean
  clickSpeedLong: 'quick' | 'default' | 'relaxed' | 'disabled'
  clickSpeedDouble: 'quick' | 'default' | 'relaxed' | 'disabled'
  logSSLKeyDangerous: boolean
  // Plugin-level log verbosity. See src/Logger.ts for what each value does.
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

  constructor(log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
    super()

    // Read options first so we know which verbosity level to wrap at, then
    // wrap, then use this.log for everything else. createFilteredLogger
    // returns the original instance unchanged when level is 'normal' (the
    // default), so the only-overhead path is the active-filter case.
    this.options = this.optionsFromConfig(config)
    this.log = createFilteredLogger(log, this.options.logLevel)

    this.log.info('LutronCasetaLeap starting up...')

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
    // a very high number (see [#123](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/issues/123))
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

    this.log.info('LutronCasetaLeap plugin finished early initialization')
  }

  optionsFromConfig(config: PlatformConfig): GlobalOptions {
    return Object.assign(
      {
        filterPico: false,
        filterBlinds: false,
        clickSpeedDouble: 'default',
        clickSpeedLong: 'default',
        logSSLKeyDangerous: false,
        // Defaults reflect the post-reclassification "sane quiet by default"
        // posture. logLevel 'normal' means the wrapper is a passthrough; the
        // quietness comes from the call sites being correctly classified.
        // buttonPressLogging 'debug' means presses are not visible in normal
        // logs (a behavior change from earlier versions); use 'info' to
        // restore the old chatty behavior, or 'silent' to drop them entirely.
        logLevel: 'normal',
        buttonPressLogging: 'debug',
      },
      config.options,
    )
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
      } else {
        const bridge = new SmartBridge(bridgeID, client)

        // every pico and occupancy sensor needs to subscribe to
        // 'disconnected', and that may be a lot of devices.
        // see [#123](https://github.com/homebridge-plugins/homebridge-lutron-caseta-leap/issues/123)
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
    this.getDeviceInfoWithRetry(bridge).then(async (devices: DeviceDefinition[]) => {
      const results: PromiseSettledResult<string>[] = await Promise.allSettled(
        devices.map((device: DeviceDefinition) => this.processDevice(bridge, device)),
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
    })

    bridge.on('unsolicited', this.handleUnsolicitedMessage.bind(this))
  }

  async processDevice(bridge: SmartBridge, d: DeviceDefinition): Promise<string> {
    const fullName = d.FullyQualifiedName.join(' ')
    const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString())

    let accessory: PlatformAccessory | undefined = this.accessories.get(uuid)
    let is_from_cache = true
    if (accessory === undefined) {
      is_from_cache = false
      // new device, create an accessory
      accessory = new this.api.platformAccessory(fullName, uuid)
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
        // Mirror the Error-path fix from #207 (v3.0.4): never unregister a cached
        // accessory on a refresh-time classification miss. Skipped fires for transient
        // bridge responses missing AffectedZones (filterPico path) and for filter
        // toggles, both of which can flip across runs. Leaving the accessory registered
        // matches Home Assistant's lutron_caseta philosophy — bridge inventory, not
        // refresh state, is the source of truth for removal. Users still delete
        // intentionally-filtered devices via the cached-accessory cleanup documented
        // in the README.
        if (is_from_cache) {
          this.log.warn(`Skipping cached device ${fullName}; leaving accessory registered: ${result.reason}`)
          return Promise.resolve(`Leaving cached accessory registered (skipped): ${fullName}`)
        }
        return Promise.resolve(`Skipped setting up device: ${result.reason}`)
      }
      case DeviceWireResultType.Success: {
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

    switch (device.DeviceType) {
      // serena blinds
      case 'SerenaTiltOnlyWoodBlind': {
        this.log.info('Found a Serena blind:', fullName)

        if (this.options.filterBlinds) {
          return {
            kind: DeviceWireResultType.Skipped,
            reason: 'Serena wood blinds support disabled.',
          }
        }

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
      case 'Pico4Button':
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
