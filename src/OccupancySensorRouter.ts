import debug from 'debug';
import util from 'util';

import { Response, Href, OccupancyStatus, MultipleOccupancyGroupStatus, SmartBridge } from 'lutron-leap';

const logDebug = debug('leap:bridge');

export class OccupancySensorRouter {
    static instance: OccupancySensorRouter;

    // map (bridgeID, occupancygroup Hrefs) to their callbacks
    private cbMap: Map<string, (status: OccupancyStatus) => void>;
    // map that tracks bridge subscriptions
    private subMap: Map<string, Promise<void>>;
    // map to track state information
    private stateMap: Map<string, OccupancyStatus>;

    private constructor() {
        this.cbMap = new Map();
        this.subMap = new Map();
        this.stateMap = new Map();
    }

    private makeKey(bridgeID: string, ocg: Href): string {
        return bridgeID + '_' + ocg.href;
    }

    private updateState(bridgeID: string, update: MultipleOccupancyGroupStatus) {
        logDebug('update state');
        logDebug(util.inspect(update, { depth: null }));
        for (const grpStat of update.OccupancyGroupStatuses) {
            const key = this.makeKey(bridgeID, grpStat.OccupancyGroup);
            logDebug(`handling update for ${util.inspect(key, { depth: null })} to ${grpStat.OccupancyStatus}`);
            this.stateMap.set(key, grpStat.OccupancyStatus);
        }
    }

    private callRegistered(bridgeID: string, update: MultipleOccupancyGroupStatus) {
        for (const grpStat of update.OccupancyGroupStatuses) {
            const key = this.makeKey(bridgeID, grpStat.OccupancyGroup);
            logDebug(`calling cb for ${util.inspect(key, { depth: null })} to ${grpStat.OccupancyStatus}`);
            const cb = this.cbMap.get(key);
            if (cb) {
                cb(grpStat.OccupancyStatus);
            }
        }
    }

    public static getInstance(): OccupancySensorRouter {
        if (!OccupancySensorRouter.instance) {
            OccupancySensorRouter.instance = new OccupancySensorRouter();
        }

        return OccupancySensorRouter.instance;
    }

    private async subscribeToBridge(bridge: SmartBridge) {
        // Subscribe to occupancy updates for the provided bridge.

        this.subMap.set(
            bridge.bridgeID,
            new Promise((resolve, reject) => {
                // subscribe to occupancy updates for this bridge, and...
                bridge
                    .subscribeToOccupancy(
                        ((r: Response) => {
                            logDebug('subscription cb called');
                            // ...update state and call all registered callbacks when we get an update
                            this.updateState(bridge.bridgeID, r.Body! as MultipleOccupancyGroupStatus);
                            this.callRegistered(bridge.bridgeID, r.Body! as MultipleOccupancyGroupStatus);
                        }).bind(this),
                    )
                    .then(
                        ((initial: MultipleOccupancyGroupStatus) => {
                            // we get a complete listing of occupancy groups and their
                            // statuses when we subscribe, so update our internal state
                            // while we've got the info handy

                            logDebug(`response from subscription call recd: ${util.inspect(initial, { depth: null })}`);
                            this.updateState(bridge.bridgeID, initial);

                            // resolve the promise that we'll subscribe to the bridge
                            resolve();
                        }).bind(this),
                    )
                    .catch((e) => reject(e));
            }),
        );
    }

    public async register(bridge: SmartBridge, occupancyGroup: Href, cb: (update: OccupancyStatus) => void) {
        // Register the specified bridge's occupancy group to have cb called
        // when there's an update. This function will subscribe to the bridge if
        // it hasn't already been done.

        // The key into the three state maps
        const key = this.makeKey(bridge.bridgeID, occupancyGroup);

        // If we're not already subscribed to this bridge's updates, let's do that.
        if (!this.subMap.has(bridge.bridgeID)) {
            logDebug(`bridge ${bridge.bridgeID} is a new bridge`);
            this.subscribeToBridge(bridge);
        }
        await this.subMap.get(bridge.bridgeID);

        // Store this registration's callback
        this.cbMap.set(key, cb);

        // get stored state information for the occupancygroup that's
        // registering itself, and immediately call its callback to update it.
        // n.b. that this may not be this bridge's first registration request,
        // so the above nonsense about initial status might have happened on a
        // prior registration, and is async anyway. that's why we look in the
        // cache.
        const state = this.stateMap.get(key);
        if (state) {
            logDebug(`calling callback for ${key}`);
            cb(state);
        }
    }
}
