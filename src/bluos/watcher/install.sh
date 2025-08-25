#!/bin/bash

# BluOS watcher systemd service installer
# This script installs the BluOS watcher as a systemd user service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Installing BluOS watcher as systemd service...${NC}"

# Get the current user
CURRENT_USER=$(whoami)
echo -e "${YELLOW}Installing for user: ${CURRENT_USER}${NC}"

# Check if we're in the right directory
if [ ! -f "src/bluos/watcher/watcher.ts" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

# Check if the watcher is already built
if [ ! -f "dist/bluos/watcher/watcher.js" ]; then
    echo -e "${RED}Error: watcher not built. Run 'npm run build' first.${NC}"
    exit 1
fi

# Create the systemd user directory if it doesn't exist
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"

# Copy the service file and replace placeholders
SERVICE_FILE="$SYSTEMD_USER_DIR/bluos-watcher.service"
cp src/bluos/watcher/bluos-watcher.service "$SERVICE_FILE"

# Get the current project directory (absolute path)
PROJECT_DIR=$(pwd)
echo -e "${YELLOW}Project directory: ${PROJECT_DIR}${NC}"

# Replace placeholders with actual values
sed -i.bak "s|%i|$CURRENT_USER|g" "$SERVICE_FILE"
sed -i.bak "s|%h|$HOME|g" "$SERVICE_FILE"
sed -i.bak "s|%p|$PROJECT_DIR|g" "$SERVICE_FILE"

# Remove backup file
rm "${SERVICE_FILE}.bak"

echo -e "${GREEN}Service file installed to: ${SERVICE_FILE}${NC}"

# Enable and start the service
echo -e "${YELLOW}Enabling and starting the service...${NC}"
systemctl --user daemon-reload
systemctl --user enable bluos-watcher.service
systemctl --user start bluos-watcher.service

# Check service status
echo -e "${YELLOW}Service status:${NC}"
systemctl --user status bluos-watcher.service --no-pager

echo -e "${GREEN}BluOS watcher installed successfully!${NC}"
echo -e "${YELLOW}To manage the service:${NC}"
echo -e "  Start:   systemctl --user start bluos-watcher.service"
echo -e "  Stop:    systemctl --user stop bluos-watcher.service"
echo -e "  Restart: systemctl --user restart bluos-watcher.service"
echo -e "  Status:  systemctl --user status bluos-watcher.service"
echo -e "  Logs:    journalctl --user -u bluos-watcher.service -f"
