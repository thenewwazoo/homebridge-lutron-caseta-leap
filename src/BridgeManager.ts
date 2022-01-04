import { SmartBridge } from 'lutron-leap';

export class BridgeManager {
    private bridges: Map<string, SmartBridge> = new Map();
    private pendingBridges: Map<string,
                                Array<
                                    [
                                        (bridge: SmartBridge) => void,
                                        ReturnType<typeof setTimeout>
                                    ]
                                >
                            > = new Map(); // whew, that's a gnarly spec.

    public getBridge(bridgeID: string): Promise<SmartBridge> {
        if (this.bridges.has(bridgeID)) {
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
                rejectPending(new Error('Timed out waiting for bridge to appear'));
            }, 5000);

            const bridgePromise: Promise<SmartBridge> = new Promise((resolve: (bridge: SmartBridge) => void, reject) => {
                resolvePending = resolve;
                rejectPending = reject;
            });

            if (!this.pendingBridges.has(bridgeID)) {
                this.pendingBridges.set(bridgeID, []);
            }
            this.pendingBridges.get(bridgeID)!.push([resolvePending, pendingTimeout]);

            return bridgePromise;
        }
    }

    public addBridge(bridge: SmartBridge) {
        this.bridges.set(bridge.bridgeID, bridge);
        if (this.pendingBridges.has(bridge.bridgeID)) {
            for (const [p, t] of this.pendingBridges.get(bridge.bridgeID)!) {
                clearTimeout(t);
                p(bridge);
            }
        }
        this.pendingBridges.delete(bridge.bridgeID);
    }

    public hasBridge(bridgeID: string) {
        return this.bridges.has(bridgeID);
    }
}
