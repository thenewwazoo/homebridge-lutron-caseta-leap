import { Logging } from 'homebridge';

enum ButtonState {
    IDLE,
    DOWN,
    UP,
}

// the "double press timeout" is the amount of time you have to start the
// second press after the initial press is *released*. this is the *maximum
// dwell time*. the duration of the second press does not matter, only its
// initiation matters. after the second press is detected, the state machine is
// reset. the next press will be another initial press.
const DOUBLE_PRESS_DWELL_MS = new Map<string, number>([
    ['quick', 300],
    ['default', 300],
    ['relaxed', 450],
    ['disabled', 0],
]);

// the "long press timeout" is the amount of time you must hold the button down
// for an *initial* press to count as "long". when this happens, the state
// machine is reset. the next press will be another initial press.
const LONG_PRESS_TIMEOUT_MS = new Map<string, number>([
    ['quick', 300],
    ['default', 350],
    ['relaxed', 750],
    ['disabled', 0],
]);

// Up- and down-buttons on Picos (eg. PJ2-3BRL and PJ2-2BRL) appear to be
// intentionally slowed in their response:
//
// A millisecond log excerpt of pressing an "up" button as quickly as I can
// manage (with no mobility impairments):
//
// 2022-07-26,10:29:15.862 ... 'ButtonEvent': {'EventType': 'Press'}}}}
// 2022-07-26,10:29:15.956 ... 'ButtonEvent': {'EventType': 'Release'}}}}
// 2022-07-26,10:29:16.477 ... 'ButtonEvent': {'EventType': 'Press'}}}}
// 2022-07-26,10:29:16.495 ... 'ButtonEvent': {'EventType': 'Release'}}}}
//
// That's a time of 94 ms down, 521 ms dwell, 18 ms down, and 633 ms total.
//
// Now, the same excerpt from an "on" button:
//
// 2022-07-26,10:27:47.694 ... 'ButtonEvent': {'EventType': 'Press'}}}}
// 2022-07-26,10:27:47.807 ... 'ButtonEvent': {'EventType': 'Release'}}}}
// 2022-07-26,10:27:47.887 ... 'ButtonEvent': {'EventType': 'Press'}}}}
// 2022-07-26,10:27:47.965 ... 'ButtonEvent': {'EventType': 'Release'}}}}
//
// That's a time of 113 ms down, 80 ms dwell, 78 ms down, and 271 ms total.
//
// This obviously includes network propagation delay. Interestingly, I can't
// find any indication that the Smart Hub or the Pico itself will emit anything
// that looks like a *native* double-press.
//
// This means that we must handle up- and down-buttons differently, and add
// some delay for detecting double-press events. Long-press events are
// unaffected.
const UP_DOWN_BTN_DELAY_MS = 250;

export class ButtonTracker {
    private timer: ReturnType<typeof setTimeout> | null;
    private state: ButtonState = ButtonState.IDLE;

    private longPressTimeout?: number;
    private longPressDisabled = false;

    private doublePressTimeout?: number;
    private doublePressDisabled = false;

    constructor(
        private shortPressCB: () => void,
        private doublePressCB: () => void,
        private longPressCB: () => void,
        private log: Logging,
        private href: string,
        clickSpeedDouble = 'default',
        clickSpeedLong = 'default',
        isUpDownButton = false,
    ) {
        log.debug(`btrk ${this.href} created speed ${clickSpeedDouble} dbl ${clickSpeedLong} long`);

        this.timer = null;

        if (clickSpeedLong === 'disabled') {
            this.longPressDisabled = true;
        }

        if (clickSpeedDouble === 'disabled') {
            this.doublePressDisabled = true;
        }

        if (!DOUBLE_PRESS_DWELL_MS.has(clickSpeedDouble)) {
            throw new Error(`Could not get dbl timing for speed ${clickSpeedDouble}`);
        }

        if (!LONG_PRESS_TIMEOUT_MS.has(clickSpeedLong)) {
            throw new Error(`Could not get long timing for speed ${clickSpeedLong}`);
        }

        this.longPressTimeout = LONG_PRESS_TIMEOUT_MS.get(clickSpeedLong)!;

        this.doublePressTimeout = DOUBLE_PRESS_DWELL_MS.get(clickSpeedDouble)!;
        if (isUpDownButton && !this.doublePressDisabled) {
            this.doublePressTimeout += UP_DOWN_BTN_DELAY_MS;
        }
    }

    reset() {
        this.state = ButtonState.IDLE;
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = null;
        this.log.debug('btrk reset to IDLE');
    }

    public update(action: string) {
        this.log.debug(`btrk ${this.href} got event ${action} in state ${this.state}`);

        // TODO this state machine is ill-formed, and relies on `this.timer`
        // implicitly being included in state decisions. refactor so the timer
        // updates the state variable. this will also make the `disabled`
        // options clearer.

        const longPressTimeoutHandler = () => {
            this.log.debug(`btrk ${this.href} long press timeout`);
            this.reset();

            if (this.longPressDisabled) {
                // unreachable
                return;
            }

            this.log.info(`button ${this.href} got a long press`);
            this.longPressCB();
        };

        const doublePressTimeoutHandler = () => {
            this.log.debug(`btrk ${this.href} double press expiry`);
            this.reset();
            this.log.info(`button ${this.href} got a short press`);
            this.shortPressCB();
        };

        switch (this.state) {
            case ButtonState.IDLE: {
                if (action === 'Press') {
                    this.state = ButtonState.DOWN;
                    if (this.longPressDisabled) {
                        this.log.info(`button ${this.href} long press disabled. suppressing.`);
                    } else {
                        this.timer = setTimeout(longPressTimeoutHandler, this.longPressTimeout);
                    }
                    this.log.debug(`btrk ${this.href} now in state DOWN`);
                } else {
                    // no-op
                    this.log.debug(`btrk ${this.href} no-op IDLE action ${action}`);
                }
                break;
            }

            case ButtonState.DOWN: {
                if (action === 'Release') {
                    this.state = ButtonState.UP;
                    if (this.timer) {
                        clearTimeout(this.timer);
                        this.log.debug(`btrk ${this.href} cleared timer`);
                    }
                    this.timer = setTimeout(() => {
                        doublePressTimeoutHandler();
                    }, this.doublePressTimeout);
                    this.log.debug(`btrk ${this.href} now in UP state`);
                } else {
                    // action == "Press"
                    this.log.error('btrk invalid action for state. resetting');
                    this.reset();
                }
                break;
            }

            case ButtonState.UP:
                {
                    if (action === 'Press' && this.timer) {
                        // the button was pressed again before the timer fired
                        this.log.debug(`btrk ${this.href} pressed before double-tap expiry`);
                        this.reset();

                        if (this.doublePressDisabled) {
                            this.log.info(`button ${this.href} double press disabled. suppressing.`);
                            return;
                        }

                        this.log.info(`button ${this.href} got a double press`);
                        this.doublePressCB();
                    } else {
                        this.log.error('btrk invalid action for state. resetting');
                        this.reset();
                    }
                }
                break;
        }
    }
}
