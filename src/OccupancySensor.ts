import { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';

import { OccupancySensorRouter } from './OccupancySensorRouter';
import { LutronCasetaLeap, DeviceWireResult, DeviceWireResultType } from './platform';

import { OccupancyStatus, OneAreaDefinition, SmartBridge } from 'lutron-leap';

export class OccupancySensor {
    private service: Service;
    private state: OccupancyStatus;
    private fullName: string;

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
        private readonly bridge: Promise<SmartBridge>,
    ) {
        this.fullName = accessory.context.device.FullyQualifiedName.join(' ');

        this.state = 'Unknown';

        this.accessory
            .getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
            .setCharacteristic(
                this.platform.api.hap.Characteristic.SerialNumber,
                this.accessory.context.device.SerialNumber.toString(),
            );

        this.service =
            this.accessory.getService(this.platform.api.hap.Service.OccupancySensor) ||
            this.accessory.addService(this.platform.api.hap.Service.OccupancySensor);

        this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.fullName);

        // If the status is 'Occupied', the sensor is occupied. If 'Unoccupied'
        // or 'Unknown', unoccupied.
        this.service.setCharacteristic(
            this.platform.api.hap.Characteristic.OccupancyDetected,
            this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
        );
        this.service.getCharacteristic(this.platform.api.hap.Characteristic.OccupancyDetected).on(
            this.platform.api.hap.CharacteristicEventTypes.GET,
            ((cb: CharacteristicGetCallback) => {
                if (this.state === 'Occupied') {
                    cb(null, this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
                } else {
                    cb(null, this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
                }
            }).bind(this),
        );

        // If the status is 'Unknown', the sensor is not active. If 'Occupied'
        // or 'Unoccupied', active.
        this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, false);
        this.service.getCharacteristic(this.platform.api.hap.Characteristic.StatusActive).on(
            this.platform.api.hap.CharacteristicEventTypes.GET,
            ((cb: CharacteristicGetCallback) => {
                if (this.state === 'Unknown') {
                    cb(null, false);
                } else {
                    cb(null, true);
                }
            }).bind(this),
        );
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

        this.state = update;

        switch (update) {
            case 'Occupied':
                {
                    this.service.setCharacteristic(
                        this.platform.api.hap.Characteristic.OccupancyDetected,
                        this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
                    );
                    this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, true);
                }
                break;

            case 'Unoccupied':
                {
                    this.service.setCharacteristic(
                        this.platform.api.hap.Characteristic.OccupancyDetected,
                        this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
                    );
                    this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, true);
                }
                break;

            case 'Unknown':
            default: {
                this.service.setCharacteristic(
                    this.platform.api.hap.Characteristic.OccupancyDetected,
                    this.platform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
                );
                this.service.setCharacteristic(this.platform.api.hap.Characteristic.StatusActive, false);
            }
        }
    }

    public async initialize(): Promise<DeviceWireResult> {
        const bridge = await this.bridge;
        const area: OneAreaDefinition = (await bridge.getHref(
            this.accessory.context.device.AssociatedArea,
        )) as OneAreaDefinition;

        const router = OccupancySensorRouter.getInstance();
        await router.register(bridge, area.Area.AssociatedOccupancyGroups[0], this.update.bind(this));

        return {
            kind: DeviceWireResultType.Success,
            name: this.fullName,
        };
    }
}
