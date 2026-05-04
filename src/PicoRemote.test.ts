import { describe, expect, it, vi } from 'vitest'

import { PicoRemote } from './PicoRemote.js'
import type { GlobalOptions } from './Platform.HAP.js'

describe('PicoRemote.getMatterClusters', () => {
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

  it('advertises only single press support when double and long presses are disabled', () => {
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
      expect(part.clusters.switch.multiPressMax).toBe(1)
      expect(part.clusters.switch.longPressTime).toBeUndefined()
    }
  })
})