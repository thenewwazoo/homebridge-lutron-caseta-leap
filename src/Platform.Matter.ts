// Type for Matter-required fields
// Matter device type IDs (see CSA Device Library)
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge'
import type { DeviceDefinition, SmartBridge } from 'lutron-leap'

import { DeviceWireResultType, LutronCasetaLeap } from './Platform.HAP.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

interface MatterAccessoryFields {
  // deviceType must be an api.matter.deviceTypes.* object (EndpointType), not a number array
  deviceType: any
  manufacturer: string
  model: string
  serialNumber: string
}

const MATTER_NODE_LABEL_MAX_LENGTH = 32

function normalizeMatterDisplayName(fullName: string, serialNumber: string): string {
  if (fullName.length <= MATTER_NODE_LABEL_MAX_LENGTH) {
    return fullName
  }

  // Keep labels deterministic and human-readable while preserving uniqueness.
  const compactName = fullName.replace(/\s+/g, ' ').trim()
  if (compactName.length <= MATTER_NODE_LABEL_MAX_LENGTH) {
    return compactName
  }

  const serialSuffix = ` ${serialNumber.slice(-4)}`
  const available = Math.max(1, MATTER_NODE_LABEL_MAX_LENGTH - serialSuffix.length)
  return `${compactName.slice(0, available).trimEnd()}${serialSuffix}`
}

/**
 * Homebridge Matter platform for the Lutron Caseta LEAP plugin.
 *
 * Extends the standard HAP platform ({@link LutronCasetaLeap}) and overrides
 * accessory registration to use the Homebridge Matter API when it is
 * available.  If the Matter API is absent at runtime the class falls back
 * transparently to the standard HAP behaviour inherited from
 * {@link LutronCasetaLeap}.
 *
 * Note: `configureAccessory` is intentionally **not** overridden here so that
 * cached accessories restored by Homebridge continue to be stored in
 * `this.accessories` via the base-class implementation.
 */
export class LutronCasetaLeapMatterPlatform extends LutronCasetaLeap {
  constructor(log: Logging, config: PlatformConfig, api: API) {
    super(log, config, api)
    // Use this.log (wrapped by the base class with the user's logLevel) so
    // the Matter banner respects the same verbosity setting as everything else.
    this.log.info('LutronCasetaLeapMatterPlatform: Matter mode active')
  }

  /**
   * Returns the Homebridge Matter sub-API if both `registerPlatformAccessories`
   * and `unregisterPlatformAccessories` are present, or `undefined` otherwise.
   */
  private get matterApi(): any | undefined {
    const anyApi = this.api as any
    if (
      anyApi?.matter
      && typeof anyApi.matter.registerPlatformAccessories === 'function'
      && typeof anyApi.matter.unregisterPlatformAccessories === 'function'
    ) {
      return anyApi.matter
    }
    return undefined
  }

  /**
   * Overrides {@link LutronCasetaLeap.processDevice} to register newly
   * discovered accessories with the Matter API when available, falling back
   * to the standard HAP path when Matter is not present.
   */
  override async processDevice(
    bridge: SmartBridge,
    d: DeviceDefinition,
  ): Promise<string> {
    const mApi = this.matterApi
    if (!mApi) {
      // Matter API not present – delegate entirely to the HAP implementation.
      return super.processDevice(bridge, d)
    }

    const fullName = d.FullyQualifiedName.join(' ')
    const serialNumber = d.SerialNumber?.toString() || ''
    const matterDisplayName = normalizeMatterDisplayName(fullName, serialNumber)
    const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString())

    let accessory: PlatformAccessory | undefined = this.accessories.get(uuid)
    let isFromCache = true
    if (accessory === undefined) {
      isFromCache = false
      // Use the PlatformAccessory constructor from the API
      const PlatformAccessoryCtor = this.api.platformAccessory as unknown as { new(name: string, uuid: string): PlatformAccessory }
      accessory = new PlatformAccessoryCtor(fullName, uuid)
      this.log.debug(`Device ${fullName} not found in accessory cache (Matter mode)`)
    }

    const result = await this.wireAccessory(accessory, bridge, d)

    if (
      result.kind === DeviceWireResultType.Skipped
      && result.reason.startsWith('Device type excluded by config: ')
    ) {
      if (isFromCache) {
        // In Matter mode, accessories can exist in both HAP and Matter registries.
        // Remove from both so previously cached accessories are fully purged.
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        this.accessories.delete(accessory.UUID)
        this.log.info(`Unregistered cached Matter accessory for excluded device type ${d.DeviceType}: ${fullName}`)
        return Promise.resolve(`Removed cached Matter accessory for excluded device type: ${fullName}`)
      }

      return Promise.resolve(`Skipped Matter registration for excluded device type: ${fullName}`)
    }

    accessory.displayName = matterDisplayName
    if (matterDisplayName !== fullName) {
      this.log.debug(`Truncated Matter node label for ${fullName} -> ${matterDisplayName}`)
    }

    // Set all required Matter fields before registration
    // Generalized Matter support for all device types
    let matterFields: MatterAccessoryFields | undefined
    let clusters: Record<string, any> | undefined
    let handlers: Record<string, any> | undefined
    let shouldRefreshCachedMatterAccessory = false
    switch (d.DeviceType) {
      case 'SmartBridge':
        // Suppress SmartBridge from logging or registration
        return Promise.resolve(`Skipped Matter registration for SmartBridge`)
      case 'Pico2Button':
      case 'Pico2ButtonRaiseLower':
      case 'Pico3Button':
      case 'Pico3ButtonRaiseLower':
      case 'Pico4Button':
      case 'Pico4Button2Group':
      case 'Pico4ButtonScene':
      case 'Pico4ButtonZone':
      case 'PaddleSwitchPico': {
        matterFields = {
          deviceType: mApi.deviceTypes.BridgedNode,
          manufacturer: 'Lutron Electronics',
          model: (d.ModelNumber || d.DeviceType || 'Pico Remote').toString(),
          serialNumber: serialNumber || uuid,
        }
        const PicoRemote = (await import('./PicoRemote.js')).PicoRemote
        const pico = new PicoRemote(this, accessory, bridge, this.optionsFromConfig(this.config), mApi)
        clusters = pico.getMatterClusters()
        this.log.debug(`[Matter] Pico remote ${fullName} (${d.DeviceType}): getMatterClusters returned ${Object.keys(clusters).length} top-level keys: ${Object.keys(clusters).join(', ')}`)
        if (clusters.parts && Array.isArray(clusters.parts)) {
          this.log.info(`[Matter] Pico remote ${fullName} will register with ${clusters.parts.length} composed endpoints`)
        }
        break
      }
      case 'SerenaTiltOnlyWoodBlind': {
        matterFields = {
          deviceType: mApi.deviceTypes.WindowCovering,
          manufacturer: 'Lutron Electronics',
          model: (d.ModelNumber || d.DeviceType || 'Serena Blind').toString(),
          serialNumber: serialNumber || uuid,
        }
        const { SerenaTiltOnlyWoodBlinds } = await import('./SerenaTiltOnlyWoodBlinds.js')
        clusters = SerenaTiltOnlyWoodBlinds.getMatterClusters()

        handlers = {
          windowCovering: {
            goToTiltPercentage: async (request: any) => {
              const zoneTilt100ths = Number(
                request?.tiltPercent100thsValue
                ?? request?.targetPositionTiltPercent100ths
                ?? 0,
              )
              const clamped100ths = Math.max(0, Math.min(10000, Math.round(zoneTilt100ths)))
              const lutronTilt = clamped100ths / 200
              await bridge.setBlindsTilt(d, lutronTilt)
            },
          },
        }
        break
      }
      case 'RPSOccupancySensor': {
        matterFields = {
          deviceType: mApi.deviceTypes.OccupancySensor,
          manufacturer: 'Lutron Electronics',
          model: (d.ModelNumber || d.DeviceType || 'Occupancy Sensor').toString(),
          serialNumber: serialNumber || uuid,
        }
        const { OccupancySensor } = await import('./OccupancySensor.js')
        clusters = OccupancySensor.getMatterClusters()
        break
      }
      case 'WallDimmer': {
        matterFields = {
          deviceType: mApi.deviceTypes.DimmableLight,
          manufacturer: 'Lutron Electronics',
          model: (d.ModelNumber || d.DeviceType || 'Wall Dimmer').toString(),
          serialNumber: serialNumber || uuid,
        }
        const { WallDimmer } = await import('./WallDimmer.js')
        clusters = WallDimmer.getMatterClusters()

        const zoneHref = d.LocalZones?.[0]?.href
        if (!zoneHref) {
          return Promise.resolve(`Skipped Matter registration for device missing LocalZones: ${fullName}`)
        }

        const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))
        const percentFromMatterLevel = (level: number): number => clampPercent((Math.max(0, Math.min(254, level)) / 254) * 100)
        const sendLevel = async (levelPercent: number) => {
          await bridge.client.request('CreateRequest', `${zoneHref}/commandprocessor`, {
            Command: {
              CommandType: 'GoToLevel',
              Parameter: [{ Type: 'Level', Value: clampPercent(levelPercent) }],
            },
          })
        }

        handlers = {
          onOff: {
            on: async () => {
              const levelState = await mApi.getAccessoryState(uuid, 'levelControl')
              const knownLevel = Number((levelState as any)?.currentLevel)
              const targetPercent = Number.isFinite(knownLevel) && knownLevel > 0
                ? percentFromMatterLevel(knownLevel)
                : 100
              this.log.debug(`[Matter] WallDimmer ${fullName}: received onOff.on, restoring to ${targetPercent}`)
              await sendLevel(targetPercent)
            },
            off: async () => sendLevel(0),
            toggle: async () => {
              const resp = await bridge.client.request('ReadRequest', `${zoneHref}/status`)
              const status = (resp.Body as any)?.ZoneStatus
              const isOn = typeof status?.Level === 'number' && status.Level > 0
              await sendLevel(isOn ? 0 : 100)
            },
          },
          levelControl: {
            moveToLevel: async (request: any) => sendLevel(percentFromMatterLevel(Number(request?.level ?? 0))),
            moveToLevelWithOnOff: async (request: any) => sendLevel(percentFromMatterLevel(Number(request?.level ?? 0))),
          },
        }
        break
      }
      case 'WallSwitch': {
        matterFields = {
          deviceType: mApi.deviceTypes.OnOffLight,
          manufacturer: 'Lutron Electronics',
          model: (d.ModelNumber || d.DeviceType || 'Wall Switch').toString(),
          serialNumber: serialNumber || uuid,
        }
        const { WallSwitch } = await import('./WallSwitch.js')
        clusters = WallSwitch.getMatterClusters()

        const zoneHref = d.LocalZones?.[0]?.href
        if (!zoneHref) {
          return Promise.resolve(`Skipped Matter registration for device missing LocalZones: ${fullName}`)
        }

        const sendLevel = async (on: boolean) => {
          this.log.debug(`[Matter->LEAP] WallSwitch ${fullName}: sending GoToLevel ${on ? 100 : 0} to ${zoneHref}`)
          await bridge.client.request('CreateRequest', `${zoneHref}/commandprocessor`, {
            Command: {
              CommandType: 'GoToLevel',
              Parameter: [{ Type: 'Level', Value: on ? 100 : 0 }],
            },
          })
        }

        handlers = {
          onOff: {
            on: async () => {
              this.log.debug(`[Matter] WallSwitch ${fullName}: received onOff.on`)
              await sendLevel(true)
            },
            off: async () => {
              this.log.debug(`[Matter] WallSwitch ${fullName}: received onOff.off`)
              await sendLevel(false)
            },
            toggle: async () => {
              this.log.debug(`[Matter] WallSwitch ${fullName}: received onOff.toggle`)
              const resp = await bridge.client.request('ReadRequest', `${zoneHref}/status`)
              const status = (resp.Body as any)?.ZoneStatus
              const isOn = typeof status?.Level === 'number' && status.Level > 0
              this.log.debug(`[Matter] WallSwitch ${fullName}: current level=${status?.Level ?? 'unknown'}, toggling to ${isOn ? 0 : 100}`)
              await sendLevel(!isOn)
            },
          },
        }
        break
      }
      default:
        // Not supported for Matter, skip registration (no log for SmartBridge)
        this.log.debug(`Device type ${d.DeviceType} is not supported for Matter, skipping Matter registration for ${fullName}`)
        return Promise.resolve(`Skipped Matter registration for unsupported device: ${fullName}`)
    }
    if (matterFields && clusters) {
      const previousParts = Array.isArray((accessory as any).parts)
        ? (accessory as any).parts as Array<Record<string, any>>
        : []

      // Matter validator requires these fields on the accessory object itself.
      Object.assign(accessory as any, matterFields)
      // Keep metadata in context as well so cached accessory restores keep parity.
      Object.assign(accessory.context, matterFields)

      if ('parts' in clusters && Array.isArray(clusters.parts) && clusters.parts.length > 0) {
        const nextParts = clusters.parts as Array<Record<string, any>>

        // Composed device — set parts directly on the accessory
        ;(accessory as any).parts = nextParts
        delete (accessory as any).clusters
        delete (accessory as any).handlers
        this.log.debug(`[Matter] Registering composed device '${fullName}' with ${nextParts.length} endpoint(s)`)
        this.log.debug(`[Matter Debug] Part structure for '${fullName}':`, JSON.stringify(nextParts, null, 2))

        // Cached accessories can retain stale endpoint metadata from earlier
        // registrations. If part IDs/count changed (or no prior parts existed),
        // force a re-register so Home receives the updated composed structure.
        if (isFromCache) {
          const previousIds = previousParts.map(part => String(part.id)).sort()
          const nextIds = nextParts.map(part => String(part.id)).sort()
          shouldRefreshCachedMatterAccessory = previousIds.length !== nextIds.length
            || previousIds.some((id, index) => id !== nextIds[index])
        }
      } else {
        // Single-endpoint device — strip any 'behaviors' and 'parts' keys and set clusters directly
        const pureClusters = Object.fromEntries(
          Object.entries(clusters).filter(([k]) => k !== 'behaviors' && k !== 'parts'),
        )
        if (Object.keys(pureClusters).length === 0) {
          this.log.warn(`Device ${fullName} did not provide valid Matter clusters, skipping Matter registration.`)
          return Promise.resolve(`Skipped Matter registration for device with invalid clusters: ${fullName}`)
        }
        ;(accessory as any).clusters = pureClusters
        if (handlers && Object.keys(handlers).length > 0) {
          ;(accessory as any).handlers = handlers
        } else {
          delete (accessory as any).handlers
        }
        delete (accessory as any).parts
        this.log.debug(`[Matter Debug] Registering '${fullName}' with clusters:`, JSON.stringify(pureClusters, null, 2))
      }
    } else {
      this.log.warn(`Device ${fullName} did not provide valid Matter clusters, skipping Matter registration.`)
      return Promise.resolve(`Skipped Matter registration for device with invalid clusters: ${fullName}`)
    }

    switch (result.kind) {
      case DeviceWireResultType.Error: {
        if (isFromCache) {
          mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.debug(`un-registered cached device ${fullName} (Matter) due to an error: ${result.reason}`)
        }
        return Promise.reject(new Error(`Failed to wire device ${fullName}: ${result.reason}`))
      }
      case DeviceWireResultType.Skipped: {
        if (isFromCache) {
          this.log.debug(`un-registered cached device ${fullName} (Matter) because it was skipped`)
          mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        }
        return Promise.resolve(`Skipped setting up device: ${result.reason}`)
      }
      case DeviceWireResultType.Success: {
        // Mirror the base-class wiredDevices tracking so that subsequent
        // processAllDevices() passes (after reconfiguration or deviceheard
        // events) skip this device and avoid accumulating duplicate listeners.
        this.wiredDevices.add(uuid)
        if (!isFromCache) {
          this.accessories.set(accessory.UUID, accessory)
          mApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.debug(`registered new device ${fullName} (Matter) because it was new`)
        } else if (shouldRefreshCachedMatterAccessory) {
          await mApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          await mApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
          this.log.info(`Refreshed cached Matter accessory for composed endpoint changes: ${fullName}`)
        }
        return Promise.resolve(isFromCache
          ? `Restoring existing accessory from cache (Matter): ${fullName}`
          : `Adding new accessory (Matter): ${fullName}`)
      }
    }
  }
}
