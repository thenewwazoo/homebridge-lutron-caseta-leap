# BluOS watcher Systemd Service

This document explains how to install and manage the BluOS watcher as a systemd service.

## Overview

The BluOS watcher is a background service that synchronizes the Living/Kitchen audio zones. It polls the sync state every 5 seconds to maintain audio synchronization.

## Installation

### 1. Install as Systemd Service

Run the installation script from the project root:

```bash
./src/bluos/watcher/install.sh
```

This script will:
- Build the project
- Create the systemd user service file
- Enable and start the service
- Show the service status

### 2. Manual Installation

If you prefer to install manually:

1. Build the project: `npm run build`
2. Copy the service file to your systemd user directory:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp bluos-watcher.service ~/.config/systemd/user/
   ```
3. Edit the service file to replace placeholders with your actual paths
4. Enable and start the service:
   ```bash
   systemctl --user watcher-reload
   systemctl --user enable bluos-watcher.service
   systemctl --user start bluos-watcher.service
   ```

## Service Management

### Start the Service
```bash
systemctl --user start bluos-watcher.service
```

### Stop the Service
```bash
systemctl --user stop bluos-watcher.service
```

### Restart the Service
```bash
systemctl --user restart bluos-watcher.service
```

### Check Service Status
```bash
systemctl --user status bluos-watcher.service
```

### View Service Logs
```bash
journalctl --user -u bluos-watcher.service -f
```

## Deployment Integration

The watcher is automatically restarted when you run `npm run deploy`. The deploy script now includes:

1. Build the project
2. Push code to the server
3. Restart the homebridge service
4. **Restart the BluOS watcher service** (new!)

## Uninstallation

To remove the systemd service, run from the project root:

```bash
./src/bluos/watcher/uninstall.sh
```

Or manually:
```bash
systemctl --user stop bluos-watcher.service
systemctl --user disable bluos-watcher.service
rm ~/.config/systemd/user/bluos-watcher.service
systemctl --user watcher-reload
```

## Troubleshooting

### Service Won't Start
- Check the service logs: `journalctl --user -u bluos-watcher.service -n 50`
- Verify the paths in the service file are correct
- Ensure the project is built (`npm run build`)

### Service Stops Unexpectedly
- The service is configured with `Restart=always` and will automatically restart
- Check logs for error messages that might indicate configuration issues

### Permission Issues
- The service runs as a user service, so it should have access to your home directory
- Ensure the working directory path in the service file is correct

## Service Configuration

The service file (`bluos-watcher.service`) includes:

- **Type**: Simple (runs the watcher process)
- **User**: Current user (via %i placeholder)
- **WorkingDirectory**: Project directory (via %h placeholder)
- **Restart**: Always (automatically restarts if it fails)
- **RestartSec**: 10 seconds (delay before restart)
- **StandardOutput/Error**: Journal (logs to systemd journal)

## Notes

- This is a **user service**, not a system service, so it runs under your user account
- The service will automatically start on boot if enabled
- The watcher polls every 5 seconds by default (configurable in the code)
- All output is logged to the systemd journal for easy monitoring
