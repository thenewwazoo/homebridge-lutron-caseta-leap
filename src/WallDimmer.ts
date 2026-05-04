import type { CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory, Service } from 'homebridge'
import type { DeviceDefinition, OneZoneStatus, Response, SmartBridge } from 'lutron-leap'

import type { LutronCasetaLeap } from './Platform.HAP.js'

export class WallDimmer {
  private service: Service
  private device: DeviceDefinition

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

  private async handleOnSet(value: CharacteristicValue, cb: CharacteristicSetCallback) {
    try {
      // Send command to bridge to turn on/off, preserving the last known
      // brightness level when turning on.
      // Set zone level using LEAP command to /commandprocessor
      if (!this.device.LocalZones || !this.device.LocalZones[0]) {
        throw new Error('No LocalZones found on device')
      }
      const zoneHref = this.device.LocalZones[0].href
      const targetLevel = value ? this.getLastKnownBrightness() : 0
      await this.bridge.client.request('CreateRequest', `${zoneHref}/commandprocessor`, {
        Command: {
          CommandType: 'GoToLevel',
          Parameter: [{ Type: 'Level', Value: targetLevel }],
        },
      })
      cb(null)
    } catch (e) {
      this.platform.log.error('Failed to set WallDimmer On state:', e)
      cb(e as Error)
    }
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

  private async handleBrightnessSet(value: CharacteristicValue, cb: CharacteristicSetCallback) {
    try {
      // Send command to bridge to set brightness (level)
      if (!this.device.LocalZones || !this.device.LocalZones[0]) {
        throw new Error('No LocalZones found on device')
      }
      const zoneHref = this.device.LocalZones[0].href
      await this.bridge.client.request('CreateRequest', `${zoneHref}/commandprocessor`, {
        Command: {
          CommandType: 'GoToLevel',
          Parameter: [{ Type: 'Level', Value: Number(value) }],
        },
      })
      cb(null)
    } catch (e) {
      this.platform.log.error('Failed to set WallDimmer Brightness:', e)
      cb(e as Error)
    }
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
