import type { Logging } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ButtonTracker } from './ButtonState.js'

// Create a mock logger that captures log calls
function createMockLogger(): Logging & { infoCalls: string[], debugCalls: string[] } {
  const infoCalls: string[] = []
  const debugCalls: string[] = []

  return {
    info: vi.fn((msg: string) => { infoCalls.push(msg) }),
    debug: vi.fn((msg: string) => { debugCalls.push(msg) }),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
    infoCalls,
    debugCalls,
    prefix: 'test',
  } as unknown as Logging & { infoCalls: string[], debugCalls: string[] }
}

describe('buttonTracker', () => {
  let mockLogger: Logging & { infoCalls: string[], debugCalls: string[] }
  let shortPressCB: ReturnType<typeof vi.fn>
  let doublePressCB: ReturnType<typeof vi.fn>
  let longPressCB: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockLogger = createMockLogger()
    shortPressCB = vi.fn()
    doublePressCB = vi.fn()
    longPressCB = vi.fn()
    vi.useFakeTimers()
  })

  describe('engravingText in log messages', () => {
    it('includes engraving text in short press log when provided', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/1234',
        'default',
        'default',
        false,
        'Goodnight',
      )

      // Simulate QSX Release (short press)
      tracker.update('Release')

      // Wait for timeout to fire short press
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalled()
      expect(mockLogger.infoCalls.some(msg =>
        msg.includes('/button/1234') && msg.includes('("Goodnight")') && msg.includes('short press'),
      )).toBe(true)
    })

    it('does not include engraving when not provided', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/5678',
        'default',
        'default',
        false,
        // No engraving text
      )

      // Simulate QSX Release (short press)
      tracker.update('Release')

      // Wait for timeout
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalled()
      const shortPressLog = mockLogger.infoCalls.find(msg => msg.includes('short press'))
      expect(shortPressLog).toBeDefined()
      expect(shortPressLog).toContain('button /button/5678')
      expect(shortPressLog).not.toContain('("')
    })

    it('includes engraving text in long press log', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/9999',
        'default',
        'default',
        false,
        'All Lights',
      )

      // Simulate QSX LongHold
      tracker.update('LongHold')

      expect(longPressCB).toHaveBeenCalled()
      expect(mockLogger.infoCalls.some(msg =>
        msg.includes('/button/9999') && msg.includes('("All Lights")') && msg.includes('long press'),
      )).toBe(true)
    })

    it('includes engraving text in double press log', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/7777',
        'default',
        'default',
        false,
        'Scene 1',
      )

      // Simulate QSX MultiTap (double press)
      tracker.update('MultiTap')

      expect(doublePressCB).toHaveBeenCalled()
      expect(mockLogger.infoCalls.some(msg =>
        msg.includes('/button/7777') && msg.includes('("Scene 1")') && msg.includes('double press'),
      )).toBe(true)
    })

    it('handles special characters in engraving text', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/1111',
        'default',
        'default',
        false,
        'Living Room "Main"',
      )

      tracker.update('Release')
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalled()
      expect(mockLogger.infoCalls.some(msg =>
        msg.includes('("Living Room "Main"")'),
      )).toBe(true)
    })

    it('handles empty string engraving as no engraving', () => {
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/2222',
        'default',
        'default',
        false,
        '', // Empty string
      )

      tracker.update('Release')
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalled()
      // Empty string is falsy, so should not include parentheses
      const shortPressLog = mockLogger.infoCalls.find(msg => msg.includes('short press'))
      expect(shortPressLog).toContain('button /button/2222')
      expect(shortPressLog).not.toContain('("")')
    })
  })

  describe('backwards compatibility', () => {
    it('works without engravingText parameter', () => {
      // This tests that the parameter is optional and defaults correctly
      const tracker = new ButtonTracker(
        shortPressCB,
        doublePressCB,
        longPressCB,
        mockLogger,
        '/button/3333',
        'default',
        'default',
        false,
      )

      tracker.update('Release')
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalled()
    })
  })

  describe('caseta state machine (Press/Release)', () => {
    it('Press → Release → timeout = single press', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/100', 'default', 'default', false,
      )

      tracker.update('Press')
      tracker.update('Release')

      expect(shortPressCB).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalledOnce()
      expect(doublePressCB).not.toHaveBeenCalled()
      expect(longPressCB).not.toHaveBeenCalled()
    })

    it('Press → Release → Press = double press', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/101', 'default', 'default', false,
      )

      tracker.update('Press')
      tracker.update('Release')
      tracker.update('Press') // second press before timeout

      expect(doublePressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()
      expect(longPressCB).not.toHaveBeenCalled()
    })

    it('Press → long timeout = long press', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/102', 'default', 'default', false,
      )

      tracker.update('Press')

      expect(longPressCB).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2000)

      expect(longPressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()
      expect(doublePressCB).not.toHaveBeenCalled()
    })

    it('does not fire pressOnlyTimer when isPressOnlyButton is false', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/103', 'default', 'disabled', false, undefined, false,
      )

      tracker.update('Press')
      // Advance past double press timeout but not long press timeout
      vi.advanceTimersByTime(500)

      // Should NOT have fired short press — no pressOnlyTimer for normal buttons
      expect(shortPressCB).not.toHaveBeenCalled()
    })
  })

  describe('press-only (shades) buttons', () => {
    it('Press with no Release fires single press when isPressOnlyButton is true', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/200', 'default', 'disabled', false, undefined, true,
      )

      tracker.update('Press')

      expect(shortPressCB).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalledOnce()
    })

    it('Press → Release cancels pressOnlyTimer (no duplicate)', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/201', 'default', 'disabled', false, undefined, true,
      )

      tracker.update('Press')
      tracker.update('Release')

      // Advance past both timeouts
      vi.advanceTimersByTime(1000)

      // Should fire exactly once from the Release path, not twice
      expect(shortPressCB).toHaveBeenCalledOnce()
    })
  })

  describe('qsx event types', () => {
    it('LongHold from IDLE fires long press', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/300', 'default', 'default', false,
      )

      tracker.update('LongHold')

      expect(longPressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()
      expect(doublePressCB).not.toHaveBeenCalled()
    })

    it('MultiTap from IDLE fires double press', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/301', 'default', 'default', false,
      )

      tracker.update('MultiTap')

      expect(doublePressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()
      expect(longPressCB).not.toHaveBeenCalled()
    })

    it('Release from IDLE → timeout = single press (QSX short press)', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/302', 'default', 'default', false,
      )

      tracker.update('Release')

      expect(shortPressCB).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)

      expect(shortPressCB).toHaveBeenCalledOnce()
    })

    it('Release → MultiTap = double press (cancels pending single)', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/303', 'default', 'default', false,
      )

      tracker.update('Release')
      tracker.update('MultiTap')

      expect(doublePressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()

      // Advance past timeout — should not fire short press
      vi.advanceTimersByTime(1000)
      expect(shortPressCB).not.toHaveBeenCalled()
    })

    it('Press → LongHold from DOWN fires long press and cancels timers', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/304', 'default', 'default', false,
      )

      tracker.update('Press')
      tracker.update('LongHold')

      expect(longPressCB).toHaveBeenCalledOnce()
      expect(shortPressCB).not.toHaveBeenCalled()

      // Advance past all timeouts — nothing else should fire
      vi.advanceTimersByTime(5000)
      expect(shortPressCB).not.toHaveBeenCalled()
      expect(longPressCB).toHaveBeenCalledOnce()
    })

    it('LongHold with long press disabled suppresses event', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/305', 'default', 'disabled', false,
      )

      tracker.update('LongHold')

      expect(longPressCB).not.toHaveBeenCalled()
      expect(shortPressCB).not.toHaveBeenCalled()
    })

    it('MultiTap with double press disabled suppresses event', () => {
      const tracker = new ButtonTracker(
        shortPressCB, doublePressCB, longPressCB, mockLogger,
        '/button/306', 'disabled', 'default', false,
      )

      tracker.update('MultiTap')

      expect(doublePressCB).not.toHaveBeenCalled()
      expect(shortPressCB).not.toHaveBeenCalled()
    })
  })
})
