#!/bin/bash
# ─────────────────────────────────────────────────────────────
# set-openclaw.sh
# Configure OpenClaw to use cursor-bridge as the model provider
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env for BRIDGE_PORT / CURSOR_MODEL if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

BRIDGE_PORT="${BRIDGE_PORT:-18790}"
CURSOR_MODEL="${CURSOR_MODEL:-auto}"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
PROVIDER_NAME="cursor-cli"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  cursor-bridge → OpenClaw integration             │"
echo "└──────────────────────────────────────────────────┘"
echo ""

# ── Check openclaw config ────────────────────────────────────
if [ ! -f "$OPENCLAW_CONFIG" ]; then
  warn "OpenClaw config not found at: $OPENCLAW_CONFIG"
  read -rp "Enter path to openclaw.json: " OPENCLAW_CONFIG
  [ -f "$OPENCLAW_CONFIG" ] || fail "File not found: $OPENCLAW_CONFIG"
fi

# ── Check bridge is running ──────────────────────────────────
info "Checking cursor-bridge at port $BRIDGE_PORT..."
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  ok "cursor-bridge is running"
else
  warn "cursor-bridge does not appear to be running on port $BRIDGE_PORT"
  warn "Start it first: ./start.sh daemon"
fi

# ── Probe available models ───────────────────────────────────
AVAILABLE_MODELS=""
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" >/dev/null 2>&1; then
  AVAILABLE_MODELS=$(curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" \
    | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); console.log(j.data.map(m=>m.id).join(', '))" 2>/dev/null || echo "")
fi

info "Bridge endpoint: http://127.0.0.1:${BRIDGE_PORT}/v1"
info "Default model:   ${CURSOR_MODEL}"
[ -n "$AVAILABLE_MODELS" ] && info "Available:       ${AVAILABLE_MODELS}"
echo ""

# ── Backup existing config ───────────────────────────────────
BACKUP="${OPENCLAW_CONFIG}.bak.pre-cursor-bridge"
if [ -f "$BACKUP" ]; then
  warn "Backup already exists at $BACKUP (skipping new backup)"
else
  cp "$OPENCLAW_CONFIG" "$BACKUP"
  ok "Backed up to $BACKUP"
fi

# ── Build model list for provider ───────────────────────────
# Start with the default model; add extra well-known names if bridge is up
MODELS_JSON="[{\"id\": \"${CURSOR_MODEL}\", \"name\": \"Cursor (${CURSOR_MODEL})\", \"reasoning\": true, \"input\": [\"text\"], \"cost\": {\"input\": 0, \"output\": 0, \"cacheRead\": 0, \"cacheWrite\": 0}, \"contextWindow\": 200000, \"maxTokens\": 65536}]"

if [ -n "$AVAILABLE_MODELS" ]; then
  MODELS_JSON=$(curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models" \
    | node -e "
const d = require('fs').readFileSync('/dev/stdin', 'utf-8');
const j = JSON.parse(d);
const models = j.data.map(m => ({
  id: m.id,
  name: 'Cursor (' + m.id + ')',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 65536
}));
console.log(JSON.stringify(models));
" 2>/dev/null || echo "$MODELS_JSON")
fi

# ── Patch openclaw.json ──────────────────────────────────────
node -e "
const fs = require('fs');
const configPath = process.argv[1];
const bridgePort = process.argv[2];
const cursorModel = process.argv[3];
const providerName = process.argv[4];
const modelsJson = process.argv[5];

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

config.models = config.models || {};
config.models.providers = config.models.providers || {};
config.models.providers[providerName] = {
  api: 'openai-completions',
  apiKey: 'cursor-bridge-local',
  baseUrl: 'http://127.0.0.1:' + bridgePort + '/v1',
  models: JSON.parse(modelsJson),
};

// Set as default model if agent defaults exist
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.agents.defaults.model.primary = providerName + '/' + cursorModel;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Patched ' + configPath);
" "$OPENCLAW_CONFIG" "$BRIDGE_PORT" "$CURSOR_MODEL" "$PROVIDER_NAME" "$MODELS_JSON"

ok "OpenClaw config patched (provider: ${PROVIDER_NAME}, default: ${PROVIDER_NAME}/${CURSOR_MODEL})"

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
else
  warn "openclaw command not found — restart gateway manually"
fi

echo ""
echo "Done. Test with:"
echo "  curl http://127.0.0.1:${BRIDGE_PORT}/v1/cursor-models"
echo ""
