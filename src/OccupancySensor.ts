import type { CharacteristicGetCallback, PlatformAccessory, Service } from 'homebridge'
import type { OccupancyStatus, OneAreaDefinition, OneAreaStatus, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, LutronCasetaLeap } from './platform.js'

import { OccupancySensorRouter } from './OccupancySensorRouter.js'
import { DeviceWireResultType, formatQSXDeviceName, sanitizeHomeKitName } from './platform.js'

export class OccupancySensor {
  private service: Service
  private state: OccupancyStatus
  private fullName: string

  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
  ) {
    const deviceType = accessory.context.device.DeviceType
    this.fullName = (deviceType === 'RPSOccupancySensor' || deviceType === 'RPSCeilingMountedOccupancySensor')
      ? formatQSXDeviceName(accessory.context.device.FullyQualifiedName)
      : sanitizeHomeKitName(accessory.context.device.FullyQualifiedName.join(' '))

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
  }

  public async initialize(): Promise<DeviceWireResult> {
    const area: OneAreaDefinition = (await this.bridge.getHref(
      this.accessory.context.device.AssociatedArea,
    )) as OneAreaDefinition

    // QSX processors track occupancy at area level, not via occupancy groups
    if (!area.Area.AssociatedOccupancyGroups || area.Area.AssociatedOccupancyGroups.length === 0) {
      this.platform.log.debug(`${this.fullName}: Using QSX area-based occupancy tracking`)

      // Subscribe to area status updates
      const areaStatusUrl = `${area.Area.href}/status`
      this.bridge.client.subscribe(areaStatusUrl, (response) => {
        const body = response.Body as OneAreaStatus | undefined
        if (body?.AreaStatus?.OccupancyStatus) {
          this.update(body.AreaStatus.OccupancyStatus as OccupancyStatus)
        }
      }).catch((e) => {
        this.platform.log.warn(`Failed to subscribe to area status for ${this.fullName}: ${e.message}`)
      })

      // Read initial state
      const areaStatus = await this.bridge.client.request('ReadRequest', areaStatusUrl)
      const statusBody = areaStatus.Body as OneAreaStatus | undefined
      if (statusBody?.AreaStatus?.OccupancyStatus) {
        this.update(statusBody.AreaStatus.OccupancyStatus as OccupancyStatus)
      }

      return {
        kind: DeviceWireResultType.Success,
        name: this.fullName,
      }
    }

    // Caseta/RA3 uses occupancy groups
    const router = OccupancySensorRouter.getInstance()
    await router.register(this.bridge, area.Area.AssociatedOccupancyGroups[0], this.update.bind(this))

    return {
      kind: DeviceWireResultType.Success,
      name: this.fullName,
    }
  }
}
