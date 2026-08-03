import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionWatchdog } from './ConnectionWatchdog.js'

function makeLog(): any {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function makeWatchdog(overrides: Partial<ConstructorParameters<typeof ConnectionWatchdog>[0]> = {}) {
  const ping = vi.fn().mockResolvedValue({})
  const revive = vi.fn().mockResolvedValue(undefined)
  const log = makeLog()
  const watchdog = new ConnectionWatchdog({
    bridgeLabel: 'test-bridge',
    ping,
    revive,
    log,
    pingIntervalMs: 1000,
    pingTimeoutMs: 100,
    failureThreshold: 3,
    ...overrides,
  })
  return { watchdog, ping, revive, log }
}

describe('connectionWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pings on the configured interval and never revives while pings succeed', async () => {
    const { watchdog, ping, revive } = makeWatchdog()
    watchdog.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(ping).toHaveBeenCalledTimes(5)
    expect(revive).not.toHaveBeenCalled()
    watchdog.stop()
  })

  it('revives after the failure threshold and resets the counter afterwards', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('connection dead'))
    const { watchdog, revive } = makeWatchdog({ ping })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(3000)
    expect(revive).toHaveBeenCalledTimes(1)

    // Counter was reset: two more failures are not enough for a second revive...
    await vi.advanceTimersByTimeAsync(2000)
    expect(revive).toHaveBeenCalledTimes(1)

    // ...but the third one is.
    await vi.advanceTimersByTimeAsync(1000)
    expect(revive).toHaveBeenCalledTimes(2)
    watchdog.stop()
  })

  it('treats a ping that never settles as a failure via its own timeout', async () => {
    // Reproduces the lutron-leap hazard: request() arms its timeout inside
    // the socket.write callback, so a write against a dead socket can hang
    // the promise forever. The watchdog must not hang with it.
    const ping = vi.fn(() => new Promise(() => { /* never settles */ }))
    const { watchdog, revive } = makeWatchdog({ ping, failureThreshold: 1 })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(1100) // interval fires at 1000, timeout at +100
    expect(revive).toHaveBeenCalledTimes(1)
    watchdog.stop()
  })

  it('a successful ping resets the consecutive-failure count', async () => {
    let failing = true
    const ping = vi.fn(() => (failing ? Promise.reject(new Error('down')) : Promise.resolve({})))
    const { watchdog, revive } = makeWatchdog({ ping })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(2000) // two failures
    failing = false
    await vi.advanceTimersByTimeAsync(1000) // success; counter resets
    failing = true
    await vi.advanceTimersByTimeAsync(2000) // two failures again, still below threshold
    expect(revive).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000) // third consecutive failure
    expect(revive).toHaveBeenCalledTimes(1)
    watchdog.stop()
  })

  it('skips pings while skip() reports the bridge is mid-reconfiguration', async () => {
    const { watchdog, ping, revive } = makeWatchdog({ skip: () => true })
    watchdog.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(ping).not.toHaveBeenCalled()
    expect(revive).not.toHaveBeenCalled()
    watchdog.stop()
  })

  it('keeps running when revive itself fails', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('down'))
    const revive = vi.fn().mockRejectedValue(new Error('bridge still unreachable'))
    const { watchdog, log } = makeWatchdog({ ping, revive })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(3000)
    expect(revive).toHaveBeenCalledTimes(1)
    expect(log.error).toHaveBeenCalled()

    // Another three failures trigger another attempt rather than giving up.
    await vi.advanceTimersByTimeAsync(3000)
    expect(revive).toHaveBeenCalledTimes(2)
    watchdog.stop()
  })

  it('never runs two revives concurrently', async () => {
    // Guards the `reviving` flag. Without it, a revive that takes longer than
    // the ping interval would be re-entered on every tick, stacking teardowns
    // of the same bridge on top of each other.
    const ping = vi.fn().mockRejectedValue(new Error('down'))
    let inFlight = 0
    let maxConcurrent = 0
    const revive = vi.fn(() => {
      inFlight++
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          inFlight--
          resolve()
        }, 10_000)
      })
    })
    const { watchdog } = makeWatchdog({ ping, revive })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(12_000)
    expect(revive).toHaveBeenCalledTimes(1)
    expect(maxConcurrent).toBe(1)
    watchdog.stop()
  })

  it('uses the documented production cadence when no overrides are given', async () => {
    // Pins the "detected and repaired within about three minutes" contract:
    // 60s interval, 3 strikes.
    const ping = vi.fn().mockRejectedValue(new Error('down'))
    const revive = vi.fn().mockResolvedValue(undefined)
    const watchdog = new ConnectionWatchdog({ bridgeLabel: 'b', ping, revive, log: makeLog() })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(59_999)
    expect(ping).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(ping).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(ping).toHaveBeenCalledTimes(3)
    expect(revive).toHaveBeenCalledTimes(1)
    watchdog.stop()
  })

  it('unrefs its interval so it cannot hold the process open', () => {
    const unref = vi.fn()
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as any)
    try {
      const { watchdog } = makeWatchdog()
      watchdog.start()
      expect(unref).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('does not count a ping lost to an in-flight reconfigure as a strike', async () => {
    // reconfigureBridge() calls drain(), which discards in-flight requests
    // without settling them. The ping we lose says nothing about the health of
    // the replacement connection, so it must not push us toward a teardown.
    let reconfiguring = false
    const ping = vi.fn(() => new Promise((_r, reject) => {
      setTimeout(() => {
        reconfiguring = true
        reject(new Error('drained'))
      }, 50)
    }))
    const { watchdog, revive } = makeWatchdog({ ping, skip: () => reconfiguring, failureThreshold: 1 })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalled()
    expect(revive).not.toHaveBeenCalled()
    watchdog.stop()
  })

  it('calls onHealthy after a successful ping so an interrupted repair can finish', async () => {
    const onHealthy = vi.fn()
    const { watchdog } = makeWatchdog({ onHealthy })
    watchdog.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(onHealthy).toHaveBeenCalledTimes(2)
    watchdog.stop()
  })

  it('runs onHealthy on the first success after a failed revive', async () => {
    // The dangerous sequence: a revive dies partway, destroying every LEAP
    // subscription, and then the bridge starts answering pings again. The ping
    // looks healthy but no events are being delivered, so the platform has to
    // be told to re-subscribe.
    let failing = true
    const ping = vi.fn(() => (failing ? Promise.reject(new Error('down')) : Promise.resolve({})))
    const revive = vi.fn().mockRejectedValue(new Error('bridge still rebooting'))
    const onHealthy = vi.fn()
    const { watchdog } = makeWatchdog({ ping, revive, onHealthy })
    watchdog.start()

    await vi.advanceTimersByTimeAsync(3000)
    expect(revive).toHaveBeenCalledTimes(1)
    expect(onHealthy).not.toHaveBeenCalled()

    failing = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(onHealthy).toHaveBeenCalledTimes(1)
    watchdog.stop()
  })

  it('a failure inside onHealthy does not break the ping loop', async () => {
    const onHealthy = vi.fn().mockRejectedValue(new Error('resubscribe blew up'))
    const { watchdog, ping } = makeWatchdog({ onHealthy })
    watchdog.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(3)
    watchdog.stop()
  })

  it('stop() prevents a revive from starting after shutdown', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('down'))
    const { watchdog, revive } = makeWatchdog({ ping })
    watchdog.start()
    await vi.advanceTimersByTimeAsync(2000)
    watchdog.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(revive).not.toHaveBeenCalled()
  })

  it('start() is idempotent and stop() halts pinging', async () => {
    const { watchdog, ping } = makeWatchdog()
    watchdog.start()
    watchdog.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ping).toHaveBeenCalledTimes(2) // not doubled by the second start()

    watchdog.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(ping).toHaveBeenCalledTimes(2)
  })
})
