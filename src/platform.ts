import { EventEmitter } from 'events';
import {
    BridgeFinder,
    BridgeNetInfo,
    DeviceDefinition,
    LEAP_PORT,
    LeapClient,
    OneDeviceStatus,
    Response,
    SmartBridge,
} from 'lutron-leap';

import { API, APIEvent, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import TypedEmitter from 'typed-emitter';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';
import { SerenaTiltOnlyWoodBlinds } from './SerenaTiltOnlyWoodBlinds';
import { PicoRemote } from './PicoRemote';
import { OccupancySensor } from './OccupancySensor';
import { BridgeManager } from './BridgeManager';

import fs from 'fs';
import v8 from 'v8';
import process from 'process';

interface PlatformEvents {
    unsolicited: (response: Response) => void;
}

// see config.schema.json
export interface GlobalOptions {
    filterPico: boolean;
    filterBlinds: boolean;
    clickSpeedLong: 'quick' | 'default' | 'relaxed' | 'disabled';
    clickSpeedDouble: 'quick' | 'default' | 'relaxed' | 'disabled';
}

interface BridgeAuthEntry {
    bridgeid: string;
    ca: string;
    key: string;
    cert: string;
}

export class SkipDevice extends Error {
    constructor(msg) {
        super(msg);
        Object.setPrototypeOf(this, SkipDevice.prototype);
        this.name = 'Skipping';
    }
}

export class LutronCasetaLeap
    extends (EventEmitter as new () => TypedEmitter<PlatformEvents>)
    implements DynamicPlatformPlugin
{
    private readonly accessories: Map<string, PlatformAccessory> = new Map();
    private finder: BridgeFinder | null = null;
    private options: GlobalOptions;
    private secrets: Map<string, BridgeAuthEntry>;
    private bridgeMgr;

    constructor(public readonly log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
        super();

        log.info('LutronCasetaLeap starting up...');

        this.bridgeMgr = new BridgeManager(this);

        process.on('warning', (e) => this.log.warn(`Got ${e.name} process warning: ${e.message}:\n${e.stack}`));

        this.options = this.optionsFromConfig(config);
        this.secrets = this.secretsFromConfig(config);
        if (this.secrets.size === 0) {
            log.warn('No bridge auth configured. Retiring.');
            return;
        }

        // Each device will subscribe to 'unsolicited', which means we very
        // quickly hit the limit for EventEmitters. Set this limit to the
        // number of bridges times the per-bridge device limit.
        this.setMaxListeners(75 * this.secrets.size);

        /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
        api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            log.info('Finished launching; starting up automatic discovery');

            this.finder = new BridgeFinder();
            this.finder.on('discovered', this.handleBridgeDiscovery.bind(this));
            this.finder.on('failed', (error) => {
                log.error('Could not connect to discovered hub:', error);
            });
            this.finder.beginSearching();
        });

        process.on('SIGUSR2', () => {
            const fileName = `/tmp/lutron.${Date.now()}.heapsnapshot`;
            const usage = process.memoryUsage();
            this.log.warn(`Current memory usage:
                          rss=${usage.rss},
                          heapTotal=${usage.heapTotal},
                          heapUsed=${usage.heapUsed},
                          external=${usage.external},
                          arrayBuffers=${usage.arrayBuffers}`);
            this.log.warn(`Got request to dump heap. Dumping to ${fileName}`);
            const snapshotStream = v8.getHeapSnapshot();
            const fileStream = fs.createWriteStream(fileName);
            snapshotStream.pipe(fileStream);
            this.log.info(`Heap dump to ${fileName} finished.`);
        });

        log.info('LutronCasetaLeap plugin finished early initialization');
    }

    optionsFromConfig(config: PlatformConfig): GlobalOptions {
        return Object.assign(
            {
                filterPico: false,
                filterBlinds: false,
                clickSpeedDouble: 'default',
                clickSpeedLong: 'default',
            },
            config.options,
        );
    }

    secretsFromConfig(config: PlatformConfig): Map<string, BridgeAuthEntry> {
        const out = new Map();
        for (const entry of config.secrets as Array<BridgeAuthEntry>) {
            out.set(entry.bridgeid.toLowerCase(), {
                ca: entry.ca,
                key: entry.key,
                cert: entry.cert,
                bridgeid: entry.bridgeid,
            });
        }
        return out;
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.accessories.set(accessory.UUID, accessory);
    }

    // ----- CUSTOM METHODS

    private handleBridgeDiscovery(bridgeInfo: BridgeNetInfo) {
        if (this.bridgeMgr.hasBridge(bridgeInfo.bridgeid.toLowerCase())) {
            // we've already discovered this bridge, move along
            this.log.info('Bridge', bridgeInfo.bridgeid, 'already known, closing.');
            return;
        }
        if (this.secrets.has(bridgeInfo.bridgeid.toLowerCase())) {
            const these = this.secrets.get(bridgeInfo.bridgeid.toLowerCase())!;
            this.log.debug('bridge', bridgeInfo.bridgeid, 'has secrets', JSON.stringify(these));
            const client = new LeapClient(bridgeInfo.ipAddr, LEAP_PORT, these.ca, these.key, these.cert);
            const bridge = new SmartBridge(bridgeInfo.bridgeid.toLowerCase(), client);
            this.bridgeMgr.addBridge(bridge);
            this.processAllDevices(bridge);
        } else {
            throw new Error('no credentials for bridge ID ' + bridgeInfo.bridgeid);
        }
    }

    private processAllDevices(bridge: SmartBridge) {
        bridge.getDeviceInfo().then(async (devices: DeviceDefinition[]) => {
            const results: PromiseSettledResult<void>[] = await Promise.allSettled(
                devices.map((device: DeviceDefinition) => this.processDevice(bridge, device)),
            );
            for (const result of results) {
                if (result.status === 'rejected') {
                    this.log.error(`Failed to process device: ${result.reason}`);
                }
            }
        });

        bridge.on('unsolicited', this.handleUnsolicitedMessage.bind(this));
    }

    async processDevice(bridge: SmartBridge, d: DeviceDefinition) {
        const fullName = d.FullyQualifiedName.join(' ');
        const uuid = this.api.hap.uuid.generate(d.SerialNumber.toString());

        const accessory: PlatformAccessory | undefined = this.accessories.get(uuid);
        if (accessory) {
            // either re-setup the device or remove it
            try {
                await this.wireAccessory(accessory, bridge, d);
                accessory.displayName = fullName;
            } catch (e) {
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                return Promise.reject(new Error(`Failed to wire cached device ${fullName}: ${e}`));
            }
        } else {
            // new device, create an accessory and add it (or skip it)
            const accessory: PlatformAccessory<Record<string, DeviceDefinition | string>> | void =
                new this.api.platformAccessory(fullName, uuid);

            try {
                await this.wireAccessory(accessory, bridge, d);
            } catch (e) {
                return Promise.reject(new Error(`Failed to wire new device ${fullName}: ${e}`));
            }

            this.accessories.set(accessory.UUID, accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }

    wireAccessory(accessory: PlatformAccessory, bridge: SmartBridge, device: DeviceDefinition): Promise<void> {
        const fullName = device.FullyQualifiedName.join(' ');
        accessory.context.device = device;
        accessory.context.bridgeID = bridge.bridgeID;

        switch (device.DeviceType) {
            case 'SerenaTiltOnlyWoodBlind': {
                this.log.info('Found a new Serena blind:', fullName);

                if (this.options.filterBlinds) {
                    throw new SkipDevice('Serena wood blinds support disabled.');
                }

                // SIDE EFFECT: this constructor mutates the accessory object
                new SerenaTiltOnlyWoodBlinds(this, accessory, bridge);

                return Promise.resolve();
            }

            case 'Pico2Button':
            case 'Pico2ButtonRaiseLower':
            case 'Pico3Button':
            case 'Pico3ButtonRaiseLower':
            case 'Pico4Button2Group':
            case 'Pico4ButtonScene':
            case 'Pico4ButtonZone': {
                this.log.info(`Found a new ${device.DeviceType} remote ${fullName}`);

                // SIDE EFFECT: this constructor mutates the accessory object
                const remote = new PicoRemote(this, accessory, bridge, this.options);
                return remote.initialize();
            }

            case 'RPSOccupancySensor': {
                this.log.info(`Found a new ${device.DeviceType} occupancy sensor ${fullName}`);

                const sensor = new OccupancySensor(this, accessory, this.bridgeMgr.getBridge(bridge.bridgeID));
                return sensor.initialize();
            }

            // known devices that are exposed directly to homekit
            case 'SmartBridge':
            case 'WallSwitch':
            case 'WallDimmer':
            case 'CasetaFanSpeedController':
            case 'SerenaRollerShade':
            case 'DivaSmartDimmer': {
                return Promise.reject(
                    new SkipDevice(`Device type ${device.DeviceType} supported natively, skipping setup`),
                );
            }

            // TODO
            // known devices that are not exposed to homekit, pending support
            case 'Pico4Button':
            case 'FourGroupRemote': {
                return Promise.reject(
                    new SkipDevice(
                        `Device type ${device.DeviceType} not yet supported, skipping setup. Please file a request ticket`,
                    ),
                );
            }

            // any device we don't know about yet
            default:
                return Promise.reject(
                    new SkipDevice(
                        `Device type ${device.DeviceType} not recognized. Please file a ticket and tell me about it`,
                    ),
                );
        }
    }

    handleUnsolicitedMessage(bridgeID: string, response: Response) {
        this.log.debug('bridge', bridgeID, 'got unsolicited message', response);

        if (response.CommuniqueType === 'UpdateResponse' && response.Header.Url === '/device/status/deviceheard') {
            const heardDevice = (response.Body! as OneDeviceStatus).DeviceStatus.DeviceHeard;
            this.log.info(`New ${heardDevice.DeviceType} s/n ${heardDevice.SerialNumber}. Triggering refresh in 30s.`);
            this.bridgeMgr
                .getBridge(bridgeID)
                .then((bridge: SmartBridge) => setTimeout(() => this.processAllDevices(bridge), 30000))
                .catch((e) => this.log.error('Failed to trigger device refresh due to newly-heard device:', e));
        } else {
            this.emit('unsolicited', response);
        }
    }
}
