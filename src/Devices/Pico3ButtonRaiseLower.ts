import {
    Service,
    PlatformAccessory,
    CharacteristicGetCallback,
} from 'homebridge';

import { LutronCasetaLeap } from '../platform';
import { OneZoneStatus, Response, SmartBridge, Device } from 'lutron-leap';

export class Pico3ButtonRaiseLower {
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
            .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.device.SerialNumber);

        this.service =
            this.accessory.getService(this.platform.api.hap.Service.StatelessProgrammableSwitch) ||
            this.accessory.addService(this.platform.api.hap.Service.StatelessProgrammableSwitch);

        this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.device.FullyQualifiedName.join(' '));

        // create handlers for required characteristics

        const getter = ((cb: CharacteristicGetCallback) => {
            this.handleProgrammableSwitchEventGet().then((pos: number) => {
                cb(null, pos);
            }, (e: Error) => {
                cb(e);
            });
        }).bind(this);

        this.service.getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
            .setProps({
                validValues: [0],
            })
            .on(this.platform.api.hap.CharacteristicEventTypes.GET, getter);

        this.platform.on('unsolicited', this.handleUnsolicited.bind(this));

    }

    async handleProgrammableSwitchEventGet(): Promise<number> {
        this.platform.log.info('remote', this.device.FullyQualifiedName.join(' '), 'were asked for current or target position');
        const bridge = await this.bridge;
        const tilt = await bridge.readBlindsTilt(this.device);
        const adj_val = Math.min(100, tilt * 2);
        this.platform.log.info('got adjusted position', adj_val);
        return adj_val;
    }

    handleUnsolicited(response: Response): void {
        if ((response.Body as OneZoneStatus).ZoneStatus.Zone.href === this.device.LocalZones[0].href) {
            const adj_val = Math.min(100, (response.Body as OneZoneStatus).ZoneStatus.Tilt * 2);
            this.platform.log.info('accessory', this.accessory.UUID, 'got a response with adjusted value', adj_val);

            this.accessory.getService(this.platform.api.hap.Service.StatelessProgrammableSwitch)!
                .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                .updateValue(adj_val);
        }
    }

}
