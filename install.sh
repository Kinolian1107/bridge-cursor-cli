#!/bin/bash
# ─────────────────────────────────────────────────────────────
# openclaw-bridge-cursorcli installer
#
# This script:
#   1. Detects cursor-agent / cursor CLI binary
#   2. Patches OpenClaw config to use cursor-bridge as the model provider
#   3. Creates start/stop helper scripts
#   4. Optionally adds auto-start to ~/.bashrc
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults (override via env) ──────────────────────────────
BRIDGE_PORT="${BRIDGE_PORT:-18790}"
CURSOR_MODEL="${CURSOR_MODEL:-opus-4.6-thinking}"
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
echo "│  openclaw-bridge-cursorcli installer              │"
echo "│  Bridge OpenClaw → Cursor CLI AI models           │"
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

# OpenClaw
if [ ! -f "$OPENCLAW_CONFIG" ]; then
  fail "OpenClaw config not found at $OPENCLAW_CONFIG. Install OpenClaw first."
fi
ok "OpenClaw config: $OPENCLAW_CONFIG"

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

# ── 3. Backup and patch OpenClaw config ──────────────────────
info "Patching OpenClaw configuration..."

BACKUP="$OPENCLAW_CONFIG.bak.pre-cursor-bridge"
if [ ! -f "$BACKUP" ]; then
  cp "$OPENCLAW_CONFIG" "$BACKUP"
  ok "Backed up to $BACKUP"
else
  warn "Backup already exists: $BACKUP (skipping)"
fi

# Use Node to do the JSON patching (safe and correct)
node -e "
const fs = require('fs');

// Patch main config
const configPath = '$OPENCLAW_CONFIG';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Set the model provider
config.models = config.models || {};
config.models.providers = config.models.providers || {};
config.models.providers['cursor-cli'] = {
  api: 'openai-completions',
  apiKey: 'cursor-bridge-local',
  baseUrl: 'http://127.0.0.1:${BRIDGE_PORT}/v1',
  models: [{
    id: '${CURSOR_MODEL}',
    name: 'Cursor CLI (${CURSOR_MODEL})',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 65536,
  }],
};

// Set default model
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.agents.defaults.model.primary = 'cursor-cli/${CURSOR_MODEL}';

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('  ✓ Patched ' + configPath);

// Patch agent models.json if it exists
const agentModelsPath = '$AGENT_MODELS';
if (fs.existsSync(agentModelsPath)) {
  const agentModels = {
    providers: {
      'cursor-cli': {
        baseUrl: 'http://127.0.0.1:${BRIDGE_PORT}/v1',
        apiKey: 'cursor-bridge-local',
        api: 'openai-completions',
        models: [{
          id: '${CURSOR_MODEL}',
          name: 'Cursor CLI (${CURSOR_MODEL})',
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
"

# ── 4. Create env file ───────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
cat > "$ENV_FILE" <<EOF
# cursor-bridge configuration
BRIDGE_PORT=${BRIDGE_PORT}
CURSOR_MODEL=${CURSOR_MODEL}
CURSOR_BIN=${CURSOR_BIN}
CURSOR_WORKSPACE=${OPENCLAW_DIR}/workspace
# CURSOR_MODE=ask  # Uncomment for read-only Q&A mode
EOF
ok "Created $ENV_FILE"

# ── 5. Create start/stop scripts ────────────────────────────
cat > "$SCRIPT_DIR/start.sh" <<'STARTEOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/.cursor-bridge.pid"
LOGFILE="$SCRIPT_DIR/cursor-bridge.log"

# Load .env
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(node -v)/bin:$PATH"

if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "cursor-bridge is already running (PID $OLD_PID)"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

if [ "$1" = "daemon" ]; then
  echo "Starting cursor-bridge in background..."
  nohup node "$SCRIPT_DIR/cursor-bridge.mjs" >> "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "cursor-bridge started (PID $(cat "$PIDFILE"))"
  echo "Log: $LOGFILE"
  sleep 3
  if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    HEALTH=$(curl -s "http://127.0.0.1:${BRIDGE_PORT:-18790}/health" 2>/dev/null)
    echo "✓ Health: $HEALTH"
  else
    echo "✗ Failed to start. Check $LOGFILE"
    exit 1
  fi
else
  exec node "$SCRIPT_DIR/cursor-bridge.mjs"
fi
STARTEOF

cat > "$SCRIPT_DIR/stop.sh" <<'STOPEOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/.cursor-bridge.pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping cursor-bridge (PID $PID)..."
    kill "$PID"; sleep 2
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
    echo "✓ Stopped"
  else
    echo "Process $PID not running"
  fi
  rm -f "$PIDFILE"
else
  PIDS=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "Found cursor-bridge processes: $PIDS"
    kill $PIDS
    echo "✓ Stopped"
  else
    echo "cursor-bridge is not running"
  fi
fi
STOPEOF

chmod +x "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/stop.sh"
ok "Created start.sh / stop.sh"

# ── 6. Auto-start in .bashrc ────────────────────────────────
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
echo "│  View logs:     tail -f cursor-bridge.log                │"
echo "│                                                          │"
echo "│  Then restart OpenClaw gateway to pick up the new config:│"
echo "│    openclaw gateway stop && openclaw gateway              │"
echo "│                                                          │"
echo "│  Test:                                                   │"
echo "│    curl http://127.0.0.1:${BRIDGE_PORT}/health               │"
echo "│                                                          │"
echo "└──────────────────────────────────────────────────────────┘"
echo ""
