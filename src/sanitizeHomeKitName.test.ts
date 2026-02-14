import { describe, expect, it } from 'vitest'

import { formatQSXDeviceName, formatQSXKeypadName, sanitizeHomeKitName } from './platform.js'

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

  it('normalizes smart quotes to plain apostrophes', () => {
    expect(sanitizeHomeKitName("Cora\u2019s Room")).toBe("Cora's Room")
    expect(sanitizeHomeKitName("\u2018Hello\u2019")).toBe("Hello")
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

describe('formatQSXKeypadName', () => {
  it('strips numeric area prefix and appends Keypad', () => {
    expect(formatQSXKeypadName(['101 Foyer', 'Entry'])).toBe('Foyer Entry Keypad')
  })

  it('strips alphanumeric area prefix (B00, B03)', () => {
    expect(formatQSXKeypadName(['B00 Landing', 'Bottom of Stairs'])).toBe('Landing Bottom of Stairs Keypad')
    expect(formatQSXKeypadName(['B03 Wine Tasting', 'Entry'])).toBe('Wine Tasting Entry Keypad')
  })

  it('removes consecutive duplicate words', () => {
    expect(formatQSXKeypadName(['104 Kitchen', 'Kitchen Island'])).toBe('Kitchen Island Keypad')
    expect(formatQSXKeypadName(['111 Hallway', 'Hallway'])).toBe('Hallway Keypad')
    expect(formatQSXKeypadName(['902 Master Deck', 'Deck'])).toBe('Master Deck Keypad')
  })

  it('removes duplicate at end of multi-word area name', () => {
    expect(formatQSXKeypadName(['200 Upstairs Hallway', 'Hallway'])).toBe('Upstairs Hallway Keypad')
  })

  it('does not remove non-consecutive duplicates', () => {
    // "Master" appears twice but not consecutively
    expect(formatQSXKeypadName(['113 Master Bedroom', 'Master Exit'])).toBe('Master Bedroom Master Exit Keypad')
  })

  it('handles names without duplicates', () => {
    expect(formatQSXKeypadName(['109 Guest Suite', 'Entry'])).toBe('Guest Suite Entry Keypad')
    expect(formatQSXKeypadName(['116 Master Bath', 'Water Closet'])).toBe('Master Bath Water Closet Keypad')
  })

  it('handles names with smart quotes (Lutron uses Unicode apostrophes)', () => {
    expect(formatQSXKeypadName(['204 Cora\u2019s Room', 'Entry'])).toBe("Cora's Room Entry Keypad")
  })
})

describe('formatQSXDeviceName', () => {
  it('strips prefix and deduplicates without suffix', () => {
    expect(formatQSXDeviceName(['106 Laundry Room', 'Laundry Occupancy'])).toBe('Laundry Room Laundry Occupancy')
  })

  it('strips prefix and deduplicates for garage sensor', () => {
    expect(formatQSXDeviceName(['107 Garage', 'Garage Occupancy Sensor'])).toBe('Garage Occupancy Sensor')
  })

  it('accepts an optional suffix', () => {
    expect(formatQSXDeviceName(['101 Foyer', 'Entry'], 'Keypad')).toBe('Foyer Entry Keypad')
  })
})
