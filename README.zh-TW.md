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

**運作原理：** cursor-bridge 提供一個 OpenAI 相容的 API（`/v1/chat/completions`）。當 OpenClaw 發送請求時，bridge 會將其轉譯成 `cursor agent --print` 指令並串流回傳結果。零外部依賴 — 只使用 Node.js 內建模組。

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
3. **cursor-bridge** 啟動 `cursor agent --print --force --model <model>` 並傳入提示
4. **cursor agent** 透過你的 Cursor 訂閱使用選定的模型處理提示
5. 回應以 OpenAI 相容的 SSE 事件串流回傳（或單一 JSON 回應）

當提示超過 128KB 時，bridge 會寫入暫存檔並使用 shell 展開來傳遞。

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
