import {
    Device,
    BridgeFinder,
    SmartBridge,
    SecretStorage,
} from 'lutron-leap';

import {
    API,
    APIEvent,
    CharacteristicEventTypes,
    CharacteristicSetCallback,
    CharacteristicValue,
    DynamicPlatformPlugin,
    HAP,
    Logging,
    PlatformAccessory,
    PlatformAccessoryEvent,
    PlatformConfig,
} from "homebridge";

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds';

let hap: HAP;
let Accessory: typeof PlatformAccessory;

export class LutronCasetaLeap implements DynamicPlatformPlugin {

    private readonly accessories: PlatformAccessory[] = [];
    private finder: BridgeFinder;
    private secrets: Map<string, SecretStorage> = new Map();
    private bridges: Map<string, SmartBridge> = new Map();

    constructor(
        public readonly log: Logging,
        public readonly config: PlatformConfig,
        public readonly api: API
    ) {

        log.info("LutronCasetaLeap starting up...");

        this.finder = new BridgeFinder(this.secrets);
        this.finder.on("discovered", this.handleBridgeDiscovery);

        log.info("Example platform finished initializing!");

        /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
        api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            log.info("Got DID_FINISH_LAUNCHING");
        });
    }

    /*
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory): void {
        this.log("Configuring accessory %s", accessory.displayName);

        accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log("%s identified!", accessory.displayName);
        });

        accessory.getService(hap.Service.Lightbulb)!.getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            this.log.info("%s Light was set to: " + value);
            callback();
        });

        this.accessories.push(accessory);
    }

    // ----- CUSTOM METHODS

    private handleBridgeDiscovery(bridge: SmartBridge) {
        if (this.bridges.has(bridge.bridgeID)) {
            // we've already discovered this bridge, move along
            return;
        }
        this.bridges.set(bridge.bridgeID, bridge);

        bridge.getDeviceInfo().then((devices: Device[]) => {
            for (let d of devices) {
                let uuid = this.api.hap.uuid.generate(d.SerialNumber);
                switch (d.DeviceType) {
                    case "SerenaTiltOnlyWoodBlinds": {
                        const accessory = new this.api.platformAccessory(d.FullyQualifiedName.join(' '), uuid);
                        accessory.context.device = d;
                        new SerenaTiltOnlyWoodBlinds(this, accessory); // mutates accessory
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                        this.accessories.push(accessory);
                        break;
                    }
                    default:
                        this.log.info("Got unimplemented device type ", d.DeviceType, ", skipping");
                }
            }
        });
    }
}
