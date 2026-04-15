#!/bin/bash
# cursor-bridge 啟動腳本
# 用法: ./start.sh        (前景執行)
#       ./start.sh daemon  (背景執行)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/cursor-bridge.pid"
mkdir -p "$SCRIPT_DIR/logs"
LOGFILE="$SCRIPT_DIR/logs/cursor-bridge.$(date +%Y%m%d).log"

# Load .env if present (overrides defaults)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

# Defaults (only if not already set by .env)
export BRIDGE_PORT="${BRIDGE_PORT:-18790}"
export CURSOR_MODEL="${CURSOR_MODEL:-opus-4.6-thinking}"
export CURSOR_BIN="${CURSOR_BIN:-cursor}"
export CURSOR_WORKSPACE="${CURSOR_WORKSPACE:-$HOME/.cursor-bridge/workspace}"
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(node -v 2>/dev/null | sed 's/v//')/bin:$PATH"

# 用 pgrep 偵測所有執行中的實例（不依賴 PID 文件）
EXISTING_PIDS=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)
if [ -n "$EXISTING_PIDS" ]; then
    echo "cursor-bridge is already running (PID(s): $EXISTING_PIDS)"
    exit 0
fi

# 額外確認 port 是否被佔用
if ss -tlnp 2>/dev/null | grep -q ":${BRIDGE_PORT} "; then
    PORT_PID=$(ss -tlnp 2>/dev/null | grep ":${BRIDGE_PORT} " | grep -oP 'pid=\K[0-9]+' | head -1)
    echo "Port $BRIDGE_PORT is already in use (PID: ${PORT_PID:-unknown})"
    exit 1
fi

# 清除殘留的 PID 文件
rm -f "$PIDFILE"

if [ "$1" = "daemon" ]; then
    # Background mode
    echo "Starting cursor-bridge in background..."
    nohup node "$SCRIPT_DIR/cursor-bridge.mjs" > /dev/null 2>&1 &
    echo $! > "$PIDFILE"
    echo "cursor-bridge started (PID $(cat "$PIDFILE"))"
    echo "Log: $LOGFILE"
    sleep 2
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "✓ Health check: $(curl -s http://127.0.0.1:${BRIDGE_PORT}/health)"
    else
        echo "✗ Failed to start. Check $LOGFILE"
        exit 1
    fi
else
    # Foreground mode
    exec node "$SCRIPT_DIR/cursor-bridge.mjs"
fi
