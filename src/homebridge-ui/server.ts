import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'
import { BridgeFinder, LeapClient, PairingClient } from 'lutron-leap'
import forge from 'node-forge'

interface Secrets {
  ca: string
  key: string
  cert: string
}

interface ConnectParams {
  secrets: Secrets
  bridgeid: string
  ipAddr: string
}

interface AssociateParams {
  bridgeid: string
  ipAddr: string
}

class PluginUiServer extends HomebridgePluginUiServer {
  private finder: BridgeFinder

  constructor() {
    super()
    this.finder = new BridgeFinder()
    this.finder.on('discovered', (bridgeInfo) => {
      this.pushEvent('discovered', bridgeInfo)
    })

    this.onRequest('/search', this.findBridges.bind(this))
    this.onRequest('/connect', this.doConnect.bind(this))
    this.onRequest('/associate', this.doAssociate.bind(this))

    this.ready()
  }

  async findBridges(): Promise<void> {
    this.finder.beginSearching()
  }

  async doConnect({ secrets, bridgeid, ipAddr }: ConnectParams): Promise<void> {
    // console.log('Got request to connect', bridgeid, 'at', ipAddr, ' with secrets', JSON.stringify(secrets))
    this.pushEvent('toast', { message: `Got request to connect ${bridgeid} at ${ipAddr} with secrets ${JSON.stringify(secrets)}` })
    try {
      const client = new LeapClient(ipAddr, 8081, secrets.ca, secrets.key, secrets.cert)
      await client.connect()
      // console.log('client connected to', bridgeid, ipAddr)
      this.pushEvent('toast', { message: `client connected to ${bridgeid}, ${ipAddr}` })
    } catch (e: any) {
      // console.log('failed to connect to', bridgeid, e)
      this.pushEvent('toast', { message: `failed to connect to ${bridgeid}, ${e.message ?? e}` })
      this.pushEvent('failed', { bridgeid, reason: (e as Error).message })
      throw e
    }
    this.pushEvent('connected', bridgeid)
  }

  async doAssociate({ bridgeid, ipAddr }: AssociateParams): Promise<void> {
    // console.info('Got request to associate with', bridgeid, 'at', ipAddr)
    this.pushEvent('toast', { message: `Got request to associate with ${bridgeid} at ${ipAddr}` })
    const client = new PairingClient(ipAddr, 8083)
    try {
      await client.connect()
      // console.info('association phase connected', bridgeid, ipAddr)
      this.pushEvent('toast', { message: `Association phase connected: ${bridgeid} at ${ipAddr}` })
    } catch (e: any) {
      // console.warn('failed to associate', bridgeid, ipAddr, e)
      this.pushEvent('toast', { message: `failed to associate: ${bridgeid}, ${ipAddr}, ${e.message ?? e}` })
      throw new Error('Initial associate failed!')
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out')), 30000)
        client.once('message', (response) => {
          // console.log('got message', response)
          this.pushEvent('toast', { message: `got message ${response}` })
          const res = response as { Body: { Status: { Permissions: string[] } } }
          if (res.Body.Status.Permissions.includes('PhysicalAccess')) {
            // console.log('Physical access confirmed')
            this.pushEvent('toast', { message: `Physical access confirmed` })
            clearTimeout(t)
            resolve()
          } else {
            // console.log('unexpected pairing result', response)
            this.pushEvent('toast', { message: `unexpected pairing result, ${response}` })
            reject(response)
          }
        })
      })
    } catch (e: any) {
      // console.log('waiting for button push failed', e)
      this.pushEvent('toast', { message: `waiting for button push failed, ${e.message ?? e}` })
      throw e
    }

    const keys = await new Promise<forge.pki.KeyPair>((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err, keyPair) => {
        if (err !== undefined) {
          resolve(keyPair)
        } else {
          reject(err)
        }
      })
    })

    const csr = forge.pki.createCertificationRequest()
    csr.publicKey = keys.publicKey
    csr.setSubject([
      {
        name: 'commonName',
        value: 'homebridge-lutron',
      },
    ])
    csr.sign(keys.privateKey as forge.pki.rsa.PrivateKey)
    const csrText = forge.pki.certificationRequestToPem(csr)

    let certResult
    try {
      certResult = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('CSR response timed out')), 5000)
        client.once('message', (response) => {
          // console.log('got cert request result', JSON.stringify(response))
          this.pushEvent('toast', { message: `got cert request result ${JSON.stringify(response)}, ${t}` })
          resolve(response)
        })

        client.requestPair(csrText)
      })

      if (certResult.Header.StatusCode !== '200 OK') {
        throw new Error(`bad CSR response: ${JSON.stringify(certResult)}`)
      }
    } catch (e: any) {
      // console.log('CSR failed', e)
      this.pushEvent('toast', { message: `CSR failed, ${e.message ?? e}` })
      throw e
    }

    this.pushEvent('associated', {
      bridgeid,
      ipAddr,
      secrets: {
        bridgeid,
        ca: certResult.Body.SigningResult.RootCertificate,
        cert: certResult.Body.SigningResult.Certificate,
        key: forge.pki.privateKeyToPem(keys.privateKey),
      },
    })
  }
}

(() => {
  return new PluginUiServer()
})()
