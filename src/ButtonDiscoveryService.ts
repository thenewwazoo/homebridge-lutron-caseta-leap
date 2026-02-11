import type { API, Logging } from 'homebridge'

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface DiscoveredButton {
  href: string
  ButtonNumber: number
  Name: string
  Engraving?: { Text: string }
  Parent: { href: string }
  deviceHref: string
  discoveredAt: number
  source: 'probe' | 'press'
}

interface DiscoveredButtonsData {
  version: 1
  buttons: DiscoveredButton[]
}

const DATA_FILE_NAME = 'lutron-discovered-buttons.json'
const SAVE_DEBOUNCE_MS = 2000

export class ButtonDiscoveryService {
  private filePath: string
  private data: DiscoveredButtonsData
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave = false

  constructor(
    api: API,
    private log: Logging,
  ) {
    this.filePath = path.join(api.user.storagePath(), DATA_FILE_NAME)
    this.data = this.load()
  }

  private load(): DiscoveredButtonsData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as DiscoveredButtonsData
        if (parsed.version === 1 && Array.isArray(parsed.buttons)) {
          this.log.info(`[ButtonDiscovery] Loaded ${parsed.buttons.length} persisted buttons from ${this.filePath}`)
          return parsed
        }
        this.log.warn(`[ButtonDiscovery] Invalid data format, starting fresh`)
      }
    } catch (e) {
      this.log.warn(`[ButtonDiscovery] Failed to load persisted buttons: ${e}`)
    }
    return { version: 1, buttons: [] }
  }

  private saveImmediate(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
      this.log.debug?.(`[ButtonDiscovery] Saved ${this.data.buttons.length} buttons to ${this.filePath}`)
    } catch (e) {
      this.log.error(`[ButtonDiscovery] Failed to save buttons: ${e}`)
    }
    this.pendingSave = false
  }

  private save(): void {
    // Debounce saves to avoid excessive disk writes during startup
    this.pendingSave = true
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveImmediate()
      this.saveDebounceTimer = null
    }, SAVE_DEBOUNCE_MS)
  }

  public addButton(button: DiscoveredButton): boolean {
    // Check if button already exists
    const existingIndex = this.data.buttons.findIndex(b => b.href === button.href)
    if (existingIndex >= 0) {
      // Update if this is a probe discovering a previously press-discovered button
      const existing = this.data.buttons[existingIndex]
      if (existing.source === 'press' && button.source === 'probe') {
        this.data.buttons[existingIndex] = button
        this.save()
        this.log.debug?.(`[ButtonDiscovery] Updated ${button.href} (was press-discovered, now probed)`)
        return false
      }
      return false // Already exists
    }

    this.data.buttons.push(button)
    this.save()
    this.log.info(`[ButtonDiscovery] Added new button: ${button.Name || button.href} (${button.source})`)
    return true
  }

  public getButtonsForDevice(deviceHref: string): DiscoveredButton[] {
    return this.data.buttons.filter(b => b.deviceHref === deviceHref)
  }

  public getAllButtons(): DiscoveredButton[] {
    return [...this.data.buttons]
  }

  public clear(): void {
    const count = this.data.buttons.length
    this.data = { version: 1, buttons: [] }
    this.saveImmediate()
    this.log.warn(`[ButtonDiscovery] Cleared ${count} persisted buttons`)
  }

  public getStats(): { total: number, byDevice: Record<string, number>, bySource: Record<string, number> } {
    const byDevice: Record<string, number> = {}
    const bySource: Record<string, number> = { probe: 0, press: 0 }

    for (const button of this.data.buttons) {
      byDevice[button.deviceHref] = (byDevice[button.deviceHref] || 0) + 1
      bySource[button.source] = (bySource[button.source] || 0) + 1
    }

    return {
      total: this.data.buttons.length,
      byDevice,
      bySource,
    }
  }

  public flush(): void {
    if (this.pendingSave) {
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer)
        this.saveDebounceTimer = null
      }
      this.saveImmediate()
    }
  }
}
