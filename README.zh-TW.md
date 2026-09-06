**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

# cursor-bridge

把你的 **Cursor 訂閱** 變成本機 AI API server。cursor-bridge 將 [Cursor CLI](https://cursor.com/cli) 包成 HTTP proxy，同時支援 **OpenAI** 與 **Anthropic** 兩種 wire format — 任何 AI 用戶端都能使用頂級模型（預設 Grok 4.6，另有 Claude Fable 5、Claude Opus 4.8、GPT-5.5、Gemini 3.1 Pro 等 130+ 個），**完全不需要各家的 API Key**。原生支援 **Linux、macOS 與 Windows**。

## 這個專案能做什麼

- **OpenAI 相容 API** — `POST /v1/chat/completions`（串流與非串流），OpenClaw、Hermes Agent、Continue.dev、OpenAI SDK 或 `curl` 都能直接用
- **Anthropic 相容 API**（v2.2）— `POST /v1/messages` 讓 Anthropic SDK、甚至 **Claude Code**（`ANTHROPIC_BASE_URL`）跑在 Cursor 模型上
- **多模態輸入**（v2.3）— `/v1/chat/completions` 與 `/v1/messages` 接受圖片、聲音、影片內容（data URI、`http(s)` URL、Anthropic `image`/`document` blocks）
- **Tool calling** — 完整的多輪 `tools` 循環，自動切換到能穩定遵循工具協議的 codex 模型
- **模型 allowlist** — 互動式挑選工具（`node select-models.mjs`）馴服 130+ 模型清單，並同步到 Hermes / OpenClaw
- **一行指令整合** — `./set-hermesagent.sh` 端到端設定 Hermes Agent（全新安裝也行，不需要 Nous Portal）
- **維運就緒**（v2.2）— 可選 bearer auth（`BRIDGE_API_KEY`）供 LAN/Tailscale 使用、Prometheus `/metrics`、每日輪轉 log、session 延續
- **跨平台** — Linux、macOS、Windows 都是一級公民：`install.sh`/`start.sh`/`stop.sh` 各有原生 PowerShell 對應版（`install.ps1`/`start.ps1`/`stop.ps1`），長 prompt 走 stdin 避開 OS 命令列長度限制，`.exe`/`.cmd`/`.bat`/`.ps1` 形式的 Cursor binary 全都支援
- **零依賴** — 只用 Node.js 內建模組

```
OpenAI / Anthropic 用戶端 ──► cursor-bridge (port 18790) ──► cursor agent --print ──► 你的 Cursor 訂閱
```

## 快速開始

需求：**Node.js ≥ 22** 與已登入的 [Cursor CLI](https://cursor.com/cli)（`cursor agent login`）。

### 先安裝 Node.js（如果還沒裝）

本專案是純 Node.js，沒有它無法執行。先確認你的環境：

```bash
node --version   # 必須是 v22.0.0 以上
```

若指令不存在或版本低於 22，請先安裝：

```bash
# Linux / macOS / WSL — nvm（推薦，免 sudo，可指定版本）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 重開終端機後執行：
nvm install 22

# macOS — Homebrew
brew install node@22

# Ubuntu / Debian — NodeSource apt repo
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

```powershell
# Windows — winget（或到 https://nodejs.org 下載 LTS 安裝檔）
winget install OpenJS.NodeJS.LTS
```

繼續之前，再跑一次 `node --version` 確認是 `v22+`。

**Linux / macOS / WSL：**

```bash
git clone https://github.com/Kinolian1107/bridge-cursor-cli.git
cd bridge-cursor-cli

./install.sh        # 偵測 Cursor CLI、建立 .env、可選 OpenClaw 整合
./start.sh daemon   # 背景啟動
```

**Windows（PowerShell，原生 Cursor CLI 安裝）：**

```powershell
git clone https://github.com/Kinolian1107/bridge-cursor-cli.git
cd bridge-cursor-cli

.\install.ps1        # 偵測 cursor-agent.exe、建立 .env
.\start.ps1 daemon   # 背景啟動（停止：.\stop.ps1）
```

或在任何平台手動：`cp .env.example .env` 之後 `node cursor-bridge.mjs` — bridge 會自行載入 `.env`。

## 試試看

```bash
# 健康檢查 + 模型清單
curl http://127.0.0.1:18790/health
curl http://127.0.0.1:18790/v1/models

# OpenAI 格式
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好！"}]}'

# Anthropic 格式 — 或把 ANTHROPIC_BASE_URL 指過來，直接用 SDK / Claude Code
curl http://127.0.0.1:18790/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"你好！"}]}'
```

## 文件導覽

| 主題 | 看這裡 |
|------|--------|
| **API 參考** — 端點、Anthropic Messages API、bearer auth 與 Prometheus metrics、逐請求 `metadata.cursor_*` 選項、session 延續 | [docs/api.zh-TW.md](docs/api.zh-TW.md) |
| **設定參數** — 所有環境變數、Cursor 認證、log 管理、疑難排解、解除安裝 | [docs/configuration.zh-TW.md](docs/configuration.zh-TW.md) |
| └ 對 LAN 開放 — 讓同網段其他電腦連線（含 WSL2 port forwarding） | [docs/configuration.zh-TW.md](docs/configuration.zh-TW.md#對區域網路lan開放-bridge) |
| **模型** — allowlist 挑選工具、推薦模型、即時模型清單、Tool Bridge 模式 | [docs/models.zh-TW.md](docs/models.zh-TW.md) |
| **整合** — Hermes Agent、OpenClaw、Anthropic SDK / Claude Code | [docs/integrations.zh-TW.md](docs/integrations.zh-TW.md) |
| └ Hermes 首次安裝（不走 Nous Portal） | [docs/hermes-setup.zh-TW.md](docs/hermes-setup.zh-TW.md) |
| **運作原理** — 請求流程、CLI flags、fingerprint dedup、ACP | [docs/how-it-works.zh-TW.md](docs/how-it-works.zh-TW.md) |
| **更新日誌** — 完整版本歷史（v1.0 → v2.3） | [docs/CHANGELOG.zh-TW.md](docs/CHANGELOG.zh-TW.md) |
| **Roadmap / 研究筆記** | [docs/todo.md](docs/todo.md) · [docs/research/](docs/research/) |

每份文件都有英文版（去掉 `.zh-TW` 後綴）。

## 解除安裝

```bash
./uninstall.sh
```

## 授權條款

MIT
