#!/bin/bash
# cursor-bridge 停止腳本

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/cursor-bridge.pid"

# 用 pgrep 找出所有實例（不依賴 PID 文件）
PIDS=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)

if [ -z "$PIDS" ]; then
    echo "cursor-bridge is not running"
    rm -f "$PIDFILE"
    exit 0
fi

echo "Stopping cursor-bridge (PID(s): $PIDS)..."
kill $PIDS

# 等待最多 5 秒讓進程正常退出
for i in $(seq 1 5); do
    sleep 1
    REMAINING=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)
    if [ -z "$REMAINING" ]; then
        break
    fi
done

# 仍有殘留則強制終止
REMAINING=$(pgrep -f "cursor-bridge.mjs" 2>/dev/null)
if [ -n "$REMAINING" ]; then
    echo "Force killing (PID(s): $REMAINING)..."
    kill -9 $REMAINING
fi

rm -f "$PIDFILE"
echo "✓ Stopped"
