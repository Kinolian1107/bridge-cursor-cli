#!/bin/bash
# ─────────────────────────────────────────────────────────────
# cursor-bridge installer
#
# This script:
#   1. Detects cursor-agent / cursor CLI binary
#   2. Creates .env, start.sh, stop.sh
#   3. Optionally patches OpenClaw config (if detected / requested)
#   4. Optionally adds auto-start to ~/.bashrc
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults (override via env) ──────────────────────────────
BRIDGE_PORT="${BRIDGE_PORT:-18790}"
CURSOR_MODEL="${CURSOR_MODEL:-auto}"
CURSOR_WORKSPACE="${CURSOR_WORKSPACE:-$HOME/.cursor-bridge/workspace}"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
AGENT_MODELS="$OPENCLAW_DIR/agents/main/agent/models.json"

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  cursor-bridge installer                          │"
echo "│  OpenAI-compatible proxy for Cursor CLI           │"
echo "└──────────────────────────────────────────────────┘"
echo ""

# ── 1. Check prerequisites ───────────────────────────────────
info "Checking prerequisites..."

# Node >= 22
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node >= 22 first."
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VER < 22 )); then
  fail "Node.js >= 22 required (found $(node -v))"
fi
ok "Node.js $(node -v)"

# Cursor CLI
CURSOR_BIN=""
if command -v cursor-agent &>/dev/null; then
  CURSOR_BIN="$(command -v cursor-agent)"
elif [ -x "$HOME/.local/bin/cursor-agent" ]; then
  CURSOR_BIN="$HOME/.local/bin/cursor-agent"
elif command -v cursor &>/dev/null; then
  CURSOR_BIN="$(command -v cursor)"
else
  fail "Cursor CLI not found. Install it first: https://cursor.com/cli"
fi
ok "Cursor CLI: $CURSOR_BIN"

# ── 2. List available Cursor models ─────────────────────────
info "Available Cursor models:"
if [[ "$CURSOR_BIN" == *"cursor-agent"* ]]; then
  "$CURSOR_BIN" --list-models 2>/dev/null | head -20 || true
else
  "$CURSOR_BIN" agent --list-models 2>/dev/null | head -20 || true
fi
echo ""
info "Selected model: ${CYAN}${CURSOR_MODEL}${NC}"
echo "  (Override with: CURSOR_MODEL=<model-id> ./install.sh)"
echo ""

# ── 3. Create env file ───────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
cat > "$ENV_FILE" <<EOF
# cursor-bridge configuration
BRIDGE_PORT=${BRIDGE_PORT}
CURSOR_MODEL=${CURSOR_MODEL}
CURSOR_BIN=${CURSOR_BIN}
CURSOR_WORKSPACE=${CURSOR_WORKSPACE}
# CURSOR_MODE=ask  # Uncomment for read-only Q&A mode
EOF
ok "Created $ENV_FILE"

# Create the cursor-agent workspace dir — cursor-agent errors with
# "Workspace path does not exist" if --workspace points at a missing directory.
mkdir -p "$CURSOR_WORKSPACE"
ok "Workspace ready: $CURSOR_WORKSPACE"

# ── 4. Start/stop scripts ───────────────────────────────────
# start.sh / stop.sh ship with the repo — keep them executable instead of
# regenerating embedded copies here that drift from the tracked versions.
chmod +x "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/stop.sh"
ok "start.sh / stop.sh ready"

# ── 5. OpenClaw integration (optional) ──────────────────────
OPENCLAW_DETECTED=false
if [ -f "$OPENCLAW_CONFIG" ]; then
  OPENCLAW_DETECTED=true
fi

echo ""
if $OPENCLAW_DETECTED; then
  info "OpenClaw detected at $OPENCLAW_CONFIG"
  read -rp "Configure cursor-bridge as OpenClaw model provider? [Y/n] " ans_oc
else
  warn "OpenClaw not found at $OPENCLAW_CONFIG"
  read -rp "Configure OpenClaw integration anyway (specify path)? [y/N] " ans_oc
  if [[ "$ans_oc" =~ ^[Yy] ]]; then
    read -rp "OpenClaw config path: " OPENCLAW_CONFIG
    if [ -f "$OPENCLAW_CONFIG" ]; then
      OPENCLAW_DIR="$(dirname "$OPENCLAW_CONFIG")"
      AGENT_MODELS="$OPENCLAW_DIR/agents/main/agent/models.json"
      OPENCLAW_DETECTED=true
    else
      warn "File not found, skipping OpenClaw integration."
      ans_oc="n"
    fi
  fi
fi

if $OPENCLAW_DETECTED && [[ -z "${ans_oc:-}" || "$ans_oc" =~ ^[Yy] ]]; then
  info "Patching OpenClaw configuration..."

  BACKUP="$OPENCLAW_CONFIG.bak.pre-cursor-bridge"
  if [ ! -f "$BACKUP" ]; then
    cp "$OPENCLAW_CONFIG" "$BACKUP"
    ok "Backed up to $BACKUP"
  else
    warn "Backup already exists: $BACKUP (skipping)"
  fi

  node -e "
const fs = require('fs');

const configPath = process.argv[1];
const bridgePort = process.argv[2];
const cursorModel = process.argv[3];
const agentModelsPath = process.argv[4];

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
config.models = config.models || {};
config.models.providers = config.models.providers || {};
config.models.providers['cursor-cli'] = {
  api: 'openai-completions',
  apiKey: 'cursor-bridge-local',
  baseUrl: 'http://127.0.0.1:' + bridgePort + '/v1',
  models: [{
    id: cursorModel,
    name: 'Cursor CLI (' + cursorModel + ')',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 65536,
  }],
};
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.agents.defaults.model.primary = 'cursor-cli/' + cursorModel;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('  ✓ Patched ' + configPath);

if (fs.existsSync(agentModelsPath)) {
  const agentModels = {
    providers: {
      'cursor-cli': {
        baseUrl: 'http://127.0.0.1:' + bridgePort + '/v1',
        apiKey: 'cursor-bridge-local',
        api: 'openai-completions',
        models: [{
          id: cursorModel,
          name: 'Cursor CLI (' + cursorModel + ')',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 65536,
        }],
      },
    },
  };
  fs.writeFileSync(agentModelsPath, JSON.stringify(agentModels, null, 2) + '\n');
  console.log('  ✓ Patched ' + agentModelsPath);
}
" "$OPENCLAW_CONFIG" "$BRIDGE_PORT" "$CURSOR_MODEL" "$AGENT_MODELS"

  ok "OpenClaw integration configured"
  OPENCLAW_CONFIGURED=true
else
  info "Skipped OpenClaw integration."
  OPENCLAW_CONFIGURED=false
fi

# ── 6. Auto-start in .bashrc ────────────────────────────────
echo ""
BASHRC="$HOME/.bashrc"
MARKER="# cursor-bridge auto-start"
if ! grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
  read -rp "Add cursor-bridge auto-start to ~/.bashrc? [Y/n] " ans
  if [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; then
    cat >> "$BASHRC" <<EOF

$MARKER
if [ -f "$SCRIPT_DIR/start.sh" ] && ! pgrep -f "cursor-bridge.mjs" >/dev/null 2>&1; then
  "$SCRIPT_DIR/start.sh" daemon >/dev/null 2>&1
fi
EOF
    ok "Added auto-start to ~/.bashrc"
  else
    info "Skipped. Start manually: $SCRIPT_DIR/start.sh daemon"
  fi
else
  warn "Auto-start entry already in ~/.bashrc"
fi

# ── Done ─────────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  ✓ Installation complete!                                │"
echo "├──────────────────────────────────────────────────────────┤"
echo "│                                                          │"
echo "│  Start bridge:  ./start.sh daemon                        │"
echo "│  Stop bridge:   ./stop.sh                                │"
echo "│  View logs:     tail -f logs/cursor-bridge.\$(date +%Y%m%d).log │"
echo "│                                                          │"
echo "│  Test:                                                   │"
echo "│    curl http://127.0.0.1:${BRIDGE_PORT}/health               │"
echo "│                                                          │"
if [ "${OPENCLAW_CONFIGURED:-false}" = "true" ]; then
echo "│  Restart OpenClaw gateway to apply:                      │"
echo "│    openclaw gateway stop && openclaw gateway             │"
echo "│                                                          │"
fi
echo "└──────────────────────────────────────────────────────────┘"
echo ""
