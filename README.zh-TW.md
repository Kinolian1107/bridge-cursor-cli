**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

# openclaw-bridge-cursorcli

將 [OpenClaw](https://github.com/openclaw/openclaw) 串接到 [Cursor CLI](https://cursor.com/cli) — 透過你的 Cursor 訂閱使用頂級 AI 模型（Claude 4.6 Opus、GPT-5.2、Gemini 3 Pro 等），**不需要額外的 API Key**。

## 為什麼需要這個？

OpenClaw 是一個很棒的個人 AI 助手，但在本地跑模型（例如用 Ollama 跑 Qwen3-14B）需要高階 GPU，而且品質遠比不上頂級模型。如果你已經有 **Cursor 訂閱**（Pro/Business），你就能使用最強的 AI 模型 — 這個 bridge 讓 OpenClaw 直接使用它們。

## 架構

```
Telegram / WhatsApp / Discord / Signal / 等等
                    │
                    ▼
       ┌────────────────────────┐
       │    OpenClaw Gateway     │  port 18789
       │     (個人 AI 助手)       │
       └───────────┬────────────┘
                   │  OpenAI 相容 API
                   ▼
       ┌────────────────────────┐
       │    cursor-bridge        │  port 18790
       │    (本專案代理伺服器)     │
       └───────────┬────────────┘
                   │  建立子程序
                   ▼
       ┌────────────────────────┐
       │    cursor agent --print │
       │  (Cursor CLI 無頭模式)   │
       │   使用你的 Cursor 訂閱    │
       └────────────────────────┘
```

**運作原理：** cursor-bridge 提供一個 OpenAI 相容的 API（`/v1/chat/completions`）。當 OpenClaw 發送請求時，bridge 會將其轉譯成 `cursor agent --print --stream-json` 指令並串流回傳結果。零外部依賴 — 只使用 Node.js 內建模組。

## v1.1 更新內容

- **Token 用量回報** — 準確估算並回報 `prompt_tokens`、`completion_tokens` 和 `thinking_tokens`，讓 OpenClaw 的 compaction 機制正確運作。
- **Tool Bridge 模式** — 當 OpenClaw 發送 `tools` 參數時，cursor-bridge 會將工具定義注入到 prompt 中，並將模型的工具呼叫回應解析為 OpenAI 相容的 `tool_calls` 格式。包含 Cursor workspace 規則檔（`workspace-rules/tool-bridge.mdc`）。
- **大型 prompt 處理（E2BIG 修復）** — 超過 32KB 的 prompt 改用 stdin pipe 傳遞，避免 Linux 上的 `E2BIG` 錯誤。
- **結構化 stream-json 輸出** — 使用 `--output-format stream-json` 可靠解析 thinking、assistant、tool_call 和 result 事件。
- **改善錯誤處理** — 將錯誤分類（context overflow、timeout、rate limit、auth）為 OpenAI 相容的錯誤類型。

## 前置需求

| 需求 | 版本 |
|------|------|
| Node.js | >= 22 |
| [Cursor CLI](https://cursor.com/cli) | 已安裝並登入（`cursor agent login`） |
| [OpenClaw](https://github.com/openclaw/openclaw) | 已安裝並運行中 |

## 快速開始

```bash
git clone https://github.com/Kinolian1107/openclaw-bridge-cursorcli.git
cd openclaw-bridge-cursorcli

# 執行安裝腳本（自動修改 OpenClaw 設定）
chmod +x install.sh
./install.sh

# 啟動 bridge
./start.sh daemon

# 重啟 OpenClaw gateway 以載入新設定
openclaw gateway stop
openclaw gateway
```

## 手動設定

如果你想手動設定：

### 1. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env — 設定 CURSOR_BIN 為你的 cursor-agent 路徑
```

### 2. 啟動 bridge

```bash
# 前景執行（除錯用）
node cursor-bridge.mjs

# 背景執行（daemon 模式）
./start.sh daemon

# 停止
./stop.sh
```

### 3. 修改 OpenClaw 設定

編輯 `~/.openclaw/openclaw.json`：

```jsonc
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "cursor-cli/opus-4.6-thinking"  // ← 改這裡
      }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {                              // ← 新增這個區塊
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [
          {
            "id": "opus-4.6-thinking",
            "name": "Claude 4.6 Opus (Thinking) via Cursor CLI",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 65536
          }
        ]
      }
    }
  }
}
```

同時更新 `~/.openclaw/agents/main/agent/models.json`，加入相同的 provider 設定。

### 4. 重啟 OpenClaw gateway

```bash
openclaw gateway stop
openclaw gateway
```

## 設定參數

所有設定透過環境變數（或 `.env` 檔案）：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `BRIDGE_PORT` | `18790` | 代理伺服器埠號 |
| `BRIDGE_HOST` | `127.0.0.1` | 綁定位址 |
| `CURSOR_MODEL` | `opus-4.6-thinking` | Cursor CLI 模型 ID |
| `CURSOR_BIN` | `cursor` | `cursor` 或 `cursor-agent` 二進位檔路徑 |
| `CURSOR_WORKSPACE` | `~/.openclaw/workspace` | cursor agent 工作目錄 |
| `CURSOR_MODE` | *（空）* | `ask`（唯讀問答）/ `plan`（唯讀規劃）/ *空* = 完整 agent |
| `BRIDGE_TIMEOUT_MS` | `300000` | 請求逾時時間（預設 5 分鐘） |

## 可用模型

執行 `cursor agent --list-models` 查看所有可用模型。常用選擇：

| 模型 ID | 名稱 |
|---------|------|
| `opus-4.6-thinking` | Claude 4.6 Opus（帶思考鏈）— **推薦** |
| `opus-4.6` | Claude 4.6 Opus |
| `sonnet-4.5-thinking` | Claude 4.5 Sonnet（帶思考鏈） |
| `gpt-5.2-codex-high` | GPT-5.2 Codex High |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gemini-3-pro` | Gemini 3 Pro |
| `grok` | Grok |

在 `.env` 中設定 `CURSOR_MODEL` 並重啟 bridge 即可切換模型。

## API 端點

bridge 提供標準的 OpenAI 相容 API：

| 端點 | 方法 | 說明 |
|------|------|------|
| `/health` | GET | 健康檢查 |
| `/v1/models` | GET | 列出可用模型 |
| `/v1/chat/completions` | POST | 聊天補全（支援串流與非串流） |

### 範例：直接呼叫 API

```bash
# 非串流
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opus-4.6-thinking","messages":[{"role":"user","content":"你好！"}]}'

# 串流
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opus-4.6-thinking","messages":[{"role":"user","content":"你好！"}],"stream":true}'
```

## 解除安裝

```bash
./uninstall.sh
```

這會從備份還原原始的 OpenClaw 設定，並移除 `~/.bashrc` 中的自動啟動項目。

## 運作原理（技術細節）

1. **OpenClaw** 發送 OpenAI 相容的聊天補全請求到 bridge
2. **cursor-bridge** 將訊息陣列轉換成單一提示字串：
   - 系統訊息 → `<system_instructions>` 區塊
   - 對話歷史 → `<conversation_history>` 區塊
   - 最新的使用者訊息 → 附加在最後
   - 若有 `tools` → 注入為 `<openclaw_tools>` 區塊 + `--mode ask` 防止原生工具執行
3. **cursor-bridge** 啟動 `cursor agent --print --force --model <model> --output-format stream-json --stream-partial-output` 並傳入提示
   - Prompt ≤ 32KB：作為 CLI 參數傳遞
   - Prompt > 32KB：寫入暫存檔並透過 `cat file | cursor-agent ...` pipe 傳遞
4. **cursor agent** 透過你的 Cursor 訂閱使用選定的模型處理提示
5. Bridge 解析 NDJSON `stream-json` 事件（init、thinking、assistant、tool_call、result）並轉換為 OpenAI 相容的 SSE 事件
6. Token 用量從字元數估算並包含在最後的回應 chunk 中

### Tool Bridge 模式

當 OpenClaw 在 API 請求中包含 `tools` 時：
1. Bridge 將工具定義以 XML 格式注入到 prompt 中
2. Cursor workspace 規則（`workspace-rules/tool-bridge.mdc`）指示模型以 `<tool_call>` XML 格式輸出工具呼叫
3. Bridge 解析這些 XML 區塊並轉換為 OpenAI `tool_calls` 格式
4. OpenClaw 收到標準的 `tool_calls` 後可以執行它們，並將結果送回進行後續對話

啟用 Tool Bridge 模式，將規則檔複製到 Cursor workspace：

```bash
mkdir -p ~/.openclaw/workspace/.cursor/rules/
cp workspace-rules/tool-bridge.mdc ~/.openclaw/workspace/.cursor/rules/
```

## 疑難排解

### Bridge 無法啟動
- 檢查 18790 埠是否已被佔用：`ss -tlnp | grep 18790`
- 查看日誌：`tail -f cursor-bridge.log`

### OpenClaw 仍使用舊模型
- 確認已在修改設定後重啟 OpenClaw gateway
- 檢查 `~/.openclaw/openclaw.json` — `agents.defaults.model.primary` 應為 `cursor-cli/opus-4.6-thinking`
- 檢查 `~/.openclaw/agents/main/agent/models.json` — 應包含 `cursor-cli` provider

### Cursor CLI 驗證問題
- 執行 `cursor agent login` 或 `cursor agent status` 檢查驗證狀態
- 確認你有有效的 Cursor 訂閱

### 回應速度慢
- 第一次請求可能較慢（Cursor agent 啟動時間約 5-15 秒）
- 後續請求通常會更快
- `thinking` 模型需要更長時間，但會產生更好的結果

## 授權條款

MIT
