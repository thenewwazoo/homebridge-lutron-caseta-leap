export const PLUGIN_NAME = 'homebridge-lutron-caseta-leap'
export const PLATFORM_NAME = 'LutronCasetaLeap'

export interface LutronCasetaLeapPluginConfig {
  preferMatter?: boolean
  enableMatter?: boolean
  [key: string]: any
}

export const DEFAULT_CONFIG: Partial<LutronCasetaLeapPluginConfig> = {
  preferMatter: true,
  enableMatter: true,
}
