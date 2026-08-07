import type { Href, MultipleOccupancyGroupStatus, OccupancyStatus, Response, SmartBridge } from 'lutron-leap'

import util from 'node:util'

import debug from 'debug'

const logDebug = debug('leap:bridge')

export class OccupancySensorRouter {
  static instance: OccupancySensorRouter

  // map (bridgeID, occupancygroup Hrefs) to their callbacks
  private cbMap: Map<string, (status: OccupancyStatus) => void>
  // map that tracks bridge subscriptions
  private subMap: Map<string, Promise<void>>
  // map to track state information
  private stateMap: Map<string, OccupancyStatus>

  private constructor() {
    this.cbMap = new Map()
    this.subMap = new Map()
    this.stateMap = new Map()
  }

  private makeKey(bridgeID: string, ocg: Href): string {
    return `${bridgeID}_${ocg.href}`
  }

  private updateState(bridgeID: string, update: MultipleOccupancyGroupStatus) {
    logDebug('update state')
    logDebug(util.inspect(update, { depth: null }))
    for (const grpStat of update.OccupancyGroupStatuses) {
      const key = this.makeKey(bridgeID, grpStat.OccupancyGroup)
      logDebug(`handling update for ${util.inspect(key, { depth: null })} to ${grpStat.OccupancyStatus}`)
      this.stateMap.set(key, grpStat.OccupancyStatus)
    }
  }

  private callRegistered(bridgeID: string, update: MultipleOccupancyGroupStatus) {
    for (const grpStat of update.OccupancyGroupStatuses) {
      const key = this.makeKey(bridgeID, grpStat.OccupancyGroup)
      logDebug(`calling cb for ${util.inspect(key, { depth: null })} to ${grpStat.OccupancyStatus}`)
      const cb = this.cbMap.get(key)
      if (cb) {
        cb(grpStat.OccupancyStatus)
      }
    }
  }

  public static getInstance(): OccupancySensorRouter {
    if (!OccupancySensorRouter.instance) {
      OccupancySensorRouter.instance = new OccupancySensorRouter()
    }

    return OccupancySensorRouter.instance
  }

  private async subscribeToBridge(bridge: SmartBridge) {
    // Subscribe to occupancy updates for the provided bridge.

    this.subMap.set(
      bridge.bridgeID,
      new Promise((resolve, reject) => {
        // update state and call all registered callbacks when we get an update
        const _handleOccupancyUpdate = (r: Response) => {
          logDebug('subscription cb called')
          this.updateState(bridge.bridgeID, r.Body! as MultipleOccupancyGroupStatus)
          this.callRegistered(bridge.bridgeID, r.Body! as MultipleOccupancyGroupStatus)
        }

        // we get a complete listing of occupancy groups and their
        // statuses when we subscribe, so update our internal state
        // while we've got the info handy
        const _handleGlobalUpdate = (initial: MultipleOccupancyGroupStatus) => {
          logDebug(`response from subscription call recd: ${util.inspect(initial, { depth: null })}`)
          this.updateState(bridge.bridgeID, initial)
        }

        // subscribe to occupancy updates for this bridge, and...
        bridge
          .subscribeToOccupancy(_handleOccupancyUpdate.bind(this))
          .then(_handleGlobalUpdate.bind(this))
        // resolve the promise that we'll subscribe to the bridge
          .then(() => resolve())
          .catch(e => reject(e))

        // when the bridge is disconnected, subscriptions are lost. re-establish them.
        bridge.on('disconnected', () => {
          bridge.subscribeToOccupancy(_handleOccupancyUpdate.bind(this))
            .then(_handleGlobalUpdate.bind(this))
            // Previously uncaught by design ("better to just blow it all up"),
            // but crashing the child bridge is the #236 failure class: the
            // restart corrupts the accessory cache and costs users their room
            // assignments. A failed re-subscribe is now observed and logged on
            // this file's debug channel (the router is a singleton with no
            // Homebridge logger), and is retried on the next 'disconnected'
            // emission.
            .catch((e) => {
              logDebug('failed to re-subscribe to occupancy updates after reconnect:', e)
            })
        })
      }),
    )
  }

  public async register(bridge: SmartBridge, occupancyGroup: Href, cb: (update: OccupancyStatus) => void) {
    // Register the specified bridge's occupancy group to have cb called
    // when there's an update. This function will subscribe to the bridge if
    // it hasn't already been done.

    // Create the key used for looking into the three state maps we're about to use
    const key = this.makeKey(bridge.bridgeID, occupancyGroup)

    // Store this registration's callback first. The bridge re-subscribes to
    // occupancy on its own after a reconnect, so the router can start receiving
    // updates before the await below finishes - and if the callback is not in
    // place by then, the updates arrive with nobody to hand them to.
    this.cbMap.set(key, cb)

    // If we're not already subscribed to this bridge's updates, let's do that.
    if (!this.subMap.has(bridge.bridgeID)) {
      logDebug(`bridge ${bridge.bridgeID} is a new bridge`)
      this.subscribeToBridge(bridge)
    }

    try {
      await this.subMap.get(bridge.bridgeID)
    } catch (e) {
      // A failed subscription used to stay in the map as a permanently rejected
      // promise, so every later attempt awaited the same stale rejection and the
      // sensor could never recover without restarting Homebridge. Drop it so the
      // next registration tries again.
      this.subMap.delete(bridge.bridgeID)
      throw e
    }

    // get stored state information for the occupancygroup that's
    // registering itself, and immediately call its callback to update it.
    // n.b. that this may not be this bridge's first registration request,
    // so the above nonsense about initial status might have happened on a
    // prior registration, and is async anyway. that's why we look in the
    // cache.
    const state = this.stateMap.get(key)
    if (state) {
      logDebug(`calling callback for ${key}`)
      cb(state)
    }
  }
}
