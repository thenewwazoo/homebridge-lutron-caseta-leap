import type { PlatformConfig } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { createPlatformProxy, normalizeConfig } from './utils.js'

// ---------------------------------------------------------------------------
// normalizeConfig
// ---------------------------------------------------------------------------

describe('normalizeConfig', () => {
  it('returns defaults when called with undefined', () => {
    const cfg = normalizeConfig(undefined)
    expect(cfg.preferMatter).toBe(true)
    expect(cfg.enableMatter).toBe(true)
  })

  it('applies defaults for fields absent in raw config', () => {
    const cfg = normalizeConfig({ platform: 'LutronCasetaLeap' } as PlatformConfig)
    expect(cfg.preferMatter).toBe(true)
    expect(cfg.enableMatter).toBe(true)
  })

  it('respects explicit false values over defaults', () => {
    const cfg = normalizeConfig({
      platform: 'LutronCasetaLeap',
      preferMatter: false,
      enableMatter: false,
    } as PlatformConfig)
    expect(cfg.preferMatter).toBe(false)
    expect(cfg.enableMatter).toBe(false)
  })

  it('preserves arbitrary extra fields from raw config', () => {
    const cfg = normalizeConfig({ platform: 'LutronCasetaLeap', secrets: ['x'] } as any)
    expect((cfg as any).secrets).toEqual(['x'])
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
    new Proxy({}, baseConfig, makeApi(false, false))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when Matter is available but not enabled (isMatterEnabled returns false)', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    new Proxy({}, baseConfig, makeApi(true, false))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses Matter when Matter is available and all flags default to true', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    new Proxy({}, baseConfig, makeApi(true, true))
    expect(Matter).toHaveBeenCalledOnce()
    expect(HAP).not.toHaveBeenCalled()
  })

  it('uses HAP when enableMatter is false even if Matter is available', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    new Proxy({}, { ...baseConfig, enableMatter: false }, makeApi(true, true))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when preferMatter is false even if Matter is available', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    new Proxy({}, { ...baseConfig, preferMatter: false }, makeApi(true, true))
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when api has no isMatterAvailable method', () => {
    const HAP = vi.fn()
    const Matter = vi.fn()
    const Proxy = createPlatformProxy(HAP, Matter)
    new Proxy({}, baseConfig, {})
    expect(HAP).toHaveBeenCalledOnce()
    expect(Matter).not.toHaveBeenCalled()
  })

  it('uses HAP when MatterPlatform is null', () => {
    const HAP = vi.fn()
    const Proxy = createPlatformProxy(HAP, null)
    new Proxy({}, baseConfig, makeApi(true, true))
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
