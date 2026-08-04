import type { PlatformAccessory, PlatformConfig } from 'homebridge'

import type { LutronCasetaLeapPluginConfig } from './settings.js'

/**
 * Normalises a raw platform config object into a typed plugin config,
 * applying built-in defaults for Matter-related flags.
 */
export function normalizeConfig(raw?: PlatformConfig): LutronCasetaLeapPluginConfig {
  const defaults: Partial<LutronCasetaLeapPluginConfig> = {
    enableMatter: true,
  }
  if (!raw) {
    return defaults as LutronCasetaLeapPluginConfig
  }
  return { ...defaults, ...(raw as any) } as LutronCasetaLeapPluginConfig
}

/**
 * Bounds a promise with a timeout.
 *
 * Deliberately not `Promise.race` against a bare reject-after-setTimeout
 * promise, for two reasons this codebase has been bitten by:
 *
 *  - The timer is cleared as soon as the wrapped promise settles. Racing
 *    leaves the timer armed for its full duration, so a fast call still pins
 *    a handle on the event loop, and a 60s bound would keep the process
 *    alive for 60s after the work finished.
 *  - A rejection handler is attached to the wrapped promise unconditionally,
 *    so a slow rejection arriving after the timeout has already fired stays
 *    observed. Racing leaves that late rejection unhandled, which is the
 *    pattern in lutron-leap's ping loop that crashed child bridges (#236).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Creates a proxy class that instantiates the correct platform implementation
 * (HAP or Matter) at runtime based on the Homebridge API capabilities and the
 * user's configuration.  The proxy delegates the `configureAccessory` call
 * required by the `DynamicPlatformPlugin` interface to the chosen
 * implementation so that cached accessories are always tracked correctly.
 *
 * @param HAPPlatform The standard HAP platform class constructor.
 * @param MatterPlatform The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: any, MatterPlatform: any): any {
  return class LutronCasetaLeapPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter). */
    private readonly impl: any

    constructor(log: any, config: PlatformConfig, api: any) {
      const cfg = normalizeConfig(config)
      const enableMatter = cfg.enableMatter as boolean
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (enableMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, cfg, api)
      } else {
        // Fallback to HAP
        this.impl = new HAPPlatform(log, cfg, api)
      }
    }

    configureAccessory(accessory: PlatformAccessory): void {
      this.impl.configureAccessory(accessory)
    }
  }
}
