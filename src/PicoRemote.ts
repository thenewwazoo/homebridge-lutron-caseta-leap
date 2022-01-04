import { Service, PlatformAccessory } from 'homebridge';

import { LutronCasetaLeap } from './platform';
import { OneButtonStatusEvent, Response, SmartBridge } from 'lutron-leap';

// This maps device types and button numbers to human-readable labels and
// ServiceLabelIndex values. n.b. the labels are not shown in Apple's Home app,
// but are shown in other apps. The index value determines the order that
// buttons are shown in the Home app. They're ordered top-to-bottom here.
const BUTTON_MAP = new Map<string, Map<number, { label: string; index: number }>>([
    [
        'Pico2Button',
        new Map([
            [0, { label: 'On', index: 1 }],
            [1, { label: 'Off', index: 2 }],
        ]),
    ],
    [
        'Pico2ButtonRaiseLower',
        new Map([
            [0, { label: 'On', index: 1 }],
            [1, { label: 'Off', index: 4 }],
            [2, { label: 'Raise', index: 2 }],
            [3, { label: 'Lower', index: 3 }],
        ]),
    ],
    [
        'Pico3Button',
        new Map([
            [0, { label: 'On', index: 1 }],
            [1, { label: 'Center', index: 2 }],
            [2, { label: 'Off', index: 3 }],
        ]),
    ],
    [
        'Pico3ButtonRaiseLower',
        new Map([
            [0, { label: 'On', index: 1 }],
            [1, { label: 'Center', index: 3 }],
            [2, { label: 'Off', index: 5 }],
            [3, { label: 'Raise', index: 2 }],
            [4, { label: 'Lower', index: 4 }],
        ]),
    ],
    // TODO
    /*
    ['Pico4Button', new Map([
    ])],
    ['Pico4ButtonScene', new Map([
    ])],
    ['Pico4ButtonZone', new Map([
    ])],
    ['Pico4Button2Group', new Map([
    ])],
   */
]);

export class PicoRemote {
    private services: Map<string, Service>;

    constructor(
        private readonly platform: LutronCasetaLeap,
        private readonly accessory: PlatformAccessory,
        private readonly bridge: Promise<SmartBridge>,
    ) {
        this.accessory
            .getService(this.platform.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
            .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
            .setCharacteristic(
                this.platform.api.hap.Characteristic.SerialNumber,
                this.accessory.context.device.SerialNumber.toString(),
            );

        this.services = new Map();

        const label_svc =
            this.accessory.getService(this.platform.api.hap.Service.ServiceLabel) ||
            this.accessory.addService(this.platform.api.hap.Service.ServiceLabel);
        label_svc.setCharacteristic(
            this.platform.api.hap.Characteristic.ServiceLabelNamespace,
            this.platform.api.hap.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS, // ha ha
        );

        for (const button of accessory.context.buttons) {
            const alias = BUTTON_MAP.get(this.accessory.context.device.DeviceType)!.get(button.ButtonNumber)!;
            this.platform.log.debug(
                `setting up ${button.href} named ${button.Name} numbered ${button.ButtonNumber} as ${alias}`,
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

            // TODO add timers to track double- and long-presses, remove this line
            service
                .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
                .setProps({ maxValue: 0 });

            this.services.set(button.href, service);

            bridge.then((bridge: SmartBridge) => {
                this.platform.log.debug(`have bridge ${bridge.bridgeID}, subscribing`);
                bridge.client.subscribe(button.href + '/status/event', this.handleEvent.bind(this), 'SubscribeRequest');
            });
        }

        this.platform.on('unsolicited', this.handleUnsolicited.bind(this));
    }

    handleEvent(response: Response): void {
        const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus;
        const svc = this.services.get(evt.Button.href);
        this.platform.log.debug('handling event from button ', evt.Button.href);
        if (svc !== undefined) {
            if (evt.ButtonEvent.EventType === 'Release') {
                this.platform.log.debug('button ', evt.Button.href, ' was released');
                svc.getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent).updateValue(
                    this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
                );
            } else {
                this.platform.log.debug('button ', evt.Button.href, ' was ', evt.ButtonEvent.EventType);
            }
        } else {
            this.platform.log.warn('unsolicited button event from ', evt.Button.href);
        }
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
