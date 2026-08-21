import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

// lutron-leap opens real sockets and starts mDNS discovery on import, so the
// whole module is replaced with the little the platform constructor touches.
vi.mock('lutron-leap', () => ({
  BridgeFinder: class {
    on() {
      return this
    }

    beginSearching() {}
  },
  LeapClient: class {},
  SmartBridge: class {},
  LEAP_PORT: 8081,
  ExceptionDetail: class ExceptionDetail {},
}))

// The routing is what is under test, not the dimmer itself, so the dimmer is a
// double. Its real constructor wants a full HAP accessory.
const initialize = vi.fn(async () => ({ kind: 0, name: 'Hall Diva' }))
vi.mock('./WallDimmer.js', () => ({
  WallDimmer: class {
    initialize = initialize
    static getMatterClusters() {
      return {}
    }
  },
}))

const { LutronCasetaLeap } = await import('./Platform.HAP.js')

process.setMaxListeners(0)

function makePlatform() {
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() }
  const api: any = {
    on: vi.fn(),
    hap: { uuid: { generate: (s: string) => `uuid-${s}` } },
    platformAccessory: class {},
  }
  const platform: any = new LutronCasetaLeap(log, { platform: 'LutronCasetaLeap', secrets: [] } as any, api)
  platform.processAllDevices = vi.fn()
  return { platform, log }
}

function makeDevice(DeviceType: string) {
  return {
    DeviceType,
    FullyQualifiedName: ['Hall', 'Diva'],
    SerialNumber: 12345,
    ModelNumber: 'DVRF-6L-LA',
    LocalZones: [{ href: '/zone/1' }],
  } as any
}

describe('device type routing', () => {
  it('wires a Diva smart dimmer as a dimmer rather than skipping it', async () => {
    const { platform } = makePlatform()

    const result = await platform.wireAccessory({ context: {} } as any, {} as any, makeDevice('DivaSmartDimmer'))

    expect(result).toEqual({ kind: 0, name: 'Hall Diva' })
  })

  it('still skips a device type it has never heard of', async () => {
    const { platform } = makePlatform()

    const result = await platform.wireAccessory({ context: {} } as any, {} as any, makeDevice('SomeFutureThing'))

    expect(result.reason).toContain('not supported by this plugin')
  })

  it('offers every routed dimmer type in the exclusion list', () => {
    // A type the plugin wires but does not offer here cannot be turned off,
    // which is the half of the change that is easy to forget.
    const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'))
    const excludable = schema.schema.properties.options.properties.excludedDeviceTypes.items.enum

    expect(excludable).toContain('DivaSmartDimmer')
  })
})
