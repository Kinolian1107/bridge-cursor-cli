**[English](how-it-works.md)** | **[繁體中文](how-it-works.zh-TW.md)** · [← README](../README.zh-TW.md)

# 運作原理（技術細節）

## 架構

```
任何 OpenAI 或 Anthropic 相容的用戶端
（OpenClaw、Hermes、Claude Code、Continue.dev、curl 等）
                    │
                    │  /v1/chat/completions（OpenAI）
                    │  /v1/messages（Anthropic，v2.2）
                    ▼
       ┌────────────────────────┐
       │     cursor-bridge       │  port 18790
       │    (本專案代理伺服器)     │
       └───────────┬────────────┘
                   │  建立子程序
                   ▼
       ┌────────────────────────┐
       │  cursor agent --print   │
       │   --output-format       │
       │     stream-json         │
       └────────────────────────┘
```

零外部依賴 — 只使用 Node.js 內建模組。

## 請求流程

1. **用戶端** 發送 OpenAI 相容的聊天補全請求（Anthropic `/v1/messages` 請求會先由 `lib/anthropic-compat.mjs` 轉成 OpenAI 形狀，之後走相同流程；回應在輸出端再翻譯回去）
2. **cursor-bridge** 將訊息陣列轉換成單一提示字串：
   - 系統訊息 → `<system_instructions>` 區塊
   - 對話歷史 → `<conversation_history>` 區塊
   - 最新使用者訊息 → 附加在最後
   - 若有 `tools` → 注入為 `<tool_calling_protocol>` 區塊（見 [Tool Bridge 模式](models.zh-TW.md#tool-bridge-模式)）
3. **cursor-bridge** 啟動：
   ```
   cursor agent --print --force --model <model>
     --output-format stream-json --stream-partial-output
     --workspace <path> [--worktree] [--mode ask|plan]
   ```
   - Prompt ≤ 32KB：作為 CLI 參數傳遞（Linux/macOS）
   - Prompt > 32KB — 或在 Windows 上任何長度：透過 stdin 直接傳遞（避免 Linux `E2BIG` / Windows 命令列長度限制）
4. **cursor agent** 透過你的 Cursor 訂閱使用選定的模型處理提示
5. Bridge 解析 NDJSON `stream-json` 事件（`system`、`assistant`、`tool_call`、`result`）並轉換為 OpenAI 相容的 SSE
6. Token 用量從字元數估算並包含在最後的回應 chunk 中

## CLI Flags 參考

| Flag | 用途 |
|------|------|
| `--print` / `-p` | 非互動（headless）模式 |
| `--force` / `--yolo` | 直接套用檔案修改 |
| `--output-format text\|json\|stream-json` | 輸出格式。`json` = 單一 JSON 物件，非串流 client 最簡單（v2.0） |
| `--stream-partial-output` | 增量文字 delta，支援即時串流 |
| `--model <id>` | 選擇模型 |
| `--workspace <path>` | 設定 repository root |
| `--worktree` / `--worktree-base <branch>` / `--skip-worktree-setup` | 在暫時 git worktree 中隔離編輯（v2.0 全部接通） |
| `--mode ask\|plan` | 唯讀模式 |
| `--trust` | 跳過 workspace trust 提示（v2.0 預設自動加，可用 `cursor_trust=false` 關閉） |
| `--sandbox enabled\|disabled` | 顯式 sandbox 覆寫（v2.0） |
| `--resume <chat-id>` / `--continue` | Session 延續（v2.0） |

## Fingerprint dedup（v2.0）

啟用 `--stream-partial-output` 時，cursor-agent 會 emit **三種變形** 的 `assistant` event（[官方文件](https://cursor.com/docs/cli/reference/output-format)）：

| `timestamp_ms` | `model_call_id` | 處置 |
|---|---|---|
| 有 | 無 | **保留** — 真正的新 delta |
| 有 | 有 | **丟棄** — pre-tool-call 重播 |
| 無 | 無 | **丟棄** — 收尾 flush 重播 |

v2.0 在串流與非串流路徑都實作這個過濾規則，取代 v1.x 的啟發式長度比對 dedup。

## ACP（Agent Communication Protocol）

Cursor CLI 也支援 `cursor agent acp` — 一個基於 stdio 的 JSON-RPC 2.0 協議，供進階自訂整合使用（JetBrains、Neovim、Zed 等 IDE 插件使用此協議）。cursor-bridge 目前使用較簡單的 `--print` headless 模式；若有更複雜的整合需求可研究 ACP。ACP 研究筆記見 [todo.md](todo.md)。
