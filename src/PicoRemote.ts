import type { Characteristic, PlatformAccessory, Service } from 'homebridge'
import type { ButtonDefinition, OneButtonStatusEvent, Response, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, GlobalOptions, LutronCasetaLeap } from './Platform.HAP.js'

import { inspect } from 'node:util'

import { ExceptionDetail } from 'lutron-leap'

import { ButtonTracker } from './ButtonState.js'
import { logButtonPress } from './Logger.js'
import { DeviceWireResultType } from './Platform.HAP.js'

// This maps DeviceType and ButtonNumber to human-readable labels and
// ServiceLabelIndex values. n.b. the labels are not shown in Apple's Home app,
// but are shown in other apps. The index value determines the order that
// buttons are shown in the Home app. They're ordered top-to-bottom (as they
// appear on the physical remote) in this map.
//
// [
//     $DeviceType,
//     new Map([
//         [$ButtonNumber, { label: '...', index: ... }],
//         ...
//     ]),
// ]
const BUTTON_MAP = new Map<string, Map<number, { label: string, index: number, isUpDown: boolean }>>([
  [
    'Pico2Button',
    new Map([
      [0, { label: 'On', index: 1, isUpDown: false }],
      [2, { label: 'Off', index: 2, isUpDown: false }],
    ]),
  ],
  [
    'Pico2ButtonRaiseLower',
    new Map([
      [0, { label: 'On', index: 1, isUpDown: false }],
      [2, { label: 'Off', index: 4, isUpDown: false }],
      [3, { label: 'Raise', index: 2, isUpDown: true }],
      [4, { label: 'Lower', index: 3, isUpDown: true }],
    ]),
  ],
  [
    'Pico3Button',
    new Map([
      [0, { label: 'On', index: 1, isUpDown: false }],
      [1, { label: 'Center', index: 2, isUpDown: false }],
      [2, { label: 'Off', index: 3, isUpDown: false }],
    ]),
  ],
  [
    'Pico3ButtonRaiseLower',
    new Map([
      [0, { label: 'On', index: 1, isUpDown: false }],
      [1, { label: 'Center', index: 3, isUpDown: false }],
      [2, { label: 'Off', index: 5, isUpDown: false }],
      [3, { label: 'Raise', index: 2, isUpDown: true }],
      [4, { label: 'Lower', index: 4, isUpDown: true }],
    ]),
  ],
  [
    'Pico4Button2Group',
    new Map([
      [1, { label: 'Group 1 On', index: 1, isUpDown: false }],
      [2, { label: 'Group 1 Off', index: 2, isUpDown: false }],
      [3, { label: 'Group 2 On', index: 3, isUpDown: false }],
      [4, { label: 'Group 2 Off', index: 4, isUpDown: false }],
    ]),
  ],
  [
    'Pico4ButtonScene',
    new Map([
      [1, { label: 'Button 1', index: 1, isUpDown: false }],
      [2, { label: 'Button 2', index: 2, isUpDown: false }],
      [3, { label: 'Button 3', index: 3, isUpDown: false }],
      [4, { label: 'Button 4', index: 4, isUpDown: false }],
    ]),
  ],
  [
    'Pico4ButtonZone',
    new Map([
      [1, { label: 'Button 1', index: 1, isUpDown: false }],
      [2, { label: 'Button 2', index: 2, isUpDown: false }],
      [3, { label: 'Button 3', index: 3, isUpDown: false }],
      [4, { label: 'Button 4', index: 4, isUpDown: false }],
    ]),
  ],
  [
    'PaddleSwitchPico',
    new Map([
      [0, { label: 'On', index: 1, isUpDown: false }],
      [2, { label: 'Off', index: 2, isUpDown: false }],
    ]),
  ],
  [
    'Pico4Button',
    new Map([
      [1, { label: 'Button 1', index: 1, isUpDown: false }],
      [2, { label: 'Button 2', index: 2, isUpDown: false }],
      [3, { label: 'Button 3', index: 3, isUpDown: false }],
      [4, { label: 'Button 4', index: 4, isUpDown: false }],
    ]),
  ],
])

export class PicoRemote {
  private services: Map<string, Service> = new Map()
  private trackers: Map<string, ButtonTracker> = new Map()
  // Map button href to ButtonNumber for event lookup
  private hrefToButtonNumber: Map<string, number> = new Map()
  // Resolved alias per button href so event handling does not depend solely on ButtonNumber.
  private hrefToAlias: Map<string, { label: string, index: number, isUpDown: boolean }> = new Map()
  // Buttons collected during initialize() so a single 'disconnected' handler
  // can re-subscribe all of them (LeapClient._empty() drops subscriptions on
  // socket close — unlike pylutron-caseta, which preserves them).
  private buttons: ButtonDefinition[] = []

  private matterApi?: any
  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
    private readonly options: GlobalOptions,
    matterApi?: any,
  ) {
    this.matterApi = matterApi
  }

  private normalizeButtonName(name: string | undefined): string {
    return (name || '').toLowerCase().replace(/\s+/g, ' ').trim()
  }

  private aliasFromButtonName(
    dentry: Map<number, { label: string, index: number, isUpDown: boolean }>,
    buttonName: string | undefined,
  ): { label: string, index: number, isUpDown: boolean } | undefined {
    const normalizedName = this.normalizeButtonName(buttonName)
    if (normalizedName.length === 0) {
      return undefined
    }

    const directMatch = Array.from(dentry.values()).find(v => this.normalizeButtonName(v.label) === normalizedName)
    if (directMatch) {
      return directMatch
    }

    // Common Lutron naming variant for center button.
    if (normalizedName === 'favorite') {
      return Array.from(dentry.values()).find(v => this.normalizeButtonName(v.label) === 'center')
    }

    return undefined
  }

  private resolveAlias(
    dentry: Map<number, { label: string, index: number, isUpDown: boolean }>,
    button: ButtonDefinition,
  ): { label: string, index: number, isUpDown: boolean } | undefined {
    const byNumber = dentry.get(button.ButtonNumber)
    if (byNumber) {
      return byNumber
    }

    return this.aliasFromButtonName(dentry, button.Name)
  }

  public async initialize(): Promise<DeviceWireResult> {
    const fullName = this.accessory.context.device.FullyQualifiedName.join(' ')

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'Lutron Electronics Co., Inc')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.accessory.context.device.ModelNumber)
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, fullName)
      .setCharacteristic(this.platform.api.hap.Characteristic.ConfiguredName, fullName)
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.SerialNumber.toString(),
      )

    const label_svc
      = this.accessory.getService(this.platform.api.hap.Service.ServiceLabel)
        || this.accessory.addService(this.platform.api.hap.Service.ServiceLabel)
    label_svc.setCharacteristic(
      this.platform.api.hap.Characteristic.ServiceLabelNamespace,
      this.platform.api.hap.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS, // ha ha
    )

    let bgs
    try {
      bgs = await this.bridge.getButtonGroupsFromDevice(this.accessory.context.device)
    } catch (e) {
      this.platform.log.error('Failed to get button group(s) belonging to', fullName, e)
      return {
        kind: DeviceWireResultType.Error,
        reason: `Failed to get button group(s) belonging to ${fullName}: ${e}`,
      }
    }

    // Bail out if the bridge returned an ExceptionDetail for any button group
    // (typically when the device is mid-removal in the Lutron app). The previous
    // code used forEach with `return new Error(...)` — both the return and the
    // constructed-but-not-thrown Error were no-ops, so ExceptionDetail objects
    // flowed into getButtonsFromGroup() below and surfaced as opaque errors.
    // Returning Error here (not Skipped) means the cached accessory is preserved
    // by the platform.ts cache-preservation rule until the user removes it.
    for (const bg of bgs) {
      if (bg instanceof ExceptionDetail) {
        return {
          kind: DeviceWireResultType.Error,
          reason: `Bridge returned ExceptionDetail for button group on ${fullName}: ${bg.Message}`,
        }
      }
    }

    let buttons: ButtonDefinition[] = []
    for (const bg of bgs) {
      try {
        buttons = buttons.concat(await this.bridge.getButtonsFromGroup(bg))
      } catch (e) {
        this.platform.log.error('Failed to get buttons from button group', bg.href)
        return {
          kind: DeviceWireResultType.Error,
          reason: `Failed to get buttons from button group ${bg.href}: ${e}`,
        }
      }
    }

    // If we've been told to skip Picos already associated in the Lutron app,
    // do a two-stage check.
    //
    // Stage 1 (cheap): any button group with non-empty AffectedZones is
    // wired to a light/dimmer/switch/scene in the Lutron app.
    //
    // The previous check `AffectedZones !== undefined` was always true on
    // the wire even for empty arrays, so it skipped audio Picos, fan Picos,
    // and scene-only Picos that carry an empty AffectedZones field but
    // still have real programming. The opposite of the desired behaviour.
    //
    // Stage 2 (deep): for Picos with no zone wiring, every button reports
    // ProgrammingModelType: 'SingleActionProgrammingModel' regardless of
    // whether the user has actually programmed it - so the only ground
    // truth is whether each button's linked Preset carries assignments.
    // Unprogrammed Presets are a bare {href, Parent} shell. Programmed
    // ones carry one or more *Assignments arrays (PresetAssignments,
    // DimmedLevelAssignments, SwitchedLevelAssignments, FanSpeedAssignments,
    // PlayPauseToggleAssignments, NextTrackAssignments, FavoriteCycleAssignments,
    // RaiseLowerAssignments, etc).
    if (this.options.filterPico) {
      const wired = bgs.find(bg => Array.isArray(bg.AffectedZones) && bg.AffectedZones.length > 0)
      if (wired) {
        return {
          kind: DeviceWireResultType.Skipped,
          reason: `Associated with a device outside HomeKit (${wired.href} has ${wired.AffectedZones!.length} zone(s) wired)`,
        }
      }
      for (const button of buttons) {
        const pmHref = (button.ProgrammingModel as { href?: string } | undefined)?.href
        if (!pmHref) {
          continue
        }
        let pm: { Preset?: { href?: string } } | undefined
        try {
          const resp = await this.bridge.getHref({ href: pmHref } as any) as any
          pm = resp?.ProgrammingModel ?? resp
        } catch (e) {
          this.platform.log.warn(`Failed to read programming model ${pmHref} for ${fullName}; treating ${button.href} as unprogrammed:`, e)
          continue
        }
        const presetHref = pm?.Preset?.href
        if (!presetHref) {
          continue
        }
        let preset: unknown
        try {
          const resp = await this.bridge.getHref({ href: presetHref } as any) as any
          preset = resp?.Preset ?? resp
        } catch (e) {
          this.platform.log.warn(`Failed to read preset ${presetHref} for ${fullName}; treating ${button.href} as unprogrammed:`, e)
          continue
        }
        if (presetIsProgrammed(preset)) {
          return {
            kind: DeviceWireResultType.Skipped,
            reason: `Associated with a device outside HomeKit (${button.href} preset ${presetHref} has assignments)`,
          }
        }
      }
    }

    const dentry = BUTTON_MAP.get(this.accessory.context.device.DeviceType)
    if (dentry === undefined) {
      return {
        kind: DeviceWireResultType.Error,
        reason: `Could not find ${this.accessory.context.device.DeviceType} in button map`,
      }
    }

    for (const button of buttons) {
      const alias = this.resolveAlias(dentry, button)
      if (alias === undefined) {
        this.platform.log.warn(
          `Skipping unmapped button ${button.ButtonNumber} (${button.Name}) for ${this.accessory.context.device.DeviceType}`,
        )
        continue
      }

      // Map href to ButtonNumber for event lookup
      this.hrefToButtonNumber.set(button.href, button.ButtonNumber)
      this.hrefToAlias.set(button.href, alias)

      this.platform.log.debug(
        `setting up ${button.href} named ${button.Name} numbered ${button.ButtonNumber} as ${inspect(
          alias,
          true,
          null,
        )}`,
      )

      const service
        = this.accessory.getServiceById(this.platform.api.hap.Service.StatelessProgrammableSwitch, alias.label)
          || this.accessory.addService(
            this.platform.api.hap.Service.StatelessProgrammableSwitch,
            button.Name,
            alias.label,
          )
      service.addLinkedService(label_svc)

      service.setCharacteristic(this.platform.api.hap.Characteristic.Name, alias.label)
      service.setCharacteristic(this.platform.api.hap.Characteristic.ServiceLabelIndex, alias.index)

      const validValues = [this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS]
      if (this.options.clickSpeedDouble !== 'disabled') {
        validValues.push(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS)
      } else {
        this.platform.log.debug('double press disabled')
      }
      if (this.options.clickSpeedLong !== 'disabled') {
        validValues.push(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS)
      } else {
        this.platform.log.debug('long press disabled')
      }
      const maxProgrammableSwitchEventValue = this.options.clickSpeedLong !== 'disabled'
        ? this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS
        : this.options.clickSpeedDouble !== 'disabled'
          ? this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
          : this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      this.platform.log.debug('validValues', validValues)

      const emitMatterGesture = (gesture: 'singlePress' | 'doublePress' | 'longPress') => {
        if (!this.matterApi) {
          return
        }

        const hasComposedParts = Array.isArray((this.accessory as any).parts)
        const partId = `button-${alias.index}`

        const emitOptions = hasComposedParts
          ? { partId }
          : (this.accessory as any).clusters?.switch
              ? { position: alias.index }
              : undefined

        if (!emitOptions) {
          return
        }

        const switchApi = this.matterApi.switch
        if (!switchApi || typeof switchApi.emitGesture !== 'function') {
          this.platform.log.warn(
            `[Matter] switch.emitGesture is unavailable for ${this.accessory.displayName}; skipping ${gesture}`,
          )
          return
        }

        this.platform.log.debug(
          `[Matter] Emitting switch gesture ${gesture} for ${this.accessory.displayName} ${'partId' in emitOptions ? `part ${emitOptions.partId}` : `position ${emitOptions.position}`}`,
        )
        void switchApi.emitGesture(this.accessory.UUID, gesture, emitOptions).catch((error: unknown) => {
          this.platform.log.warn(
            `[Matter] Failed to emit gesture ${gesture} for ${this.accessory.displayName}: ${String(error)}`,
          )
        })
      }

      service
        .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
        .setProps({
          maxValue: maxProgrammableSwitchEventValue,
          validValues,
        })

      const SINGLE_PRESS = () => {
        emitMatterGesture('singlePress')
        return service
          .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
          .setProps({
            maxValue: maxProgrammableSwitchEventValue,
            validValues,
          })
          .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
      }
      let DOUBLE_PRESS: () => Characteristic | null
      if (this.options.clickSpeedDouble !== 'disabled') {
        DOUBLE_PRESS = () => {
          emitMatterGesture('doublePress')
          return service
            .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
            .setProps({
              maxValue: maxProgrammableSwitchEventValue,
              validValues,
            })
            .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS)
        }
      } else {
        DOUBLE_PRESS = () => {
          return null
        }
      }

      let LONG_PRESS: () => Characteristic | null
      if (this.options.clickSpeedLong !== 'disabled') {
        LONG_PRESS = () => {
          emitMatterGesture('longPress')
          return service
            .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
            .setProps({
              maxValue: maxProgrammableSwitchEventValue,
              validValues,
            })
            .updateValue(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS)
        }
      } else {
        LONG_PRESS = () => {
          return null
        }
      }

      this.services.set(button.href, service)
      this.trackers.set(
        button.href,
        new ButtonTracker(
          SINGLE_PRESS,
          DOUBLE_PRESS,
          LONG_PRESS,
          this.platform.log,
          button.href,
          this.options.clickSpeedDouble,
          this.options.clickSpeedLong,
          alias.isUpDown,
          // Thread the user's buttonPressLogging choice into the tracker so
          // the interpreted short/long/double press lines respect it. The
          // raw Press/Release event log in handleEvent() below uses the
          // same option via logButtonPress().
          this.options.buttonPressLogging,
        ),
      )

      // Track this button so the single 'disconnected' handler registered after
      // the loop can re-subscribe all of them. The previous code registered one
      // disconnect listener per button, which leaked listeners (one Pico with N
      // buttons added N listeners) — that's why platform.ts has setMaxListeners(400).
      this.buttons.push(button)
      this.platform.log.debug(`subscribing to ${button.href} events`)
      this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
    }

    if (this.trackers.size === 0) {
      return {
        kind: DeviceWireResultType.Error,
        reason: `No mapped buttons found for ${this.accessory.context.device.DeviceType}`,
      }
    }

    // LeapClient._empty() clears all taggedSubscriptions on socket close, so we
    // must re-register them on reconnect. Home Assistant's lutron_caseta has no
    // equivalent because pylutron-caseta preserves subscriptions across reconnect;
    // that asymmetry is worth filing upstream against lutron-leap-js.
    // One handler per device, not per button — see comment on this.buttons above.
    this.bridge.on('disconnected', () => {
      this.platform.log.debug(`re-subscribing to ${this.buttons.length} button(s) after connection loss`)
      for (const button of this.buttons) {
        this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
      }
    })

    this.platform.on('unsolicited', this.handleUnsolicited.bind(this))

    return {
      kind: DeviceWireResultType.Success,
      name: fullName,
    }
  }

  handleEvent(response: Response): void {
    const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus
    const buttonHref = evt.Button.href

    const fullName = this.accessory.context.device.FullyQualifiedName.join(' ')
    // Raw Press/Release event from the bridge — fires twice per physical
    // press (once for Press, once for Release). Routed through
    // logButtonPress() so the user's buttonPressLogging option (info /
    // debug / silent) governs visibility, independent of the broader
    // logLevel option. See Logger.ts.
    logButtonPress(
      this.platform.log,
      this.options.buttonPressLogging,
      `Button ${buttonHref} on Pico remote ${fullName} got action ${evt.ButtonEvent.EventType}`,
    )
    // Route to the button tracker, which interprets the raw Press/Release
    // events into single-press, double-press, or long-press gestures.
    // The tracker's callbacks emit both HAP events and Matter events.
    this.trackers.get(buttonHref)!.update(evt.ButtonEvent.EventType)
  }

  handleUnsolicited(response: Response): void {
    if (response.Header.MessageBodyType === 'OneButtonStatusEvent') {
      const href = (response.Body as OneButtonStatusEvent)?.ButtonStatus.Button.href
      if (this.services.has(href)) {
        this.platform.log.warn('got unsolicited response for known button ', href, ', handling anyway')
        this.handleEvent(response)
      }
    }
  }

  /**
   * Returns a Matter clusters object for this Pico remote, based on its button map.
   */
  public getMatterClusters(): Record<string, any> {
    const type = this.accessory.context.device.DeviceType
    const fullName = this.accessory.context.device.FullyQualifiedName.join(' ')

    this.platform.log.debug(`[Matter] getMatterClusters called for Pico type: ${type}, display name: ${this.accessory.displayName}`)

    const dentry = BUTTON_MAP.get(type)
    if (!dentry) {
      this.platform.log.warn(`[Matter] PicoRemote type '${type}' not found in BUTTON_MAP (${fullName}), returning empty clusters.`)
      return {}
    }

    this.platform.log.debug(`[Matter] Found BUTTON_MAP entry for '${type}' with ${dentry.size} buttons`)

    // Expose Pico remotes as composed Matter endpoints: one GenericSwitch-like
    // part per physical button. This aligns better with Home's separate button
    // presentation than a single multi-position switch endpoint.
    const genericSwitchDeviceType = this.matterApi?.deviceTypes?.GenericSwitch
    if (!genericSwitchDeviceType) {
      this.platform.log.warn(
        `[Matter] GenericSwitch deviceType is unavailable for '${type}' (${fullName}), matterApi state: ${this.matterApi ? 'present' : 'absent'}`,
      )
      return {}
    }

    // matter.js GenericSwitch requires explicitly adding Switch behavior/features
    // via .with(...). Without this, the endpoint may be created but not expose
    // switch event semantics correctly to controllers.
    let partDeviceType = genericSwitchDeviceType
    const switchServer = genericSwitchDeviceType?.requirements?.server?.mandatory?.Switch
    if (typeof genericSwitchDeviceType.with === 'function' && switchServer) {
      partDeviceType = genericSwitchDeviceType.with(switchServer)
      this.platform.log.debug(`[Matter] GenericSwitch parts configured with explicit SwitchServer behavior for '${type}'`)
    } else {
      this.platform.log.warn(
        `[Matter] GenericSwitch SwitchServer behavior was not resolved for '${type}'. Endpoint visibility may be limited in some controllers.`,
      )
    }

    this.platform.log.debug(`[Matter] GenericSwitch deviceType available, creating parts for '${type}'`)

    const sortedAliases = Array.from(dentry.values()).sort((a, b) => a.index - b.index)
    this.platform.log.debug(`[Matter] Creating ${sortedAliases.length} button parts for '${type}'`)
    const isLongPressEnabled = this.options.clickSpeedLong !== 'disabled'
    const isDoublePressEnabled = this.options.clickSpeedDouble !== 'disabled'
    const allowNonCompliant = !!this.options.matterAllowNonCompliantSinglePress

    const parts = sortedAliases.map((alias) => {
      const switchCluster: Record<string, number> = {
        currentPosition: 0,
        numberOfPositions: 2, // Button has 2 positions: unpressed (0) and pressed (1)
      }

      // Always set multiPressMax = 2 if non-compliant option is off (spec-compliant)
      if (!allowNonCompliant && isDoublePressEnabled) {
        switchCluster.multiPressMax = 2
      }

      // Only set longPressTime if long press is enabled
      if (isLongPressEnabled) {
        switchCluster.longPressTime = 1000
      }

      const part = {
        id: `button-${alias.index}`,
        name: alias.label,
        displayName: alias.label,
        deviceType: partDeviceType,
        clusters: {
          switch: switchCluster,
        },
      }
      this.platform.log.debug(`[Matter] Created part: id=${part.id}, name=${part.name}`)
      return part
    })

    if (parts.length === 0) {
      this.platform.log.warn(`[Matter] No button parts created for Pico type '${type}' (${fullName})`)
      return {}
    }

    this.platform.log.info(
      `[Matter] Pico remote '${fullName}' (${type}): creating ${parts.length} composed endpoint(s)`,
    )
    this.platform.log.debug(
      `[Matter] Pico composed parts payload for '${type}': ${JSON.stringify(parts, null, 2)}`,
    )

    const composed = { parts }
    return composed
  }
}

// A LEAP Preset is "programmed" if it carries any non-empty assignment array.
// The unprogrammed shape is just {href, Parent}. Programmed Presets carry one
// or more of: PresetAssignments, DimmedLevelAssignments, SwitchedLevelAssignments,
// FanSpeedAssignments, TiltAssignments, PlayPauseToggleAssignments,
// NextTrackAssignments, FavoriteCycleAssignments, RaiseLowerAssignments, etc.
// We don't enumerate the families - any key whose name ends in "Assignments"
// with a non-empty array counts, which makes the check forward-compatible
// with future LEAP types while ignoring unrelated array fields LEAP may add.
export function presetIsProgrammed(preset: unknown): boolean {
  if (!preset || typeof preset !== 'object') {
    return false
  }
  for (const [k, v] of Object.entries(preset as Record<string, unknown>)) {
    if (!k.endsWith('Assignments')) {
      continue
    }
    if (Array.isArray(v) && v.length > 0) {
      return true
    }
  }
  return false
}
