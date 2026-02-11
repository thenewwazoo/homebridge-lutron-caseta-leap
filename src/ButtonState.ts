import type { Logging } from 'homebridge'

enum ButtonState {
  IDLE,
  DOWN,
  UP,
  LONG_HOLD, // After QSX LongHold, waiting for Release to complete
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
])

// the "long press timeout" is the amount of time you must hold the button down
// for an *initial* press to count as "long". when this happens, the state
// machine is reset. the next press will be another initial press.
const LONG_PRESS_TIMEOUT_MS = new Map<string, number>([
  ['quick', 300],
  ['default', 350],
  ['relaxed', 750],
  ['disabled', 0],
])

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
const UP_DOWN_BTN_DELAY_MS = 250

// Timeout to detect "Press-only" buttons (like QSX shades buttons)
// that send Press but never send Release for short presses.
// This should be longer than the double-press window to allow double-tap detection.
// We'll use the double-press timeout value dynamically instead of a fixed value.

export class ButtonTracker {
  private timer: ReturnType<typeof setTimeout> | null
  private pressOnlyTimer: ReturnType<typeof setTimeout> | null = null
  private state: ButtonState = ButtonState.IDLE

  private longPressTimeout?: number
  private longPressDisabled = false

  private doublePressTimeout?: number
  private doublePressDisabled = false

  constructor(
    private shortPressCB: () => void,
    private doublePressCB: () => void,
    private longPressCB: () => void,
    private log: Logging,
    private href: string,
        clickSpeedDouble = 'default',
        clickSpeedLong = 'default',
        isUpDownButton = false,
        private engravingText?: string,
        private isPressOnlyButton = false,
  ) {
    log.debug(`btrk ${this.href} created speed ${clickSpeedDouble} dbl ${clickSpeedLong} long`)

    this.timer = null

    if (clickSpeedLong === 'disabled') {
      this.longPressDisabled = true
    }

    if (clickSpeedDouble === 'disabled') {
      this.doublePressDisabled = true
    }

    if (!DOUBLE_PRESS_DWELL_MS.has(clickSpeedDouble)) {
      throw new Error(`Could not get dbl timing for speed ${clickSpeedDouble}`)
    }

    if (!LONG_PRESS_TIMEOUT_MS.has(clickSpeedLong)) {
      throw new Error(`Could not get long timing for speed ${clickSpeedLong}`)
    }

    this.longPressTimeout = LONG_PRESS_TIMEOUT_MS.get(clickSpeedLong)!

    this.doublePressTimeout = DOUBLE_PRESS_DWELL_MS.get(clickSpeedDouble)!
    if (isUpDownButton && !this.doublePressDisabled) {
      this.doublePressTimeout += UP_DOWN_BTN_DELAY_MS
    }
  }

  // Format button identifier for log messages, including engraving if available
  private get buttonName(): string {
    if (this.engravingText) {
      return `button ${this.href} ("${this.engravingText}")`
    }
    return `button ${this.href}`
  }

  reset() {
    this.state = ButtonState.IDLE
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    if (this.pressOnlyTimer) {
      clearTimeout(this.pressOnlyTimer)
    }
    this.pressOnlyTimer = null
    this.log.debug('btrk reset to IDLE')
  }

  public update(action: string) {
    this.log.debug(`btrk ${this.href} got event ${action} in state ${this.state}`)

    // TODO this state machine is ill-formed, and relies on `this.timer`
    // implicitly being included in state decisions. refactor so the timer
    // updates the state variable. this will also make the `disabled`
    // options clearer.

    const longPressTimeoutHandler = () => {
      this.log.debug(`btrk ${this.href} long press timeout`)
      this.reset()

      if (this.longPressDisabled) {
        // unreachable
        return
      }

      this.log.info(`${this.buttonName} got a long press`)
      this.longPressCB()
    }

    const doublePressTimeoutHandler = () => {
      this.log.debug(`btrk ${this.href} double press expiry`)
      this.reset()
      this.log.info(`${this.buttonName} got a short press`)
      this.shortPressCB()
    }

    switch (this.state) {
      case ButtonState.IDLE: {
        if (action === 'Press') {
          this.state = ButtonState.DOWN
          if (this.longPressDisabled) {
            this.log.info(`${this.buttonName} long press disabled. suppressing.`)
          } else {
            this.timer = setTimeout(longPressTimeoutHandler, this.longPressTimeout)
          }
          // For QSX shades buttons that send Press but no Release,
          // set a timer to detect this case. Only for buttons known to be
          // press-only (shades buttons) — normal Caseta buttons always send Release.
          if (this.isPressOnlyButton) {
            this.pressOnlyTimer = setTimeout(() => {
              // If we're still in DOWN state and haven't received Release or a second Press,
              // this is a "Press-only" button (like shades) with a single press
              if (this.state === ButtonState.DOWN) {
                this.log.debug(`btrk ${this.href} no Release/second Press after Press, treating as single press (QSX shades button)`)
                this.reset()
                this.log.info(`${this.buttonName} got a short press (QSX Press-only)`)
                this.shortPressCB()
              }
            }, this.doublePressTimeout)
          }
          this.log.debug(`btrk ${this.href} now in state DOWN`)
        } else if (action === 'Release') {
          // QSX sends Release without Press for short button presses
          // But it also sends Release BEFORE MultiTap for double-taps
          // Delay the short press to give time for MultiTap to arrive
          this.state = ButtonState.UP
          this.timer = setTimeout(() => {
            this.log.info(`${this.buttonName} got a short press (QSX Release)`)
            this.reset()
            this.shortPressCB()
          }, this.doublePressTimeout)
          this.log.debug(`btrk ${this.href} QSX Release, waiting for potential MultiTap`)
        } else if (action === 'LongHold') {
          // QSX sends LongHold for long presses
          // Transition to LONG_HOLD state to ignore the subsequent Release
          this.state = ButtonState.LONG_HOLD
          if (this.longPressDisabled) {
            this.log.info(`${this.buttonName} long press disabled. suppressing.`)
          } else {
            this.log.info(`${this.buttonName} got a long press (QSX LongHold)`)
            this.longPressCB()
          }
        } else if (action === 'MultiTap') {
          // QSX sends MultiTap for double-tap (sometimes after Release)
          // Cancel any pending short press timer
          if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
          }
          this.reset()
          if (this.doublePressDisabled) {
            this.log.info(`${this.buttonName} double press disabled. suppressing.`)
          } else {
            this.log.info(`${this.buttonName} got a double press (QSX MultiTap)`)
            this.doublePressCB()
          }
        } else {
          // Unknown action
          this.log.debug(`btrk ${this.href} unknown IDLE action ${action}`)
        }
        break
      }

      case ButtonState.DOWN: {
        if (action === 'Release') {
          this.state = ButtonState.UP
          if (this.timer) {
            clearTimeout(this.timer)
            this.log.debug(`btrk ${this.href} cleared long press timer`)
          }
          // Cancel the press-only timer since we got a proper Release
          if (this.pressOnlyTimer) {
            clearTimeout(this.pressOnlyTimer)
            this.pressOnlyTimer = null
            this.log.debug(`btrk ${this.href} cleared press-only timer`)
          }
          this.timer = setTimeout(() => {
            doublePressTimeoutHandler()
          }, this.doublePressTimeout)
          this.log.debug(`btrk ${this.href} now in UP state`)
        } else if (action === 'LongHold') {
          // QSX sends LongHold during a long press, even for buttons that send Press first
          // Cancel all timers and fire long press
          if (this.timer) {
            clearTimeout(this.timer)
          }
          if (this.pressOnlyTimer) {
            clearTimeout(this.pressOnlyTimer)
            this.pressOnlyTimer = null
          }
          this.state = ButtonState.LONG_HOLD
          if (this.longPressDisabled) {
            this.log.info(`${this.buttonName} long press disabled. suppressing.`)
          } else {
            this.log.info(`${this.buttonName} got a long press (QSX LongHold in DOWN)`)
            this.longPressCB()
          }
        } else if (action === 'Press') {
          // For QSX shades buttons: a second Press while in DOWN state means double-tap
          // (shades buttons send Press, Press for double-tap instead of MultiTap)
          this.log.debug(`btrk ${this.href} second Press in DOWN state - treating as double-tap (QSX shades button)`)
          this.reset()

          if (this.doublePressDisabled) {
            this.log.info(`${this.buttonName} double press disabled. suppressing.`)
            return
          }

          this.log.info(`${this.buttonName} got a double press (QSX Press+Press)`)
          this.doublePressCB()
        } else {
          this.log.error(`btrk invalid action ${action} for state ${this.state}. resetting`)
          this.reset()
        }
        break
      }

      case ButtonState.UP: {
        if (action === 'Press' && this.timer) {
          // the button was pressed again before the timer fired
          this.log.debug(`btrk ${this.href} pressed before double-tap expiry`)
          this.reset()

          if (this.doublePressDisabled) {
            this.log.info(`${this.buttonName} double press disabled. suppressing.`)
            return
          }

          this.log.info(`${this.buttonName} got a double press`)
          this.doublePressCB()
        } else if (action === 'MultiTap') {
          // QSX sends MultiTap after Release for double-taps
          // Cancel the pending short press timer and fire double press
          this.log.debug(`btrk ${this.href} got MultiTap in UP state, canceling pending short press`)
          this.reset()

          if (this.doublePressDisabled) {
            this.log.info(`${this.buttonName} double press disabled. suppressing.`)
            return
          }

          this.log.info(`${this.buttonName} got a double press (QSX MultiTap)`)
          this.doublePressCB()
        } else if (action === 'Release') {
          // QSX may send additional Release events, ignore them
          this.log.debug(`btrk ${this.href} ignoring additional Release in UP state`)
        } else {
          this.log.debug(`btrk ${this.href} unexpected action ${action} in UP state, resetting`)
          this.reset()
        }
        break
      }

      case ButtonState.LONG_HOLD: {
        // After QSX LongHold, we're waiting for Release to complete
        // Just reset to IDLE without firing anything
        if (action === 'Release') {
          this.log.debug(`btrk ${this.href} Release after LongHold, resetting to IDLE`)
          this.reset()
        } else {
          this.log.debug(`btrk ${this.href} unexpected action ${action} in LONG_HOLD state, resetting`)
          this.reset()
        }
        break
      }
    }
  }
}
