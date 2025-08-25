import type { PlatformAccessory, Service } from 'homebridge'
import type { ButtonDefinition, OneButtonStatusEvent, Response, SmartBridge } from 'lutron-leap'

import type { DeviceWireResult, GlobalOptions, LutronCasetaLeap } from './platform.js'

import { BluosController, masterPlayer, playerMap, players } from './bluos/index.js'
import { PicoRemote } from './PicoRemote.js'

/**
 * Audio Pico remote implementation
 *
 * This class extends PicoRemote to add audio control functionality for physical
 * Pico remotes with audio markings (play/pause, volume, preset, skip buttons).
 *
 * The current implementation is BluOS-specific, but the physical remote hardware
 * is vendor-agnostic and could support other audio systems in the future.
 *
 */
export class AudioPicoRemote extends PicoRemote {
  private bluosController: BluosController
  private volumeIntervals: Map<string, ReturnType<typeof setTimeout>> = new Map() // Store intervals for volume buttons
  private readonly VOLUME_REPEAT_INTERVAL = 300 // ms between volume adjustments when button is held
  private commandsForButtons: Map<string, { player: string }> = new Map() // Track volume buttons for cleanup

  constructor(
    platform: LutronCasetaLeap,
    accessory: PlatformAccessory,
    bridge: SmartBridge,
    options: GlobalOptions,
  ) {
    super(platform, accessory, bridge, options)
    this.bluosController = new BluosController(players, masterPlayer)
  }

  protected async setupButton(
    button: ButtonDefinition,
    service: Service,
    validValues: number[],
    alias: { label: string, index: number, isUpDown: boolean },
  ): Promise<void> {
    // Get player from config based on device serial number
    const player = playerMap.get(
      this.accessory.context.device.SerialNumber.toString(),
    )
    if (!player) {
      this.platform.log.error(
        `No player found for device ${this.accessory.context.device.FullyQualifiedName.join(' ')} with serial number ${this.accessory.context.device.SerialNumber}`,
      )
      return
    }

    const BUTTON_CONFIG = [
      {}, // index 0 unused
      {
        name: 'play/pause | group',
        singlePress: () => this.bluosController.playPause(players[player]),
        doublePress: null,
        longPress: () => this.bluosController.groupWithMaster(players[player]),
      },
      {
        name: 'volume up',
        singlePress: () => this.bluosController.volumeUp(players[player]),
        doublePress: () => this.bluosController.volumeUp(players[player], true),
        longPress: null,
      },
      {
        name: 'preset',
        singlePress: () => this.bluosController.presetNext(players[player]),
        doublePress: () => this.bluosController.presetPrevious(players[player]),
        longPress: null,
      },
      {
        name: 'volume down',
        singlePress: () => this.bluosController.volumeDown(players[player]),
        doublePress: () => this.bluosController.volumeDown(players[player], true),
        longPress: null,
      },
      {
        name: 'skip | ungroup',
        singlePress: () => this.bluosController.skipNext(players[player]),
        doublePress: () => this.bluosController.skipPrevious(players[player]),
        longPress: () => this.bluosController.ungroupFromMaster(players[player]),
      },
    ]
    const buttonConfig = BUTTON_CONFIG[alias.index] ?? {}

    // Store volume button info for continuous adjustment cleanup
    if (alias.index === 2 || alias.index === 4) {
      // Volume buttons
      this.commandsForButtons.set(button.href, { player })
    }

    const sendPlayerCommand = async (action: (() => Promise<void>) | null) => {
      if (!action) {
        return null
      }

      const buttonName = buttonConfig.name || 'unknown'

      // Dynamically determine the action type by checking which property matches
      let actionType = 'unknown'
      if (action === buttonConfig.singlePress) {
        actionType = 'single press'
      } else if (action === buttonConfig.doublePress) {
        actionType = 'double press'
      } else if (action === buttonConfig.longPress) {
        actionType = 'long press'
      }

      this.platform.log.info(`Sending command '${buttonName}' (${actionType}) for player '${player}'`)
      try {
        await action()
      } catch (error) {
        this.platform.log.error(`Error sending command '${buttonName}' (${actionType}) for player '${player}'`, error)
      }
      return null
    }

    const SINGLE_PRESS = () => sendPlayerCommand(buttonConfig.singlePress ?? null)
    const DOUBLE_PRESS = () => sendPlayerCommand(buttonConfig.doublePress ?? null)

    // Handle long press for volume buttons
    const LONG_PRESS = () => {
      // If this is a volume button (up or down), start sending volume commands at intervals
      if (alias.index === 2 || alias.index === 4) {
        // Volume buttons
        const isUp = alias.index === 2
        const volumeAction = isUp
          ? () => this.bluosController.volumeUp(players[player])
          : () => this.bluosController.volumeDown(players[player])
        this.startContinuousVolumeAdjustment(button.href, player, isUp ? 'up' : 'down', volumeAction)
        this.platform.log.info(`Long press detected on ${alias.label} button - starting continuous volume ${isUp ? 'up' : 'down'} for player ${player}`)
      } else {
        sendPlayerCommand(buttonConfig.longPress ?? null)
      }
    }

    // Use helper method to set up button tracker and service
    // Only allow DOUBLE_PRESS for buttons that have double modifier configured
    const hasDoublePress = buttonConfig.doublePress !== undefined

    // If no single/double modifiers in BUTTON_CONFIG, only allow SINGLE_PRESS
    if (!buttonConfig.singlePress && !buttonConfig.doublePress) {
      // Update validValues to only include SINGLE_PRESS
      validValues = [this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS]

      // Update the characteristic properties
      service
        .getCharacteristic(this.platform.api.hap.Characteristic.ProgrammableSwitchEvent)
        .setProps({
          maxValue: this.platform.api.hap.Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
          validValues,
        })
    }

    // Use null function for DOUBLE_PRESS if the button doesn't support it
    const doublePressFn = hasDoublePress ? DOUBLE_PRESS : () => null
    this.setupButtonTracker(button.href, service, SINGLE_PRESS, doublePressFn, LONG_PRESS, alias.isUpDown)
  }

  public async initialize(): Promise<DeviceWireResult> {
    const result = await super.initialize()
    return result
  }

  // Override the handleEvent method from PicoRemote to add volume control functionality
  handleEvent(response: Response): void {
    // Call the parent implementation first
    super.handleEvent(response)

    const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus
    const buttonHref = evt.Button.href
    const eventType = evt.ButtonEvent.EventType

    // If this is a volume button, stop continuous volume on release
    if (this.commandsForButtons.has(buttonHref) && eventType === 'Release') {
      const buttonInfo = this.commandsForButtons.get(buttonHref)!
      if (this.volumeIntervals.has(buttonHref)) {
        clearInterval(this.volumeIntervals.get(buttonHref)!)
        this.volumeIntervals.delete(buttonHref)
        this.platform.log.info(`Button released - stopped continuous volume for player ${buttonInfo.player}`)
      }
    }
  }

  /**
   * Start continuous volume adjustment at fixed intervals for a specific button
   */
  private startContinuousVolumeAdjustment(
    buttonHref: string,
    player: string,
    modifier: string,
    volumeAction: () => Promise<void>,
  ): void {
    // Clear any existing interval for this button
    if (this.volumeIntervals.has(buttonHref)) {
      clearInterval(this.volumeIntervals.get(buttonHref)!)
      this.volumeIntervals.delete(buttonHref)
    }

    // Set up recurring volume adjustments
    const interval = setInterval(() => {
      this.platform.log.debug(
        `Continuous volume ${modifier} for ${player}`,
      )
      volumeAction()
    }, this.VOLUME_REPEAT_INTERVAL)

    // Store the interval reference to clear it later
    this.volumeIntervals.set(buttonHref, interval)

    // Send initial command immediately
    volumeAction()

    this.platform.log.info(`Started continuous volume ${modifier} for player ${player}`)
  }

  // Clean up any ongoing intervals when the device is removed
  public destroy(): void {
    // Clear all volume intervals
    for (const interval of this.volumeIntervals.values()) {
      clearInterval(interval)
    }
    this.volumeIntervals.clear()
    this.commandsForButtons.clear()
  }
}
