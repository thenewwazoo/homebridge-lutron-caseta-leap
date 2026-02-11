import { describe, expect, it } from 'vitest'

import { sanitizeHomeKitName } from './platform.js'

describe('sanitizeHomeKitName', () => {
  it('passes through simple alphanumeric names', () => {
    expect(sanitizeHomeKitName('Living Room')).toBe('Living Room')
  })

  it('preserves hyphens in names', () => {
    expect(sanitizeHomeKitName('Guest-Room Light')).toBe('Guest-Room Light')
  })

  it('preserves periods in names', () => {
    expect(sanitizeHomeKitName('Mr. Smith Office')).toBe('Mr. Smith Office')
  })

  it('preserves parentheses mid-name but strips trailing ones', () => {
    // Trailing non-alphanumeric chars are stripped per HomeKit requirements
    expect(sanitizeHomeKitName('Kitchen (Main)')).toBe('Kitchen (Main')
    expect(sanitizeHomeKitName('(Main) Kitchen')).toBe('Main) Kitchen')
  })

  it('preserves ampersands and single quotes', () => {
    expect(sanitizeHomeKitName("Tom & Jerry's Room")).toBe("Tom & Jerry's Room")
  })

  it('preserves commas, slashes, colons, and exclamation marks', () => {
    expect(sanitizeHomeKitName('Floor 1, Room 2/3: Main!')).toBe('Floor 1, Room 2/3: Main')
  })

  it('preserves unicode letters (accented, CJK, etc.)', () => {
    expect(sanitizeHomeKitName('Café Über')).toBe('Café Über')
  })

  it('strips control characters and newlines', () => {
    expect(sanitizeHomeKitName('Dining\nHeaters')).toBe('Dining Heaters')
    expect(sanitizeHomeKitName('Dining\r\nHeaters')).toBe('Dining Heaters')
    expect(sanitizeHomeKitName('Tab\there')).toBe('Tab here')
  })

  it('collapses multiple spaces into one', () => {
    expect(sanitizeHomeKitName('Living    Room')).toBe('Living Room')
  })

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeHomeKitName('  Living Room  ')).toBe('Living Room')
  })

  it('strips leading non-alphanumeric characters', () => {
    expect(sanitizeHomeKitName('---Living Room')).toBe('Living Room')
    expect(sanitizeHomeKitName('  (Main Light)')).toBe('Main Light')
  })

  it('strips trailing non-alphanumeric characters', () => {
    expect(sanitizeHomeKitName('Living Room---')).toBe('Living Room')
    expect(sanitizeHomeKitName('Living Room...')).toBe('Living Room')
  })

  it('returns fallback for empty string', () => {
    expect(sanitizeHomeKitName('')).toBe('Unknown Device')
  })

  it('returns fallback for whitespace-only string', () => {
    expect(sanitizeHomeKitName('   ')).toBe('Unknown Device')
  })

  it('returns fallback for string of only special characters', () => {
    expect(sanitizeHomeKitName('###')).toBe('Unknown Device')
  })

  it('handles a realistic QSX fully-qualified name', () => {
    expect(sanitizeHomeKitName('First Floor Kitchen Pendant')).toBe('First Floor Kitchen Pendant')
  })

  it('handles names with embedded newlines from engraving text', () => {
    // Engraving text may contain newlines that get joined into names
    expect(sanitizeHomeKitName('Dining\nRoom\nLight')).toBe('Dining Room Light')
  })
})
