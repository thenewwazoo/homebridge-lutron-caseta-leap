#!/usr/bin/env node

import type { PlayerStatus } from './controller.js'

import process from 'node:process'

import { players } from './config.js'
import { BluosController } from './controller.js'

// CLI argument parsing
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: bluos <player> <command> [arg]')
  console.error('Commands:')
  console.error('  playpause')
  console.error('  stop')
  console.error('  status')
  console.error('  isplaying')
  console.error('  preset <next|previous>')
  console.error('  skip <next|previous>')
  console.error('  volume <[level]|up|down>')
  console.error('Players:', Object.keys(players).join(', '))
  process.exit(1)
}

const [playerName, command] = args
const subcommand = args[2]
const level = args[3]

// Validate command
if (!['playpause', 'stop', 'status', 'isplaying', 'preset', 'skip', 'volume'].includes(command)) {
  console.error(`Invalid command '${command}'. Must be one of: playpause, stop, status, isplaying, preset, skip, volume`)
  process.exit(1)
}

// Validate subcommands for commands that need them
if (['preset', 'skip', 'volume'].includes(command)) {
  if (!subcommand) {
    console.error(`Command '${command}' requires a subcommand`)
    if (command === 'preset') console.error('Subcommands: next, previous')
    if (command === 'skip') console.error('Subcommands: next, previous')
    if (command === 'volume') console.error('Subcommands: level, up, down')
    process.exit(1)
  }
  
  if (command === 'preset' && !['next', 'previous'].includes(subcommand)) {
    console.error('Invalid preset subcommand. Must be: next, previous')
    process.exit(1)
  }
  
  if (command === 'skip' && !['next', 'previous'].includes(subcommand)) {
    console.error('Invalid skip subcommand. Must be: next, previous')
    process.exit(1)
  }
  
  if (command === 'volume') {
    // Check if subcommand is a number (level) or valid subcommand
    const levelNum = parseInt(subcommand)
    if (isNaN(levelNum)) {
      // Not a number, must be 'up' or 'down'
      if (!['up', 'down'].includes(subcommand)) {
        console.error('Invalid volume subcommand. Must be: up, down, or a number (0-100)')
        process.exit(1)
      }
    } else {
      // It's a number, validate the range
      if (levelNum < 0 || levelNum > 100) {
        console.error('Volume level must be a number between 0 and 100')
        process.exit(1)
      }
    }
  }
}

// Validate player
if (!players[playerName]) {
  console.error(`Invalid player: ${playerName}`)
  console.error('Available players:', Object.keys(players).join(', '))
  process.exit(1)
}

// Initialize controller
const masterPlayer = players[Object.keys(players)[0]] // Use first player as master
const controller = new BluosController(players, masterPlayer)
const player = players[playerName]
let status: PlayerStatus | null = null

// Execute command
async function main() {
  try {
    switch (command) {
      case 'playpause':
        await controller.playPause(player)
        console.log(`Play/pause command sent to ${playerName}`)
        break

      case 'stop':
        await controller.stop(player)
        console.log(`Stop command sent to ${playerName}`)
        break

        case 'status':
          const status = await controller.getStatus(player)
          console.log(status)
          break

        case 'isplaying': 
          const isPlaying = await controller.isPlaying(player)
          console.log(`${isPlaying}`)
          process.exit(isPlaying ? 0 : 1)
          break
    
  
      case 'preset':
        if (subcommand === 'next') {
          await controller.presetNext(player)
          console.log(`Preset next sent to ${playerName}`)
        } else {
          await controller.presetPrevious(player)
          console.log(`Preset previous sent to ${playerName}`)
        }
        break

      case 'skip':
        if (subcommand === 'next') {
          await controller.skipNext(player)
          console.log(`Skip next sent to ${playerName}`)
        } else {
          await controller.skipPrevious(player)
          console.log(`Skip previous sent to ${playerName}`)
        }
        break

      case 'volume':
        const level = parseInt(subcommand)
        if (subcommand === 'up') {
          await controller.volumeUp(player)
          console.log(`Volume up sent to ${playerName}`)
        } else if (subcommand === 'down') {
          await controller.volumeDown(player)
          console.log(`Volume down sent to ${playerName}`)
        } else if (!isNaN(level)) {
          await controller.volumeLevel(player, level)
          console.log(`Volume set to ${level} on ${playerName}`)
        }
        break

      default:
        console.error('Unknown command')
        process.exit(1)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
