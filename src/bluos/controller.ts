import axios from 'axios'

export interface PlayerConfig {
  ip: string
  port: number
  volume: number
  preset: number
}

export interface Players {
  [key: string]: PlayerConfig
}

export interface PlayerStatus {
  isTv: boolean
  state: string
  volume: number
  slaves?: Array<{ id: string; port: string }>
  etag?: string
}

/**
 * Implements the BluOS API for controlling players.
 *
 * The BluOS API v1.7 is documented here:
 * https://bluos.io/wp-content/uploads/2025/06/BluOS-Custom-Integration-API_v1.7.pdf
 */
export class BluosController {
  private players: Players
  private masterPlayer: PlayerConfig
  private statusCache = new Map<PlayerConfig, PlayerStatus>()

  constructor(players: Players, masterPlayer: PlayerConfig) {
    this.players = players
    this.masterPlayer = masterPlayer
  }

  /**
   * Make a single HTTP request to a BluOS player
   */
  private async apiRequest(player: PlayerConfig, path: string, timeoutMs: number = 5000, quiet: boolean = false): Promise<string> {
    const url = `http://${player.ip}:${player.port}${path}`
    try {
      const response = await axios.get(url, { timeout: timeoutMs })
      return response.data
    } catch (error) {
      if (!quiet) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`Error making request to ${url}: ${errorMessage}`)
      }
      throw error
    }
  }

  /**
   * Play/pause toggle with special logic for TV source
   */
  public async playPause(player: PlayerConfig): Promise<void> {
    const status = await this.getStatus(player)

    if ((status.state === 'stream' || status.state === 'play') && !status.isTv) {
      // If playing and not TV, pause
      await this.apiRequest(player, '/Pause')
    } else if (status.state === 'pause' && !status.isTv) {
      // If paused and not TV, resume playback
      await this.apiRequest(player, '/Play')
    } else {
      // If stopped, TV source, or any other state, start fresh with preset
      await this.apiRequest(player, `/Volume?level=${player.volume}`)
      await this.apiRequest(player, `/Preset?id=${player.preset}`)
    }
  }

  /**
   * Stop playback. Generally not exposed via UI or buttons.
   */
  public async stop(player: PlayerConfig): Promise<void> {
    await this.apiRequest(player, '/Stop')
  }

  /**
   * Volume control
   */
  public async volumeUp(player: PlayerConfig, double: boolean = false): Promise<void> {
    const delta = double ? '4' : '2'
    await this.apiRequest(player, `/Volume?db=${delta}`)
  }

  public async volumeDown(player: PlayerConfig, double: boolean = false): Promise<void> {
    const delta = double ? '4' : '2'
    await this.apiRequest(player, `/Volume?db=-${delta}`)
  }

  public async volumeLevel(player: PlayerConfig, level: number): Promise<void> {
    await this.apiRequest(player, `/Volume?level=${level}`)
  }

  /**
   * Preset navigation
   */
  public async presetNext(player: PlayerConfig): Promise<void> {
    await this.apiRequest(player, '/Preset?id=+1')
  }

  public async presetPrevious(player: PlayerConfig): Promise<void> {
    await this.apiRequest(player, '/Preset?id=-1')
  }

  /**
   * Track navigation
   */
  public async skipNext(player: PlayerConfig): Promise<void> {
    await this.apiRequest(player, '/Action?action=Next')
  }

  public async skipPrevious(player: PlayerConfig): Promise<void> {
    await this.apiRequest(player, '/Action?action=Previous')
  }

  /**
   * Group / Ungroup a player with the master player
   */
  public async groupWithMaster(player: PlayerConfig): Promise<void> {
    await this.apiRequest(this.masterPlayer, `/AddSlave?slave=${player.ip}&port=${player.port}`)
  }

  public async ungroupFromMaster(player: PlayerConfig): Promise<void> {
    await this.apiRequest(this.masterPlayer, `/RemoveSlave?slave=${player.ip}&port=${player.port}`)
  }

  /**
   * Get the current status of a player, optionally using long polling
   *
   * @param player - The player to get the status of
   * @param options - Optional parameters:
   *   - longPoll: Whether to use long polling (default: false)
   *   - longPollTimeoutSec: Timeout for long polling (default: 120 seconds)
   */
  public async getStatus(player: PlayerConfig, options?: { longPoll?: boolean; longPollTimeoutSec?: number }): Promise<PlayerStatus> {
    const useLongPoll = options?.longPoll === true
    const timeoutSec = options?.longPollTimeoutSec ?? 120

    // If long polling is enabled, use the etag from the cache if it exists
    const existingEtag = this.statusCache.get(player)?.etag
    const statusPath = useLongPoll
      ? `/Status?timeout=${timeoutSec}${existingEtag ? `&etag=${encodeURIComponent(existingEtag)}` : ''}`
      : '/Status'

    // Fetch the status XML and extract the etag
    const statusXml = await this.apiRequest(player, statusPath, (useLongPoll ? (timeoutSec * 1000) : 5000), useLongPoll)
    const etagMatch = statusXml.match(/etag="([^"]*)"/)
    const etag = etagMatch?.[1]

    // Need to fetch the full status if long polling is not enabled, or the etag has changed, or the status is not in the cache
    if (!useLongPoll || (etag && etag !== existingEtag) || !this.statusCache.has(player)) {
      // Extract state and isTV from the status XML
      const stateMatch = statusXml.match(/<state>([^<]*)<\/state>/)
      const state = stateMatch?.[1] ?? ''
      const isTv = /<title1>TV<\/title1>/.test(statusXml) 
  
      // Fetch the sync status XML and extract the volume and slaves
      const syncStatusXml = await this.apiRequest(player, '/SyncStatus')
      const volumeMatch = syncStatusXml.match(/volume="([^"]*)"/)
      const volume = volumeMatch ? Number.parseInt(volumeMatch[1]) : 0
      const slavePlayers = syncStatusXml.match(/<slave[^>]*>.*?<\/slave>/g)
      const slaves = slavePlayers?.map((slaveXml) => {
        const idMatch = slaveXml.match(/id="([^"]*)"/)
        const portMatch = slaveXml.match(/port="([^"]*)"/)
        return {
          id: idMatch?.[1] ?? '',
          port: portMatch?.[1] ?? '',
        }
      }).filter(slave => slave.id !== '') ?? []
      
      // Cache the status and return it
      const currentStatus: PlayerStatus = { isTv, state, volume, slaves, etag }
      this.statusCache.set(player, currentStatus)
      return currentStatus
    } else {
      // Return last known state when no change
      return this.statusCache.get(player) ?? { isTv: false, state: '', volume: 0, slaves: [] }
    }
  }

  /**
   * Check if a player is currently playing
   */
  public async isPlaying(player: PlayerConfig): Promise<boolean> {
    const status = await this.getStatus(player)
    return (status.state === 'stream' || status.state === 'play')
  }
}
