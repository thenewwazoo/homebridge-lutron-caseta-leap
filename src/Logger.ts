import type { LogLevel, Logging } from 'homebridge'

/**
 * Plugin-level log verbosity setting. Stacks on top of Homebridge's own
 * log handling and the call-site reclassification done in this PR:
 *
 *   'normal'      — passthrough. After call-site reclassification, 'info' is
 *                   reserved for one-time lifecycle events (startup banner,
 *                   per-device discovery, retry attempts); per-event noise
 *                   (button presses, mDNS re-announce churn, blind position
 *                   reads/writes) is at 'debug'. Default.
 *   'quiet'       — suppress 'info' (and 'success'); pass 'warn'/'error'
 *                   through. Useful in production where info banners are
 *                   visual noise but you still want to see anomalies.
 *   'errors-only' — suppress 'info'/'success' AND 'warn'; pass 'error' only.
 *
 * 'debug' is intentionally NEVER suppressed by this wrapper; it is gated by
 * Homebridge's own debug-mode flag, which is the right axis for that. If a
 * user has enabled debug deliberately for troubleshooting, suppressing it
 * here would defeat the purpose.
 */
export type LogLevelOption = 'normal' | 'quiet' | 'errors-only'

/**
 * Per-button-press logging level. Button presses are special-cased because
 * they're the primary diagnostic an operator wants for "did my press
 * register?" troubleshooting, but they're also high-volume noise in steady
 * state.
 *
 *   'info'   — visible at info level (legacy behavior; useful when wiring
 *              up automations and you want to see presses without enabling
 *              global Homebridge debug).
 *   'debug'  — visible at debug level only (new default). Quiet in normal
 *              logs; flip Homebridge's global debug to see presses.
 *   'silent' — never log presses at any level.
 */
export type ButtonPressLogLevel = 'info' | 'debug' | 'silent'

/**
 * Wraps a Homebridge Logging instance to apply a user-selected verbosity
 * filter. Returns the original logger unchanged when level is 'normal'
 * (zero overhead). For 'quiet' and 'errors-only', returns a callable
 * function wrapper that no-ops the suppressed methods and delegates the
 * rest to the original logger.
 *
 * Wrapping at the platform level cascades to every device class that reads
 * `this.platform.log` (PicoRemote, OccupancySensor, SerenaTiltOnlyWoodBlinds,
 * ButtonTracker via PicoRemote), so this single wrap point governs the
 * whole plugin.
 */
export function createFilteredLogger(base: Logging, level: LogLevelOption): Logging {
  // 'normal' or any unexpected value → passthrough. Defensive: if a hand-edited
  // config.json supplies a string we don't recognise, never silently suppress.
  if (level !== 'quiet' && level !== 'errors-only') {
    return base
  }

  const suppressInfo = true // both 'quiet' and 'errors-only' suppress info+success
  const suppressWarn = level === 'errors-only'
  const noop: (..._args: any[]) => void = () => { /* suppressed by logLevel */ }

  // Logging is callable AND has methods; build a function with attached
  // properties to satisfy both shapes. The callable form behaves like info().
  const fn = function wrappedLogger(msg: string, ...params: any[]): void {
    if (suppressInfo) {
      return
    }
    base(msg, ...params)
  } as unknown as Logging

  // Methods are bound to the original logger so internal `this` references
  // (prefix, formatting helpers) still see the right instance.
  ;(fn as any).prefix = base.prefix
  ;(fn as any).info = suppressInfo ? noop : base.info.bind(base)
  ;(fn as any).success = suppressInfo ? noop : base.success.bind(base)
  ;(fn as any).warn = suppressWarn ? noop : base.warn.bind(base)
  ;(fn as any).error = base.error.bind(base)
  ;(fn as any).debug = base.debug.bind(base)
  ;(fn as any).log = (lvl: LogLevel, msg: string, ...params: any[]) => {
    // LogLevel is a const enum whose values are the strings 'info'/'success'/
    // 'warn'/'error'/'debug', so equality checks against string literals are
    // type-correct and stable across const-enum erasure.
    if (suppressInfo && (lvl === 'info' || lvl === 'success')) {
      return
    }
    if (suppressWarn && lvl === 'warn') {
      return
    }
    base.log(lvl, msg, ...params)
  }

  return fn
}

/**
 * Emit a button-press log line at the level specified by the user's
 * 'buttonPressLogging' option. Used by both PicoRemote (for raw
 * Press/Release events received from the bridge) and ButtonTracker (for
 * interpreted short/long/double press events derived from the state
 * machine). Centralised here so the three states stay in sync between
 * the two call sites.
 */
export function logButtonPress(
  log: Logging,
  level: ButtonPressLogLevel,
  message: string,
  ...params: any[]
): void {
  switch (level) {
    case 'info':
      log.info(message, ...params)
      break
    case 'debug':
      log.debug(message, ...params)
      break
    case 'silent':
      // intentionally drop
      break
  }
}
