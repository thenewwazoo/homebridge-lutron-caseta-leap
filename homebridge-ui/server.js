const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const { BridgeFinder, LeapClient, PairingClient } = require('lutron-leap');

const forge = require('node-forge');

class PluginUiServer extends HomebridgePluginUiServer {
    constructor() {
        // super() MUST be called first
        super();

        this.finder = new BridgeFinder();
        this.finder.on('discovered', (bridgeInfo) => {
            this.pushEvent('discovered', bridgeInfo);
        });

        this.onRequest('/search', this.findBridges.bind(this));
        this.onRequest('/connect', this.doConnect.bind(this));
        this.onRequest('/associate', this.doAssociate.bind(this));

        // this MUST be called when you are ready to accept requests
        this.ready();
    }

    async findBridges() {
        this.finder.beginSearching();
    }

    async doConnect({ secrets, bridgeid, ipAddr }) {
        console.log('Got request to connect', bridgeid, 'at', ipAddr, ' with secrets', JSON.stringify(secrets));
        try {
            const client = new LeapClient(ipAddr, 8081 /*TODO magic number*/, secrets.ca, secrets.key, secrets.cert);
            await client.connect();
            console.log('client connected to', bridgeid, ipAddr);
            // TODO actually do a ping here, maybe return LEAP version?
        } catch (e) {
            console.log('failed to connect to', bridgeid, e);
            this.pushEvent('failed', { bridgeid: bridgeid, reason: e.message });
            throw e;
        }
        this.pushEvent('connected', '032E7E88');
    }

    async doAssociate({ bridgeid, ipAddr }) {
        /***
         * This is kind of a long, ugly one. Here's what this does:
         * - Creates a new PairingClient w/ some default SSL credentials
         * - Waits for a special kind of message to come down the wire that indicates
         *   that the button has been pressed.
         * - Generate a new RSA keypair
         * - Create a certification signing request (PKCS#10)
         * - Submit it to the bridge and wait for a special kind of response
         *   that includes the signed certificate
         * - Return the newly-generated privkey, cert, and CA to the UI
         ***/

        // Create a new pairing client w/ some default SSL credentials
        console.log('Got request to associate with', bridgeid, 'at', ipAddr);
        const client = new PairingClient(ipAddr, 8083 /*TODO magic number*/);
        try {
            await client.connect();
            console.log('association phase connected', bridgeid, ipAddr);
        } catch (e) {
            console.log('failed to associate', bridgeid, ipAddr, e);
            throw new Error('Initial associate failed!');
        }

        // Wait for a special kind of message to come down the wire that
        // indicates that the button has been pressed.
        try {
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('timed out')), 30000);
                client.once('message', (response) => {
                    console.log('got message', response);
                    if (response.Body.Status.Permissions.includes('PhysicalAccess')) {
                        console.log('Physical access confirmed');
                        clearTimeout(t);
                        resolve();
                    } else {
                        console.log('unexpected pairing result', response);
                        reject(response);
                    }
                });
            });
        } catch (e) {
            console.log('waiting for button push failed', e);
            throw e;
        }

        // Generate a new RSA keypair
        const keys = await new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err, keyPair) => {
                if (err !== undefined) {
                    resolve(keyPair);
                } else {
                    reject(err);
                }
            });
        });

        // Create a certification signing request (PKCS#10)
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keys.publicKey;
        csr.setSubject([
            {
                name: 'commonName',
                value: 'homebridge-lutron-caseta-leap',
            },
        ]);
        csr.sign(keys.privateKey);
        const csrText = forge.pki.certificationRequestToPem(csr);

        // Submit it to the bridge and wait for a special kind of response that
        // includes the signed certificate
        let certResult;
        try {
            certResult = await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('CSR response timed out')), 5000);
                client.once('message', (response) => {
                    console.log('got cert request result', JSON.stringify(response));
                    resolve(response);
                });

                client.requestPair(csrText);
            });

            if (certResult.Header.StatusCode !== '200 OK') {
                throw new Error('bad CSR response: ' + JSON.stringify(certResult));
            }
        } catch (e) {
            console.log('CSR failed', e);
            throw e;
        }

        // Return the newly-generated privkey, cert, and CA to the UI
        this.pushEvent('associated', {
            bridgeid: bridgeid,
            ipAddr: ipAddr,
            secrets: {
                bridgeid: bridgeid,
                ca: certResult.Body.SigningResult.RootCertificate,
                cert: certResult.Body.SigningResult.Certificate,
                key: forge.pki.privateKeyToPem(keys.privateKey),
            },
        });
    }
}

(() => {
    return new PluginUiServer();
})();
