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
CURSOR_MODEL="${CURSOR_MODEL:-cursor-grok-4.6-high}"
BRIDGE_API_KEY="${BRIDGE_API_KEY:-}"
HERMES_DIR="${HERMES_DIR:-$HOME/.hermes}"
HERMES_CONFIG="$HERMES_DIR/config.yaml"
HERMES_BIN="${HERMES_BIN:-}"

curl_bridge() {
  if [ -n "$BRIDGE_API_KEY" ]; then
    curl -sf --config <(
      printf 'header = "Authorization: Bearer %s"\n' "$BRIDGE_API_KEY"
    ) "$@"
  else
    curl -sf "$@"
  fi
}

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

# ── Ensure hermes config exists (bootstrap a fresh install) ──
# First-time, no-Portal path: generate a default config non-interactively so a
# brand-new Hermes install is never steered into the Nous Portal OAuth wizard.
if [ ! -f "$HERMES_CONFIG" ]; then
  warn "No Hermes config found — bootstrapping defaults (no Portal needed)"
  "$HERMES_BIN" setup --non-interactive >/dev/null 2>&1 || true
fi
[ -f "$HERMES_CONFIG" ] || fail "Hermes config not found and bootstrap failed: $HERMES_CONFIG
   Run 'hermes setup --non-interactive' manually, then re-run this script."
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
if curl_bridge "http://127.0.0.1:${BRIDGE_PORT}/v1/models" >/dev/null 2>&1; then
  AVAILABLE_MODELS=$(curl_bridge "http://127.0.0.1:${BRIDGE_PORT}/v1/models" \
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

BRIDGE_API_KEY="${BRIDGE_API_KEY}" python3 - "$HERMES_CONFIG" <<'PYEOF'
import os, re, stat, sys
from pathlib import Path

path = Path(sys.argv[1])
key = os.environ.get("BRIDGE_API_KEY", "")
text = path.read_text(encoding="utf-8")
pattern = re.compile(
    r"(^model:\n(?:  .+\n)*?  api_mode: chat_completions\n)(  api_key: .+\n)?",
    re.M,
)
replacement = rf"\1  api_key: {key}\n" if key else r"\1"
new_text, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit("could not update model.api_key")
path.write_text(new_text, encoding="utf-8")
path.chmod(stat.S_IRUSR | stat.S_IWUSR)
PYEOF
ok "Set model.api_key for bridge authentication"

"$HERMES_BIN" config set model.default "${CURSOR_MODEL}"
ok "Set model.default = ${CURSOR_MODEL}"

echo ""
ok "Hermes Agent configured to use cursor-bridge (model: ${CURSOR_MODEL})"

# ── Sync models to custom_providers ─────────────────────────
# /v1/models honours the allowlist in models.json — run
# `node select-models.mjs` first to keep the Hermes /model menu short.
echo ""
info "Syncing cursor-bridge models to Hermes custom_providers..."
info "(tip: 'node select-models.mjs' trims this list to the models you actually use)"

if [ -n "$AVAILABLE_MODELS" ]; then
  MODELS_JSON=$(curl_bridge "http://127.0.0.1:${BRIDGE_PORT}/v1/models" \
    | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); process.stdout.write(JSON.stringify(j.data.map(m=>m.id)))" 2>/dev/null || echo "[]")

  if [ "$MODELS_JSON" != "[]" ] && [ -n "$MODELS_JSON" ]; then
    # Shared with `node select-models.mjs` — the YAML rewrite policy lives there.
    python3 "$SCRIPT_DIR/lib/sync-hermes.py" \
      "$HERMES_CONFIG" "$MODELS_JSON" "http://127.0.0.1:${BRIDGE_PORT}/v1" "bridge-cursor-cli"
    ok "Hermes custom_providers updated"
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
python3 - "$HERMES_CONFIG" <<'PYEOF'
import sys, yaml
with open(sys.argv[1], encoding="utf-8") as f:
    cfg = yaml.safe_load(f) or {}
model = cfg.get("model") or {}
for key in ("default", "provider", "base_url", "api_mode"):
    print(f"  {key}: {model.get(key, '')}")
print(f"  api_key_set: {bool(model.get('api_key'))}")
PYEOF

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
echo "  curl http://127.0.0.1:${BRIDGE_PORT}/health"
echo ""
