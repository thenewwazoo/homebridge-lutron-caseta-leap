import { Service, PlatformAccessory } from 'homebridge';

import { GlobalOptions, LutronCasetaLeap, DeviceWireResult, DeviceWireResultType } from './platform';
import { ButtonTracker } from './ButtonState';
import { ExceptionDetail, OneButtonStatusEvent, Response, SmartBridge, ButtonDefinition } from 'lutron-leap';

import { inspect } from 'util';

// This maps DeviceType and ButtonNumber to human-readable labels and
// ServiceLabelIndex values. n.b. the labels are not shown in Apple's Home app,
// but are shown in other apps. The index value determines the order that
// buttons are shown in the Home app. They're ordered top-to-bottom (as they
// appear on the physical remote) in this map.
//
// [
//     $DeviceType,
//     new Map([
//         [$ButtonNumber, { label: '...', index: ... }],
//         ...
//     ]),
// ]
const BUTTON_MAP = new Map<string, Map<number, { label: string; index: number; isUpDown: boolean }>>([
    [
        'Pico2Button',
        new Map([
            [0, { label: 'On', index: 1, isUpDown: false }],
            [2, { label: 'Off', index: 2, isUpDown: false }],
        ]),
    ],
    [
        'Pico2ButtonRaiseLower',
        new Map([
            [0, { label: 'On', index: 1, isUpDown: false }],
            [2, { label: 'Off', index: 4, isUpDown: false }],
            [3, { label: 'Raise', index: 2, isUpDown: true }],
            [4, { label: 'Lower', index: 3, isUpDown: true }],
        ]),
    ],
    [
        'Pico3Button',
        new Map([
            [0, { label: 'On', index: 1, isUpDown: false }],
            [1, { label: 'Center', index: 2, isUpDown: false }],
            [2, { label: 'Off', index: 3, isUpDown: false }],
        ]),
    ],
    [
        'Pico3ButtonRaiseLower',
        new Map([
            [0, { label: 'On', index: 1, isUpDown: false }],
            [1, { label: 'Center', index: 3, isUpDown: false }],
            [2, { label: 'Off', index: 5, isUpDown: false }],
            [3, { label: 'Raise', index: 2, isUpDown: true }],
            [4, { label: 'Lower', index: 4, isUpDown: true }],
        ]),
    ],
    [
        'Pico4Button2Group',
        new Map([
            [1, { label: 'Group 1 On', index: 1, isUpDown: false }],
            [2, { label: 'Group 1 Off', index: 2, isUpDown: false }],
            [3, { label: 'Group 2 On', index: 3, isUpDown: false }],
            [4, { label: 'Group 2 Off', index: 4, isUpDown: false }],
        ]),
    ],
    [
        'Pico4ButtonScene',
        new Map([
            [1, { label: 'Button 1', index: 1, isUpDown: false }],
            [2, { label: 'Button 2', index: 2, isUpDown: false }],
            [3, { label: 'Button 3', index: 3, isUpDown: false }],
            [4, { label: 'Button 4', index: 4, isUpDown: false }],
        ]),
    ],
    [
        'Pico4ButtonZone',
        new Map([
            [1, { label: 'Button 1', index: 1, isUpDown: false }],
            [2, { label: 'Button 2', index: 2, isUpDown: false }],
            [3, { label: 'Button 3', index: 3, isUpDown: false }],
            [4, { label: 'Button 4', index: 4, isUpDown: false }],
        ]),
    ],
    // TODO
    /*
    ['Pico4Button', new Map([
    ])]
   */
]);

export class PicoRemote {
    private services: Map<string, Service> = new Map();
    private trackers: Map<string, ButtonTracker> = new Map();

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
        private readonly bridge: SmartBridge,
        private readonly options: GlobalOptions,
    ) {}

    public async initialize(): Promise<DeviceWireResult> {
        const fullName = this.accessory.context.device.FullyQualifiedName.join(' ');

        this.accessory
            .getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
            .setCharacteristic(
                this.platform.api.hap.Characteristic.SerialNumber,
                this.accessory.context.device.SerialNumber.toString(),
            );

        const label_svc =
            this.accessory.getService(this.platform.api.hap.Service.ServiceLabel) ||
            this.accessory.addService(this.platform.api.hap.Service.ServiceLabel);
        label_svc.setCharacteristic(
            this.platform.api.hap.Characteristic.ServiceLabelNamespace,
            this.platform.api.hap.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS, // ha ha
        );

        let bgs;
        try {
            bgs = await this.bridge.getButtonGroupsFromDevice(this.accessory.context.device);
        } catch (e) {
            this.platform.log.error('Failed to get button group(s) belonging to', fullName, e);
            return {
                kind: DeviceWireResultType.Error,
                reason: `Failed to get button group(s) belonging to ${fullName}: ${e}`,
            };
        }

        // if there are any buttongroups that are already associated in the
        // lutron app, and we've been told to skip them, return early.
        if (bgs.some((bg) => bg.AffectedZones !== undefined) && this.options.filterPico) {
            return {
                kind: DeviceWireResultType.Skipped,
                reason: 'Associated with a device outside HomeKit',
            };
        }

        bgs.forEach((bg) => {
            if (bg instanceof ExceptionDetail) {
                return new Error('Device has been removed');
            }
        });

        let buttons: ButtonDefinition[] = [];
        for (const bg of bgs) {
            try {
                buttons = buttons.concat(await this.bridge.getButtonsFromGroup(bg));
            } catch (e) {
                this.platform.log.error('Failed to get buttons from button group', bg.href);
                return {
                    kind: DeviceWireResultType.Error,
                    reason: `Failed to get buttons from button group ${bg.href}: ${e}`,
                };
            }
        }

        for (const button of buttons) {
            const dentry = BUTTON_MAP.get(this.accessory.context.device.DeviceType);
            if (dentry === undefined) {
                return {
                    kind: DeviceWireResultType.Error,
                    reason: `Could not find ${this.accessory.context.device.DeviceType} in button map`,
                };
            }
            const alias = dentry.get(button.ButtonNumber);
            if (alias === undefined) {
                return {
                    kind: DeviceWireResultType.Error,
                    reason: `Could not find button ${button.ButtonNumber} in ${this.accessory.context.device.DeviceType} map entry`,
                };
            }

            this.platform.log.debug(
                `setting up ${button.href} named ${button.Name} numbered ${button.ButtonNumber} as ${inspect(
                    alias,
                    true,
                    null,
                )}`,
            );

            const service =
                this.accessory.getServiceById(this.platform.api.hap.Service.StatelessProgrammableSwitch, alias.label) ||
                this.accessory.addService(
                    this.platform.api.hap.Service.StatelessProgrammableSwitch,
                    button.Name,
                    alias.label,
                );
            service.addLinkedService(label_svc);

            service.setCharacteristic(this.platform.api.hap.Characteristic.Name, alias.label);
            service.setCharacteristic(this.platform.api.hap.Characteristic.ServiceLabelIndex, alias.index);

            service
                .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                .setProps({ maxValue: 2 });

            this.services.set(button.href, service);
            this.trackers.set(
                button.href,
                new ButtonTracker(
                    () =>
                        service
                            .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                            .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS),
                    () =>
                        service
                            .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                            .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS),
                    () =>
                        service
                            .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                            .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS),
                    this.platform.log,
                    button.href,
                    this.options.clickSpeedDouble,
                    this.options.clickSpeedLong,
                    alias.isUpDown,
                ),
            );

            this.platform.log.debug(`subscribing to ${button.href} events`);
            this.bridge.subscribeToButton(button, this.handleEvent.bind(this));
        }

        this.platform.on('unsolicited', this.handleUnsolicited.bind(this));

        return {
            kind: DeviceWireResultType.Success,
            name: fullName,
        };
    }

    handleEvent(response: Response): void {
        const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus;
        const fullName = this.accessory.context.device.FullyQualifiedName.join(' ');
        this.platform.log.info(
            `Button ${evt.Button.href} on Pico remote ${fullName} got action ${evt.ButtonEvent.EventType}`,
        );
        this.trackers.get(evt.Button.href)!.update(evt.ButtonEvent.EventType);
    }

    handleUnsolicited(response: Response): void {
        if (response.Header.MessageBodyType === 'OneButtonStatusEvent') {
            const href = (response.Body as OneButtonStatusEvent)?.ButtonStatus.Button.href;
            if (this.services.has(href)) {
                this.platform.log.warn('got unsolicited response for known button ', href, ', handling anyway');
                this.handleEvent(response);
            }
        }
    }
}
