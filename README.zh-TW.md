**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

# cursor-bridge

將任何 OpenAI 相容的用戶端串接到 [Cursor CLI](https://cursor.com/cli) — 透過你的 Cursor 訂閱使用頂級 AI 模型（Claude 4.6 Opus、GPT-5.2、Gemini 3 Pro 等），**不需要額外的 API Key**。

## 架構

```
任何 OpenAI 相容的用戶端
（OpenClaw、Continue.dev、自訂應用、curl 等）
                    │
                    │  OpenAI 相容 API
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

**運作原理：** cursor-bridge 提供一個 OpenAI 相容的 API（`/v1/chat/completions`）。當用戶端發送請求時，bridge 會將其轉譯成 `cursor agent --print --output-format stream-json` 指令並串流回傳結果。零外部依賴 — 只使用 Node.js 內建模組。

## 更新日誌

完整版本歷史請見 [CHANGELOG.zh-TW.md](CHANGELOG.zh-TW.md)（v1.0 → v1.6）。

## 前置需求

| 需求 | 版本 |
|------|------|
| Node.js | >= 22 |
| [Cursor CLI](https://cursor.com/cli) | 已安裝（`curl https://cursor.com/install -fsS \| bash`） |
| Cursor 帳號 | 已登入（`cursor agent login`）或設定 `CURSOR_API_KEY` |

## 認證設定

cursor-bridge 會自動將認證憑證傳遞給 Cursor CLI。三種方式（優先順序如下）：

**方式 1 — CLI 登入（互動使用推薦）：**
```bash
cursor agent login
```

**方式 2 — API Key（daemon/伺服器使用推薦）：**
```bash
# 在 .env 中設定：
CURSOR_API_KEY=your-api-key-here
```

**方式 3 — Auth Token：**
```bash
# 在 .env 中設定：
CURSOR_AUTH_TOKEN=your-auth-token-here
```

啟動 banner 會顯示目前使用的認證方式。

## 快速開始

```bash
git clone https://github.com/Kinolian1107/openclaw-bridge-cursor-cli.git
cd openclaw-bridge-cursor-cli

chmod +x install.sh
./install.sh
# → 偵測 Cursor CLI，建立 .env 與 start/stop 腳本
# → 若偵測到 OpenClaw，詢問是否自動設定整合（可選）

./start.sh daemon
```

## 手動設定

### 1. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env — 設定 CURSOR_BIN、CURSOR_MODEL、CURSOR_API_KEY
```

### 2. 啟動 bridge

```bash
# 前景執行（除錯用）
node cursor-bridge.mjs

# 背景執行（daemon 模式）
./start.sh daemon

# 停止
./stop.sh

# 查看今日 log
tail -f logs/cursor-bridge.$(date +%Y%m%d).log
```

### 3. 測試

```bash
curl http://127.0.0.1:18790/health

# 查詢可用模型清單
curl http://127.0.0.1:18790/v1/cursor-models

# 發送聊天請求
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好！"}]}'
```

## Hermes Agent 整合（可選）

如果你使用 [Hermes Agent](https://github.com/nousresearch/hermes-agent)，執行 `./set-hermesagent.sh` — 它會設定 Hermes 使用 cursor-bridge，並**自動同步所有可用模型**到 Hermes，讓 `/model` 指令顯示完整的模型清單。

```bash
# 先確認 cursor-bridge 已啟動
./start.sh daemon

# 設定 Hermes 並同步所有模型
./set-hermesagent.sh
```

執行後，在 Hermes 中選擇 `/model` → `bridge-cursor-cli`，即可看到所有可用模型（auto、claude-4.6-opus-*、gpt-5.*、gemini-3.1-pro 等）。

隨時重新執行 `./set-hermesagent.sh` 可從 bridge 刷新最新的模型清單。

## OpenClaw 整合（可選）

如果你使用 [OpenClaw](https://github.com/openclaw/openclaw)，執行 `./install.sh` — 它會偵測 OpenClaw 並詢問是否自動設定。

若要手動設定，編輯 `~/.openclaw/openclaw.json`：

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "cursor-cli/opus-4.6-thinking" }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [{
          "id": "opus-4.6-thinking",
          "name": "Cursor CLI (opus-4.6-thinking)",
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 200000,
          "maxTokens": 65536
        }]
      }
    }
  }
}
```

然後重啟 OpenClaw gateway：
```bash
openclaw gateway stop && openclaw gateway
```

## 設定參數

所有設定透過環境變數（或 `.env` 檔案）：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `BRIDGE_PORT` | `18790` | 代理伺服器埠號 |
| `BRIDGE_HOST` | `127.0.0.1` | 綁定位址 |
| `CURSOR_MODEL` | `auto` | 無 `tools` 的請求使用的預設模型 |
| `CURSOR_TOOL_BRIDGE_MODEL` | `gpt-5.3-codex-high` | 有 `tools` 時使用的模型。Claude 系模型無法配合工具協議，codex 系模型可正常運作。設為 `""` 停用覆寫。 |
| `CURSOR_TOOL_BRIDGE_AGENT_MODE` | `""` (full agent) | Tool Bridge 模式下 cursor-agent 的執行模式。預設（空字串）= full agent 模式，允許 shell/檔案執行，適合 `autohackmd` 等技能。設為 `"ask"` 還原唯讀 ask 模式。 |
| `CURSOR_BIN` | `cursor` | `cursor` 或 `cursor-agent` 二進位檔路徑 |
| `CURSOR_WORKSPACE` | `~/.cursor-bridge/workspace` | cursor agent 工作目錄 |
| `CURSOR_MODE` | *（空）* | `ask`（唯讀問答）/ `plan`（唯讀規劃）/ *空* = 完整 agent |
| `CURSOR_WORKTREE` | `false` | `true` = 在暫時 git worktree 中隔離編輯 |
| `CURSOR_API_KEY` | *（空）* | Cursor API Key（替代 `cursor agent login`） |
| `CURSOR_AUTH_TOKEN` | *（空）* | Cursor Auth Token（替代 API Key） |
| `BRIDGE_TIMEOUT_MS` | `300000` | 請求逾時（預設 5 分鐘） |

## Log 管理

Log 寫入 `logs/` 目錄，每日自動輪轉：

```
logs/
└── cursor-bridge.20260416.log   ← 每天一份
```

```bash
# 即時追蹤今日 log
tail -f logs/cursor-bridge.$(date +%Y%m%d).log

# 查看特定日期
cat logs/cursor-bridge.20260416.log
```

午夜自動切換新的 log 檔，無需重啟服務。

## 推薦模型

| 使用場景 | 推薦模型 | 原因 |
|----------|----------|------|
| 一般對話 / 程式開發 | `claude-4.6-opus-high-thinking` 或 `auto` | 最佳推理品質 |
| 工具型 Agent（Hermes 瀏覽器工具等）| `gpt-5.3-codex-high`（**自動選用**） | 唯一能穩定輸出 `<tool_call>` blocks 而不拒絕的模型 |
| 快速 / 低成本任務 | `gpt-5.3-codex-low` | 成本較低，仍能正確遵循工具協議 |

> **工具型 Agent 重要說明：** Claude 系模型（`claude-4.6-*`、`claude-4.*`）會將 `<tool_calling_protocol>` 指令識別為「prompt injection 攻擊」而拒絕配合——這些模型永遠不會輸出 `<tool_call>` blocks。cursor-bridge 在請求中有 `tools` 時，無論你指定哪個模型，都會**自動切換到 `gpt-5.3-codex-high`**。

## 可用模型

透過 API 取得你的 Cursor 訂閱方案下即時可用的模型清單：

```bash
curl http://127.0.0.1:18790/v1/cursor-models
```

Bridge 首次呼叫時自動探測 Cursor CLI 並快取結果。常見模型範例：

| 模型 ID | 說明 |
|---------|------|
| `auto` | 讓 Cursor 自動選擇最佳模型 — **推薦** |
| `claude-4.6-opus-high-thinking` | Claude 4.6 Opus，高預算 + 延伸思考 |
| `claude-4.6-opus-max-thinking` | Claude 4.6 Opus，最高預算 + 延伸思考 |
| `claude-4.6-sonnet-medium-thinking` | Claude 4.6 Sonnet（含延伸思考） |
| `composer-2` | Cursor Composer 2 |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gpt-5.2` | GPT-5.2 |
| `gemini-3.1-pro` | Gemini 3.1 Pro |

> 可用模型視你的 Cursor 訂閱方案而定，API 只回傳你的帳號實際可使用的模型。

在 `.env` 中設定 `CURSOR_MODEL` 並重啟，或在每次請求的 `model` 欄位直接指定。

## API 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/health` | GET | 健康檢查 |
| `/v1/models` | GET | 列出可用的 Cursor 模型（探測 CLI，結果快取） |
| `/v1/cursor-models` | GET | `/v1/models` 的別名 |
| `/v1/chat/completions` | POST | 聊天補全（支援串流與非串流） |

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

## 解除安裝

```bash
./uninstall.sh
```

停止 bridge，若有 OpenClaw 備份則詢問是否還原，並移除 `~/.bashrc` 中的自動啟動項目。

## 運作原理（技術細節）

### 請求流程

1. **用戶端** 發送 OpenAI 相容的聊天補全請求
2. **cursor-bridge** 將訊息陣列轉換成單一提示字串：
   - 系統訊息 → `<system_instructions>` 區塊
   - 對話歷史 → `<conversation_history>` 區塊
   - 最新使用者訊息 → 附加在最後
   - 若有 `tools` → 注入為 `<available_tools>` 區塊 + `--mode ask`
3. **cursor-bridge** 啟動：
   ```
   cursor agent --print --force --model <model>
     --output-format stream-json --stream-partial-output
     --workspace <path> [--worktree] [--mode ask|plan]
   ```
   - Prompt ≤ 32KB：作為 CLI 參數傳遞
   - Prompt > 32KB：透過 stdin pipe 傳遞（避免 Linux `E2BIG` 限制）
4. **cursor agent** 透過你的 Cursor 訂閱使用選定的模型處理提示
5. Bridge 解析 NDJSON `stream-json` 事件（`system`、`assistant`、`tool_call`、`result`）並轉換為 OpenAI 相容的 SSE
6. Token 用量從字元數估算並包含在最後的回應 chunk 中

### CLI Flags 參考

| Flag | 用途 |
|------|------|
| `--print` / `-p` | 非互動（headless）模式 |
| `--force` / `--yolo` | 直接套用檔案修改 |
| `--output-format stream-json` | 結構化 NDJSON 事件串流 |
| `--stream-partial-output` | 增量文字 delta，支援即時串流 |
| `--model <id>` | 選擇模型 |
| `--workspace <path>` | 設定 repository root |
| `--worktree` | 在暫時 git worktree 中隔離編輯 |
| `--mode ask\|plan` | 唯讀模式 |

### Cursor CLI 認證機制

Cursor CLI 支援三種認證方式（按優先順序）：

1. **`CURSOR_API_KEY`** 環境變數
2. **`CURSOR_AUTH_TOKEN`** 環境變數
3. **`cursor agent login`** 的本地登入 session

cursor-bridge 透過 `{ ...process.env }` 將所有環境變數傳遞給子程序，因此在 `.env` 或 shell 環境中設定的任何認證方式都會自動生效。

### Tool Bridge 模式

當用戶端在 API 請求中包含 `tools` 時：
1. Bridge **自動切換到 `gpt-5.3-codex-high`**（覆寫請求中的模型）
2. 工具定義以 `<tool_calling_protocol>` XML 格式注入到 prompt 中
3. 模型在需要呼叫工具時輸出 `<tool_call>` XML blocks
4. Bridge 解析這些 blocks 並轉換為 OpenAI `tool_calls` 格式
5. 用戶端執行工具並回傳結果，Bridge 處理完整的多輪工具循環

**為什麼需要模型覆寫？** Claude 系模型會將 user message 中的 `<tool_calling_protocol>` 識別為「prompt injection 攻擊」而拒絕輸出 `<tool_call>` blocks——這是 Claude 內建的安全機制，無法透過 prompt 技巧繞過。`gpt-5.3-codex-high` 能穩定遵循工具協議。

透過環境變數覆寫工具橋接模型：
```bash
CURSOR_TOOL_BRIDGE_MODEL=gpt-5.3-codex-low   # 較低成本的替代方案
CURSOR_TOOL_BRIDGE_MODEL=                     # 停用覆寫，使用請求中指定的模型
```

### ACP（Agent Communication Protocol）

Cursor CLI 也支援 `cursor agent acp` — 一個基於 stdio 的 JSON-RPC 2.0 協議，供進階自訂整合使用（JetBrains、Neovim、Zed 等 IDE 插件使用此協議）。cursor-bridge 目前使用較簡單的 `--print` headless 模式；若有更複雜的整合需求可研究 ACP。

## 疑難排解

### Bridge 無法啟動
- 檢查 18790 埠是否已被佔用：`ss -tlnp | grep 18790`
- 查看日誌：`tail -f logs/cursor-bridge.$(date +%Y%m%d).log`

### 認證錯誤
- 執行 `cursor agent login` 進行互動式登入
- 或在 `.env` 中設定 `CURSOR_API_KEY`
- 檢查狀態：`cursor agent status`

### 找不到 Cursor CLI
- 安裝：`curl https://cursor.com/install -fsS | bash`
- 若安裝在非標準路徑，在 `.env` 中設定 `CURSOR_BIN` 完整路徑

### 回應速度慢
- 第一次請求可能較慢（Cursor agent 啟動時間約 5-15 秒）
- `thinking` 模型需要更長時間，但會產生更好的結果

## 授權條款

MIT
