import type { Logging } from 'homebridge'

import { withTimeout } from './utils.js'

// Why this exists: lutron-leap detects dead connections (its own ping loop
// fires every 5 minutes) but deliberately never repairs them; the .catch in
// SmartBridge.startPingLoop is a documented no-op. Repair only happens when
// the socket emits 'close' (never happens for half-open connections after a
// router reboot or Wi-Fi blip) or when an mDNS re-announce arrives (best
// effort at most). Without this watchdog, a silently dead connection stays
// dead until Homebridge restarts.
//
// Defaults are chosen so a dead connection is detected and repaired within
// about three minutes: three failed pings, 60 seconds apart.
const DEFAULT_PING_INTERVAL_MS = 60_000
const DEFAULT_PING_TIMEOUT_MS = 10_000
const DEFAULT_FAILURE_THRESHOLD = 3

export interface ConnectionWatchdogOptions {
  /** Identifies the bridge in log lines. */
  bridgeLabel: string
  /** Sends a lightweight request over the current connection. */
  ping: () => Promise<unknown>
  /**
   * Tears down and replaces the connection. Called after `failureThreshold`
   * consecutive ping failures. May resolve `false` to signal it stood down
   * because another repair path was already handling the bridge.
   */
  revive: () => Promise<boolean | void>
  /**
   * Returns true while the bridge is mid-reconfiguration (the mDNS
   * re-announce path replacing the client). Pings are skipped during that
   * window so a deliberate teardown is not misread as staleness.
   */
  skip?: () => boolean
  /**
   * Called after every successful ping. A ping is NOT proof the plugin is
   * working: lutron-leap's request() awaits connect(), so a ping transparently
   * opens a fresh socket, and a fresh socket has no LEAP subscriptions on it.
   * A reachable bridge with no subscriptions delivers no button presses at
   * all, so the platform uses this hook to finish any repair an interrupted
   * revive left outstanding.
   */
  onHealthy?: () => Promise<void> | void
  log: Logging
  pingIntervalMs?: number
  pingTimeoutMs?: number
  failureThreshold?: number
}

export class ConnectionWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = 0
  private reviving = false
  private stopped = false
  // Consecutive failed revive attempts, used only to keep the log quiet when a
  // bridge is off for a long time (unplugged, away for the weekend). The repair
  // cadence itself is unchanged; it is the warn/error spam every ~3 minutes
  // that would otherwise be a problem, and this plugin has a documented history
  // of users objecting to log noise.
  private consecutiveReviveFailures = 0

  constructor(private readonly opts: ConnectionWatchdogOptions) {}

  public start(): void {
    if (this.timer) {
      return
    }
    this.stopped = false
    const interval = this.opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS
    this.timer = setInterval(() => {
      void this.check()
    }, interval)
    // Never hold the process open on shutdown just to ping.
    this.timer.unref?.()
  }

  public stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async check(): Promise<void> {
    if (this.reviving || this.stopped || this.opts.skip?.()) {
      return
    }

    const timeoutMs = this.opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS
    const threshold = this.opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD

    try {
      // The extra timeout matters even though lutron-leap's request() has its
      // own 5s timer: that timer is armed inside the socket.write callback,
      // so a ping issued against a socket that dies between connect and
      // write never settles at all. This bound guarantees the watchdog
      // always gets an answer.
      await withTimeout(this.opts.ping(), timeoutMs, `watchdog ping to bridge ${this.opts.bridgeLabel} timed out`)
      if (this.consecutiveFailures > 0) {
        this.opts.log.info(`Bridge ${this.opts.bridgeLabel} connection recovered after ${this.consecutiveFailures} failed ping(s)`)
      }
      this.consecutiveFailures = 0
      this.consecutiveReviveFailures = 0
      // Past an await: re-check before doing repair work. A ping resolving
      // after stop() must not trigger a re-subscribe against a bridge nobody
      // is listening to, and one resolving mid-reconfigure must not interleave
      // repair work with the reconfigure that made it moot.
      if (this.stopped || this.opts.skip?.()) {
        return
      }
      try {
        await this.opts.onHealthy?.()
      } catch (e) {
        // Never let follow-up repair work break the ping loop itself.
        this.opts.log.debug(`Post-ping repair for bridge ${this.opts.bridgeLabel} failed:`, e)
      }
    } catch (e) {
      // Re-check the guards now that we are past an await. A reconfigure that
      // started while the ping was in flight calls LeapClient.drain(), which
      // clears every in-flight request without settling it, so the ping we
      // just lost says nothing about the health of the new connection.
      // Counting it would be a false strike against a connection that is
      // being repaired already.
      if (this.stopped || this.opts.skip?.()) {
        return
      }

      this.consecutiveFailures++
      this.opts.log.debug(`Watchdog ping ${this.consecutiveFailures}/${threshold} to bridge ${this.opts.bridgeLabel} failed:`, e)
      if (this.consecutiveFailures < threshold) {
        return
      }

      // Quiet the repeated announcements once a bridge has been unreachable
      // for a while; the first failure of a run is always at warn.
      const firstAttempt = this.consecutiveReviveFailures === 0
      const announce = firstAttempt ? this.opts.log.warn.bind(this.opts.log) : this.opts.log.debug.bind(this.opts.log)
      announce(`LEAP connection to bridge ${this.opts.bridgeLabel} appears stale (${threshold} consecutive failed pings); forcing a reconnect`)

      this.consecutiveFailures = 0
      this.reviving = true
      try {
        const repaired = await this.opts.revive()
        this.consecutiveReviveFailures = 0
        if (repaired === false) {
          this.opts.log.debug(`Bridge ${this.opts.bridgeLabel} repair was already in progress elsewhere; watchdog stood down`)
        } else {
          this.opts.log.info(`Bridge ${this.opts.bridgeLabel} connection re-established by watchdog`)
        }
      } catch (reviveError) {
        this.consecutiveReviveFailures++
        const report = firstAttempt ? this.opts.log.error.bind(this.opts.log) : this.opts.log.debug.bind(this.opts.log)
        report(`Watchdog failed to re-establish connection to bridge ${this.opts.bridgeLabel}; will keep trying:`, reviveError)
      } finally {
        this.reviving = false
      }
    }
  }
}
