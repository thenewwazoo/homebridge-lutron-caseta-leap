import type { API } from 'homebridge'

import { LutronCasetaLeap } from './Platform.HAP.js'
import { LutronCasetaLeapMatterPlatform } from './Platform.Matter.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { createPlatformProxy } from './utils.js'

// Register our platform with homebridge.
export default (api: API): void => {
  const ProxyCtor = createPlatformProxy(LutronCasetaLeap, LutronCasetaLeapMatterPlatform)
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ProxyCtor as any)
}
