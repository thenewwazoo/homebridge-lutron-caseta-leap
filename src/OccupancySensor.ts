import type { CharacteristicGetCallback, PlatformAccessory, Service } from 'homebridge'
import type { OccupancyStatus, OneAreaDefinition, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, LutronCasetaLeap } from './Platform.HAP.js'

import { OccupancySensorRouter } from './OccupancySensorRouter.js'
import { DeviceWireResultType } from './Platform.HAP.js'

export class OccupancySensor {
  /**
   * Returns a Matter clusters object for this occupancy sensor.
   * Matches Matter spec: occupancySensing cluster per homebridge-matter wiki §7.3.
   */
  public static getMatterClusters(): Record<string, any> {
    return {
      occupancySensing: {
        occupancy: { occupied: false },
        // 0 = PIR sensor type per Matter §7.3
        occupancySensorType: 0,
        occupancySensorTypeBitmap: { pir: true, ultrasonic: false, physicalContact: false },
      },
    }
  }

  private service: Service
  private state: OccupancyStatus
  private fullName: string

  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
  ) {
    this.fullName = accessory.context.device.FullyQualifiedName.join(' ')

    this.state = 'Unknown'

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, this.fullName)
      .setCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName, this.fullName)
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.SerialNumber.toString(),
      )

    this.service
      = this.accessory.getService(this.platform.api.hap.Service.OccupancySensor)
        || this.accessory.addService(this.platform.api.hap.Service.OccupancySensor)

    this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.fullName)

    // If the status is 'Occupied', the sensor is occupied. If 'Unoccupied'
    // or 'Unknown', unoccupied.
    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.OccupancyDetected,
      this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    )
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.OccupancyDetected).on(
      this.platform.api.hap.CharacteristicEventTypes.GET,
      (cb: CharacteristicGetCallback) => {
        if (this.state === 'Occupied') {
          cb(null, this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED)
        } else {
          cb(null, this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED)
        }
      },
    )

    // If the status is 'Unknown', the sensor is not active. If 'Occupied'
    // or 'Unoccupied', active.
    this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, false)
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.StatusActive).on(
      this.platform.api.hap.CharacteristicEventTypes.GET,
      (cb: CharacteristicGetCallback) => {
        if (this.state === 'Unknown') {
          cb(null, false)
        } else {
          cb(null, true)
        }
      },
    )
  }

  private update(update: OccupancyStatus) {
    // This method contains the logic that manages mapping the three LEAP
    // occupancy sensor states to the two Homekit characteristics.
    //
    // If the status is 'Occupied', the sensor is occupied. If 'Unoccupied'
    // or 'Unknown', unoccupied.
    //
    // If the status is 'Unknown', the sensor is not active. If 'Occupied'
    // or 'Unoccupied', active.

    this.state = update

    switch (update) {
      case 'Occupied':
        this.service.setCharacteristic(
          this.platform.api.hap.Characteristic.OccupancyDetected,
          this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
        )
        this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, true)
        break

      case 'Unoccupied':
        this.service.setCharacteristic(
          this.platform.api.hap.Characteristic.OccupancyDetected,
          this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
        )
        this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, true)
        break

      case 'Unknown':
      default: {
        this.service.setCharacteristic(
          this.platform.api.hap.Characteristic.OccupancyDetected,
          this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
        )
        this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, false)
      }
    }

    const matterApi = (this.platform.api as any).matter
    if (matterApi && this.accessory?.UUID) {
      const occupied = update === 'Occupied'
      void matterApi.updateAccessoryState(this.accessory.UUID, 'occupancySensing', {
        occupancy: { occupied },
      })
    }
  }

  public async initialize(): Promise<DeviceWireResult> {
    const area: OneAreaDefinition = (await this.bridge.getHref(
      this.accessory.context.device.AssociatedArea,
    )) as OneAreaDefinition

    const router = OccupancySensorRouter.getInstance()
    await router.register(this.bridge, area.Area.AssociatedOccupancyGroups[0], this.update.bind(this))

    return {
      kind: DeviceWireResultType.Success,
      name: this.fullName,
    }
  }
}
