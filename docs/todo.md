# todo.md — bridge-cursor-cli 未來方向

> 此檔記錄已研究但暫不實作的方向、以及未來可能想做的事。
> 撰寫時間：2026-05-08（v2.0.0 後）

---

## 1. ACP（Agent Communication Protocol）整合 — Deferred

### 背景

目前 bridge-cursor-cli 是 **B 路線（OpenAI-compatible HTTP shim）**：

```
caller ─HTTP→ cursor-bridge :18790 ─spawn→ cursor-agent CLI (stdout NDJSON) ─→ HTTP SSE
              [假裝 OpenAI API]            [stream-json + fingerprint dedup]
```

**ACP（C 路線）**是 Cursor 官方為 agent CLI 設計的雙向 streaming 協議（NDJSON over stdio / WebSocket），是「直連通道」而非「相容層」：

```
caller ─ACP/NDJSON→ cursor-agent  （無 HTTP / 無 spawn / protocol-level message id）
```

### ACP 相對 B 路線的優點

| 項目 | B 路線（現況） | C 路線（ACP） |
|---|---|---|
| 啟動延遲 | 每次 spawn 一次 cursor-agent | cursor-agent 常駐 socket |
| Stream dedup | 需要 fingerprint（`timestamp_ms` 有、`model_call_id` 無）過濾 3 種 variant | Protocol 層內建 message id，不會重複 |
| Tool calling | 需要把 `web_search_20250305` / `googleSearch` 翻譯給 cursor | 直接走 cursor 內建 tool 協議 |
| Session continuity | 靠 `chat_id` + `--resume` 模擬 | 原生 session，重啟仍記得 context |
| Pre-H2 preamble | 要靠 `trimToFirstH2()` 之類 hack 過濾 | `assistant_message_delta` vs `tool_use_thought` 在協議層分離 |
| OpenAI SDK 相容 | ✅ 任何 OpenAI 工具都能接 | ❌ 只有自家程式能用 |

### 為什麼暫不做

1. **失去通用性**：bridge 的價值就在於可以給 OpenClaw / Continue.dev / 任何 OpenAI SDK 用戶接，ACP 等於回到單一消費者模式。
2. **現況夠用**：v2.0 的 fingerprint dedup + per-request `metadata.cursor_*` + model-name prefix tokens 已能解掉 LazyBun 想要的所有問題。
3. **ACP 還在演進**：Cursor 1.3+ 才趨於穩定，目前協議仍可能 breaking change。

### 何時重啟此路線

- 若出現「LazyBun 是 cursor-bridge 唯一消費者」的事實 → 直接 ACP 比較乾淨
- 若 fingerprint dedup 維護成本爆掉（cursor 每次 stream-json 改格式都要追） → 改用 ACP 一勞永逸
- 若 LazyBun 真的需要「主題研究的跨 session memory」且 `chat_id` 模擬不夠用

### 若要動工的初步設計

不取代 B 路線，而是**並存**：

```
cursor-bridge.mjs
├── HTTP server :18790                  # B 路線（保留）
│   ├── POST /v1/chat/completions
│   ├── POST /v1/cursor-sessions/create
│   └── GET  /healthz
└── ACP socket :18791 (or stdio mode)   # C 路線（新增）
    └── 直連 cursor-agent，emit ACP NDJSON
```

LazyBun `LlmProvider` 介面新增 `acp` 實作；其他工具仍走 HTTP。
新增旗標 `BRIDGE_ACP_ENABLED=1` 預設關，避免誤觸。

### 研究來源備忘

- Cursor 官方 ACP 規格（需 cursor 1.3+）
- `cursor agent --acp-stdio` 模式（待驗證旗標名）
- 對照組：Anthropic Claude Agent SDK、OpenAI Realtime API（皆為 first-party agent protocol）

---

## 2. 其他可考慮的方向

### 2.1 Tool bridge 雙向化

目前 tool 翻譯是「caller → cursor」單向（OpenAI tool spec → cursor 內建 tool）。
反方向（cursor 觸發 tool → caller 執行 → 回傳結果）目前不支援。
若 caller 想把自己的 function calling 拋給 cursor 用，需要做 tool result roundtrip。

### 2.2 Session GC / TTL

`POST /v1/cursor-sessions/create` 開的 chat 沒有過期機制，cursor 那邊會無限累積。
建議：bridge 維護一個 `sessionId → lastUsedAt` 表，過 7 天自動 `cursor agent rm <id>`。

### 2.3 多 cursor binary 切換

目前 `CURSOR_BIN` 只能設一個。若使用者有多個 cursor 版本（stable / nightly），
可考慮 per-request `metadata.cursor_binary` override。

### 2.4 Bridge 自身 telemetry ✅（v2.2 部分完成）

✅ v2.2 已實作 `/metrics` Prometheus 端點（`lib/metrics.mjs`）：
`bridge_requests_total{endpoint,method,status}`、`bridge_request_duration_seconds`
（sum/count）、`bridge_auth_failures_total`、`bridge_inflight_requests`、`bridge_uptime_seconds`。
同版本也加了 optional bearer auth（`BRIDGE_API_KEY`，`lib/auth.mjs`）。

剩餘想法：
- 結構化日誌（JSON line）寫到 `logs/bridge.log`
- latency histogram buckets（目前是 summary sum/count）、spawn count 獨立指標

### 2.5 Health check 強化

目前 `/healthz` 只回 `{ ok: true, supports }`。可加：
- 真的 spawn 一次 `cursor agent --version`，確認 binary 存在且版本符合
- Cache 30 秒，避免每次 health check 都 spawn

### 2.6 lib/parse-cursor-options 拆分

`parse-cursor-options.mjs` 目前處理：
1. `metadata.cursor_*` 解析
2. Model name prefix tokens
3. Default 合併

若再加新欄位（例如 ACP 相關旗標），考慮拆成 `parse-metadata.mjs` + `parse-model-tokens.mjs` 兩支。

### 2.7 tests/ 補強

`parse-options.test.mjs` 已有 22 個 case。缺：
- HTTP layer 端對端測試（用 supertest 或類似，mock cursor-agent stdout）
- Stream dedup fingerprint logic 的單元測試（給三種 variant，確認只有 variant 1 通過）

---

## 3. 已完成、不再追蹤

- ✅ v2.0 per-request `metadata.cursor_*` 解析
- ✅ Model name prefix tokens（`cursor/ask:`、`cursor/plan:`、`cursor/agent:`、`cursor/worktree:`）
- ✅ Fingerprint dedup（filter 非 delta variant）
- ✅ `POST /v1/cursor-sessions/create` + `GET /v1/cursor-sessions`
- ✅ Health endpoint `supports.*` capability matrix
- ✅ LazyBun 整合（per-topic `cursorChatId` 持久化）
