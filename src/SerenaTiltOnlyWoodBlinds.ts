import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicSetCallback,
    CharacteristicGetCallback,
} from 'homebridge';

import { LutronCasetaLeap } from './platform';
import { OneZoneStatus, Response, SmartBridge, Device } from 'lutron-leap';

export class SerenaTiltOnlyWoodBlinds {
    private service: Service;
    private device: Device;

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
        private readonly bridge: Promise<SmartBridge>,
    ) {
        this.device = accessory.context.device;

        this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.device.ModelNumber)
            .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.device.SerialNumber.toString());

        this.service =
            this.accessory.getService(this.platform.api.hap.Service.WindowCovering) ||
            this.accessory.addService(this.platform.api.hap.Service.WindowCovering);

        this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.device.FullyQualifiedName.join(' '));

        // create handlers for required characteristics

        const getter = ((cb: CharacteristicGetCallback) => {
            this.handleCurrentPositionGet().then((pos: number) => {
                cb(null, pos);
            }, (e: Error) => {
                cb(e);
            });
        }).bind(this);

        const setter = ((pos: CharacteristicValue, cb: CharacteristicSetCallback) => {
            this.handleTargetPositionSet(pos).then(() => {
                cb(null, pos);
            }, (e: Error) => {
                cb(e);
            });
        }).bind(this);

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, getter);

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, getter)
            .on(this.platform.api.hap.CharacteristicEventTypes.SET, setter);

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.PositionState)
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, this.handlePositionStateGet.bind(this));

        this.platform.on('unsolicited', this.handleUnsolicited.bind(this));

    }

    // `value` can range from 0-100, but n.b. 50 is flat. The Homekit
    // Window Covering's required "Position" characteristic expects 0 to be
    // "fully closed" and 100 to be "fully open". As such, we constrain the
    // tilt angle to [-90,0] degrees by scaling `value` after the fact.

    async handleCurrentPositionGet(): Promise<number> {
        this.platform.log.info('blinds', this.device.FullyQualifiedName.join(' '), 'were asked for current or target position');
        const bridge = await this.bridge;
        const tilt = await bridge.readBlindsTilt(this.device);
        const adj_val = Math.min(100, tilt * 2);
        this.platform.log.info('got adjusted position', adj_val);
        return adj_val;
    }

    async handleTargetPositionSet(value: CharacteristicValue): Promise<void> {
        const adj_val = Number(value) / 2;
        this.platform.log.info('blinds', this.device.FullyQualifiedName.join(' '), 'were set to adjusted value', adj_val);
        const bridge = await this.bridge;
        await bridge.setBlindsTilt(this.device, adj_val);

    }

    handlePositionStateGet(cb: CharacteristicGetCallback): void {
        cb(null, this.platform.api.hap.Characteristic.PositionState.STOPPED);
    }

    handleUnsolicited(response: Response): void {
        if (response.Header.MessageBodyType === 'OneZoneStatus') {
            if ((response.Body as OneZoneStatus)?.ZoneStatus?.Zone?.href === this.device.LocalZones[0].href) {
                const adj_val = Math.min(100, (response.Body as OneZoneStatus).ZoneStatus.Tilt * 2);
                this.platform.log.info('accessory', this.accessory.UUID, 'got a response with adjusted value', adj_val);

                this.accessory.getService(this.platform.api.hap.Service.WindowCovering)!
                    .getCharacteristic(this.platform.api.hap.Characteristic.TargetPosition)
                    .updateValue(adj_val);

                this.accessory.getService(this.platform.api.hap.Service.WindowCovering)!
                    .getCharacteristic(this.platform.api.hap.Characteristic.CurrentPosition)
                    .updateValue(adj_val);
            }
        }
    }

}
