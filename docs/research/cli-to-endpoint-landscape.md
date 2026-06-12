# CLI → Endpoint 賽道研究：bridge-cursor-cli 還能做得更好的地方

*產出：2026-06-13 ｜ 來源：18 個 repo / 文章 ｜ 信心：中高（GitHub 一手 README + 協議文件交叉比對）*

## Executive Summary

「把 agentic CLI 包成 OpenAI-compatible endpoint」在 2025 下半年到 2026 已經從個人 hack
變成一個有數十個專案的小賽道。主流分兩派:**廣度型多後端 gateway**(`agent-cli-to-api`、
`code-proxy`、`llm-cli-proxy` —— 一個 endpoint 同時包 Codex / Claude Code / Gemini / Cursor,
用 model prefix 路由)與 **深度型單一 vendor bridge**(各種 `claude-code-proxy`)。
bridge-cursor-cli 屬於後者,而且在「**下游 consumer 自動設定**」(select-models.mjs 同步 Hermes /
OpenClaw)、**Windows 支援**、**zero-dep** 這幾點上,目前賽道裡幾乎沒有對手做到同樣程度。

但對照 production 化最深的 `ccproxy`(Go,bearer token + scopes + Prometheus + FUSE workspace
bridge)和最接近的競品 `agent-cli-to-api`(同樣包 Cursor Agent、且有 `/v1/messages` 與 vision),
bridge-cursor-cli 有幾個明確可補的洞:**Anthropic `/v1/messages` 相容**、**reasoning_effort
passthrough**、**optional bearer auth + `/metrics`**(安全地離開 localhost 的前提)、
**npm 發佈讓 `npx` 一行啟動**,以及策略層級的 **ACP server 模式**(todo.md 已列為 deferred,
但賽道共識已把 ACP 確立為 editor↔agent 的標準,值得重新評估解禁)。

---

## 1. 賽道現況:兩種架構

### 廣度型:多後端 gateway(一個 endpoint,prefix 路由)

| 專案 | 語言 | 後端 | 路由方式 | 亮點 |
|---|---|---|---|---|
| [leeguooooo/agent-cli-to-api](https://github.com/leeguooooo/agent-cli-to-api) | Python/FastAPI | Codex / **Cursor Agent** / Claude Code / Gemini | `CODEX_PROVIDER=auto` + `model` 前綴 `cursor:` `claude:` `gemini:` | 「LiteLLM for agent CLIs」;有 `/v1/messages`、vision、PDF、把 ChatGPT 訂閱的 image_gen 變成 API |
| [rodrigorodriguescosta/code-proxy](https://github.com/rodrigorodriguescosta/code-proxy) | — | Claude Code / Codex / Gemini + API-key providers | `model` 前綴 `cli-cc/*` `cli-codex/*` + OAuth provider 模式 | 「用你的 IDE 當 agent、訂閱當 model」;一個 `:3456/v1` 打通 CLI 與 pay-per-token |
| [slopedrop/llm-cli-proxy](https://github.com/slopedrop/llm-cli-proxy) | — | Claude / Gemini / Codex | 每個 provider 一個 port | Codex 直接打 OAuth API 繞過 `exec resume` 的 system-prompt 重注入 bug |

### 深度型:單一 vendor bridge

| 專案 | 語言 | 包誰 | production 特徵 |
|---|---|---|---|
| [GurYN/ccproxy](https://github.com/GurYN/ccproxy) | Go(single binary, no CGO) | Claude Code | **這份研究的對照標竿**:bearer token(SQLite + argon2id)、scopes、per-token RPM/日 token 限額、Prometheus `/metrics`、debug capture(JSONL)、FUSE workspace bridge(讓 server 上的 Claude 改使用者 laptop 上的目錄)、systemd/Docker 模板 |
| [i-am-logger/claude-code-proxy](https://github.com/i-am-logger/claude-code-proxy) | Rust | Claude Code | 同時提供 `/v1/chat/completions` **與** `/v1/responses`;constant-time auth;`kill_on_drop` 防殭屍 |
| [codeproxy-ai/cli](https://github.com/codeproxy-ai/cli) | TS(npx) | 轉 Responses API | Codex 0.128+ 要求 custom provider 講 Responses API,這支補那個洞 |

> **觀察**:你的 Hermes config 顯示你已經同時跑 `bridge-cursor-cli:18790`、`bridge-gemini-cli:18791`、
> `bridge-claude-code:18793` —— 等於你已經用「**多個獨立 process**」實作了多後端故事。這比單一
> gateway 多了隔離性(各自重啟、各自 crash 不互拖),所以「合併成一個 gateway」對你反而**不一定更好**。

---

## 2. bridge-cursor-cli 目前已經做得比較好的地方

- **下游 consumer 自動設定**:`select-models.mjs` 把 allowlist 同步進 Hermes(`custom_providers`)
  與 OpenClaw(`providers`)—— 賽道裡**沒有別的專案會幫你設定消費端**,大家都只負責 server 側。這是真差異化。
- **Windows 支援**:`ccproxy` 明寫 macOS/Linux only;`agent-cli-to-api` 靠 uv;你有 `start.ps1`/`stop.ps1`
  原生 PowerShell。
- **zero npm 依賴 + Node ≥22**:對照 ccproxy(7 個 Go 套件)、agent-cli-to-api(FastAPI 全家桶),
  你的攻擊面與安裝摩擦最小。
- **Cursor 專屬 per-request 旋鈕**:`cursor/ask:` `plan:` `agent:` `worktree:` 前綴 + `metadata.cursor_*`,
  比 agent-cli-to-api 只有 `cursor-auto`/`cursor-fast` preset 深得多。
- **官方 `--list-models` 探測 + fingerprint dedup**:針對 Cursor stream-json 三種 variant 調過。

---

## 3. 可以做得更好的洞(按 槓桿/成本 排序)

### 高槓桿

1. **Anthropic `/v1/messages` 相容**
   `agent-cli-to-api`、多數 Claude proxy 都提供 `/v1/messages`,好處是 **Anthropic SDK 與 Claude Code
   本身**(把 `ANTHROPIC_BASE_URL` 指過來)就能用 Cursor 模型。你現在只有 OpenAI 形狀,等於擋掉一整類 consumer。
   做法:加一個 translate 層(Anthropic Messages ⇄ 你內部的 cursor 呼叫),`messages`/`system`/`tools` 對映。
   成本中、解鎖面大。

2. **Optional bearer auth + `/metrics`**(離開 localhost 的前提)
   ccproxy 的整個賣點是「在 LAN / Tailscale 上安全地給 n8n / LibreChat / Open WebUI 用」。你現在 threat
   model 是 localhost-only;一旦想跨機,就需要 **token 驗證**(哪怕是單一 `BRIDGE_API_KEY` bearer)+
   **per-token rate limit** + **Prometheus `/metrics`**(todo.md 2.4 已列)。不必做到 ccproxy 的 SQLite +
   scopes 那麼重,但 bearer + 一個 `/metrics` 端點就能把使用場景從「本機」擴到「家用網段/Tailscale」。

3. **ACP server 模式(解禁 todo.md item 1)**
   研究強化了重啟這條路線的理由:[ACP(Agent Client Protocol)](https://agentclientprotocol.com)由
   Zed 發起、2026/02 JetBrains 加入共同維護,已是 editor↔agent 的事實標準(Gemini CLI `--acp`、
   Claude Code 走 `claude-agent-acp` adapter、Cursor 支援、2026/01 上線 ACP Registry)。
   你 todo.md 暫不做的理由是「會失去 OpenAI 通用性」—— 但 ACP 與 HTTP shim **並存**(你自己的設計草案)
   就能同時吃到:HTTP 給通用 consumer、ACP 給「常駐 socket、protocol 層 message id、原生 session」
   解掉 spawn 延遲與 fingerprint dedup 維護成本。賽道共識讓這條路線的長期賭注更穩。

### 中槓桿

4. **`reasoning_effort` passthrough**
   ccproxy 把 OpenAI `reasoning_effort` → `claude --effort low/medium/high/xhigh/max`。你目前是把 effort
   烤進 model id(`claude-opus-4-8-medium`、`...-thinking`),allowlist 因此膨脹。改成第一級 `reasoning_effort`
   欄位(header 或 body)會更 OpenAI-idiomatic,也讓 allowlist 變短。成本低。

5. **Session TTL / GC**(todo.md 2.2)
   ccproxy 有 session TTL eviction;你 `POST /v1/cursor-sessions/create` 開的 chat 不會過期,cursor 端無限累積。
   一張 `sessionId → lastUsedAt` 表 + 背景 `cursor agent rm` 即可。成本低。

6. **npm 發佈 → `npx cursor-bridge`**
   `agent-cli-to-api` 有 `uvx --from git+...`、ccproxy 有 `go install ...@latest`。你 package.json 名稱已是
   `cursor-bridge`,發到 npm 就能 `npx cursor-bridge` 一行啟動,onboarding 摩擦大降。成本低。

7. **per-request workspace 選擇**
   ccproxy 的 `X-CC-Workspace` header + config 端 named workspace allowlist + ephemeral fallback。你現在
   `CURSOR_WORKSPACE` 只能設一個 + `worktree:` 前綴。若做多專案,加一個「config 宣告 named dirs、request 指名」
   會比單一全域目錄好用,而且(學 ccproxy)**只接受 server 端定義的名字、不收 client 自由路徑**才安全。

### 低槓桿 / 視 Cursor CLI 能力而定

8. **Docker + systemd 模板**:ccproxy 出 `deploy/`、agent-cli-to-api 出 launchd installer;你有 start/install
   腳本但缺容器化模板。成本低。
9. **Responses API `/v1/responses`**:只有當你想被 Codex CLI(0.128+)或 Responses-API client 當 provider 才需要。niche。
10. **Vision / 檔案輸入(image_url、type:file PDF)**:agent-cli-to-api 有;能不能做取決於 `cursor-agent` 本身吃不吃多模態輸入,需先驗證。
11. **verbosity 模式**(text-only / verbose / narrated):ccproxy 用來在 chat UI 露出/隱藏 tool 呼叫;你已有 `streamPartialOutput` + preamble 過濾,優先序低。

---

## Key Takeaways

1. **定位是對的,別盲目追廣度**。你已用多個獨立 bridge process 拿到多後端的好處且保有隔離性;把三支合併成
   單一 gateway 是橫向擴張,**不會讓單一專案更好**。維持「深度型單 vendor + consumer 自動設定」這個差異化。
2. **最高 CP 值三件**:`/v1/messages`(解鎖 Anthropic SDK / Claude Code 當 consumer)、**optional bearer
   auth + `/metrics`**(把使用場景從 localhost 擴到 LAN/Tailscale)、**npm 發佈**(`npx` 一行上手)。前兩件 todo.md
   都已沾到邊。
3. **ACP 值得從 deferred 升級為「規劃中」**。賽道已把 ACP 確立為標準,你的「HTTP + ACP 並存」草案能同時保住通用性,
   並一勞永逸解掉 spawn 延遲與 fingerprint dedup 的長期維護稅。
4. **小而快的清掃**:`reasoning_effort` passthrough 收掉膨脹的 allowlist、session TTL 防 cursor 端累積、Docker/systemd
   模板 —— 都是低成本、todo.md 已知的項目。

---

## Sources

1. [leeguooooo/agent-cli-to-api](https://github.com/leeguooooo/agent-cli-to-api) — 多後端 gateway,含 Cursor Agent、`/v1/messages`、vision、image_gen。
2. [GurYN/ccproxy](https://github.com/GurYN/ccproxy) — production 化最深的 Claude Code proxy(token/scopes/metrics/FUSE bridge)。
3. [rodrigorodriguescosta/code-proxy](https://github.com/rodrigorodriguescosta/code-proxy) — CLI + OAuth provider 多模式 gateway。
4. [slopedrop/llm-cli-proxy](https://github.com/slopedrop/llm-cli-proxy) — Claude/Gemini/Codex 訂閱代理。
5. [i-am-logger/claude-code-proxy](https://github.com/i-am-logger/claude-code-proxy) — Rust,chat completions + Responses API。
6. [codeproxy-ai/cli](https://github.com/codeproxy-ai/cli) — 任意上游轉 Responses API。
7. [nielspeter/claude-code-proxy](https://github.com/nielspeter/claude-code-proxy) — Go,反向(讓 Claude Code 用 OpenAI 供應商)。
8. [GewoonJaap/gemini-cli-openai](https://github.com/GewoonJaap/gemini-cli-openai) — Cloudflare Worker 把 Gemini CLI 變 OpenAI endpoint(885★)。
9. [soficis/gemini-cli-proxy](https://github.com/soficis/gemini-cli-proxy) — 加 credential rotation / load-balance。
10. [msoap/shell2http](https://github.com/msoap/shell2http) — 通用「任意 shell 指令 → HTTP」對照組。
11. [eshaan7/Flask-Shell2HTTP](https://github.com/eshaan7/Flask-Shell2HTTP) — 通用 subprocess → REST wrapper。
12. [casys.ai — MCP vs A2A vs ACP](https://casys.ai/blog/mcp-a2a-acp-agent-protocols) — 協議全景,ACP(Agent Client Protocol)勝出脈絡。
13. [Marc Nuri — ACP: the LSP for AI coding agents](https://blog.marcnuri.com/agent-client-protocol-acp-introduction) — ACP 定位與 editor/agent 角色翻轉。
14. [dev.to — ACP connect any agent to any editor](https://dev.to/dmaxdev/agent-client-protocol-acp-connect-any-ai-agent-to-any-editor-2p0m) — ACP Registry、Gemini `--acp`、Claude/Codex adapter。
15. [agents.buttonscli.com — MCP & ACP field guide](https://agents.buttonscli.com/field-guide/protocols) — 各 agent 對 MCP/ACP 的實作盤點。

## Methodology

針對 4 個 sub-question(直接競品、通用 CLI→API 工具、ACP/MCP 協議標準、Gemini-CLI worker 生態)各跑
2–3 組 exa 語意搜尋,取得 ~30 個來源,深讀 `agent-cli-to-api` 與 `ccproxy` 兩份完整 README 作為 feature
基準;以本 repo 的 `cursor-bridge.mjs` 能力矩陣與 `todo.md` 為對照,產出 gap 分析。未深入驗證的項目(Cursor CLI
是否吃多模態輸入)已在文中標註。
