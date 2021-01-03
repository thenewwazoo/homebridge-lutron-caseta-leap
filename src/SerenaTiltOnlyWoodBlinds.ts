import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicSetCallback,
    CharacteristicGetCallback,
} from 'homebridge';

import { LutronCasetaLeap } from './platform';
import { Device } from 'lutron-leap';

export class SerenaTiltOnlyWoodBlinds {
    private service: Service;

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
    ) {
        const d: Device = accessory.context.device;
        this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, d.ModelNumber)
            .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, d.SerialNumber);

        this.service =
            this.accessory.getService(this.platform.api.hap.Service.WindowCovering) ||
            this.accessory.addService(this.platform.api.hap.Service.WindowCovering);

        this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, d.FullyQualifiedName.join(' '));

        // create handlers for required characteristics
        this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handleCurrentPositionGet.bind(this));

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handleTargetPositionGet.bind(this))
            .on(this.platform.api.hap.CharacteristicEventTypes.SET, this.handleTargetPositionSet.bind(this));

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handlePositionStateGet.bind(this));
    }

    handleCurrentPositionGet(cb: CharacteristicGetCallback): void {
        this.platform.log.info('blinds were asked for current position');
        cb(null, 50);
    }

    handleTargetPositionGet(cb: CharacteristicGetCallback): void {
        this.platform.log.info('blinds were asked for target position');
        cb(null, 50);
    }

    handleTargetPositionSet(value: CharacteristicValue, cb: CharacteristicSetCallback): void {
        this.platform.log.info('blinds got set position', value);
        cb(null);
    }

    handlePositionStateGet(cb: CharacteristicGetCallback): void {
        cb(null, this.platform.api.hap.Characteristic.PositionState.STOPPED);
    }

}
