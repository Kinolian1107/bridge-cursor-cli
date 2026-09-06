**[English](models.md)** | **[繁體中文](models.zh-TW.md)** · [← README](../README.zh-TW.md)

# 模型

## 模型 Allowlist（select-models）

Cursor 開放了 **130+ 個模型**，會把模型選單灌爆（Hermes 的 `/model` 選單幾乎無法使用）。用互動式挑選工具一次設定好你的 allowlist：

```bash
node select-models.mjs        # 或：npm run models
```

- ↑/↓ 移動 · **空白鍵** 勾選 · **a** 全選 · **n** 全不選 · 直接打字過濾 · **enter** 儲存
- 選取結果存到 `models.json`，bridge 的 `/v1/models` 之後只回傳這些模型 — **不需重啟**
- 儲存後工具會詢問是否直接同步到 Hermes Agent（`~/.hermes/config.yaml`）與 OpenClaw（`~/.openclaw/openclaw.json`）

非互動用法：

```bash
node select-models.mjs --list                       # 列出所有探測到的模型
node select-models.mjs --set "auto,gpt-5.3-codex-high,claude-fable-5-thinking-medium"
node select-models.mjs --sync                       # 把現有 allowlist 重新同步到 Hermes/OpenClaw
node select-models.mjs --clear                      # 移除 allowlist（顯示全部模型）
curl "http://127.0.0.1:18790/v1/models?all=1"       # 略過 allowlist 取得完整清單
```

## 推薦模型

| 使用場景 | 推薦模型 | 原因 |
|----------|----------|------|
| 一般對話 / 程式開發 | `cursor-grok-4.6-high`（預設）、`claude-fable-5-thinking-medium` 或 `auto` | Grok 4.6 是 bridge 預設；Claude / `auto` 仍可指定 |
| 工具型 Agent（Hermes 瀏覽器工具等）| `gpt-5.3-codex-high`（**自動選用**） | 能穩定輸出 `<tool_call>` blocks 而不拒絕 |
| 快速 / 低成本任務 | `composer-2.5` 或 `gpt-5.3-codex-low` | 成本較低、速度快 |

> **工具型 Agent 重要說明：** Claude 系模型（`claude-4.6-*`、`claude-4.*`）會將 `<tool_calling_protocol>` 指令識別為「prompt injection 攻擊」而拒絕配合——這些模型永遠不會輸出 `<tool_call>` blocks。cursor-bridge 在請求中有 `tools` 時，無論你指定哪個模型，都會**自動切換到 `gpt-5.3-codex-high`**。詳見下方 [Tool Bridge 模式](#tool-bridge-模式)。

## 可用模型

透過 API 取得你的 Cursor 訂閱方案下即時可用的模型清單：

```bash
curl http://127.0.0.1:18790/v1/cursor-models
```

Bridge 首次呼叫時透過 `cursor-agent --list-models` 探測並快取結果。常見模型範例（cursor-agent 2026.08 時點，共 130+ 個）：

| 模型 ID | 說明 |
|---------|------|
| `cursor-grok-4.6-high` | Cursor Grok 4.6 — **預設**（另有 `-low`/`-medium`/`-xhigh`；`-fast` 後綴 = fast 檔位） |
| `auto` | 讓 Cursor 自動選擇最佳模型 |
| `cursor-grok-4.5-high` | Cursor Grok 4.5（非 fast；另有 `-low`/`-medium`；`-fast` 後綴 = fast 檔位） |
| `claude-opus-5-thinking-high` | Claude Opus 5 延伸思考 |
| `claude-fable-5-thinking-high` | Claude Fable 5 延伸思考 |
| `claude-opus-4-8-thinking-high` | Claude Opus 4.8 延伸思考 |
| `gpt-5.6-sol-high` | GPT-5.6 Sol High |
| `gpt-5.5-high` | GPT-5.5 High（另有 `-none`/`-low`/`-medium`/`-extra-high`） |
| `gpt-5.3-codex-high` | GPT-5.3 Codex High — 工具呼叫首選 |
| `composer-2.5` | Cursor Composer 2.5 |
| `gemini-3.1-pro` | Gemini 3.1 Pro |
| `kimi-k3-high` | Kimi K3 High |

> 可用模型視你的 Cursor 訂閱方案而定，API 只回傳你的帳號實際可使用的模型。Cursor 很常改模型名稱 — 舊的 `opus-4.6-thinking`、`composer-2` 等 id 已經不存在。Bridge 預設是 `cursor-grok-4.6-high`；若要讓 Cursor 自動選，設 `CURSOR_MODEL=auto`。

在 `.env` 中設定 `CURSOR_MODEL` 並重啟，或在每次請求的 `model` 欄位直接指定。

## Tool Bridge 模式

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

如果你希望工具呼叫維持在 `composer-2.5`（不切到 codex），可建立這樣的設定檔：

```bash
# .env.mode-composer-tools
CURSOR_MODEL=composer-2.5
CURSOR_TOOL_BRIDGE_MODEL=
```

這樣在請求含 `tools` 時就不會強制覆寫成 codex，而是維持請求/預設模型。不過就 `<tool_call>` 協議穩定性而言，codex 仍然是最穩定的選項。
