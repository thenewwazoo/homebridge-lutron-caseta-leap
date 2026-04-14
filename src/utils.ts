import type { PlatformAccessory, PlatformConfig } from 'homebridge'

import type { LutronCasetaLeapPluginConfig } from './settings.js'

/**
 * Normalises a raw platform config object into a typed plugin config,
 * applying built-in defaults for Matter-related flags.
 */
export function normalizeConfig(raw?: PlatformConfig): LutronCasetaLeapPluginConfig {
  const defaults: Partial<LutronCasetaLeapPluginConfig> = {
    preferMatter: true,
    enableMatter: true,
  }
  if (!raw) {
    return defaults as LutronCasetaLeapPluginConfig
  }
  return { ...defaults, ...(raw as any) } as LutronCasetaLeapPluginConfig
}

/**
 * Creates a proxy class that instantiates the correct platform implementation
 * (HAP or Matter) at runtime based on the Homebridge API capabilities and the
 * user's configuration.  The proxy delegates the `configureAccessory` call
 * required by the `DynamicPlatformPlugin` interface to the chosen
 * implementation so that cached accessories are always tracked correctly.
 *
 * @param HAPPlatform  The standard HAP platform class constructor.
 * @param MatterPlatform  The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: any, MatterPlatform: any): any {
  return class LutronCasetaLeapPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter). */
    private readonly impl: any

    constructor(log: any, config: PlatformConfig, api: any) {
      const cfg = normalizeConfig(config)
      const preferMatter = cfg.preferMatter as boolean
      const enableMatter = cfg.enableMatter as boolean
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (enableMatter && preferMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, cfg, api)
      }
      else {
        // Fallback to HAP
        this.impl = new HAPPlatform(log, cfg, api)
      }
    }

    configureAccessory(accessory: PlatformAccessory): void {
      this.impl.configureAccessory(accessory)
    }
  }
}
