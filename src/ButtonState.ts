import { Logging } from 'homebridge';

enum ButtonState {
    IDLE,
    DOWN,
    UP,
}

type LongPressTimeout = number;
type DoublePressTimeout = number;

// the "long press timeout" is the amount of time you must hold the button down
// for an *initial* press to count as "long". when this happens, the state
// machine is reset. the next press will be another initial press.
//
// the "double press timeout" is the amount of time you have to start the
// second press after the initial press is *released*. this is the *maximum
// dwell time*. the duration of the second press does not matter, only its
// initiation matters. after the second press is detected, the state machine is
// reset. the next press will be another initial press.
const CLICK_TIMING = new Map<string, [LongPressTimeout, DoublePressTimeout]>([
    ['fast', [200, 200]],
    ['medium', [350, 300]],
    ['slow', [750, 450]],
]);

export class ButtonTracker {
    private timer: ReturnType<typeof setTimeout> | null;
    private state: ButtonState = ButtonState.IDLE;
    private longPressTimeout: number;
    private doublePressTimeout: number;

    constructor(
        private shortPressCB: () => void,
        private doublePressCB: () => void,
        private longPressCB: () => void,
        private log: Logging,
        private href: string,
        clickSpeed?: string,
    ) {
        log.debug(`btrk ${this.href} created speed ${clickSpeed}`);

        if (clickSpeed === undefined) {
            clickSpeed = 'medium';
        }

        this.timer = null;

        const speeds = CLICK_TIMING.get(clickSpeed);
        if (!speeds) {
            throw new Error(`Could not get timings for speed ${clickSpeed}`);
        }

        this.longPressTimeout = speeds[0];
        this.doublePressTimeout = speeds[1];
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

        const longPressTimeoutHandler = () => {
            this.log.debug(`btrk ${this.href} long press timeout`);
            this.reset();
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
                    this.timer = setTimeout(longPressTimeoutHandler, this.longPressTimeout);
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
