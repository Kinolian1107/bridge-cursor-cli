#!/bin/bash
# ─────────────────────────────────────────────────────────────
# cursor-bridge uninstaller
#
# Stops the bridge, optionally restores OpenClaw config from
# backup, and removes auto-start entry.
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
echo "cursor-bridge uninstaller"
echo "──────────────────────────"
echo ""

# Stop bridge
if pgrep -f "cursor-bridge.mjs" >/dev/null 2>&1; then
  "$SCRIPT_DIR/stop.sh" 2>/dev/null || pkill -f "cursor-bridge.mjs" 2>/dev/null
  ok "Stopped cursor-bridge"
fi

# Restore OpenClaw config (only if backup exists)
if [ -f "$BACKUP" ]; then
  read -rp "Restore OpenClaw config from backup? [Y/n] " ans
  if [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; then
    cp "$BACKUP" "$OPENCLAW_CONFIG"
    ok "Restored $OPENCLAW_CONFIG from backup"
    info "Restart OpenClaw gateway to apply: openclaw gateway stop && openclaw gateway"
  fi
fi

# Remove auto-start from .bashrc
BASHRC="$HOME/.bashrc"
if grep -qF "cursor-bridge auto-start" "$BASHRC" 2>/dev/null; then
  sed -i '/# cursor-bridge auto-start/,+3d' "$BASHRC"
  ok "Removed auto-start from ~/.bashrc"
fi

# Cleanup generated files
rm -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/cursor-bridge.pid"
if [ -d "$SCRIPT_DIR/logs" ]; then
  read -rp "Delete logs/ directory? [y/N] " ans_logs
  if [[ "$ans_logs" =~ ^[Yy] ]]; then
    rm -rf "$SCRIPT_DIR/logs"
    ok "Deleted logs/"
  fi
fi
ok "Cleaned up generated files"

echo ""
echo "Done."
echo ""
