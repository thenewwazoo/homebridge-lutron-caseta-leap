import type { PlatformConfig } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { createPlatformProxy, normalizeConfig, withTimeout } from './utils.js'

// ---------------------------------------------------------------------------
// normalizeConfig
// ---------------------------------------------------------------------------

describe('normalizeConfig', () => {
  it('returns defaults when called with undefined', () => {
    const cfg = normalizeConfig(undefined)
    expect(cfg.enableMatter).toBe(true)
  })

  it('applies defaults for fields absent in raw config', () => {
    const cfg = normalizeConfig({ platform: 'LutronCasetaLeap' } as PlatformConfig)
    expect(cfg.enableMatter).toBe(true)
  })

  it('respects explicit false values over defaults', () => {
    const cfg = normalizeConfig({
      platform: 'LutronCasetaLeap',
      enableMatter: false,
    } as PlatformConfig)
    expect(cfg.enableMatter).toBe(false)
  })

  it('preserves arbitrary extra fields from raw config', () => {
    const cfg = normalizeConfig({ platform: 'LutronCasetaLeap', secrets: ['x'] } as any)
    expect((cfg as any).secrets).toEqual(['x'])
  })
})

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  it('resolves with the wrapped value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'too slow')).resolves.toBe(42)
  })

  it('propagates the wrapped rejection unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('inner')), 1000, 'too slow')).rejects.toThrow('inner')
  })

  it('rejects with the timeout message when the promise never settles', async () => {
    vi.useFakeTimers()
    try {
      const hung = new Promise(() => { /* never settles */ })
      const bounded = withTimeout(hung, 500, 'too slow')
      const assertion = expect(bounded).rejects.toThrow('too slow')
      await vi.advanceTimersByTimeAsync(500)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the timer as soon as the wrapped promise settles', async () => {
    // Promise.race would leave the 60s timer armed here, holding a handle on
    // the event loop long after the work finished.
    vi.useFakeTimers()
    try {
      await withTimeout(Promise.resolve('done'), 60_000, 'too slow')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a late rejection observed instead of leaking it', async () => {
    // The #236 failure mode: the wrapped promise rejects AFTER the bound has
    // already fired. Promise.race would leave that rejection unhandled, which
    // is fatal to the Homebridge child bridge.
    vi.useFakeTimers()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectLate: (e: Error) => void = () => {}
      const slow = new Promise((_resolve, reject) => {
        rejectLate = reject
      })
      const bounded = withTimeout(slow, 40, 'too slow')
      const assertion = expect(bounded).rejects.toThrow('too slow')
      await vi.advanceTimersByTimeAsync(40)
      await assertion

      rejectLate(new Error('late failure'))
      await vi.advanceTimersByTimeAsync(100)
      // Give the microtask queue a chance to surface an unhandled rejection.
      await Promise.resolve()
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// createPlatformProxy – platform selection
// ---------------------------------------------------------------------------

const baseConfig: PlatformConfig = {
  platform: 'LutronCasetaLeap',
  name: 'Lutron',
  secrets: [],
}

function makeApi(matterAvailable: boolean, matterEnabled: boolean): any {
  return {
    isMatterAvailable: vi.fn(() => matterAvailable),
    isMatterEnabled: vi.fn(() => matterEnabled),
  }
}

describe('createPlatformProxy – platform selection', () => {
  it('uses HAP when Matter is not available', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    void new Proxy({}, baseConfig, makeApi(false, false))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when Matter is available but not enabled (isMatterEnabled returns false)', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    void new Proxy({}, baseConfig, makeApi(true, false))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses Matter when Matter is available and all flags default to true', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    void new Proxy({}, baseConfig, makeApi(true, true))
    expect(Matter).toHaveBeenCalledOnce()
    expect(HAP).not.toHaveBeenCalled()
  })

  it('uses HAP when enableMatter is false even if Matter is available', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    void new Proxy({}, { ...baseConfig, enableMatter: false }, makeApi(true, true))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when api has no isMatterAvailable method', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    void new Proxy({}, baseConfig, {})
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when MatterPlatform is null', () => {
    const HAP = vi.fn()
    const Proxy = createPlatformProxy(HAP, null)
    void new Proxy({}, baseConfig, makeApi(true, true))
    expect(HAP).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// createPlatformProxy – configureAccessory delegation
// ---------------------------------------------------------------------------

describe('createPlatformProxy – configureAccessory delegation', () => {
  it('delegates configureAccessory to the HAP impl', () => {
    const mockConfigureAccessory = vi.fn()
    class MockHAP {
      configureAccessory = mockConfigureAccessory
    }
    const Proxy = createPlatformProxy(MockHAP, null)
    const proxy = new Proxy({}, baseConfig, makeApi(false, false))
    const accessory = { UUID: 'test-uuid' }
    proxy.configureAccessory(accessory)
    expect(mockConfigureAccessory).toHaveBeenCalledWith(accessory)
  })

  it('delegates configureAccessory to the Matter impl', () => {
    const mockConfigureAccessory = vi.fn()
    class MockHAP {}
    class MockMatter {
      configureAccessory = mockConfigureAccessory
    }
    const Proxy = createPlatformProxy(MockHAP, MockMatter)
    const proxy = new Proxy({}, baseConfig, makeApi(true, true))
    const accessory = { UUID: 'matter-uuid' }
    proxy.configureAccessory(accessory)
    expect(mockConfigureAccessory).toHaveBeenCalledWith(accessory)
  })
})
