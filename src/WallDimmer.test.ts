import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WallDimmer } from './WallDimmer.js'

/**
 * ⚠️ The case these specs exist for is a HomeKit automation that says "turn on
 * at 20%". HomeKit sends that as two writes, On and Brightness, and
 * HAP-NodeJS starts both set handlers without waiting for the first
 * (`Accessory.handleSetCharacteristics` fires them in a loop and collects the
 * promises afterwards). Both map onto one LEAP `GoToLevel`, so they used to
 * race and the light was left at whichever level reached the bridge last -
 * reported on homebridge-lutron#270 as a Diva stuck at 100%.
 *
 * The specs therefore drive the two handlers the way HAP-NodeJS does: start
 * both, then await, rather than awaiting one before starting the other.
 */
describe('wallDimmer level writes', () => {
  const ON = 'On'
  const BRIGHTNESS = 'Brightness'

  let request: ReturnType<typeof vi.fn>
  let handlers: Map<string, any>
  let values: Map<string, any>

  function build() {
    values = new Map<string, any>()
    handlers = new Map<string, any>()

    const lightbulb: any = {
      setCharacteristic: vi.fn(() => lightbulb),
      updateCharacteristic: vi.fn((c: string, v: any) => {
        values.set(c, v)
        return lightbulb
      }),
      getCharacteristic: vi.fn((c: string) => ({
        get value() {
          return values.get(c)
        },
        on(event: string, fn: any) {
          handlers.set(`${c}:${event}`, fn)
          return this
        },
      })),
    }

    const info: any = { setCharacteristic: vi.fn(() => info) }

    const platform: any = {
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
      api: {
        hap: {
          Service: { AccessoryInformation: 'AccessoryInformation', Lightbulb: 'Lightbulb' },
          Characteristic: {
            Manufacturer: 'Manufacturer',
            Model: 'Model',
            Name: 'Name',
            ConfiguredName: 'ConfiguredName',
            SerialNumber: 'SerialNumber',
            On: ON,
            Brightness: BRIGHTNESS,
          },
        },
      },
    }

    const device = {
      DeviceType: 'DivaSmartDimmer',
      ModelNumber: 'DVRF-6L-LA',
      SerialNumber: 1234,
      FullyQualifiedName: ['Hall', 'Diva'],
      LocalZones: [{ href: '/zone/1' }],
    }

    const accessory: any = {
      context: { device },
      getService: vi.fn((s: string) => (s === 'AccessoryInformation' ? info : lightbulb)),
      addService: vi.fn(() => lightbulb),
    }

    request = vi.fn(async () => ({}))
    const bridge: any = { client: { request } }

    return new WallDimmer(platform, accessory, bridge, device as any)
  }

  /** Every level the bridge was asked to go to, in the order it was asked. */
  function levelsSent(): number[] {
    return request.mock.calls.map(call => call[2].Command.Parameter[0].Value)
  }

  function write(characteristic: string, value: any): Promise<any> {
    return new Promise(resolve => handlers.get(`${characteristic}:set`)(value, resolve))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    build()
  })

  it('turns on at the brightness the automation asked for, not full brightness', async () => {
    // The light is off, so its Brightness characteristic reads 0 - which is
    // exactly what used to send On down the "fall back to 100" path
    values.set(BRIGHTNESS, 0)

    const brightnessWrite = write(BRIGHTNESS, 20)
    const onWrite = write(ON, true)
    await vi.advanceTimersByTimeAsync(60)
    await Promise.all([brightnessWrite, onWrite])

    expect(levelsSent()).toEqual([20])
  })

  it('does not care which of the two writes arrives first', async () => {
    values.set(BRIGHTNESS, 0)

    const onWrite = write(ON, true)
    const brightnessWrite = write(BRIGHTNESS, 20)
    await vi.advanceTimersByTimeAsync(60)
    await Promise.all([onWrite, brightnessWrite])

    expect(levelsSent()).toEqual([20])
  })

  it('still restores the last level when only On is written', async () => {
    values.set(BRIGHTNESS, 40)

    const onWrite = write(ON, true)
    await vi.advanceTimersByTimeAsync(60)
    await onWrite

    expect(levelsSent()).toEqual([40])
  })

  it('falls back to full brightness when nothing better is known', async () => {
    values.set(BRIGHTNESS, 0)

    const onWrite = write(ON, true)
    await vi.advanceTimersByTimeAsync(60)
    await onWrite

    expect(levelsSent()).toEqual([100])
  })

  it('turns off with a single zero, whatever the brightness says', async () => {
    values.set(BRIGHTNESS, 60)

    const offWrite = write(ON, false)
    await vi.advanceTimersByTimeAsync(60)
    await offWrite

    expect(levelsSent()).toEqual([0])
  })

  it('reports a failed command back to HomeKit', async () => {
    request.mockRejectedValueOnce(new Error('bridge is away'))

    const onWrite = write(ON, true)
    await vi.advanceTimersByTimeAsync(60)

    expect(await onWrite).toBeInstanceOf(Error)
  })
})
