import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicSetCallback,
    CharacteristicGetCallback,
} from 'homebridge';

import { LutronCasetaLeap } from './platform';
import { SmartBridge, Device } from 'lutron-leap';

export class SerenaTiltOnlyWoodBlinds {
    private service: Service;
    private device: Device;

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
        private readonly bridge: SmartBridge,
    ) {
        this.device = accessory.context.device;

        this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.device.ModelNumber)
            .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.device.SerialNumber);

        this.service =
            this.accessory.getService(this.platform.api.hap.Service.WindowCovering) ||
            this.accessory.addService(this.platform.api.hap.Service.WindowCovering);

        this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.device.FullyQualifiedName.join(' '));

        // create handlers for required characteristics

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handleCurrentPositionGet.bind(this));

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handleCurrentPositionGet.bind(this))
            .on(this.platform.api.hap.CharacteristicEventTypes.SET, this.handleTargetPositionSet.bind(this));

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handlePositionStateGet.bind(this));
    }

    handleCurrentPositionGet(cb: CharacteristicGetCallback): void {
        this.platform.log.info('blinds', this.device.FullyQualifiedName.join(' '), 'were asked for current or target position');
        this.bridge.readBlindsTilt(this.device).then((tilt_val) => {
            cb(null, tilt_val/2);
        }).catch((e: Error) => {
            cb(e);
        });
    }

    /*
    handleTargetPositionGet(cb: CharacteristicGetCallback): void {
        this.platform.log.info('blinds were asked for target position');
        cb(null, 50);
    }
   */

    handleTargetPositionSet(value: CharacteristicValue, cb: CharacteristicSetCallback): void {
        this.platform.log.info('blinds', this.device.FullyQualifiedName.join(' '), 'were set to position', value);
        this.bridge.setBlindsTilt(this.device, Number(value)).then(() => {
            cb(null);
        }).catch((e: Error) => {
            cb(e);
        });
    }

    handlePositionStateGet(cb: CharacteristicGetCallback): void {
        cb(null, this.platform.api.hap.Characteristic.PositionState.STOPPED);
    }

}
