#!/bin/bash
# ─────────────────────────────────────────────────────────────
# clearset-hermesagent.sh
# Remove cursor-bridge integration from Hermes Agent config
# ─────────────────────────────────────────────────────────────

set -euo pipefail

HERMES_DIR="${HERMES_DIR:-$HOME/.hermes}"
HERMES_CONFIG="$HERMES_DIR/config.yaml"
BACKUP="${HERMES_CONFIG}.bak.pre-cursor-bridge"
HERMES_BIN="${HERMES_BIN:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  cursor-bridge → Hermes Agent: remove integration │"
echo "└──────────────────────────────────────────────────┘"
echo ""

# ── Find hermes binary ───────────────────────────────────────
if [ -z "$HERMES_BIN" ]; then
  if command -v hermes &>/dev/null; then
    HERMES_BIN="$(command -v hermes)"
  elif [ -x "$HOME/.local/bin/hermes" ]; then
    HERMES_BIN="$HOME/.local/bin/hermes"
  else
    fail "hermes binary not found"
  fi
fi

[ -f "$HERMES_CONFIG" ] || fail "Hermes config not found: $HERMES_CONFIG"

# ── Show current config ───────────────────────────────────────
CURRENT_MODEL=$(grep -A4 "^model:" "$HERMES_CONFIG" 2>/dev/null | grep "default:" | awk '{print $2}' || echo "unknown")
CURRENT_BASE_URL=$(grep -A4 "^model:" "$HERMES_CONFIG" 2>/dev/null | grep "base_url:" | awk '{print $2}' || echo "")
info "Current model:   $CURRENT_MODEL"
[ -n "$CURRENT_BASE_URL" ] && info "Current baseUrl: $CURRENT_BASE_URL"
echo ""

# ── Restore from backup if available ────────────────────────
if [ -f "$BACKUP" ]; then
  read -rp "Restore Hermes config from backup ($BACKUP)? [Y/n] " ans_restore
  if [[ -z "$ans_restore" || "$ans_restore" =~ ^[Yy] ]]; then
    cp "$BACKUP" "$HERMES_CONFIG"
    rm -f "$BACKUP"
    ok "Restored $HERMES_CONFIG from backup"
  else
    info "Resetting model config to Hermes defaults..."
    _reset_config=true
  fi
else
  warn "No backup found — resetting model config to Hermes defaults"
  _reset_config=true
fi

# ── Reset to default Hermes (NousResearch) provider ─────────
if [[ "${_reset_config:-false}" == "true" ]]; then
  # Check if cursor-bridge base_url is still set
  if grep -q "http://127.0.0.1:" "$HERMES_CONFIG" 2>/dev/null; then
    warn "Config still points to a local bridge."
    echo "  Options:"
    echo "    1) Reset to NousResearch hosted (hermes model)"
    echo "    2) Leave as-is"
    read -rp "  Choice [1/2]: " ans_reset
    if [[ "$ans_reset" == "1" ]]; then
      "$HERMES_BIN" config set model.provider nous 2>/dev/null || true
      # Remove base_url and api_mode (nous provider doesn't need them)
      python3 -c "
import re, sys
with open('$HERMES_CONFIG', 'r') as f:
    content = f.read()
# Remove custom fields under model section
content = re.sub(r'  base_url:.*\n', '', content)
content = re.sub(r'  api_mode:.*\n', '', content)
with open('$HERMES_CONFIG', 'w') as f:
    f.write(content)
print('Cleared base_url and api_mode from model config')
" 2>/dev/null && ok "Reset to NousResearch provider" || warn "Could not fully reset — run 'hermes model' to reconfigure interactively"
    fi
  else
    ok "Config no longer references cursor-bridge"
  fi
fi

# ── Show result ──────────────────────────────────────────────
echo ""
info "Current Hermes model config:"
grep -A5 "^model:" "$HERMES_CONFIG" | head -8 | sed 's/^/  /'

# ── Restart Hermes gateway ───────────────────────────────────
echo ""
GATEWAY_RUNNING=false
if "$HERMES_BIN" gateway status 2>/dev/null | grep -qi "running\|active"; then
  GATEWAY_RUNNING=true
fi

if $GATEWAY_RUNNING; then
  read -rp "Restart Hermes gateway to apply changes? [Y/n] " ans_restart
  if [[ -z "$ans_restart" || "$ans_restart" =~ ^[Yy] ]]; then
    info "Restarting Hermes gateway..."
    "$HERMES_BIN" gateway restart 2>/dev/null || {
      "$HERMES_BIN" gateway stop 2>/dev/null || true
      sleep 1
      nohup "$HERMES_BIN" gateway run >/dev/null 2>&1 &
    }
    sleep 2
    ok "Hermes gateway restarted"
  else
    info "Restart manually: hermes gateway restart"
  fi
else
  info "Hermes gateway is not running (no restart needed)"
fi

echo ""
echo "Done."
echo ""
