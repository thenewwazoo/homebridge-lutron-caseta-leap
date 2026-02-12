import type { Characteristic, PlatformAccessory, Service } from 'homebridge'
import type {
  ButtonDefinition,
  OneButtonStatusEvent,
  Response,
  SmartBridge,
} from 'lutron-leap'

import type { DiscoveredButton } from './ButtonDiscoveryService.js'
import type {
  DeviceWireResult,
  GlobalOptions,
  LutronCasetaLeap,
} from './platform.js'

import { inspect } from 'node:util'

import { ExceptionDetail } from 'lutron-leap'

import { ButtonTracker } from './ButtonState.js'
import { DeviceWireResultType, sanitizeHomeKitName } from './platform.js'

// Keywords that indicate a button is a shades/blinds control button
// These buttons typically only send Press events (no Release/LongHold)
// so long press detection won't work reliably
const SHADES_BUTTON_KEYWORDS = [
  'shade',
  'blind',
  'shades',
  'blinds',
  'raise',
  'lower',
  'tilt',
  'slat',
  'open',
  'close',
  'stop',
  'drape',
  'drapes',
  'curtain',
  'curtains',
]

function isShadesButton(
  buttonName: string,
  engravingText: string | undefined,
): boolean {
  const textToCheck = `${buttonName} ${engravingText || ''}`.toLowerCase()
  return SHADES_BUTTON_KEYWORDS.some(keyword =>
    textToCheck.includes(keyword),
  )
}

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
const BUTTON_MAP = new Map<
  string,
  Map<number, { label: string, index: number, isUpDown: boolean }>
>([
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
  // TODO
  /*
    ['Pico4Button', new Map([
    ])]
   */
])

export class PicoRemote {
  private services: Map<string, Service> = new Map()
  private trackers: Map<string, ButtonTracker> = new Map()
  // For synthetic buttons (QSX), we also need to track by button number
  // since the event hrefs may not match our synthetic hrefs
  private trackersByButtonNumber: Map<number, ButtonTracker> = new Map()
  private servicesByButtonNumber: Map<number, Service> = new Map()
  // Track if this device uses synthetic buttons
  private hasSyntheticButtons = false
  // Deduplication: track last processed event to skip duplicates from QSX
  private lastEventKey = ''
  private lastEventTime = 0
  // Track device hrefs this remote handles (for dynamic discovery with merged devices)
  private deviceHrefs: Set<string> = new Set()
  // Track button group hrefs for this device (for matching button parents)
  private buttonGroupHrefs: Set<string> = new Set()
  // Reference to label service for adding dynamic buttons
  private labelService: Service | null = null
  // Current button index for adding new buttons
  private nextButtonIndex = 1

  constructor(
    private readonly platform: LutronCasetaLeap,
    private readonly accessory: PlatformAccessory,
    private readonly bridge: SmartBridge,
    private readonly options: GlobalOptions,
  ) {}

  public async initialize(): Promise<DeviceWireResult> {
    const fullName = sanitizeHomeKitName(
      this.accessory.context.device.FullyQualifiedName.join(' '),
    )

    // Check if this is a merged device (2-gang keypad)
    // These properties are added by platform.mergeMultiGangKeypads() for merged devices
    const device = this.accessory.context.device as any
    const mergedDeviceHrefs: string[] | undefined = device._mergedDeviceHrefs
    const mergedSerialNumbers: number[] | undefined
      = device._mergedSerialNumbers
    const isMergedDevice = mergedDeviceHrefs && mergedDeviceHrefs.length > 1

    if (isMergedDevice) {
      this.platform.log.debug(
        `${fullName}: This is a merged device with ${mergedDeviceHrefs!.length} physical device(s) `
        + `(serial numbers: ${mergedSerialNumbers?.join(', ')})`,
      )
    }

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Manufacturer,
        'Lutron Electronics Co., Inc',
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.Model,
        this.accessory.context.device.ModelNumber,
      )
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, fullName)
      .setCharacteristic(
        this.platform.api.hap.Characteristic.ConfiguredName,
        fullName,
      )
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.SerialNumber.toString(),
      )

    const label_svc
      = this.accessory.getService(this.platform.api.hap.Service.ServiceLabel)
        || this.accessory.addService(this.platform.api.hap.Service.ServiceLabel)
    label_svc.setCharacteristic(
      this.platform.api.hap.Characteristic.ServiceLabelNamespace,
      this.platform.api.hap.Characteristic.ServiceLabelNamespace
        .ARABIC_NUMERALS, // ha ha
    )
    this.labelService = label_svc

    // Track all device hrefs for this device (single or merged)
    if (isMergedDevice && mergedDeviceHrefs) {
      for (const href of mergedDeviceHrefs) {
        this.deviceHrefs.add(href)
      }
    } else {
      this.deviceHrefs.add(device.href)
    }

    // Load persisted buttons for this device BEFORE probing
    const discoveryService = this.platform.buttonDiscoveryService
    const persistedButtons = discoveryService.getButtonsForDevice(device.href)
    let useCachedButtons = false
    const cachedButtonDefs: ButtonDefinition[] = []

    if (persistedButtons.length > 0) {
      this.platform.log.debug(
        `${fullName}: Loading ${persistedButtons.length} persisted buttons from cache`,
      )
      // Convert persisted buttons to ButtonDefinition format
      for (const persisted of persistedButtons) {
        const buttonDef: ButtonDefinition = {
          href: persisted.href,
          ButtonNumber: persisted.ButtonNumber,
          Name: persisted.Name,
          Parent: persisted.Parent,
        } as ButtonDefinition
        if (persisted.Engraving) {
          (buttonDef as any).Engraving = persisted.Engraving
        }
        cachedButtonDefs.push(buttonDef)
        // Also add to bridge cache for subscriptions
        this.bridge.addDiscoveredButton(persisted.deviceHref, buttonDef)
      }
      useCachedButtons = true
    }

    let bgs
    try {
      // For merged devices, fetch button groups from each physical device
      if (isMergedDevice) {
        this.platform.log.debug(
          `${fullName}: Fetching button groups from ${mergedDeviceHrefs!.length} merged devices...`,
        )
        // Fetch button groups from each merged device and combine them
        const allBgs = await Promise.all(
          mergedDeviceHrefs!.map(async (deviceHref) => {
            this.platform.log.debug(
              `${fullName}: Fetching button groups from device ${deviceHref}...`,
            )
            const deviceBgs
              = await this.bridge.getButtonGroupsFromDeviceHref(deviceHref)
            this.platform.log.debug(
              `${fullName}: Device ${deviceHref} has ${deviceBgs.length} button group(s)`,
            )
            return deviceBgs
          }),
        )
        bgs = allBgs.flat()
        this.platform.log.debug(
          `${fullName}: Total from all merged devices: ${bgs.length} button group(s)`,
        )
      } else {
        bgs = await this.bridge.getButtonGroupsFromDevice(
          this.accessory.context.device,
        )
      }
      this.platform.log.debug(
        `${fullName}: Found ${bgs.length} button group(s)`,
      )
      // Debug: log button group hrefs
      for (const bg of bgs) {
        if (!(bg instanceof ExceptionDetail)) {
          this.platform.log.debug(
            `${fullName}: Button group href=${bg.href}, has Buttons array=${!!bg.Buttons}, length=${bg.Buttons?.length || 0}`,
          )
        }
      }
    } catch (e) {
      this.platform.log.error(
        'Failed to get button group(s) belonging to',
        fullName,
        e,
      )
      return {
        kind: DeviceWireResultType.Error,
        reason: `Failed to get button group(s) belonging to ${fullName}: ${e}`,
      }
    }

    // Track button group hrefs for dynamic discovery (matching unknown button events)
    for (const bg of bgs) {
      if (!(bg instanceof ExceptionDetail)) {
        this.buttonGroupHrefs.add(bg.href)
      }
    }

    // For merged devices, pre-populate the button cache for ALL device hrefs
    // This ensures buttons can be found even if they're on a different device than the buttongroup's Parent
    if (isMergedDevice && mergedDeviceHrefs && mergedDeviceHrefs.length > 1) {
      this.platform.log.debug(
        `${fullName}: Pre-populating button cache for ${mergedDeviceHrefs.length} merged devices...`,
      )
      await this.bridge.prePopulateButtonCacheForDevices(mergedDeviceHrefs)
      this.platform.log.debug(
        `${fullName}: Button cache pre-population complete`,
      )
    }

    // if there are any buttongroups that are already associated in the
    // lutron app, and we've been told to skip them, return early.
    if (
      bgs.some(bg => bg.AffectedZones !== undefined)
      && this.options.filterPico
    ) {
      return {
        kind: DeviceWireResultType.Skipped,
        reason: 'Associated with a device outside HomeKit',
      }
    }

    bgs.forEach((bg) => {
      if (bg instanceof ExceptionDetail) {
        return new Error('Device has been removed')
      }
    })

    let buttons: ButtonDefinition[] = []

    if (useCachedButtons) {
      // Use cached buttons directly - skip expensive API calls
      buttons = cachedButtonDefs
    } else {
      // No cache - probe for buttons from each button group
      for (const bg of bgs) {
        try {
          // Debug: log the buttongroup's Parent to understand QSX structure
          const parentInfo = bg.Parent
            ? (bg.Parent as { href?: string }).href || JSON.stringify(bg.Parent)
            : 'undefined'
          this.platform.log.debug(
            `${fullName}: ButtonGroup ${bg.href} has Parent: ${parentInfo}`,
          )
          this.platform.log.debug(
            `${fullName}: Querying buttons for button group ${bg.href}...`,
          )
          const bgButtons = await this.bridge.getButtonsFromGroup(bg)
          this.platform.log.debug(
            `${fullName}: Button group ${bg.href} returned ${bgButtons.length} button(s)`,
          )
          if (bgButtons.length > 0) {
            this.platform.log.debug(
              `${fullName}: First button: ${JSON.stringify(bgButtons[0])}`,
            )
          }
          buttons = buttons.concat(bgButtons)
        } catch (e) {
          this.platform.log.error(
            'Failed to get buttons from button group',
            bg.href,
            e,
          )
          return {
            kind: DeviceWireResultType.Error,
            reason: `Failed to get buttons from button group ${bg.href}: ${e}`,
          }
        }
      }
      this.platform.log.debug(
        `${fullName}: Total buttons found: ${buttons.length}`,
      )
    }

    // Check for synthetic (fallback) buttons mixed with real buttons
    // Synthetic buttons are created when getButtonsFromGroup can't query real buttons
    // They have _synthetic=true, fake hrefs, and "undefined" engravings
    // @ts-expect-error - _synthetic is added by SmartBridge for QSX buttons
    const realButtons = buttons.filter(b => b._synthetic !== true)
    // @ts-expect-error - _synthetic is added by SmartBridge for QSX buttons
    const syntheticButtons = buttons.filter(b => b._synthetic === true)

    if (syntheticButtons.length > 0 && realButtons.length > 0) {
      // We have a mix - keep only the real buttons
      this.platform.log.debug(
        `${fullName}: Filtering out ${syntheticButtons.length} synthetic buttons, keeping ${realButtons.length} real buttons`,
      )
      buttons = realButtons
    } else if (syntheticButtons.length > 0 && realButtons.length === 0) {
      // All buttons are synthetic - skip this device
      this.platform.log.warn(
        `${fullName}: All ${buttons.length} buttons are synthetic (probing failed). `
        + `This may be a phantom device or 2-gang keypad where buttons belong to another device. Skipping.`,
      )
      return {
        kind: DeviceWireResultType.Skipped,
        reason: `All buttons are synthetic - likely phantom device or 2-gang pair`,
      }
    }

    // Sort buttons by their ButtonNumber for consistent ordering
    // and log all button numbers to help debug numbering issues
    const buttonNumbers = buttons
      .map(b => b.ButtonNumber)
      .sort((a, b) => a - b)
    this.platform.log.debug(
      `${fullName}: Button numbers from API: [${buttonNumbers.join(', ')}]`,
    )

    // Track which service subtypes we're using for this device
    const activeSubtypes = new Set<string>()

    // Create a sequential index map for buttons (1, 2, 3, 4...) regardless of API ButtonNumber gaps
    // Use button.href as key (not ButtonNumber) because merged devices can have multiple buttons
    // with the same ButtonNumber from different physical devices
    const sortedButtons = [...buttons].sort(
      (a, b) => a.ButtonNumber - b.ButtonNumber,
    )
    const buttonIndexMap = new Map<string, number>()
    sortedButtons.forEach((button, idx) => {
      buttonIndexMap.set(button.href, idx + 1) // 1-indexed for HomeKit
    })

    for (const button of buttons) {
      const dentry = BUTTON_MAP.get(this.accessory.context.device.DeviceType)
      let alias:
        | { label: string, index: number, isUpDown: boolean }
        | undefined

      if (dentry !== undefined) {
        // Known device type - use static button map
        alias = dentry.get(button.ButtonNumber)
        if (alias === undefined) {
          return {
            kind: DeviceWireResultType.Error,
            reason: `Could not find button ${button.ButtonNumber} in ${this.accessory.context.device.DeviceType} map entry`,
          }
        }
      } else {
        // Unknown device type (e.g., QSX keypads) - generate dynamic button mapping
        // Use the button's Engraving text if available, otherwise Name, otherwise generic
        const engravingText = (button as any).Engraving?.Text?.replace(
          /[\r\n]+/g,
          ' ',
        ).trim()
        let buttonLabel
          = engravingText || button.Name || `Button ${button.ButtonNumber}`
        // Append " Button" suffix if not already present
        if (!buttonLabel.toLowerCase().includes('button')) {
          buttonLabel = `${buttonLabel} Button`
        }
        // For single-button devices, prefix with device name to avoid ambiguous button names
        // (e.g., "Exterior" alone isn't descriptive, but "Family Room Cabinet - Exterior Button" is)
        if (buttons.length === 1) {
          buttonLabel = `${fullName} - ${buttonLabel}`
          this.platform.log.debug(
            `${fullName}: Single-button device, prefixing button label: "${buttonLabel}"`,
          )
        }
        // Use sequential index from buttonIndexMap to handle API numbering gaps
        // (e.g., if API returns buttons 1, 2, 4, we map to indices 1, 2, 3)
        // Use button.href as key since merged devices can have duplicate ButtonNumbers
        const sequentialIndex
          = buttonIndexMap.get(button.href) || button.ButtonNumber
        alias = {
          label: buttonLabel,
          index: sequentialIndex,
          isUpDown: false,
        }
        this.platform.log.debug(
          `${fullName}: Button ${button.href} - Name="${button.Name}", ButtonNumber=${button.ButtonNumber}, Engraving="${engravingText}", label="${buttonLabel}", sequentialIndex=${sequentialIndex}`,
        )
        this.platform.log.debug(
          `Generated dynamic button mapping for ${this.accessory.context.device.DeviceType}: button ${button.ButtonNumber} -> "${buttonLabel}" (index ${sequentialIndex})`,
        )
      }

      this.platform.log.debug(
        `setting up ${button.href} named ${button.Name} numbered ${button.ButtonNumber} as ${inspect(
          alias,
          true,
          null,
        )}`,
      )

      const service
        = this.accessory.getServiceById(
          this.platform.api.hap.Service.StatelessProgrammableSwitch,
          alias.label,
        )
        || this.accessory.addService(
          this.platform.api.hap.Service.StatelessProgrammableSwitch,
          alias.label, // Use the label (with engraving) as the display name
          alias.label,
        )
      service.addLinkedService(label_svc)
      activeSubtypes.add(alias.label)

      service.setCharacteristic(
        this.platform.api.hap.Characteristic.Name,
        alias.label,
      )
      // Also set ConfiguredName if available - this is what HomeKit often displays
      if (this.platform.api.hap.Characteristic.ConfiguredName) {
        service.setCharacteristic(
          this.platform.api.hap.Characteristic.ConfiguredName,
          alias.label,
        )
      }
      service.setCharacteristic(
        this.platform.api.hap.Characteristic.ServiceLabelIndex,
        alias.index,
      )

      // Check if this is a shades button (only sends Press, no Release/LongHold)
      // For shades buttons, we disable long press since it can't be detected reliably
      const engravingText = (button as any).Engraving?.Text?.replace(
        /[\r\n]+/g,
        ' ',
      ).trim()
      const isShades = isShadesButton(button.Name || '', engravingText)
      if (isShades) {
        this.platform.log.info(
          `Button "${alias.label}" detected as shades button - long press disabled`,
        )
      }

      const validValues = [
        this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
          .SINGLE_PRESS,
      ]
      if (this.options.clickSpeedDouble !== 'disabled') {
        validValues.push(
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
            .DOUBLE_PRESS,
        )
      } else {
        this.platform.log.debug('double press disabled')
      }
      // Only enable long press if not disabled AND not a shades button
      const longPressEnabled
        = this.options.clickSpeedLong !== 'disabled' && !isShades
      if (longPressEnabled) {
        validValues.push(
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
            .LONG_PRESS,
        )
      } else if (isShades) {
        this.platform.log.debug('long press disabled for shades button')
      } else {
        this.platform.log.debug('long press disabled')
      }
      this.platform.log.debug('validValues', validValues)

      service
        .getCharacteristic(
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
        )
        .setProps({
          maxValue:
            this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
              .LONG_PRESS,
          validValues,
        })

      const SINGLE_PRESS = () => {
        return service
          .getCharacteristic(
            this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
          )
          .setProps({
            maxValue:
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                .LONG_PRESS,
            validValues,
          })
          .updateValue(
            this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
              .SINGLE_PRESS,
          )
      }
      let DOUBLE_PRESS: () => Characteristic | null
      if (this.options.clickSpeedDouble !== 'disabled') {
        DOUBLE_PRESS = () => {
          return service
            .getCharacteristic(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
            )
            .setProps({
              maxValue:
                this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                  .LONG_PRESS,
              validValues,
            })
            .updateValue(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                .DOUBLE_PRESS,
            )
        }
      } else {
        DOUBLE_PRESS = () => {
          return null
        }
      }

      let LONG_PRESS: () => Characteristic | null
      if (longPressEnabled) {
        LONG_PRESS = () => {
          return service
            .getCharacteristic(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
            )
            .setProps({
              maxValue:
                this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                  .LONG_PRESS,
              validValues,
            })
            .updateValue(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                .LONG_PRESS,
            )
        }
      } else {
        LONG_PRESS = () => {
          return null
        }
      }

      this.services.set(button.href, service)
      const tracker = new ButtonTracker(
        SINGLE_PRESS,
        DOUBLE_PRESS,
        LONG_PRESS,
        this.platform.log,
        button.href,
        this.options.clickSpeedDouble,
        // For shades buttons, disable long press detection
        isShades ? 'disabled' : this.options.clickSpeedLong,
        alias.isUpDown,
        engravingText,
        isShades || this.bridge.isQSX,
      )
      this.trackers.set(button.href, tracker)

      // For synthetic buttons, also track by button number for event matching
      // @ts-expect-error - _synthetic is added by SmartBridge for QSX buttons
      if (button._synthetic) {
        this.hasSyntheticButtons = true
        this.trackersByButtonNumber.set(button.ButtonNumber, tracker)
        this.servicesByButtonNumber.set(button.ButtonNumber, service)
        this.platform.log.debug(
          `Registered synthetic button ${button.ButtonNumber} for event matching`,
        )
      }

      this.platform.log.debug(`subscribing to ${button.href} events`)
      this.bridge.subscribeToButton(button, this.handleEvent.bind(this))

      // when the connection is lost, so are subscriptions.
      this.bridge.on('disconnected', () => {
        this.platform.log.debug(
          `re-subscribing to ${button.href} events after connection loss`,
        )
        this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
      })

      // Track highest index for dynamic button creation
      const currentIndex
        = buttonIndexMap.get(button.href) || button.ButtonNumber
      if (currentIndex >= this.nextButtonIndex) {
        this.nextButtonIndex = currentIndex + 1
      }
    }

    // Persist all discovered buttons (both probed and previously persisted)
    for (const button of buttons) {
      const engravingText = (button as any).Engraving?.Text?.replace(
        /[\r\n]+/g,
        ' ',
      ).trim()
      const discoveredButton: DiscoveredButton = {
        href: button.href,
        ButtonNumber: button.ButtonNumber,
        Name: button.Name,
        Parent: button.Parent,
        deviceHref: device.href,
        discoveredAt: Date.now(),
        source: 'probe',
      }
      if (engravingText) {
        discoveredButton.Engraving = { Text: engravingText }
      }
      discoveryService.addButton(discoveredButton)
    }
    this.platform.log.debug(
      `${fullName}: Persisted ${buttons.length} probed buttons`,
    )

    // Clean up stale services that no longer match any button
    // This handles the case where buttons were previously synthetic but are now real
    const allServices = this.accessory.services.filter(
      s =>
        s.UUID
        === this.platform.api.hap.Service.StatelessProgrammableSwitch.UUID,
    )
    for (const service of allServices) {
      const subtype = service.subtype
      if (subtype && !activeSubtypes.has(subtype)) {
        this.platform.log.debug(
          `${fullName}: Removing stale button service with subtype "${subtype}"`,
        )
        this.accessory.removeService(service)
      }
    }

    this.platform.on('unsolicited', this.handleUnsolicited.bind(this))

    return {
      kind: DeviceWireResultType.Success,
      name: fullName,
    }
  }

  handleEvent(response: Response): void {
    const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus
    const fullName = sanitizeHomeKitName(
      this.accessory.context.device.FullyQualifiedName.join(' '),
    )

    // Deduplicate: QSX processors sometimes send the same event multiple times
    // Use a short 50ms window to catch only true duplicates (which arrive almost simultaneously)
    // but allow intentional double-taps (which are 200-300ms apart)
    const eventKey = `${evt.Button.href}:${evt.ButtonEvent.EventType}`
    const now = Date.now()
    const timeSinceLast = now - this.lastEventTime
    if (eventKey === this.lastEventKey && timeSinceLast < 50) {
      return
    }
    this.lastEventKey = eventKey
    this.lastEventTime = now

    this.platform.log.debug(
      `Button ${evt.Button.href} on Pico remote ${fullName} got action ${evt.ButtonEvent.EventType}`,
    )

    // First try direct href lookup
    let tracker = this.trackers.get(evt.Button.href)

    // For synthetic buttons (QSX), fall back to button number lookup
    // The event contains the real button href which won't match our synthetic hrefs
    if (!tracker && this.hasSyntheticButtons) {
      // Try to extract button number from the event
      // QSX button events should include ButtonNumber in the response
      // @ts-expect-error - ButtonNumber may be in the event body
      const buttonNumber = evt.Button?.ButtonNumber
      if (buttonNumber !== undefined) {
        tracker = this.trackersByButtonNumber.get(buttonNumber)
        if (tracker) {
          this.platform.log.debug(
            `Matched QSX button event by ButtonNumber: ${buttonNumber}`,
          )
        }
      }

      // If still not found, log for debugging
      if (!tracker) {
        this.platform.log.warn(
          `Could not find tracker for button event. href=${evt.Button.href}, ButtonNumber=${buttonNumber}`,
        )
        this.platform.log.debug(`Full event: ${JSON.stringify(evt)}`)
        return
      }
    }

    if (!tracker) {
      this.platform.log.warn(`No tracker found for button ${evt.Button.href}`)
      return
    }

    tracker.update(evt.ButtonEvent.EventType)
  }

  handleUnsolicited(response: Response): void {
    if (response.Header.MessageBodyType === 'OneButtonStatusEvent') {
      const evt = response.Body as OneButtonStatusEvent
      const href = evt?.ButtonStatus.Button.href

      // If this button has a direct subscription (non-synthetic buttons),
      // process via handleEvent as a fallback in case the direct subscription
      // was lost. The deduplication logic in handleEvent will prevent
      // double-processing if both paths deliver the event.
      if (this.services.has(href)) {
        this.platform.log.debug(
          `Got unsolicited event for known button ${href}, handling as fallback`,
        )
        this.handleEvent(response)
        return
      }

      // For QSX synthetic buttons, the real button hrefs won't match our synthetic ones
      // Try to match by button number from the event
      if (this.hasSyntheticButtons) {
        // @ts-expect-error - ButtonNumber may be in the event
        const buttonNumber = evt?.ButtonStatus.Button?.ButtonNumber
        if (
          buttonNumber !== undefined
          && this.trackersByButtonNumber.has(buttonNumber)
        ) {
          this.platform.log.debug(
            `Matched unsolicited QSX button event by ButtonNumber: ${buttonNumber} (real href: ${href})`,
          )
          // Call the tracker directly since handleEvent expects matching hrefs
          const tracker = this.trackersByButtonNumber.get(buttonNumber)
          if (tracker) {
            tracker.update(evt.ButtonStatus.ButtonEvent.EventType)
          }
          return
        }

        // If ButtonNumber isn't in the event, log the full event so we can debug
        this.platform.log.debug(
          `QSX button event without ButtonNumber match. href=${href}, full event: ${JSON.stringify(evt)}`,
        )
      }

      // Dynamic discovery: Check if this button might belong to this device
      // by checking if its parent buttongroup matches any of our buttongroups
      // @ts-expect-error - Button may have Parent property in full response
      const buttonParentHref = evt?.ButtonStatus.Button?.Parent?.href as
        | string
        | undefined
      if (buttonParentHref && this.buttonGroupHrefs.has(buttonParentHref)) {
        this.platform.log.debug(
          `[DYNAMIC DISCOVERY] Unknown button ${href} belongs to our buttongroup ${buttonParentHref}`,
        )
        this.registerDynamicButton(
          href,
          evt.ButtonStatus.ButtonEvent.EventType,
        ).catch((e) => {
          this.platform.log.error(
            `[DYNAMIC DISCOVERY] Failed to register button ${href}: ${e}`,
          )
        })
      }
    }
  }

  private async registerDynamicButton(
    buttonHref: string,
    initialEventType: string,
  ): Promise<void> {
    const fullName = sanitizeHomeKitName(
      this.accessory.context.device.FullyQualifiedName.join(' '),
    )
    const device = this.accessory.context.device as any

    this.platform.log.debug(
      `[DYNAMIC DISCOVERY] Fetching button details for ${buttonHref}...`,
    )

    // Fetch the button details from the bridge
    const button = await this.bridge.getButton(buttonHref)
    if (!button) {
      this.platform.log.warn(
        `[DYNAMIC DISCOVERY] Could not fetch button ${buttonHref}`,
      )
      return
    }

    this.platform.log.debug(
      `[DYNAMIC DISCOVERY] Button fetched: Name="${button.Name}", ButtonNumber=${button.ButtonNumber}`,
    )

    // Generate button label and index
    const engravingText = (button as any).Engraving?.Text?.replace(
      /[\r\n]+/g,
      ' ',
    ).trim()
    let buttonLabel
      = engravingText || button.Name || `Button ${button.ButtonNumber}`
    // Append " Button" suffix if not already present
    if (!buttonLabel.toLowerCase().includes('button')) {
      buttonLabel = `${buttonLabel} Button`
    }
    // For single-button devices, prefix with device name to avoid ambiguous button names
    // If this is the first button being registered (services.size === 0), treat as single-button
    if (this.services.size === 0) {
      buttonLabel = `${fullName} - ${buttonLabel}`
      this.platform.log.debug(
        `[DYNAMIC DISCOVERY] Single-button device, prefixing button label: "${buttonLabel}"`,
      )
    }
    const buttonIndex = this.nextButtonIndex++

    // Check if this is a shades button
    const isShades = isShadesButton(button.Name || '', engravingText)

    // Create the HomeKit service
    const service = this.accessory.addService(
      this.platform.api.hap.Service.StatelessProgrammableSwitch,
      buttonLabel,
      buttonLabel,
    )
    if (this.labelService) {
      service.addLinkedService(this.labelService)
    }

    service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      buttonLabel,
    )
    if (this.platform.api.hap.Characteristic.ConfiguredName) {
      service.setCharacteristic(
        this.platform.api.hap.Characteristic.ConfiguredName,
        buttonLabel,
      )
    }
    service.setCharacteristic(
      this.platform.api.hap.Characteristic.ServiceLabelIndex,
      buttonIndex,
    )

    // Set up valid values
    const validValues = [
      this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    ]
    if (this.options.clickSpeedDouble !== 'disabled') {
      validValues.push(
        this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
          .DOUBLE_PRESS,
      )
    }
    const longPressEnabled
      = this.options.clickSpeedLong !== 'disabled' && !isShades
    if (longPressEnabled) {
      validValues.push(
        this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
      )
    }

    service
      .getCharacteristic(
        this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
      )
      .setProps({
        maxValue:
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
            .LONG_PRESS,
        validValues,
      })

    // Create button action callbacks
    const SINGLE_PRESS = () => {
      return service
        .getCharacteristic(
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
        )
        .setProps({
          maxValue:
            this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
              .LONG_PRESS,
          validValues,
        })
        .updateValue(
          this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
            .SINGLE_PRESS,
        )
    }
    const DOUBLE_PRESS
      = this.options.clickSpeedDouble !== 'disabled'
        ? () =>
            service
              .getCharacteristic(
                this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
              )
              .setProps({
                maxValue:
                  this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                    .LONG_PRESS,
                validValues,
              })
              .updateValue(
                this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                  .DOUBLE_PRESS,
              )
        : () => null
    const LONG_PRESS = longPressEnabled
      ? () =>
          service
            .getCharacteristic(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent,
            )
            .setProps({
              maxValue:
                this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                  .LONG_PRESS,
              validValues,
            })
            .updateValue(
              this.platform.api.hap.Characteristic.ProgrammableSwitchEvent
                .LONG_PRESS,
            )
      : () => null

    // Register service and tracker
    this.services.set(button.href, service)
    const tracker = new ButtonTracker(
      SINGLE_PRESS,
      DOUBLE_PRESS,
      LONG_PRESS,
      this.platform.log,
      button.href,
      this.options.clickSpeedDouble,
      isShades ? 'disabled' : this.options.clickSpeedLong,
      false, // isUpDown
      engravingText,
      isShades || this.bridge.isQSX,
    )
    this.trackers.set(button.href, tracker)

    // Subscribe to future events
    this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
    this.bridge.on('disconnected', () => {
      this.bridge.subscribeToButton(button, this.handleEvent.bind(this))
    })

    // Persist the discovery
    const discoveredButton: DiscoveredButton = {
      href: button.href,
      ButtonNumber: button.ButtonNumber,
      Name: button.Name,
      Parent: button.Parent,
      deviceHref: device.href,
      discoveredAt: Date.now(),
      source: 'press',
    }
    if (engravingText) {
      discoveredButton.Engraving = { Text: engravingText }
    }
    this.platform.buttonDiscoveryService.addButton(discoveredButton)

    // Add to bridge cache for future reference
    this.bridge.addDiscoveredButton(device.href, button)

    this.platform.log.info(
      `[DYNAMIC DISCOVERY] Button "${buttonLabel}" (${button.href}) registered successfully! Index=${buttonIndex}`,
    )

    // Process the initial event that triggered discovery
    tracker.update(initialEventType)
  }
}
