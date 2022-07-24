import { SmartBridge } from 'lutron-leap';
import { LutronCasetaLeap } from './platform';

import * as util from 'util';

export class BridgeManager {
    /* When restoring accessories from the cache, the mDNS-based bridge
     * autodetection isn't yet running. This means we know the ID of a bridge
     * that we _expect_ to discover. In order to defer the operations that
     * require a connection to that bridge (such as subscribing to button
     * events), getBridge returns a Promise for the bridge. We store its
     * resolve and reject functions in the `pendingBridges` map. When it arrives,
     * we resolve the promise and store the connected bridge in the `bridges`
     * map. Because a bridge can be requested multiple times, we store an array
     * of resolve/reject pairs, and resolve them all.
     */
    private bridges: Map<string, SmartBridge> = new Map();
    private pendingBridges: Map<string, Array<[(bridge: SmartBridge) => void, ReturnType<typeof setTimeout>]>> =
        new Map(); // whew, that's a gnarly spec.

    constructor(private platform: LutronCasetaLeap) {}

    public getBridge(bridgeID: string): Promise<SmartBridge> {
        this.platform.log.debug('got request for bridge', bridgeID);

        if (this.bridges.has(bridgeID)) {
            this.platform.log.debug('had bridge', bridgeID);
            return Promise.resolve(this.bridges.get(bridgeID)!);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let resolvePending = function (_bridge: SmartBridge): void {
                // this gets replaced
            };

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let rejectPending = function (_e: Error): void {
                // this gets replaced
            };

            const pendingTimeout = setTimeout(() => {
                this.platform.log.error('pending map was', util.inspect(this.pendingBridges));
                this.platform.log.error('constructed bridges', util.inspect(this.bridges));
                rejectPending(new Error('Timed out waiting for bridge to appear'));
            }, 15000);

            const bridgePromise: Promise<SmartBridge> = new Promise(
                (resolve: (bridge: SmartBridge) => void, reject) => {
                    resolvePending = resolve;
                    rejectPending = reject;
                },
            );

            if (!this.pendingBridges.has(bridgeID)) {
                this.pendingBridges.set(bridgeID, []);
            }
            this.pendingBridges.get(bridgeID)!.push([resolvePending, pendingTimeout]);

            return bridgePromise;
        }
    }

    public addBridge(bridge: SmartBridge) {
        this.platform.log.debug('got request to add bridge', bridge.bridgeID);
        this.bridges.set(bridge.bridgeID, bridge);
        if (this.pendingBridges.has(bridge.bridgeID)) {
            this.platform.log.debug('someone was awaiting bridge', bridge.bridgeID);
            for (const [p, t] of this.pendingBridges.get(bridge.bridgeID)!) {
                clearTimeout(t);
                p(bridge);
            }
        }
        this.pendingBridges.delete(bridge.bridgeID);
    }

    public hasBridge(bridgeID: string) {
        this.platform.log.debug(`seeking bridge ${bridgeID}`);
        return this.bridges.has(bridgeID);
    }
}
