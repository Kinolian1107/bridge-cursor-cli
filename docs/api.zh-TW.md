**[English](api.md)** | **[繁體中文](api.zh-TW.md)** · [← README](../README.zh-TW.md)

# API 參考

## 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/health` | GET | 健康檢查（回報 `supports.*` 能力旗標） |
| `/v1/models` | GET | 列出 Cursor 模型（探測 CLI，結果快取）。**v2.1**：會套用 `models.json` allowlist 過濾；加 `?all=1` 取得完整清單 |
| `/v1/cursor-models` | GET | `/v1/models` 的別名 |
| `/v1/chat/completions` | POST | 聊天補全（支援串流與非串流） |
| `/v1/messages` | POST | **v2.2** — Anthropic Messages API（支援串流與非串流），詳見[下方](#anthropic-messages-apiv22) |
| `/v1/messages/count_tokens` | POST | **v2.2** — token 數估算（與 `usage` 欄位同一套估算比例） |
| `/metrics` | GET | **v2.2** — Prometheus metrics（requests、durations、auth failures、inflight、uptime） |
| `/v1/cursor-sessions/create` | POST | **v2.0** — 呼叫 `cursor agent create-chat` 建立空 chat，回傳 `{ chat_id }` 給 `metadata.cursor_resume_chat_id` 用 |
| `/v1/cursor-sessions` | GET | **v2.0** — 透過 `cursor agent ls` 列出歷史 chat |

設定 `BRIDGE_API_KEY` 後，除 `/health` 外所有端點都需要帶 key（見 [Bearer Auth 與 Metrics](#bearer-auth-與-metricsv22)）。

### 範例

```bash
# 查詢可用模型清單
curl http://127.0.0.1:18790/v1/cursor-models

# 非串流
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好！"}]}'

# 串流
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好！"}],"stream":true}'
```

## Anthropic Messages API（v2.2）

bridge 也支援 **Anthropic Messages API**（`POST /v1/messages`），Anthropic SDK — 甚至 Claude Code 本身 — 都能直接使用 Cursor 模型：

```bash
# Anthropic SDK（任何語言）：把 base URL 指向 bridge 即可
export ANTHROPIC_BASE_URL=http://127.0.0.1:18790
export ANTHROPIC_API_KEY=anything   # 若啟用 auth 則填 BRIDGE_API_KEY

# 直接 curl
curl http://127.0.0.1:18790/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"你好！"}]}'
```

支援範圍：`system`（字串或 blocks）、多輪對話歷史、`tools` / `tool_use` / `tool_result` 完整循環（走與 OpenAI 路徑相同的 Tool Bridge Mode）、串流 SSE（`message_start` → `content_block_delta` → `message_stop`）、以及 `POST /v1/messages/count_tokens`（估算值）。內部實作是把 request 轉成 OpenAI 形狀走完全相同的管線 — 所有 `metadata.cursor_*` per-request 選項在這裡一樣有效。圖片／聲音／影片／文件 blocks 會被保留（見[多模態輸入](#多模態輸入v23)）。

## 多模態輸入（v2.3）

`/v1/chat/completions` 與 `/v1/messages` 都接受圖片、聲音、影片、檔案內容。cursor-agent 沒有 `--file` 旗標，所以每個附件會寫到該次請求的暫存目錄，再用 `--add-dir` 掛進去，prompt 會列出存檔路徑。請求結束後刪除暫存檔。

**模型**能不能真正看懂聲音或影片，仍取決於你選的模型（Grok 4.6 等多元模態模型可以；純文字模型只看得到檔案路徑）。

### OpenAI content parts

```bash
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cursor-grok-4.6-high",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "這段畫面有什麼？" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
        { "type": "input_audio", "input_audio": { "data": "...", "format": "wav" } },
        { "type": "video_url", "video_url": { "url": "https://example.com/clip.mp4" } }
      ]
    }]
  }'
```

可辨識的 type：`image_url` / `input_image`、`input_audio` / `audio_url`、`video_url` / `input_video` / `video`、`file` / `input_file`，以及 Gemini 風格 `inline_data`。來源可以是 `data:` URI、裸 base64，或 `http(s)` URL。`file:` 與其他 scheme 會被拒絕，localhost / RFC1918 目的地也一樣（要用內網媒體請設 `BRIDGE_MEDIA_ALLOW_PRIVATE=true`）。

### Anthropic content blocks

`/v1/messages` 上的 `image`、`audio`、`video`、`document` blocks（base64 `source` 或 URL）會先轉換，再走同一條管線。

上限可設定：`BRIDGE_MEDIA_MAX_BYTES`（50 MB）、`BRIDGE_MEDIA_MAX_FILES`（16）、`BRIDGE_MEDIA_FETCH_TIMEOUT_MS`（15 秒）、`BRIDGE_MAX_BODY_BYTES`（80 MB）。

## Bearer Auth 與 Metrics（v2.2）

預設 bridge 綁定 `127.0.0.1` 且不驗證 — 本機使用沒問題。要開放到 LAN 或 Tailscale 網段時：

```bash
# .env
BRIDGE_HOST=0.0.0.0            # 或你的 Tailscale IP
BRIDGE_API_KEY=$(openssl rand -hex 32)
```

設定 `BRIDGE_API_KEY` 後，除 `/health` 外所有端點都需要帶 key，兩種 header 皆可（比對使用 timing-safe）：

```bash
curl -H "Authorization: Bearer <key>" http://bridge:18790/v1/models   # OpenAI 風格
curl -H "x-api-key: <key>" http://bridge:18790/v1/messages -d '…'     # Anthropic 風格
```

`GET /metrics` 提供 Prometheus metrics：`bridge_requests_total{endpoint,method,status}`、`bridge_request_duration_seconds`（各端點 sum/count）、`bridge_auth_failures_total`、`bridge_inflight_requests`、`bridge_uptime_seconds`。

## 逐請求選項（v2.0）

cursor-bridge v2.0 在外觀上維持 OpenAI 相容，但讓 client **逐請求**指定 cursor-agent flag。沒帶的選項會 fallback 到 bridge 的 CONFIG default — 所以 OpenClaw / Continue.dev / 既有 client 行為完全不變。

有兩種方式表達選項，可自由混用：

### A）`metadata.cursor_*` 區塊（最完整）

```jsonc
POST /v1/chat/completions
{
  "model": "cursor/claude-fable-5-thinking-medium",
  "messages": [{ "role": "user", "content": "..." }],
  "stream": false,
  "metadata": {
    "cursor_mode": "ask",                  // ask | plan | agent (default: CONFIG.mode)
    "cursor_force_output_format": "json",  // text | json | stream-json
    "cursor_sandbox": "enabled",           // enabled | disabled
    "cursor_worktree": false,
    "cursor_worktree_base": "main",
    "cursor_skip_worktree_setup": false,
    "cursor_resume_chat_id": "ch-abc-123", // session 延續
    "cursor_continue": false,              // 接續最近一次 chat
    "cursor_stream_partial_output": true,  // 覆寫預設
    "cursor_trust": true                   // 預設 true；要手動信任時設 false
  }
}
```

### B）模型名前綴 token（語法糖）

```
cursor/ask:claude-fable-5-medium          → --mode=ask
cursor/plan:claude-fable-5-medium         → --mode=plan
cursor/agent:claude-fable-5-medium        → 不加 --mode（full agent）
cursor/worktree:claude-fable-5-medium     → --worktree
cursor/ask:worktree:claude-fable-5-medium          → --mode=ask --worktree（可組合）
```

支援的 token：`ask`、`plan`、`agent`、`worktree`。未知 token 會被忽略。**衝突時 metadata 永遠贏。**

### Output format 選擇規則

| `stream` | `cursor_force_output_format` | 實際格式 |
|---|---|---|
| `true` | _(任意)_ | `stream-json`（SSE 必須有事件） |
| `false` | `text` | `text`（純 stdout） |
| `false` | `json` | `json`（單一 JSON — 最快、最簡單） |
| `false` | `stream-json` | `stream-json`（預設；保留 usage 統計） |
| `false` | _省略_ | `stream-json` |

stateless 一次性呼叫（摘要、分類、單問單答）建議用 `json` mode，不需逐字串流時最省事。

### Session 延續（v2.0）

跨多次請求要共享上下文時：

```bash
# 1. 建立新 session
CHAT_ID=$(curl -s -X POST http://127.0.0.1:18790/v1/cursor-sessions/create | jq -r .chat_id)

# 2. 後續請求帶上 chat_id
curl http://127.0.0.1:18790/v1/chat/completions -H "Content-Type: application/json" -d "{
  \"model\": \"cursor/claude-fable-5-thinking-medium\",
  \"messages\": [{\"role\": \"user\", \"content\": \"...\"}],
  \"stream\": false,
  \"metadata\": { \"cursor_resume_chat_id\": \"$CHAT_ID\" }
}"
```

Bridge 會傳 `--resume <chat-id>` 給 cursor-agent，所以模型看得到先前的 turn。
