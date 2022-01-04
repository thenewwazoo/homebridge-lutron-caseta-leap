import { EventEmitter } from 'events';
import { BridgeFinder, Device, Response, SmartBridge, SecretStorage } from 'lutron-leap';

import { API, APIEvent, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import TypedEmitter from 'typed-emitter';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds';
import { PicoRemote } from './PicoRemote';
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
    implements DynamicPlatformPlugin
{
    private readonly accessories: Map<string, PlatformAccessory> = new Map();
    private finder: BridgeFinder | null = null;
    private secrets: Map<string, SecretStorage>;
    private bridgeMgr = new BridgeManager();

    constructor(public readonly log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
        super();

        log.info('LutronCasetaLeap starting up...');

        this.secrets = this.secretsFromConfig(config);
        if (this.secrets.size === 0) {
            log.warn('No bridge auth configured. Retiring.');
            return;
        }

        /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
        api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            log.info('Finished launching; starting up automatic discovery');

            this.finder = new BridgeFinder(this.secrets);
            this.finder.on('discovered', this.handleBridgeDiscovery.bind(this));
            this.finder.on('failed', (error) => {
                log.error('Could not connect to discovered hub:', error);
            });
        });

        log.info('LutronCasetaLeap plugin finished early initialization');
    }

    secretsFromConfig(config: PlatformConfig): Map<string, SecretStorage> {
        const out = new Map();
        for (const entry of config.secrets as Array<BridgeAuthEntry>) {
            out.set(entry.bridgeid.toLowerCase(), {
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
        // At this point, we very likely do not have a bridge for the
        // accessory, so we use the bridge manager to pass a promise based on
        // the bridge ID, which we previously saved in the accessory context.
        const bridge = this.bridgeMgr.getBridge(accessory.context.bridgeID);

        this.log.info(
            `Restoring cached ${accessory.context.device.DeviceType} ${accessory.UUID} on bridge ${accessory.context.bridgeID}`,
        );

        switch (accessory.context.device.DeviceType) {
            case 'SerenaTiltOnlyWoodBlind': {
                this.log.info('Restoring blinds', accessory.context.device.FullyQualifiedName.join(' '));
                new SerenaTiltOnlyWoodBlinds(this, accessory, bridge);
                break;
            }

            case 'Pico2Button':
            case 'Pico2ButtonRaiseLower':
            case 'Pico3Button':
            case 'Pico3ButtonRaiseLower': {
                this.log.info(
                    'Restoring Pico remote',
                    accessory.context.device.FullyQualifiedName.join(' '),
                    'on bridge',
                    accessory.context.bridgeID,
                );
                try {
                    new PicoRemote(this, accessory, bridge);
                } catch (e) {
                    this.log.error('Failed to set up cached Pico remote as expected:', e);
                }
                break;
            }
            default:
                this.log.warn(`Accessory ${accessory} was cached but is not supported. Did you downgrade?`);
        }

        this.accessories.set(accessory.UUID, accessory);
    }

    // ----- CUSTOM METHODS

    private handleBridgeDiscovery(bridge: SmartBridge) {
        if (this.bridgeMgr.hasBridge(bridge.bridgeID)) {
            // we've already discovered this bridge, move along
            this.log.info('Bridge', bridge.bridgeID, 'already known, closing.');
            bridge.close();
            return;
        }
        this.bridgeMgr.addBridge(bridge);

        bridge.getDeviceInfo().then(async (devices: Device[]) => {
            for (const d of devices) {
                const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString());
                if (this.accessories.has(uuid)) {
                    this.log.info(
                        'Accessory',
                        d.DeviceType,
                        uuid,
                        d.FullyQualifiedName.join(' '),
                        'already set up. Skipping.',
                    );
                    continue;
                }

                const fullName = d.FullyQualifiedName.join(' ');

                const accessory = new this.api.platformAccessory(fullName, uuid);
                accessory.context.device = d;
                accessory.context.bridgeID = bridge.bridgeID;

                switch (d.DeviceType) {
                    case 'SerenaTiltOnlyWoodBlind': {
                        this.log.info('Found a new Serena blind:', fullName);

                        // SIDE EFFECT: this constructor mutates the accessory object
                        new SerenaTiltOnlyWoodBlinds(this, accessory, this.bridgeMgr.getBridge(bridge.bridgeID));

                        break;
                    }

                    case 'Pico2Button':
                    case 'Pico2ButtonRaiseLower':
                    case 'Pico3Button':
                    case 'Pico3ButtonRaiseLower': {
                        this.log.info('Found a new', d.DeviceType, 'remote', fullName);

                        // SIDE EFFECT: this constructor mutates the accessory object
                        try {
                            new PicoRemote(this, accessory, this.bridgeMgr.getBridge(bridge.bridgeID));
                        } catch (e) {
                            this.log.error('Failed to set up Pico', fullName, e);
                            continue;
                        }

                        break;
                    }

                    // TODO
                    case 'Pico4Button':
                    case 'Pico4ButtonScene':
                    case 'Pico4ButtonZone':
                    case 'Pico4Button2Group':
                    case 'FourGroupRemote':
                    default:
                        this.log.info('Device type', d.DeviceType, 'not yet supported, skipping setup');
                        continue;
                }
                try {
                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                } catch (e) {
                    this.log.error(`Could not register ${d.DeviceType} named ${fullName} with uuid ${uuid}: ${e}`);
                    continue;
                }
                this.accessories.set(uuid, accessory);
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
