import type { GlobalOptions } from './Platform.HAP.js'

import { describe, expect, it, vi } from 'vitest'

import { PicoRemote, presetIsProgrammed } from './PicoRemote.js'

describe('presetIsProgrammed', () => {
  it('treats the empty Preset shell as not programmed', () => {
    expect(presetIsProgrammed({ href: '/preset/229', Parent: { href: '/programmingmodel/216' } })).toBe(false)
  })

  it('treats null/undefined/non-object as not programmed', () => {
    expect(presetIsProgrammed(null)).toBe(false)
    expect(presetIsProgrammed(undefined)).toBe(false)
    expect(presetIsProgrammed('preset')).toBe(false)
    expect(presetIsProgrammed(42)).toBe(false)
  })

  it('treats empty assignment arrays as not programmed', () => {
    expect(presetIsProgrammed({ href: '/p/1', Parent: { href: '/pm/1' }, PresetAssignments: [] })).toBe(false)
  })

  it('detects scene-style PresetAssignments (the common dimmer/switch case)', () => {
    expect(presetIsProgrammed({
      href: '/preset/173',
      Parent: { href: '/programmingmodel/164' },
      PresetAssignments: [{ href: '/presetassignment/50' }],
      DimmedLevelAssignments: [{ href: '/dimmedlevelassignment/50' }],
    })).toBe(true)
  })

  it('detects audio-Pico Preset families (PlayPauseToggle, NextTrack, FavoriteCycle)', () => {
    expect(presetIsProgrammed({
      href: '/preset/222',
      Parent: { href: '/programmingmodel/210' },
      PlayPauseToggleAssignments: [{ href: '/playpausetoggleassignment/1' }],
    })).toBe(true)
    expect(presetIsProgrammed({
      href: '/preset/224',
      Parent: { href: '/programmingmodel/212' },
      NextTrackAssignments: [{ href: '/nexttrackassignment/3' }],
    })).toBe(true)
    expect(presetIsProgrammed({
      href: '/preset/223',
      Parent: { href: '/programmingmodel/211' },
      FavoriteCycleAssignments: [{ href: '/favoritecycleassignment/2' }],
    })).toBe(true)
  })

  it('detects unknown future *Assignments families generically', () => {
    expect(presetIsProgrammed({
      href: '/preset/1',
      Parent: { href: '/pm/1' },
      ImaginaryFutureAssignments: [{ href: '/imaginary/1' }],
    })).toBe(true)
  })
})

describe('picoRemote.getMatterClusters', () => {
  function createPlatformAndAccessory(deviceType = 'Pico2Button') {
    const platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    } as any

    const accessory = {
      displayName: 'Test Pico',
      context: {
        device: {
          DeviceType: deviceType,
          FullyQualifiedName: ['Living Room', 'Pico'],
        },
      },
    } as any

    return { platform, accessory }
  }

  function createOptions(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
    return {
      filterPico: false,
      excludedDeviceTypes: [],
      clickSpeedLong: 'default',
      clickSpeedDouble: 'default',
      logSSLKeyDangerous: false,
      logLevel: 'normal',
      buttonPressLogging: 'debug',
      ...overrides,
    }
  }

  it('applies GenericSwitch SwitchServer behavior and uses the modified device type for parts', () => {
    const switchServer = { name: 'SwitchServer' }
    const switchedDeviceType = { name: 'GenericSwitch+SwitchServer' }
    const withSpy = vi.fn(() => switchedDeviceType)

    const genericSwitchDeviceType = {
      with: withSpy,
      requirements: {
        server: {
          mandatory: {
            Switch: switchServer,
          },
        },
      },
    }

    const { platform, accessory } = createPlatformAndAccessory()

    const remote = new PicoRemote(
      platform,
      accessory,
      {} as any,
      createOptions(),
      {
        deviceTypes: {
          GenericSwitch: genericSwitchDeviceType,
        },
      },
    )

    const clusters = remote.getMatterClusters()
    const parts = (clusters as any).parts

    expect(withSpy).toHaveBeenCalledTimes(1)
    expect(withSpy).toHaveBeenCalledWith(switchServer)
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toHaveLength(2)
    expect(parts.map((part: any) => part.deviceType)).toEqual([switchedDeviceType, switchedDeviceType])
  })

  it('uses minimum multiPressMax of 2 (Matter spec) and omits longPressTime when both are disabled', () => {
    const switchServer = { name: 'SwitchServer' }
    const genericSwitchDeviceType = {
      with: vi.fn(() => ({ name: 'GenericSwitch+SwitchServer' })),
      requirements: {
        server: {
          mandatory: {
            Switch: switchServer,
          },
        },
      },
    }

    const { platform, accessory } = createPlatformAndAccessory()
    const remote = new PicoRemote(
      platform,
      accessory,
      {} as any,
      createOptions({
        clickSpeedDouble: 'disabled',
        clickSpeedLong: 'disabled',
      }),
      {
        deviceTypes: {
          GenericSwitch: genericSwitchDeviceType,
        },
      },
    )

    const clusters = remote.getMatterClusters()
    const parts = (clusters as any).parts

    expect(parts).toHaveLength(2)
    for (const part of parts) {
      // Matter spec requires multiPressMax >= 2; always 2 regardless of double-press config
      expect(part.clusters.switch.multiPressMax).toBe(2)
      expect(part.clusters.switch.longPressTime).toBeUndefined()
    }
  })
})
