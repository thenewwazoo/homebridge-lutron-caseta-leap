#!/bin/bash

# BluOS watcher Systemd Service Uninstaller
# This script removes the BluOS watcher systemd user service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "src/bluos/watcher/watcher.ts" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

echo -e "${YELLOW}Uninstalling BluOS watcher systemd service...${NC}"

# Stop and disable the service
echo -e "${YELLOW}Stopping and disabling the service...${NC}"
systemctl --user stop bluos-watcher.service 2>/dev/null || true
systemctl --user disable bluos-watcher.service 2>/dev/null || true

# Remove the service file
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/bluos-watcher.service"

if [ -f "$SERVICE_FILE" ]; then
    rm "$SERVICE_FILE"
    echo -e "${GREEN}Removed service file: ${SERVICE_FILE}${NC}"
else
    echo -e "${YELLOW}Service file not found: ${SERVICE_FILE}${NC}"
fi

# Reload systemd
systemctl --user watcher-reload

echo -e "${GREEN}BluOS watcher uninstalled successfully!${NC}"
