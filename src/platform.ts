import { EventEmitter } from 'events';

import {
    BridgeFinder,
    Device,
    Response,
    SmartBridge,
    SecretStorage,
} from 'lutron-leap';

import {
    API,
    APIEvent,
    DynamicPlatformPlugin,
    Logging,
    PlatformAccessory,
    PlatformConfig,
} from 'homebridge';

import TypedEmitter from 'typed-emitter';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds';
import { BridgeManager } from './BridgeManager';

interface PlatformEvents {
    unsolicited: (response: Response) => void;
}

// see config.schema.json
interface BridgeAuthEntry {
    bridgeid: string;
    ca: string;
    key: string;
    cert: string;
}

export class LutronCasetaLeap
    extends (EventEmitter as new () => TypedEmitter<PlatformEvents>)
    implements DynamicPlatformPlugin {

    private readonly accessories: Map<string, PlatformAccessory> = new Map();
    private finder: BridgeFinder;
    private secrets: Map<string, SecretStorage>;
    private bridges: Map<string, SmartBridge> = new Map();
    private bridgeMgr = new BridgeManager();

    constructor(
        public readonly log: Logging,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        super();

        log.info('LutronCasetaLeap starting up...');

        this.secrets = this.secretsFromConfig(config);

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
        for (const entry of config.secrets as Array<BridgeAuthEntry>) {
            out.set(entry.bridgeid, {
                ca: entry.ca,
                key: entry.key,
                cert: entry.cert,
            });
        }
        return out;
    }

    /*
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory): void {
        // At this point, we very likely do not have a bridge for the accessory, so we
        // use the bridge manager to pass a promise based on the bridge ID, which do we
        // saved in the accessory context.
        this.log.info('restoring cached device', accessory.UUID);
        switch (accessory.context.device.DeviceType) {
            case 'SerenaTiltOnlyWoodBlind': {
                this.log.info(
                    'restoring blinds',
                    accessory.context.device.FullyQualifiedName.join(' '),
                    'on bridge',
                    accessory.context.bridgeID,
                );
                new SerenaTiltOnlyWoodBlinds(
                    this,
                    accessory,
                    this.bridgeMgr.getBridge(accessory.context.bridgeID),
                );
                break;
            }
            default:
                this.log.warn('got cached but unsupported accessory', accessory);
        }

        this.accessories.set(accessory.UUID, accessory);
    }

    // ----- CUSTOM METHODS

    private handleBridgeDiscovery(bridge: SmartBridge) {
        if (this.bridges.has(bridge.bridgeID)) {
            // we've already discovered this bridge, move along
            return;
        }
        this.bridgeMgr.addBridge(bridge);

        bridge.getDeviceInfo().then((devices: Device[]) => {
            for (const d of devices) {
                const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString());
                if (this.accessories.has(uuid)) {
                    this.log.info('Accessory', uuid, 'already registered. skipping.');
                    continue;
                }
                switch (d.DeviceType) {
                    case 'SerenaTiltOnlyWoodBlind': {
                        this.log.info('found a blind:', d.FullyQualifiedName.join(' '));

                        const accessory = new this.api.platformAccessory(d.FullyQualifiedName.join(' '), uuid);
                        accessory.context.device = d;
                        accessory.context.bridgeID = bridge.bridgeID;

                        // SIDE EFFECT: this constructor mutates the accessory object
                        new SerenaTiltOnlyWoodBlinds(
                            this,
                            accessory,
                            this.bridgeMgr.getBridge(bridge.bridgeID),
                        );

                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                        this.accessories.set(uuid, accessory);
                        break;
                    }
                    default:
                        this.log.info('Got unimplemented device type', d.DeviceType, ', skipping');
                }
            }
        });

        bridge.on('unsolicited', this.handleUnsolicitedMessage.bind(this));
    }

    handleUnsolicitedMessage(bridgeID: string, response: Response): void {
        this.log.debug('bridge', bridgeID, 'got unsolicited message', response);
        // publish the message, and let the accessories figure out who it's for
        this.emit('unsolicited', response);
    }
}
