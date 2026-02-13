#!/bin/bash
# cursor-bridge 啟動腳本
# 用法: ./start.sh        (前景執行)
#       ./start.sh daemon  (背景執行)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/cursor-bridge.pid"
LOGFILE="$SCRIPT_DIR/cursor-bridge.log"

export CURSOR_BIN="/home/kino/.local/bin/cursor-agent"
export CURSOR_MODEL="opus-4.6-thinking"
export CURSOR_WORKSPACE="/home/kino/.openclaw/workspace"
export BRIDGE_PORT="18790"
export PATH="/home/kino/.local/bin:/home/kino/.nvm/versions/node/v22.22.0/bin:$PATH"

# Check if already running
if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "cursor-bridge is already running (PID $OLD_PID)"
        exit 0
    else
        rm -f "$PIDFILE"
    fi
fi

if [ "$1" = "daemon" ]; then
    # Background mode
    echo "Starting cursor-bridge in background..."
    nohup node "$SCRIPT_DIR/cursor-bridge.mjs" >> "$LOGFILE" 2>&1 &
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
