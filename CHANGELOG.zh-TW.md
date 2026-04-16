# 更新日誌

cursor-bridge 的所有版本更新紀錄。

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
