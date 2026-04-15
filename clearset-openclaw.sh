#!/bin/bash
# ─────────────────────────────────────────────────────────────
# clearset-openclaw.sh
# Remove cursor-bridge integration from OpenClaw config
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
BACKUP="${OPENCLAW_CONFIG}.bak.pre-cursor-bridge"
PROVIDER_NAME="cursor-cli"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  cursor-bridge → OpenClaw: remove integration     │"
echo "└──────────────────────────────────────────────────┘"
echo ""

[ -f "$OPENCLAW_CONFIG" ] || fail "OpenClaw config not found: $OPENCLAW_CONFIG"

# ── Restore from backup if available ────────────────────────
if [ -f "$BACKUP" ]; then
  read -rp "Restore OpenClaw config from backup ($BACKUP)? [Y/n] " ans_restore
  if [[ -z "$ans_restore" || "$ans_restore" =~ ^[Yy] ]]; then
    cp "$BACKUP" "$OPENCLAW_CONFIG"
    rm -f "$BACKUP"
    ok "Restored $OPENCLAW_CONFIG from backup"
  else
    info "Removing cursor-cli provider from current config..."
    _remove_provider=true
  fi
else
  warn "No backup found — removing cursor-cli provider from current config"
  _remove_provider=true
fi

# ── Remove cursor-cli provider from config ───────────────────
if [[ "${_remove_provider:-false}" == "true" ]]; then
  node -e "
const fs = require('fs');
const configPath = process.argv[1];
const providerName = process.argv[2];

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

if (config.models?.providers?.[providerName]) {
  delete config.models.providers[providerName];
  console.log('Removed provider: ' + providerName);
} else {
  console.log('Provider not found: ' + providerName + ' (nothing to remove)');
}

// Clear default model reference if it points to cursor-cli
const primary = config.agents?.defaults?.model?.primary || '';
if (primary.startsWith(providerName + '/')) {
  delete config.agents.defaults.model.primary;
  console.log('Cleared default model reference');
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" "$OPENCLAW_CONFIG" "$PROVIDER_NAME"
  ok "OpenClaw config updated"
fi

# ── Restart OpenClaw gateway ─────────────────────────────────
echo ""
if command -v openclaw &>/dev/null; then
  read -rp "Restart OpenClaw gateway now? [Y/n] " ans_restart
  if [[ -z "$ans_restart" || "$ans_restart" =~ ^[Yy] ]]; then
    info "Restarting OpenClaw gateway..."
    openclaw gateway stop 2>/dev/null || true
    sleep 1
    nohup openclaw gateway >/dev/null 2>&1 &
    sleep 2
    ok "OpenClaw gateway restarted"
  else
    info "Restart manually: openclaw gateway stop && openclaw gateway"
  fi
fi

echo ""
echo "Done."
echo ""
