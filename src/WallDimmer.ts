import type { CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory, Service } from 'homebridge'
import type { DeviceDefinition, OneZoneStatus, Response, SmartBridge } from 'lutron-leap'

import type { LutronCasetaLeap } from './Platform.HAP.js'

export class WallDimmer {
  private service: Service
  private device: DeviceDefinition

  // How long to wait for the other half of a paired On + Brightness write.
  // Short enough to be imperceptible, long enough that both handlers have
  // certainly been called - see queueLevelChange.
  private static readonly COALESCE_MS = 50

  private pendingOn?: boolean
  private pendingBrightness?: number
  private pendingCallbacks: CharacteristicSetCallback[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
    private readonly deviceDef: DeviceDefinition,
  ) {
    this.device = accessory.context.device

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.device.ModelNumber)
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, this.device.FullyQualifiedName.join(' '))
      .setCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName, this.device.FullyQualifiedName.join(' '))
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.device.SerialNumber.toString())

    this.service
      = this.accessory.getService(this.platform.api.hap.Service.Lightbulb)
        || this.accessory.addService(this.platform.api.hap.Service.Lightbulb)

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      this.device.FullyQualifiedName.join(' '),
    )

    // Set up handlers for On and Brightness characteristics
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .on('set', this.handleOnSet.bind(this))
      .on('get', this.handleOnGet.bind(this))

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.Brightness)
      .on('set', this.handleBrightnessSet.bind(this))
      .on('get', this.handleBrightnessGet.bind(this))
  }

  async initialize() {
    // Subscribe to bridge unsolicited updates for this device
    this.platform.on('unsolicited', (response: Response) => {
      if (response.Header.MessageBodyType === 'OneZoneStatus') {
        const status = (response.Body as OneZoneStatus).ZoneStatus
        const statusZoneHref = typeof status.Zone === 'string'
          ? status.Zone
          : (status.Zone && typeof status.Zone === 'object' && 'href' in status.Zone && typeof status.Zone.href === 'string'
              ? status.Zone.href
              : undefined)
        if (
          this.device.LocalZones
          && this.device.LocalZones[0]
          && statusZoneHref === this.device.LocalZones[0].href
        ) {
          this.updateStateFromBridge(status)
        }
      }
    })
    // Optionally, fetch initial state from bridge here
    return {
      kind: 0, // DeviceWireResultType.Success
      name: this.accessory.context.device.FullyQualifiedName?.join(' ') || 'WallDimmer',
    }
  }

  private getLastKnownBrightness(): number {
    const brightnessValue = this.service.getCharacteristic(this.platform.api.hap.Characteristic.Brightness).value

    if (typeof brightnessValue === 'number' && Number.isFinite(brightnessValue) && brightnessValue > 0) {
      return Math.max(1, Math.min(100, brightnessValue))
    }

    return 100
  }

  /**
   * Collect an On and/or Brightness change and send it as a single LEAP
   * command.
   *
   * ⚠️ HomeKit sends "turn on at 20%" as two separate writes, On and
   * Brightness, and HAP-NodeJS starts both set handlers without waiting for
   * the first to finish - `Accessory.handleSetCharacteristics` fires them in a
   * loop and only collects the promises afterwards. Both writes map onto the
   * same LEAP `GoToLevel` command, so the two used to race: Brightness sent
   * 20, while On read a Brightness characteristic that still said 0 - the
   * light was off - fell back to full brightness and sent 100. Whichever
   * reached the bridge last won, which is why a sunrise automation could leave
   * the light at 100%.
   *
   * One command carries both, so there is nothing left to race. A `GoToLevel`
   * above zero turns the light on by itself, so no separate On command is
   * needed.
   * @param update - the parts of the state this write changes
   * @param update.on - the new On value, when this write sets it
   * @param update.brightness - the new Brightness value, when this write sets it
   * @param cb - settled once the single command has been sent
   */
  private queueLevelChange(update: { on?: boolean, brightness?: number }, cb: CharacteristicSetCallback) {
    if (update.on !== undefined) {
      this.pendingOn = update.on
    }
    if (update.brightness !== undefined) {
      this.pendingBrightness = update.brightness
    }
    this.pendingCallbacks.push(cb)

    // Deliberately not restarted by each write: dragging the brightness slider
    // should keep sending a command every window, not stay silent until the
    // finger comes off.
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushLevelChange(), WallDimmer.COALESCE_MS)
    }
  }

  private async flushLevelChange() {
    this.flushTimer = undefined
    const on = this.pendingOn
    const brightness = this.pendingBrightness
    const callbacks = this.pendingCallbacks
    this.pendingOn = undefined
    this.pendingBrightness = undefined
    this.pendingCallbacks = []

    try {
      if (!this.device.LocalZones || !this.device.LocalZones[0]) {
        throw new Error('No LocalZones found on device')
      }
      const zoneHref = this.device.LocalZones[0].href

      // An explicit brightness always wins - it is what the user or the
      // automation actually asked for. Only a bare On falls back to the last
      // level the light was at.
      let targetLevel: number
      if (on === false) {
        targetLevel = 0
      } else if (brightness !== undefined) {
        targetLevel = brightness
      } else {
        targetLevel = this.getLastKnownBrightness()
      }

      await this.bridge.client.request('CreateRequest', `${zoneHref}/commandprocessor`, {
        Command: {
          CommandType: 'GoToLevel',
          Parameter: [{ Type: 'Level', Value: targetLevel }],
        },
      })
      for (const callback of callbacks) {
        callback(null)
      }
    } catch (e) {
      this.platform.log.error('Failed to set WallDimmer level:', e)
      for (const callback of callbacks) {
        callback(e as Error)
      }
    }
  }

  private handleOnSet(value: CharacteristicValue, cb: CharacteristicSetCallback) {
    this.queueLevelChange({ on: Boolean(value) }, cb)
  }

  private async handleOnGet(cb: CharacteristicGetCallback) {
    try {
      // Query bridge for current state
      if (!this.device.LocalZones || !this.device.LocalZones[0]) {
        throw new Error('No LocalZones found on device')
      }
      const zoneHref = this.device.LocalZones[0].href
      const resp = await this.bridge.client.request('ReadRequest', `${zoneHref}/status`)
      if (resp.Body && 'ZoneStatus' in resp.Body && resp.Body.ZoneStatus) {
        const status = resp.Body.ZoneStatus
        cb(null, status.Level > 0)
      } else {
        throw new Error('ZoneStatus not found in response')
      }
    } catch (e) {
      this.platform.log.error('Failed to get WallDimmer On state:', e)
      cb(e as Error)
    }
  }

  private handleBrightnessSet(value: CharacteristicValue, cb: CharacteristicSetCallback) {
    this.queueLevelChange({ brightness: Number(value) }, cb)
  }

  private async handleBrightnessGet(cb: CharacteristicGetCallback) {
    try {
      // Query bridge for current brightness (level)
      if (!this.device.LocalZones || !this.device.LocalZones[0]) {
        throw new Error('No LocalZones found on device')
      }
      const zoneHref = this.device.LocalZones[0].href
      const resp = await this.bridge.client.request('ReadRequest', `${zoneHref}/status`)
      if (resp.Body && 'ZoneStatus' in resp.Body && resp.Body.ZoneStatus) {
        const status = resp.Body.ZoneStatus
        cb(null, status.Level)
      } else {
        throw new Error('ZoneStatus not found in response')
      }
    } catch (e) {
      this.platform.log.error('Failed to get WallDimmer Brightness:', e)
      cb(e as Error)
    }
  }

  private updateStateFromBridge(status: any) {
    // Update HomeKit/Matter state from bridge event
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, status.Level > 0)
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, status.Level)

    const matterApi = (this.platform.api as any).matter
    if (matterApi && this.accessory?.UUID) {
      const rawPercent = Number(status?.Level ?? 0)
      const clampedPercent = Math.max(0, Math.min(100, rawPercent))
      const currentLevel = clampedPercent <= 0 ? 0 : Math.max(1, Math.min(254, Math.round((clampedPercent / 100) * 254)))

      void matterApi.updateAccessoryState(this.accessory.UUID, 'onOff', { onOff: clampedPercent > 0 })
      void matterApi.updateAccessoryState(this.accessory.UUID, 'levelControl', { currentLevel })
    }
  }

  static getMatterClusters(): Record<string, any> {
    return {
      onOff: { onOff: false },
      // Matter LevelControl: valid range is 1-254 (0 is reserved/off)
      levelControl: { currentLevel: 1, minLevel: 1, maxLevel: 254 },
    }
  }
}
