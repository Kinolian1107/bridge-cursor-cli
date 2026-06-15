**[English](configuration.md)** | **[繁體中文](configuration.zh-TW.md)** · [← README](../README.zh-TW.md)

# 設定參數

所有設定透過環境變數（或 `.env` 檔案 — bridge 會自行載入 `.env`，任何平台直接 `node cursor-bridge.mjs` 就能吃到設定）。

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `BRIDGE_PORT` | `18790` | 代理伺服器埠號 |
| `BRIDGE_HOST` | `127.0.0.1` | 綁定位址 |
| `BRIDGE_API_KEY` | *（空）* | **v2.2** — 可選 bearer auth；設定後除 `/health` 外所有端點都需要帶 key（見 [api.zh-TW.md](api.zh-TW.md#bearer-auth-與-metricsv22)） |
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
| `BRIDGE_MODELS_FILE` | `<專案目錄>/models.json` | **v2.1** — 模型 allowlist 檔案，由 `select-models.mjs` 管理 |
| `BRIDGE_VERBOSE` | `true` | 記錄完整 request/response 內容與 cursor-cli I/O；設 `false` 關閉 |

> Windows 上請在 `.env` 把 `CURSOR_BIN` 指向你的 Cursor CLI 執行檔（例如 `C:\Users\you\.local\bin\cursor-agent.exe`）；`.cmd`/`.bat`/`.ps1` 形式的 shim 也支援。

## Cursor 認證設定

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

啟動 banner 會顯示目前使用的認證方式。cursor-bridge 透過 `{ ...process.env }` 將所有環境變數傳遞給子程序，因此在 `.env` 或 shell 環境中設定的任何認證方式都會自動生效。

## 對區域網路（LAN）開放 bridge

bridge 預設綁定 `127.0.0.1`，只有本機連得到。要讓同網段其他電腦把它當 endpoint 用，在跑 bridge 的這台機器做三件事:

### 1. 綁定所有網卡

```bash
# .env
BRIDGE_HOST=0.0.0.0
```

`0.0.0.0` 會監聽所有網路介面,區網用戶端才連得進來。改完重啟（`./stop.sh && ./start.sh daemon`）,啟動 banner 應顯示 `Host: 0.0.0.0`。

### 2. 務必設定 `BRIDGE_API_KEY`

一旦綁了 `0.0.0.0`,**任何連得到這台的人都能花你的 Cursor 訂閱**。設一把 bearer 金鑰:

```bash
# .env
BRIDGE_API_KEY=$(openssl rand -hex 32)   # 或任何夠長的隨機字串
```

設定後,除了 `/health` 以外每個端點都要帶下列任一 header:

```bash
-H "Authorization: Bearer <金鑰>"
# 或
-H "x-api-key: <金鑰>"
```

> ⚠️ 不設金鑰只適合完全信任的家用網段。LAN / Tailscale 一律建議設。

### 3. 查區網 IP 並開防火牆

```bash
# 查 IP（找 192.168.x.x / 10.x.x.x 那組）
ip addr | grep "inet "          # Linux
ipconfig                         # Windows (PowerShell)

# 開放 port 18790
sudo ufw allow 18790/tcp                              # Linux (ufw)
```

```powershell
# Windows（系統管理員 PowerShell）
New-NetFirewallRule -DisplayName "cursor-bridge" -Direction Inbound -LocalPort 18790 -Protocol TCP -Action Allow
```

### 其他電腦這樣連

把 `127.0.0.1` 換成這台的區網 IP,並帶上金鑰:

```bash
curl http://192.168.1.50:18790/v1/chat/completions \
  -H "Authorization: Bearer <金鑰>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

OpenClaw / Hermes / SDK 用戶端:`base_url` 填 `http://192.168.1.50:18790/v1`,API key 填同一把。

### ⚠️ 跑在 WSL2 裡的情況

WSL2 在 NAT 後面,所以即使設了 `BRIDGE_HOST=0.0.0.0`,區網其他電腦也**連不到** WSL 的 IP —— 它們只看得到 Windows 主機。要在 **Windows 主機**（系統管理員 PowerShell）加一條 port forwarding:

```powershell
# 取得 WSL 的 IP
wsl hostname -I

# 把 Windows 主機的 18790 轉發進 WSL（把 <WSL_IP> 換成上面那組）
netsh interface portproxy add v4tov4 `
  listenaddress=0.0.0.0 listenport=18790 `
  connectaddress=<WSL_IP> connectport=18790

# 開 Windows 防火牆
New-NetFirewallRule -DisplayName "cursor-bridge" -Direction Inbound -LocalPort 18790 -Protocol TCP -Action Allow
```

其他電腦接著連的是 **Windows 主機的**區網 IP（用 `ipconfig` 查）,不是 WSL 的。WSL IP 每次重開機會變,轉發規則要重設一次（`netsh interface portproxy reset` 清除舊規則）。原生 Linux/macOS 主機不需要這一步,做完步驟 1–3 即可。

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

### `Workspace path does not exist`
- bridge 啟動時會自動建立 `CURSOR_WORKSPACE`,但在此修正之前安裝的版本可能缺少
  該目錄。手動建立:`mkdir -p ~/.cursor-bridge/workspace`(或 `.env` 裡設定的路徑),
  然後重啟 bridge。重跑 `./install.sh`(或 `.\install.ps1`)也會建立它。

### 回應速度慢
- 第一次請求可能較慢（Cursor agent 啟動時間約 5-15 秒）
- `thinking` 模型需要更長時間，但會產生更好的結果

## 解除安裝

```bash
./uninstall.sh
```

停止 bridge，若有 OpenClaw 備份則詢問是否還原，並移除 `~/.bashrc` 中的自動啟動項目。

Windows：執行 `.\stop.ps1` 後直接刪除專案資料夾即可 — `install.ps1` 只會建立本地 `.env`（不寫 registry、不加開機啟動）。
