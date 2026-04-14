import type { PlatformConfig } from 'homebridge'

import type { LutronCasetaLeapPluginConfig } from './settings.js'

/**
 * Normalises a raw platform config object into a typed plugin config.
 */
export function normalizeConfig(raw?: PlatformConfig): LutronCasetaLeapPluginConfig {
  if (!raw) {
    return {}
  }
  return { ...(raw as any) } as LutronCasetaLeapPluginConfig
}

/**
 * Creates a proxy class that instantiates the correct platform implementation
 * (HAP or Matter) at runtime based on the Homebridge API capabilities and the
 * user's configuration.
 *
 * @param HAPPlatform  The standard HAP platform class constructor.
 * @param MatterPlatform  The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: any, MatterPlatform: any): any {
  return class LutronCasetaLeapPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter). */
    private impl: any

    constructor(log: any, config: PlatformConfig, api: any) {
      const cfg = normalizeConfig(config)
      const preferMatter = cfg.preferMatter ?? true
      const enableMatter = cfg.enableMatter ?? true
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (enableMatter && preferMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, cfg, api)
        return this.impl
      }

      // Fallback to HAP
      this.impl = new HAPPlatform(log, cfg, api)
      return this.impl
    }
  }
}
