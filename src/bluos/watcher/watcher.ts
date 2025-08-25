#!/usr/bin/env node

import { BluosController } from '../controller.js';
import { players, masterPlayer } from '../config.js';

// Create the controller instance
const controller = new BluosController(players, masterPlayer);

/**
 * Checks if the living player is set to TV, and ensures it is ungrouped from the kitchen.
 * For any other source, it ensures it is grouped with kitchen.
 * Also sets volume to a ratio of the living volume based on config-defined default volumes (25 living, 10 kitchen).
 */
async function updateLivingKitchenSyncState(longPollTimeoutSec: number): Promise<void> {
  const livingStatus = await controller.getStatus(players.living, { longPoll: true, longPollTimeoutSec });
  
  // Skip processing if we got an error status
  if (livingStatus.state === 'error') {
    console.log('Skipping sync logic due to error status from living player');
    return;
  }
  
  if (livingStatus.isTv) {
    // If living source is TV, ungroup it from any players it is grouped with
    if (livingStatus.slaves && livingStatus.slaves.length > 0) {
      // Ungroup all slave players from living
      for (const slave of livingStatus.slaves) {
        const slavePlayer = Object.values(players).find(player => player.ip === slave.id);
        if (slavePlayer) {
          await controller.ungroupFromMaster(slavePlayer);
        }
      }
      console.log(`Source set to TV, ungrouped all players from living.`);
    }
  } else {
    // Group kitchen with living if source is anything other than TV and it is not already a slave
    if (!livingStatus.slaves?.some(slave => slave.id === players.kitchen.ip)) {
      await controller.volumeLevel(players.kitchen, Math.round(livingStatus.volume / 2.5));
      await controller.groupWithMaster(players.kitchen);
      console.log(`Source is NOT set to TV, grouped kitchen with living. Living volume is ${livingStatus.volume}; set kitchen volume to round(${livingStatus.volume}/2.5) = ${Math.round(livingStatus.volume / 2.5)}.`);
    }
  }
}

console.log('BluOS Living/Kitchen sync watcher started');

let consecutiveFailures = 0;
const maxBackoffSec = 10; // 10 seconds max backoff
const longPollTimeoutSec = 120; // 120 seconds long poll timeout

for (;;) {
  try {
    await updateLivingKitchenSyncState(longPollTimeoutSec);
    consecutiveFailures = 0; // Reset on success
  } catch (err) {
    // Check if this is an expected timeout from long polling (not a real error)
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ECONNABORTED') {
      // Don't increment failure count for expected timeouts
      continue;
    }
    
    // This is a real error, handle with retry logic
    consecutiveFailures++;
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(new Date(), `Living/Kitchen sync state update failed (attempt ${consecutiveFailures}):`, errorMessage)
    
    // Exponential backoff: 2s, 4s, 8s, 16s, 10s, 10s...
    const backoffSec = Math.min(2 * (2 ** (consecutiveFailures - 1)), maxBackoffSec);
    console.log(`Waiting ${backoffSec}s before retry...`);
    await new Promise(resolve => setTimeout(resolve, backoffSec * 1000));
  }
}
