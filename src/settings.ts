import type { PlatformConfig } from 'homebridge'

export const PLUGIN_NAME = 'homebridge-lutron'
export const PLATFORM_NAME = 'LutronCasetaLeap'

export interface LutronCasetaLeapPluginConfig extends PlatformConfig {
  enableMatter?: boolean
}
