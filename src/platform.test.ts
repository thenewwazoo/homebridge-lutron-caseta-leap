import { describe, expect, it, vi } from 'vitest'
import type { API, Logging, PlatformConfig } from 'homebridge'
import { LutronCasetaLeap } from './platform.js'

// Mock the homebridge API and logger
const mockLog: Logging = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
} as any

const mockAPI: API = {
  hap: {} as any,
  on: vi.fn(),
} as any

describe('LutronCasetaLeap Platform', () => {
  it('should log clear error messages when secrets are missing', () => {
    const config: PlatformConfig = {
      platform: 'LutronCasetaLeap',
      name: 'TestLutron',
      // No secrets array
    }

    new LutronCasetaLeap(mockLog, config, mockAPI)

    expect(mockLog.error).toHaveBeenCalledWith(
      'No bridge authentication configured. Please use the plugin configuration UI to associate with your Lutron Smart Bridge.'
    )
    expect(mockLog.error).toHaveBeenCalledWith(
      'Without bridge credentials, this plugin cannot discover or control any Lutron devices.'
    )
    expect(mockLog.error).toHaveBeenCalledWith(
      'Visit the Homebridge UI and configure this plugin to pair with your bridge.'
    )
  })

  it('should log clear error messages when secrets array is empty', () => {
    const config: PlatformConfig = {
      platform: 'LutronCasetaLeap',
      name: 'TestLutron',
      secrets: [], // Empty secrets array
    }

    new LutronCasetaLeap(mockLog, config, mockAPI)

    expect(mockLog.error).toHaveBeenCalledWith(
      'No bridge authentication configured. Please use the plugin configuration UI to associate with your Lutron Smart Bridge.'
    )
  })

  it('should handle incomplete bridge authentication entries', () => {
    const config: PlatformConfig = {
      platform: 'LutronCasetaLeap',
      name: 'TestLutron',
      secrets: [
        {
          bridgeid: 'test123',
          ca: 'test-ca',
          // Missing key and cert
        },
      ],
    }

    new LutronCasetaLeap(mockLog, config, mockAPI)

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Incomplete bridge authentication entry found - missing required fields. Bridge ID: test123'
    )
  })

  it('should handle valid configuration without errors', () => {
    vi.clearAllMocks()
    const config: PlatformConfig = {
      platform: 'LutronCasetaLeap',
      name: 'TestLutron',
      secrets: [
        {
          bridgeid: 'test123',
          ca: 'test-ca',
          key: 'test-key',
          cert: 'test-cert',
        },
      ],
    }

    new LutronCasetaLeap(mockLog, config, mockAPI)

    expect(mockLog.error).not.toHaveBeenCalled()
    expect(mockLog.debug).toHaveBeenCalledWith('Loaded authentication for bridge: test123')
  })
})