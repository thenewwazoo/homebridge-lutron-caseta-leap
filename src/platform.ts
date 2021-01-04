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
} from 'homebridge';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds';

export class LutronCasetaLeap implements DynamicPlatformPlugin {

    private readonly accessories: PlatformAccessory[] = [];
    private finder: BridgeFinder;
    private secrets: Map<string, SecretStorage>;
    private bridges: Map<string, SmartBridge> = new Map();

    constructor(
        public readonly log: Logging,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {

        log.info('LutronCasetaLeap starting up...');
        log.info('config is', config);

        this.secrets = this.secretsFromConfig(config);
        log.info('secrets are', JSON.stringify(this.secrets));

        this.finder = new BridgeFinder(this.secrets);
        this.finder.on('discovered', this.handleBridgeDiscovery.bind(this));

        log.info('Example platform finished initializing!');

        /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
        api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            log.info('Got DID_FINISH_LAUNCHING');
        });
    }

    secretsFromConfig(config: PlatformConfig): Map<string, SecretStorage> {
        const out = new Map();
        for (const key in <any>config.secrets) {
            this.log.info('inspecting', key);
            const value: any = (<any>config).secrets[key];
            this.log.info('has content', JSON.stringify(value));
            if (typeof value === 'object' && value !== null &&
                'ca' in value && 'cert' in value && 'key' in value) {
                out.set(key, {
                    ca: value.ca,
                    key: value.key,
                    cert: value.cert,
                });
            }
        }
        this.log.info('done! map is', out);
        return out;
    }

    /*
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory): void {
        this.log('Configuring accessory %s', accessory.displayName);
        this.log.info('the accessory is kinda like', JSON.stringify(accessory));

        //        this.accessories.push(accessory);
    }

    // ----- CUSTOM METHODS

    private handleBridgeDiscovery(bridge: SmartBridge) {
        if (this.bridges.has(bridge.bridgeID)) {
            // we've already discovered this bridge, move along
            return;
        }
        this.bridges.set(bridge.bridgeID, bridge);

        bridge.getDeviceInfo().then((devices: Device[]) => {
            for (const d of devices) {
                const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString());
                switch (d.DeviceType) {
                    case 'SerenaTiltOnlyWoodBlind': {
                        this.log.info('found a blind:', d.FullyQualifiedName.join(' '));
                        const accessory = new this.api.platformAccessory(d.FullyQualifiedName.join(' '), uuid);
                        accessory.context.device = d;
                        new SerenaTiltOnlyWoodBlinds(this, accessory, bridge); // mutates accessory
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                        this.accessories.push(accessory);
                        break;
                    }
                    default:
                        this.log.info('Got unimplemented device type', d.DeviceType, ', skipping');
                }
            }
        });
    }
}
