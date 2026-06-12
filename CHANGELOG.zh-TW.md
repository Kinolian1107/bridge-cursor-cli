# 更新日誌

cursor-bridge 的所有版本更新紀錄。

---

## v2.1（2026-06-12）

**Windows 支援 + 模型 allowlist。完全向下相容。**

### 新增

- **Windows 支援** — bridge 現在可以原生跑在 Windows（與 macOS）上：
  - 移除 `bash`/`cat` 依賴：長 prompt 直接寫入子行程的 stdin（Windows 上一律走 stdin，避開命令列長度限制與 `.cmd` quoting 地雷）。
  - `CURSOR_WORKSPACE` 預設值改用 `os.homedir()`，不再依賴 `$HOME`。
  - `CURSOR_BIN` 可以指向 `.exe`、`.cmd`、`.bat` 或 `.ps1` — `lib/cursor-cli.mjs` 自動選擇對應的 spawn 策略（直接執行 / `cmd.exe` 帶 quoting / `powershell.exe -File`）。
  - 新增 `start.ps1` / `stop.ps1` PowerShell 腳本（daemon 模式、health check、強制終止 fallback），對應 `start.sh` / `stop.sh`。
  - bridge 透過 `process.loadEnvFile()` 自行載入 `.env` — 任何平台直接 `node cursor-bridge.mjs` 即可；真正的環境變數仍優先於 `.env`。
- **模型 allowlist + `select-models.mjs`** — Cursor 現在開放 130+ 個模型，把 Hermes Agent 的 `/model` 選單灌爆了。新的互動式小工具（`node select-models.mjs` / `npm run models`）會探測即時模型清單、讓你勾選子集合（方向鍵 / 空白鍵 / 直接打字過濾）、存到 `models.json`，並可一鍵把選取結果同步到 Hermes（`~/.hermes/config.yaml` 的 `custom_providers`）與 OpenClaw（`~/.openclaw/openclaw.json`）。旗標：`--list`、`--set "a,b,c"`、`--sync`、`--clear`。
  - `/v1/models`（與 `/v1/cursor-models`）只回傳 allowlist 內的模型；`?all=1` 可略過過濾。`models.json` 每次請求重新讀取 — 不需重啟 bridge。
  - 新增 `BRIDGE_MODELS_FILE` 環境變數可覆寫 allowlist 路徑。
  - `/health` 新增 `supports.model_allowlist` 與 `supports.windows`。
- **官方模型探測** — 模型清單改用 `cursor-agent --list-models`（含顯示名稱），不再靠故意送出無效模型解析錯誤輸出。舊版 stderr probe 保留為 fallback。新增 `lib/probe-models.mjs` + `lib/cursor-cli.mjs` 模組與 14 個單元測試（`tests/probe-models.test.mjs`）。

### 變更

- **預設模型改為 `auto`** — 舊預設 `opus-4.6-thinking` 已不存在（Cursor 將其改名為 `claude-4.6-opus-*-thinking` 系列，之後又推出 `claude-opus-4-8-*` 與 `claude-fable-5-*`）。`auto` 不怕 Cursor 頻繁改名；文件列出目前推薦的模型 id。
- `set-hermesagent.sh` / `set-openclaw.sh` 改從過濾後的 `/v1/models` 同步，allowlist 對兩個整合都生效。
- 文件更新至 2026.06 模型目錄（`claude-fable-5-*`、`claude-opus-4-8-*`、`gpt-5.5-*`、`gpt-5.4-*`、`composer-2.5`、`gemini-3.5-flash`、`grok-4.3`、`kimi-k2.5`…）與官方 Windows 原生安裝指令（`irm 'https://cursor.com/install?win32=true' | iex`）。

### 遷移注意事項

- 若你的 `.env` 釘死了過期的模型 id（例如 `CURSOR_MODEL=composer-2` 或 `opus-4.6-thinking`），請更新 — 用 `cursor-agent --list-models` 或 `node select-models.mjs --list` 查現行 id。
- 既有 client 不需任何修改；沒有 `models.json` 時 `/v1/models` 輸出與 v2.0 完全相同。

---

## v2.0（2026-05-07）

**逐請求選項 + session 延續 + json-format 路徑。完全向下相容** — 既有 client（OpenClaw、Continue.dev 等）零修改即可繼續使用。

### 新增

- **`metadata.cursor_*` 區塊** — client 可以**逐請求**指定 cursor-agent flag，不用動 env var：
  - `cursor_mode: "ask" | "plan" | "agent"`
  - `cursor_force_output_format: "text" | "json" | "stream-json"`
  - `cursor_sandbox: "enabled" | "disabled"`
  - `cursor_worktree`、`cursor_worktree_base`、`cursor_skip_worktree_setup`
  - `cursor_resume_chat_id`、`cursor_continue` — session 延續
  - `cursor_stream_partial_output`、`cursor_trust`
- **模型名前綴 token** — 最常用旋鈕的語法糖：
  - `cursor/ask:<model>` → `--mode=ask`
  - `cursor/plan:<model>` → `--mode=plan`
  - `cursor/agent:<model>` → 不加 `--mode`（full agent）
  - `cursor/worktree:<model>` → `--worktree`
  - 可組合：`cursor/ask:worktree:<model>`
  - 衝突時 metadata 永遠贏。
- **`/v1/cursor-sessions/create`** — POST endpoint，呼叫 `cursor agent create-chat` 回傳 `{ chat_id }`，搭配 `metadata.cursor_resume_chat_id` 達成多輪上下文。
- **`/v1/cursor-sessions`** — GET endpoint，透過 `cursor agent ls` 列出歷史 chat。
- **`--output-format=json` 與 `--output-format=text` 路徑** — 非串流 client 可以請求單一 JSON 物件或純文字回應，完全跳過 NDJSON 解析。對 stateless 的用例（摘要、分類）速度顯著更快、邏輯更簡單。
- **官方 fingerprint dedup** — 開啟 `--stream-partial-output` 時，cursor-agent 會 emit 三種 `assistant` event（真 delta / pre-tool-call 重播 / 收尾 flush）。v2.0 依官方文件以 `timestamp_ms` + `model_call_id` 雙欄位過濾，取代 v1.x 啟發式的長度比對 dedup。
- **自動加 `--trust`**（可用 `cursor_trust=false` 關閉）— headless 在非信任 workspace 跑必加。
- **`--sandbox enabled|disabled`** 顯式透傳（之前是 bridge 內部 default）。
- **`--worktree-base` / `--skip-worktree-setup`** flag 全部接通。
- **`/health` 多回能力矩陣** — `supports.metadata_block`、`supports.model_prefix_tokens`、`supports.output_formats`、`supports.session_endpoints`、`supports.fingerprint_dedup`。
- **`lib/parse-cursor-options.mjs`** — 純解析器抽到 sibling module，方便單元測試。
- **`tests/parse-options.test.mjs`** — 22 個 unit test 覆蓋所有解析邊界。

### 變更

- `runCursorAgent` 改吃已解析的 `options` 物件，不再直接讀 global。CONFIG.mode / CONFIG.worktree 仍作為 fallback default。
- 開機 banner 升級為 `cursor-bridge v2.0.0`。

### 升級備註

- **OpenClaw / Continue.dev / curl client**：無需任何修改。沒帶 `metadata.cursor_*` 也沒用 prefix token 時，行為與 v1.6 完全一致。
- **LazyBun 與類似的 headless 呼叫者**：建議帶 `metadata: { cursor_mode: "ask", cursor_force_output_format: "json" }`，可移除研究 / 摘要輸出中的串流前言與 skill 副作用。

---

## v1.6（2026-04-16）

- **autohackmd / shell script 技能修復** — 移除 Tool Bridge 模式強制使用 `--mode ask`。v1.1 起只要請求含有 tools，cursor-bridge 就會加上 `--mode ask`，導致 cursor-agent 拒絕執行寫檔和上傳等操作。使用 `autohackmd` 等需要執行 bash 腳本的技能時，會收到「我是 Ask 模式，無法執行」的回應。v1.6 預設改為 **full agent 模式**，cursor-agent 可以原生執行 shell 指令，`autohackmd` 等技能恢復正常運作。
- **`CURSOR_TOOL_BRIDGE_AGENT_MODE`** — 新增環境變數（預設：`""` = full agent 模式）。設為 `"ask"` 可還原舊的唯讀 ask 模式。

### v1.6 Tool Calling 行為矩陣

Full agent 模式下，`gpt-5.3-codex-high` 採用智慧策略：

| 工具類型 | 範例 | v1.6 行為 | 結果 |
|---------|------|-----------|------|
| 自訂／外部工具 | `send_slack_message`、`query_database`、任意自訂 API | ✅ 回傳 `tool_calls` | Hermes 執行工具 |
| 瀏覽器導航 | `browser_navigate` | ✅ 回傳 `tool_calls` | Hermes 執行工具 |
| Shell 執行 | `terminal`（簡單指令，無技能 context） | ○ cursor-agent 原生執行 | 指令有跑，結果以文字回傳 |
| Shell＋寫檔（帶技能 context） | `terminal` + `write_file`（autohackmd 流程） | ✅/○ 視情況 | 上傳成功 |

**原理：** cursor-agent 對能原生執行的操作（shell、web fetch）直接使用內建工具。對無法原生呼叫的工具（自訂 API、Slack、資料庫），則輸出 `<tool_call>` blocks，由 cursor-bridge 解析為 OpenAI-compatible `tool_calls` 交給 Hermes 執行。這比舊的強制 `--mode ask` 更智慧 — 後者不管工具類型，一律阻止寫入和執行。

---

## v1.5（2026-04-16）

- **Tool Bridge 模式修復** — 當請求中含有 `tools` 時，自動切換到 `gpt-5.3-codex-high`。Claude 系模型（`claude-4.6-*` 等）會將注入的 `<tool_calling_protocol>` 識別為「prompt injection 攻擊」並拒絕輸出 `<tool_call>` blocks。`gpt-5.3-codex-high` 能穩定遵循協議並正確處理多輪工具循環。
- **`CURSOR_TOOL_BRIDGE_MODEL`** — 新增環境變數，可覆寫工具橋接模型（預設：`gpt-5.3-codex-high`）。設為 `""` 可停用覆寫，改用請求中指定的模型。

---

## v1.4（2026-04-16）

- **Hermes Agent 模型同步** — `set-hermesagent.sh` 現在會自動從 cursor-bridge 探測所有可用模型，並寫入 Hermes `custom_providers`，讓 `/model` → `bridge-cursor-cli` 顯示完整的模型清單（80+ 個模型），而不再只有一個。

---

## v1.3

- **動態模型探索** — `GET /v1/models` 和 `GET /v1/cursor-models` 首次請求時自動探測 Cursor CLI，回傳你的訂閱方案下真正可用的模型清單。結果快取在 process 記憶體中，後續呼叫瞬間回應。
- **Workspace 目錄說明** — 啟動前 workspace 目錄（`~/.cursor-bridge/workspace`）必須存在。`install.sh` 會自動建立；手動設定時請執行 `mkdir -p ~/.cursor-bridge/workspace`。

---

## v1.2

- **每日 log 輪轉** — 寫入 `logs/cursor-bridge.yyyyMMdd.log`，一天一份，午夜自動切換，無需重啟。
- **解耦 OpenClaw 依賴** — cursor-bridge 現在可獨立運作，`install.sh` 的 OpenClaw 整合改為可選。
- **Worktree 支援** — 設定 `CURSOR_WORKTREE=true` 可將 agent 的編輯隔離在暫時的 git worktree（`~/.cursor/worktrees`）中。
- **認證可視化** — 啟動 banner 顯示目前使用的認證方式（`CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` / `cursor agent login`）。

---

## v1.1

- **Token 用量回報** — 準確估算並回報 `prompt_tokens`、`completion_tokens` 和 `thinking_tokens`。
- **Tool Bridge 模式** — 當用戶端發送 `tools` 參數時，cursor-bridge 會將工具定義注入到 prompt 中，並將 `<tool_call>` 回應解析為 OpenAI 相容的 `tool_calls` 格式。
- **大型 prompt 處理（E2BIG 修復）** — 超過 32KB 的 prompt 改用 stdin pipe 傳遞。
- **結構化 stream-json 輸出** — 使用 `--output-format stream-json` 可靠解析事件。
- **改善錯誤處理** — 將錯誤分類為 OpenAI 相容的錯誤類型。

---

## v1.0

- 初始版本：讓任何支援 OpenAI API 的用戶端透過 OpenAI 相容代理呼叫 Cursor CLI 模型。
