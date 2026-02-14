import type { PlatformAccessory } from 'homebridge'

import { describe, expect, it } from 'vitest'

import { findOrphanedAccessories } from './platform.js'

function mockAccessory(uuid: string, href: string | undefined, serial: string | number): PlatformAccessory {
  return {
    UUID: uuid,
    displayName: `Device ${serial}`,
    context: href ? { device: { href, SerialNumber: serial } } : {},
  } as unknown as PlatformAccessory
}

describe('findOrphanedAccessories', () => {
  it('returns nothing when all cached accessories match processed UUIDs (Caseta / stable serials)', () => {
    const processedUuids = new Set(['uuid-A', 'uuid-B', 'uuid-C'])
    const hrefToUuid = new Map([
      ['/device/1', 'uuid-A'],
      ['/device/2', 'uuid-B'],
      ['/device/3', 'uuid-C'],
    ])
    const accessories = new Map([
      ['uuid-A', mockAccessory('uuid-A', '/device/1', '11111')],
      ['uuid-B', mockAccessory('uuid-B', '/device/2', '22222')],
      ['uuid-C', mockAccessory('uuid-C', '/device/3', '33333')],
    ])

    expect(findOrphanedAccessories(processedUuids, hrefToUuid, accessories)).toEqual([])
  })

  it('detects orphans when serial changed (href matches but UUID differs)', () => {
    // Device /device/2670 was cached with serial "2670" (uuid-old),
    // but now has serial 53987004 (uuid-new)
    const processedUuids = new Set(['uuid-new'])
    const hrefToUuid = new Map([['/device/2670', 'uuid-new']])
    const accessories = new Map([
      ['uuid-new', mockAccessory('uuid-new', '/device/2670', 53987004)],
      ['uuid-old', mockAccessory('uuid-old', '/device/2670', '2670')],
    ])

    const orphans = findOrphanedAccessories(processedUuids, hrefToUuid, accessories)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].UUID).toBe('uuid-old')
  })

  it('does not remove accessories for offline/removed devices (href not in current set)', () => {
    // uuid-offline is cached but its device didn't appear in discovery
    const processedUuids = new Set(['uuid-A'])
    const hrefToUuid = new Map([['/device/1', 'uuid-A']])
    const accessories = new Map([
      ['uuid-A', mockAccessory('uuid-A', '/device/1', '11111')],
      ['uuid-offline', mockAccessory('uuid-offline', '/device/99', '99999')],
    ])

    expect(findOrphanedAccessories(processedUuids, hrefToUuid, accessories)).toEqual([])
  })

  it('does not remove accessories with no device context', () => {
    const processedUuids = new Set(['uuid-A'])
    const hrefToUuid = new Map([['/device/1', 'uuid-A']])
    const accessories = new Map([
      ['uuid-A', mockAccessory('uuid-A', '/device/1', '11111')],
      ['uuid-no-ctx', mockAccessory('uuid-no-ctx', undefined, 'none')],
    ])

    expect(findOrphanedAccessories(processedUuids, hrefToUuid, accessories)).toEqual([])
  })

  it('handles multiple orphans from multiple devices', () => {
    const processedUuids = new Set(['uuid-new-1', 'uuid-new-2'])
    const hrefToUuid = new Map([
      ['/device/100', 'uuid-new-1'],
      ['/device/200', 'uuid-new-2'],
    ])
    const accessories = new Map([
      ['uuid-new-1', mockAccessory('uuid-new-1', '/device/100', 53987001)],
      ['uuid-new-2', mockAccessory('uuid-new-2', '/device/200', 53987002)],
      ['uuid-old-1', mockAccessory('uuid-old-1', '/device/100', '100')],
      ['uuid-old-2', mockAccessory('uuid-old-2', '/device/200', '200')],
    ])

    const orphans = findOrphanedAccessories(processedUuids, hrefToUuid, accessories)
    expect(orphans).toHaveLength(2)
    expect(orphans.map(o => o.UUID).sort()).toEqual(['uuid-old-1', 'uuid-old-2'])
  })

  it('returns nothing when cache is empty', () => {
    const processedUuids = new Set(['uuid-A'])
    const hrefToUuid = new Map([['/device/1', 'uuid-A']])
    const accessories = new Map<string, PlatformAccessory>()

    expect(findOrphanedAccessories(processedUuids, hrefToUuid, accessories)).toEqual([])
  })
})
