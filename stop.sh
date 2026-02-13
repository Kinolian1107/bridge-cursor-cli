#!/bin/bash
# cursor-bridge 停止腳本

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/cursor-bridge.pid"

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping cursor-bridge (PID $PID)..."
        kill "$PID"
        sleep 2
        if kill -0 "$PID" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$PID"
        fi
        echo "✓ Stopped"
    else
        echo "Process $PID not running"
    fi
    rm -f "$PIDFILE"
else
    echo "No PID file found. Checking for running processes..."
    PIDS=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Found processes: $PIDS"
        kill $PIDS
        echo "✓ Stopped"
    else
        echo "cursor-bridge is not running"
    fi
fi
