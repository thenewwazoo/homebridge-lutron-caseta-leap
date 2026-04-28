import type {
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge'
import type { DeviceDefinition, OneZoneStatus, Response, SmartBridge } from 'lutron-leap'

import type { LutronCasetaLeap } from './platform.js'

export class SerenaTiltOnlyWoodBlinds {
  private service: Service
  private device: DeviceDefinition

  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
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
            = this.accessory.getService(this.platform.api.hap.Service.WindowCovering)
              || this.accessory.addService(this.platform.api.hap.Service.WindowCovering)

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      this.device.FullyQualifiedName.join(' '),
    )

    // create handlers for required characteristics

    const getter = (cb: CharacteristicGetCallback) => {
      this.handleCurrentPositionGet().then(
        (pos: number) => {
          cb(null, pos)
        },
        (e: Error) => {
          cb(e)
        },
      )
    }

    const setter = (pos: CharacteristicValue, cb: CharacteristicSetCallback) => {
      this.handleTargetPositionSet(pos).then(
        () => {
          cb(null, pos)
        },
        (e: Error) => {
          cb(e)
        },
      )
    }

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
      .on(this.platform.api.hap.CharacteristicEventTypes.GET, getter)

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
      .on(this.platform.api.hap.CharacteristicEventTypes.GET, getter)
      .on(this.platform.api.hap.CharacteristicEventTypes.SET, setter)

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.PositionState)
      .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handlePositionStateGet.bind(this))

    this.platform.on('unsolicited', this.handleUnsolicited.bind(this))
  }

  // `value` can range from 0-100, but n.b. 50 is flat. The Homekit
  // Window Covering's required "Position" characteristic expects 0 to be
  // "fully closed" and 100 to be "fully open". As such, we constrain the
  // tilt angle to [-90,0] degrees by scaling `value` after the fact.

  async handleCurrentPositionGet(): Promise<number> {
    this.platform.log.debug(
      'blinds',
      this.device.FullyQualifiedName.join(' '),
      'were asked for current or target position',
    )
    const tilt = await this.bridge.readBlindsTilt(this.device)
    const adj_val = Math.min(100, tilt * 2)
    // Per-poll noise — Homebridge re-reads position frequently. Was info
    // (visible in normal logs); now debug so steady-state operation stays
    // quiet, with global debug bringing it back when troubleshooting.
    this.platform.log.debug(
      'Told Homekit that blinds',
      this.device.FullyQualifiedName.join(' '),
      'are at position',
      adj_val,
    )
    return adj_val
  }

  async handleTargetPositionSet(value: CharacteristicValue): Promise<void> {
    const adj_val = Number(value) / 2
    // Per-command noise — fires every time HomeKit drives the blind. Was
    // info; now debug.
    this.platform.log.debug(
      'Commanded',
      this.device.FullyQualifiedName.join(' '),
      'blinds to (adjusted) value',
      adj_val,
    )
    await this.bridge.setBlindsTilt(this.device, adj_val)
  }

  handlePositionStateGet(cb: CharacteristicGetCallback): void {
    cb(null, this.platform.api.hap.Characteristic.PositionState.STOPPED)
  }

  handleUnsolicited(response: Response): void {
    if (response.Header.MessageBodyType === 'OneZoneStatus') {
      if ((response.Body as OneZoneStatus)?.ZoneStatus?.Zone?.href === this.device.LocalZones[0].href) {
        const adj_val = Math.min(100, (response.Body as OneZoneStatus).ZoneStatus.Tilt * 2)
        // Per state-change noise — fires on every physical blind movement.
        // Was info; now debug.
        this.platform.log.debug(
          'Blinds',
          this.device.FullyQualifiedName.join(' '),
          'reported a new position of',
          adj_val,
        )

        this.accessory
          .getService(this.platform.api.hap.Service.WindowCovering)!
          .getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
          .updateValue(adj_val)

        this.accessory
          .getService(this.platform.api.hap.Service.WindowCovering)!
          .getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
          .updateValue(adj_val)
      }
    }
  }
}
