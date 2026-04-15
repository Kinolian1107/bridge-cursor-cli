#!/bin/bash
# ─────────────────────────────────────────────────────────────
# set-hermesagent.sh
# Configure Hermes Agent to use cursor-bridge as the model provider
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env for BRIDGE_PORT / CURSOR_MODEL if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

BRIDGE_PORT="${BRIDGE_PORT:-18790}"
CURSOR_MODEL="${CURSOR_MODEL:-auto}"
HERMES_DIR="${HERMES_DIR:-$HOME/.hermes}"
HERMES_CONFIG="$HERMES_DIR/config.yaml"
HERMES_BIN="${HERMES_BIN:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  cursor-bridge → Hermes Agent integration         │"
echo "└──────────────────────────────────────────────────┘"
echo ""

# ── Find hermes binary ───────────────────────────────────────
if [ -z "$HERMES_BIN" ]; then
  if command -v hermes &>/dev/null; then
    HERMES_BIN="$(command -v hermes)"
  elif [ -x "$HOME/.local/bin/hermes" ]; then
    HERMES_BIN="$HOME/.local/bin/hermes"
  else
    fail "hermes binary not found. Install from: https://github.com/nousresearch/hermes-agent"
  fi
fi
ok "Hermes Agent: $HERMES_BIN ($("$HERMES_BIN" --version 2>&1 | head -1))"

# ── Check hermes config ──────────────────────────────────────
[ -f "$HERMES_CONFIG" ] || fail "Hermes config not found: $HERMES_CONFIG"
info "Hermes config: $HERMES_CONFIG"

# ── Check bridge is running ──────────────────────────────────
info "Checking cursor-bridge at port $BRIDGE_PORT..."
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  ok "cursor-bridge is running"
else
  warn "cursor-bridge does not appear to be running on port $BRIDGE_PORT"
  warn "Start it first: ./start.sh daemon"
fi

# ── Show current model config ────────────────────────────────
CURRENT_MODEL=$(grep -A4 "^model:" "$HERMES_CONFIG" 2>/dev/null | grep "default:" | awk '{print $2}' || echo "unknown")
CURRENT_BASE_URL=$(grep -A4 "^model:" "$HERMES_CONFIG" 2>/dev/null | grep "base_url:" | awk '{print $2}' || echo "unknown")
info "Current model:   $CURRENT_MODEL"
info "Current baseUrl: $CURRENT_BASE_URL"

# ── Probe available models from bridge ───────────────────────
AVAILABLE_MODELS=""
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" >/dev/null 2>&1; then
  AVAILABLE_MODELS=$(curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" \
    | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); console.log(j.data.map(m=>m.id).join(', '))" 2>/dev/null || echo "")
fi

info "Bridge endpoint: http://127.0.0.1:${BRIDGE_PORT}/v1"
info "Target model:    ${CURSOR_MODEL}"
[ -n "$AVAILABLE_MODELS" ] && info "Available:       ${AVAILABLE_MODELS}"
echo ""

# ── Backup current config ────────────────────────────────────
BACKUP="${HERMES_CONFIG}.bak.pre-cursor-bridge"
if [ -f "$BACKUP" ]; then
  warn "Backup already exists at $BACKUP (skipping new backup)"
else
  cp "$HERMES_CONFIG" "$BACKUP"
  ok "Backed up to $BACKUP"
fi

# ── Apply config via hermes config set ──────────────────────
info "Configuring Hermes Agent to use cursor-bridge..."

"$HERMES_BIN" config set model.provider custom
ok "Set model.provider = custom"

"$HERMES_BIN" config set model.base_url "http://127.0.0.1:${BRIDGE_PORT}/v1"
ok "Set model.base_url = http://127.0.0.1:${BRIDGE_PORT}/v1"

"$HERMES_BIN" config set model.api_mode chat_completions
ok "Set model.api_mode = chat_completions"

"$HERMES_BIN" config set model.default "${CURSOR_MODEL}"
ok "Set model.default = ${CURSOR_MODEL}"

echo ""
ok "Hermes Agent configured to use cursor-bridge (model: ${CURSOR_MODEL})"

# ── Sync all models to custom_providers ─────────────────────
echo ""
info "Syncing all cursor-bridge models to Hermes custom_providers..."

if [ -n "$AVAILABLE_MODELS" ]; then
  MODELS_JSON=$(curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" \
    | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); process.stdout.write(JSON.stringify(j.data.map(m=>m.id)))" 2>/dev/null || echo "[]")

  if [ "$MODELS_JSON" != "[]" ] && [ -n "$MODELS_JSON" ]; then
    python3 - "$HERMES_CONFIG" "$MODELS_JSON" "http://127.0.0.1:${BRIDGE_PORT}/v1" <<'PYEOF'
import sys, json, yaml

config_path = sys.argv[1]
models      = json.loads(sys.argv[2])
base_url    = sys.argv[3]
PROVIDER_NAME = "bridge-cursor-cli"

with open(config_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f)

existing = cfg.get("custom_providers") or []
# Keep non-bridge-cursor-cli entries intact
kept = [p for p in existing if p.get("name") != PROVIDER_NAME]
# Build one entry per model
new_entries = [
    {
        "name":     PROVIDER_NAME,
        "base_url": base_url,
        "api_key":  "",
        "api_mode": "chat_completions",
        "model":    m,
    }
    for m in models
]
cfg["custom_providers"] = kept + new_entries

with open(config_path, "w", encoding="utf-8") as f:
    yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

print(f"  → {len(new_entries)} models written for {PROVIDER_NAME}")
PYEOF
    ok "Hermes custom_providers updated with $(echo "$MODELS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).length+'')" 2>/dev/null) models"
  else
    warn "Could not parse model list from bridge, skipping custom_providers update"
  fi
else
  warn "Bridge not running — skipping custom_providers model sync"
  warn "Run this script again after starting the bridge: ./start.sh daemon"
fi

# ── Verify ───────────────────────────────────────────────────
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
  info "Start with: hermes gateway run"
fi

echo ""
echo "Done. Test with:"
echo "  hermes chat"
echo "  curl http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models"
echo ""
