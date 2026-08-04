import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lutron-leap opens real sockets and starts real mDNS discovery on import, so
// the whole module is replaced. The doubles below model only the behaviour the
// platform depends on, including the two library quirks this file exists to
// pin down: reconfigureBridge() sets bridgeReconfigInProgress with no
// try/finally, and it drains the old client (destroying every subscription)
// before it attempts to connect.
const { LeapClientMock, SmartBridgeMock, BridgeFinderMock } = vi.hoisted(() => {
  // Defined inline rather than extending node's EventEmitter: vi.hoisted runs
  // before this module's imports are initialised.
  class TinyEmitter {
    private handlers = new Map<string, Array<(...args: any[]) => void>>()
    on(event: string, cb: (...args: any[]) => void) {
      const list = this.handlers.get(event) ?? []
      list.push(cb)
      this.handlers.set(event, list)
      return this
    }

    removeListener(event: string, cb: (...args: any[]) => void) {
      const list = (this.handlers.get(event) ?? []).filter(h => h !== cb)
      this.handlers.set(event, list)
      return this
    }

    emit(event: string, ...args: any[]) {
      for (const cb of [...(this.handlers.get(event) ?? [])]) {
        cb(...args)
      }
      return true
    }

    setMaxListeners() {
      return this
    }
  }

  class LeapClientMock {
    public static instances: LeapClientMock[] = []
    // Static so a test can change connect behaviour for clients the platform
    // has not built yet. An instance field would be shadowed per instance.
    public static connectImpl: () => Promise<void> = async () => {}
    public closed = false
    constructor(public host: string) {
      LeapClientMock.instances.push(this)
    }

    connect() {
      return LeapClientMock.connectImpl()
    }

    close() {
      this.closed = true
    }
  }

  class SmartBridgeMock extends TinyEmitter {
    public bridgeReconfigInProgress = false
    public pingLooper: any = null
    public reconfigureImpl: () => Promise<void> = async () => {}
    public pingImpl: () => Promise<unknown> = async () => ({})
    public getDeviceInfoImpl: () => Promise<any[]> = async () => []
    public reconfigureCalls = 0
    constructor(public bridgeID: string, public client: any) {
      super()
    }

    async reconfigureBridge(newClient: any) {
      this.reconfigureCalls++
      // Mirrors the library: flag set on entry, old client drained, and only
      // then the connect attempt that may throw.
      this.bridgeReconfigInProgress = true
      this.client = newClient
      await this.reconfigureImpl()
      this.emit('disconnected')
      this.bridgeReconfigInProgress = false
    }

    ping() {
      return this.pingImpl()
    }

    getDeviceInfo() {
      return this.getDeviceInfoImpl()
    }
  }

  class BridgeFinderMock extends TinyEmitter {
    beginSearching() {}
  }

  return { LeapClientMock, SmartBridgeMock, BridgeFinderMock }
})

vi.mock('lutron-leap', () => ({
  BridgeFinder: BridgeFinderMock,
  LeapClient: LeapClientMock,
  SmartBridge: SmartBridgeMock,
  LEAP_PORT: 8081,
  ExceptionDetail: class ExceptionDetail {},
}))

const { LutronCasetaLeap } = await import('./Platform.HAP.js')
const { LutronCasetaLeapMatterPlatform } = await import('./Platform.Matter.js')

function makeLog(): any {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn(), log: vi.fn() }
}

function makeApi(): any {
  return {
    on: vi.fn(),
    hap: { uuid: { generate: (s: string) => `uuid-${s}` } },
    platformAccessory: class {},
  }
}

const SECRET = { bridgeid: 'ABC123', ca: 'ca', key: 'key', cert: 'cert' }

function makePlatform() {
  const log = makeLog()
  const api = makeApi()
  const platform: any = new LutronCasetaLeap(log, { platform: 'LutronCasetaLeap', secrets: [SECRET] } as any, api)
  // Device scanning is exercised separately; stub it out so discovery tests do
  // not depend on the whole wiring pipeline.
  platform.processAllDevices = vi.fn()
  return { platform, log, api }
}

const announce = { bridgeid: 'ABC123', ipAddr: '192.168.1.50', systype: 'SmartBridge' } as any

// Each platform instance registers process-level 'warning' and 'SIGUSR2'
// handlers. Production creates one; this file creates a dozen, which trips
// node's default listener cap and prints a spurious leak warning in CI.
process.setMaxListeners(0)

beforeEach(() => {
  LeapClientMock.instances.length = 0
  LeapClientMock.connectImpl = async () => {}
})

// Restore real timers globally: a test that fails before its own cleanup would
// otherwise leave fake timers installed and hang every test after it.
afterEach(() => {
  vi.useRealTimers()
})

describe('platform bridge discovery and watchdog wiring', () => {
  it('creates exactly one watchdog per bridge across repeated announces', async () => {
    const { platform } = makePlatform()
    await platform.handleBridgeDiscovery(announce)
    const first = platform.watchdogs.get('abc123')
    expect(first).toBeDefined()

    await platform.handleBridgeDiscovery(announce)
    expect(platform.watchdogs.size).toBe(1)
    expect(platform.watchdogs.get('abc123')).toBe(first)
    first.stop()
  })

  it('records a newly announced address even while a reconfigure is in flight', async () => {
    // Regression test. BridgeFinder only emits on an absent-to-present
    // transition, so a dropped announce is usually the only one carrying a new
    // DHCP address. Returning early without recording it left the watchdog
    // rebuilding clients for a dead address forever.
    const { platform } = makePlatform()
    await platform.handleBridgeDiscovery(announce)
    platform.watchdogs.get('abc123').stop()

    platform.bridgeMgr.get('abc123').bridgeReconfigInProgress = true
    await platform.handleBridgeDiscovery({ ...announce, ipAddr: '192.168.1.77' })

    expect(platform.bridgeAddrs.get('abc123')).toBe('192.168.1.77')
  })

  it('a failed reconfigure on the mDNS path clears the flag and does not reject', async () => {
    const { platform, log } = makePlatform()
    await platform.handleBridgeDiscovery(announce)
    platform.watchdogs.get('abc123').stop()

    const bridge = platform.bridgeMgr.get('abc123')
    bridge.reconfigureImpl = async () => {
      throw new Error('bridge unreachable')
    }

    // Must not reject: this runs as an mDNS event handler with no caller, and
    // an escaping rejection is the #236 crash.
    await expect(platform.handleBridgeDiscovery(announce)).resolves.toBeUndefined()
    expect(bridge.bridgeReconfigInProgress).toBe(false)
    expect(platform.bridgesNeedingResubscribe.has('abc123')).toBe(true)
    expect(log.error).toHaveBeenCalled()
  })
})

describe('reviveBridge', () => {
  beforeEach(() => {
    LeapClientMock.instances.length = 0
  })

  async function setup() {
    const ctx = makePlatform()
    await ctx.platform.handleBridgeDiscovery(announce)
    ctx.platform.watchdogs.get('abc123').stop()
    return { ...ctx, bridge: ctx.platform.bridgeMgr.get('abc123') }
  }

  it('rebuilds a client for the last known address and reconfigures the bridge', async () => {
    const { platform, bridge } = await setup()
    platform.bridgeAddrs.set('abc123', '192.168.1.77')

    await platform.reviveBridge('abc123')

    expect(LeapClientMock.instances.at(-1)!.host).toBe('192.168.1.77')
    expect(bridge.reconfigureCalls).toBe(1)
    expect(bridge.bridgeReconfigInProgress).toBe(false)
  })

  it('gives up without touching the live connection when the bridge is unreachable', async () => {
    // The critical property: a repair that cannot connect must NOT call
    // reconfigureBridge, because that would drain the working client's
    // subscriptions and then block every recovery path while it retried.
    const { platform, bridge } = await setup()
    vi.useFakeTimers()
    LeapClientMock.connectImpl = () => new Promise(() => {})

    const attempt = platform.reviveBridge('abc123')
    const assertion = expect(attempt).rejects.toThrow(/cannot reach bridge/)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion

    expect(bridge.reconfigureCalls).toBe(0)
    expect(bridge.bridgeReconfigInProgress).toBe(false)
    expect(LeapClientMock.instances.at(-1)!.closed).toBe(true)
  })

  it('stands down when an mDNS reconfigure starts during the pre-connect window', async () => {
    // Regression test for the final-gate blocker. A bridge recovering from a
    // power cycle starts accepting TLS at the same moment it mDNS-announces,
    // so the announce path can enter reconfigureBridge() while the watchdog's
    // pre-connect is awaiting. Proceeding would run two reconfigures: two
    // 'disconnected' emissions, two subscriptions per button, every press
    // delivered twice, and the press/release tracker reset by Press,Press,
    // which reads as dead Picos, the exact symptom being fixed.
    const { platform, bridge } = await setup()
    LeapClientMock.connectImpl = async () => {
      // Simulates handleBridgeDiscovery entering reconfigureBridge() while
      // the watchdog's pre-connect is in flight.
      bridge.bridgeReconfigInProgress = true
    }

    await platform.reviveBridge('abc123')

    expect(bridge.reconfigureCalls).toBe(0)
    expect(LeapClientMock.instances.at(-1)!.closed).toBe(true)
  })

  it('marks the bridge for re-subscription when the reconfigure itself fails', async () => {
    const { platform, bridge } = await setup()
    bridge.reconfigureImpl = async () => {
      throw new Error('dropped mid-reconfigure')
    }

    await expect(platform.reviveBridge('abc123')).rejects.toThrow('dropped mid-reconfigure')
    // Flag reset by hand because the library leaves it stuck true.
    expect(bridge.bridgeReconfigInProgress).toBe(false)
    expect(platform.bridgesNeedingResubscribe.has('abc123')).toBe(true)
  })

  it('re-subscribes on the next healthy ping after an interrupted repair', async () => {
    const { platform, bridge } = await setup()
    platform.bridgesNeedingResubscribe.add('abc123')
    const onDisconnected = vi.fn()
    bridge.on('disconnected', onDisconnected)

    await platform.resubscribeIfNeeded('abc123')

    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(platform.bridgesNeedingResubscribe.has('abc123')).toBe(false)
  })

  it('does nothing on a healthy ping when no repair is outstanding', async () => {
    const { platform, bridge } = await setup()
    const onDisconnected = vi.fn()
    bridge.on('disconnected', onDisconnected)

    await platform.resubscribeIfNeeded('abc123')

    expect(onDisconnected).not.toHaveBeenCalled()
  })

  it('does not re-subscribe twice when the socket already reconnected on its own', async () => {
    // Regression guard. PicoRemote re-subscribes every button on each
    // 'disconnected', so two emissions leave two subscriptions per button:
    // every press is delivered twice and the press/release state machine
    // desynchronises. A natural reconnect satisfies the outstanding repair.
    const { platform, bridge } = await setup()
    platform.bridgesNeedingResubscribe.add('abc123')

    // The library emits this by itself when a socket closes and reopens.
    bridge.emit('disconnected')
    expect(platform.bridgesNeedingResubscribe.has('abc123')).toBe(false)

    const afterNaturalReconnect = vi.fn()
    bridge.on('disconnected', afterNaturalReconnect)
    await platform.resubscribeIfNeeded('abc123')
    expect(afterNaturalReconnect).not.toHaveBeenCalled()
  })
})

describe('accessory identity across a repair', () => {
  // The #169 / #236 symptom was Picos reappearing as new HomeKit accessories
  // and losing their room assignments and automations. These pin down that a
  // watchdog repair cannot do that.
  const pico = {
    SerialNumber: 12345,
    DeviceType: 'Pico2Button',
    FullyQualifiedName: ['Kitchen', 'Pico'],
    ModelNumber: 'PJ2-2B',
  } as any

  async function setupWithCachedPico() {
    const ctx = makePlatform()
    // Simulate Homebridge restoring the accessory from its cache at startup.
    const cached: any = { UUID: 'uuid-12345', displayName: 'Kitchen Pico', context: {}, services: [] }
    ctx.platform.configureAccessory(cached)
    // Real wiring needs HAP services; assert on registration bookkeeping only.
    ctx.platform.wireAccessory = vi.fn(async () => ({ kind: 0, name: 'Kitchen Pico' }))
    return { ...ctx, cached }
  }

  it('reuses the cached accessory instead of registering a new one', async () => {
    const { platform, api, cached } = await setupWithCachedPico()
    api.registerPlatformAccessories = vi.fn()
    api.unregisterPlatformAccessories = vi.fn()
    const bridge = new SmartBridgeMock('abc123', {})

    // Repeat the wiring the way repeated repairs would.
    await platform.processDevice(bridge, pico)
    await platform.processDevice(bridge, pico)

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled()
    expect(platform.accessories.size).toBe(1)
    expect(platform.accessories.get('uuid-12345')).toBe(cached)
  })

  it('skips already-wired devices on a repair rescan, so initialize never runs twice', async () => {
    const { platform, api } = await setupWithCachedPico()
    api.registerPlatformAccessories = vi.fn()
    const bridge = new SmartBridgeMock('abc123', {})
    bridge.getDeviceInfoImpl = async () => [pico]

    await platform.processDevice(bridge, pico)
    expect(platform.wiredDevices.has('uuid-12345')).toBe(true)

    // A repair calls processAllDevices(); the wired device must be filtered
    // out so its 'disconnected' and 'unsolicited' listeners cannot accumulate.
    // Use the real implementation, not the stub makePlatform() installs.
    platform.processAllDevices = Object.getPrototypeOf(platform).processAllDevices.bind(platform)
    ;(platform.wireAccessory as any).mockClear()
    platform.processAllDevices(bridge)
    await vi.waitFor(() => expect(platform.activeScanBridges.size).toBe(0))

    expect(platform.wireAccessory).not.toHaveBeenCalled()
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled()
  })
})

describe('getDeviceInfoWithRetry', () => {
  it('rejects rather than hanging when getDeviceInfo never settles', async () => {
    // lutron-leap arms its request timeout inside the socket.write callback,
    // so a request against a dead socket can hang forever. Unbounded, that
    // leaves the bridge in activeScanBridges and disables all later scans.
    vi.useFakeTimers()
    const { platform } = makePlatform()
    const bridge = new SmartBridgeMock('abc123', {})
    bridge.getDeviceInfoImpl = () => new Promise(() => {})

    const attempt = platform.getDeviceInfoWithRetry(bridge)
    const assertion = expect(attempt).rejects.toThrow(/timed out/)
    // 4 attempts each bounded at 60s, with 5s/15s/45s waits between them: 305s
    // in total, so advance comfortably past that.
    await vi.advanceTimersByTimeAsync(400_000)
    await assertion
    vi.useRealTimers()
  })
})

describe('matter platform cached-accessory preservation', () => {
  // The Matter override used to unregister cached accessories on Error and on
  // generic Skipped, the exact #207 bug the HAP path fixed. Watchdog repairs
  // rescan during flaky windows, when transient wire errors are most likely,
  // so the purge path must be closed before the watchdog ships.
  const pico = {
    SerialNumber: 12345,
    DeviceType: 'Pico2Button',
    FullyQualifiedName: ['Kitchen', 'Pico'],
    ModelNumber: 'PJ2-2B',
  } as any

  function makeMatterPlatform() {
    const log = makeLog()
    const api = makeApi()
    api.matter = {
      registerPlatformAccessories: vi.fn(),
      unregisterPlatformAccessories: vi.fn(),
      deviceTypes: { BridgedNode: {}, GenericSwitch: {} },
    }
    api.unregisterPlatformAccessories = vi.fn()
    const platform: any = new LutronCasetaLeapMatterPlatform(
      log,
      { platform: 'LutronCasetaLeap', secrets: [SECRET] } as any,
      api,
    )
    // context.device is normally stamped by wireAccessory; the stubbed wire
    // skips that, but getMatterClusters reads it when building Pico parts.
    const cached: any = { UUID: 'uuid-12345', displayName: 'Kitchen Pico', context: { device: pico }, services: [] }
    platform.configureAccessory(cached)
    return { platform, api, cached }
  }

  it('leaves a cached accessory registered when wiring errors during a rescan', async () => {
    const { platform, api } = makeMatterPlatform()
    platform.wireAccessory = vi.fn(async () => ({ kind: 2, reason: 'transient bridge error' }))
    const bridge = new SmartBridgeMock('abc123', {})

    await expect(platform.processDevice(bridge, pico)).resolves.toMatch(/leaving cached matter accessory registered/i)
    expect(api.matter.unregisterPlatformAccessories).not.toHaveBeenCalled()
  })

  it('leaves a cached accessory registered on a transient skip', async () => {
    const { platform, api } = makeMatterPlatform()
    platform.wireAccessory = vi.fn(async () => ({ kind: 1, reason: 'bridge response missing AffectedZones' }))
    const bridge = new SmartBridgeMock('abc123', {})

    await expect(platform.processDevice(bridge, pico)).resolves.toMatch(/leaving cached matter accessory registered/i)
    expect(api.matter.unregisterPlatformAccessories).not.toHaveBeenCalled()
  })

  it('still unregisters a cached accessory for an explicitly excluded device type', async () => {
    const { platform, api } = makeMatterPlatform()
    platform.wireAccessory = vi.fn(async () => ({ kind: 1, reason: 'Device type excluded by config: Pico2Button' }))
    const bridge = new SmartBridgeMock('abc123', {})

    await platform.processDevice(bridge, pico)
    // Deliberate removals purge both registries.
    expect(api.matter.unregisterPlatformAccessories).toHaveBeenCalledTimes(1)
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1)
  })
})

describe('in-flight wiring guard', () => {
  it('does not wire the same device twice while a slow wire is still in flight', async () => {
    // The scan timeout bounds the SCAN, not the wiring: a processDevice that
    // outlives DEVICE_WIRE_TIMEOUT_MS is still running when the next scan
    // starts. Wiring it again would create two PicoRemote instances and
    // deliver every press twice.
    vi.useFakeTimers()
    const { platform } = makePlatform()
    const pico = {
      SerialNumber: 12345,
      DeviceType: 'Pico2Button',
      FullyQualifiedName: ['Kitchen', 'Pico'],
      ModelNumber: 'PJ2-2B',
    } as any
    const bridge = new SmartBridgeMock('abc123', {})
    bridge.getDeviceInfoImpl = async () => [pico]
    platform.processDevice = vi.fn(() => new Promise(() => { /* wiring never finishes */ }))
    platform.processAllDevices = Object.getPrototypeOf(platform).processAllDevices.bind(platform)

    platform.processAllDevices(bridge)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.waitFor(() => expect(platform.activeScanBridges.size).toBe(0))
    expect(platform.processDevice).toHaveBeenCalledTimes(1)

    platform.processAllDevices(bridge)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.waitFor(() => expect(platform.activeScanBridges.size).toBe(0))
    expect(platform.processDevice).toHaveBeenCalledTimes(1)

    // A claim held only by a promise that can never settle (e.g. a request
    // stranded by drain(), whose resolver was dropped) must not exclude the
    // device forever. After the TTL the device becomes retryable again.
    await vi.advanceTimersByTimeAsync(200_000)
    platform.processAllDevices(bridge)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.waitFor(() => expect(platform.activeScanBridges.size).toBe(0))
    expect(platform.processDevice).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
