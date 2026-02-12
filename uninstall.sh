#!/bin/bash
# ─────────────────────────────────────────────────────────────
# openclaw-bridge-cursorcli uninstaller
#
# Restores OpenClaw config from backup and removes auto-start.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
BACKUP="$OPENCLAW_CONFIG.bak.pre-cursor-bridge"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
info() { echo -e "${CYAN}ℹ${NC}  $*"; }

echo ""
echo "openclaw-bridge-cursorcli uninstaller"
echo "────────────────────────────────────────"
echo ""

# Stop bridge
if pgrep -f "cursor-bridge.mjs" >/dev/null 2>&1; then
  "$SCRIPT_DIR/stop.sh" 2>/dev/null || pkill -f "cursor-bridge.mjs" 2>/dev/null
  ok "Stopped cursor-bridge"
fi

# Restore OpenClaw config
if [ -f "$BACKUP" ]; then
  read -rp "Restore OpenClaw config from backup? [Y/n] " ans
  if [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; then
    cp "$BACKUP" "$OPENCLAW_CONFIG"
    ok "Restored $OPENCLAW_CONFIG from backup"
  fi
else
  warn "No backup found at $BACKUP — manual restore needed"
fi

# Remove auto-start from .bashrc
BASHRC="$HOME/.bashrc"
if grep -qF "cursor-bridge auto-start" "$BASHRC" 2>/dev/null; then
  # Remove the block (marker line + next 3 lines)
  sed -i '/# cursor-bridge auto-start/,+3d' "$BASHRC"
  ok "Removed auto-start from ~/.bashrc"
fi

# Cleanup generated files
rm -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/.cursor-bridge.pid" "$SCRIPT_DIR/cursor-bridge.log"
ok "Cleaned up generated files"

echo ""
echo "Done. Restart OpenClaw gateway to apply: openclaw gateway stop && openclaw gateway"
echo ""
