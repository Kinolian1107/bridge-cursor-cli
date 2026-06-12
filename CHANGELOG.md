# Changelog

All notable changes to cursor-bridge are documented here.

---

## v2.2 (2026-06-13)

**Anthropic Messages API + optional bearer auth + Prometheus metrics. Fully backwards-compatible.**

### Added

- **Anthropic Messages API compatibility** — new `POST /v1/messages` endpoint speaks the Anthropic wire format, so the Anthropic SDK and Claude Code itself (`ANTHROPIC_BASE_URL` → bridge) can consume Cursor models:
  - Request translation (`lib/anthropic-compat.mjs`): `system` (string or blocks) → system message, assistant `tool_use` blocks → OpenAI `tool_calls`, user `tool_result` blocks → `role:"tool"` messages, `tools[{name,description,input_schema}]` → function tools. The converted request runs through the exact same pipeline as `/v1/chat/completions`, so Tool Bridge Mode and all `metadata.cursor_*` per-request options work unchanged.
  - Response translation via a res-like adapter that rewrites the OpenAI output on the way out: non-streaming JSON → Anthropic message (`stop_reason`, `usage.input/output_tokens`), SSE → the full Anthropic event sequence (`message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`), errors → `{type:"error", error:{type, message}}` with mapped error types.
  - `POST /v1/messages/count_tokens` returns an `input_tokens` estimate (same chars-per-token ratio as the `usage` fields).
- **Optional bearer auth** (`lib/auth.mjs`) — set `BRIDGE_API_KEY` to require a key on every endpoint except `/health`. Accepts both `Authorization: Bearer <key>` (OpenAI style) and `x-api-key: <key>` (Anthropic style); comparison is timing-safe. Unset (default) keeps the localhost-only zero-auth behaviour. Auth errors are shaped per-protocol (OpenAI vs Anthropic) depending on the path.
- **Prometheus `/metrics`** (`lib/metrics.mjs`, todo 2.4) — text exposition format with `bridge_requests_total{endpoint,method,status}`, `bridge_request_duration_seconds` (sum/count per endpoint), `bridge_auth_failures_total`, `bridge_inflight_requests`, `bridge_uptime_seconds`. Endpoint labels are bounded (unknown paths collapse into `other`).
- `/health` adds `supports.anthropic_messages`, `supports.bearer_auth`, `supports.metrics`.
- 38 new unit tests (`tests/anthropic-compat.test.mjs`, `tests/auth.test.mjs`, `tests/metrics.test.mjs`) — 81 total.

### Migration notes

- No changes required for existing clients. Auth stays off until you set `BRIDGE_API_KEY`.

---

## v2.1 (2026-06-12)

**Windows support + model allowlist. Fully backwards-compatible.**

### Added

- **Windows support** — the bridge now runs natively on Windows (and macOS):
  - Removed the `bash`/`cat` dependency: long prompts are written directly to the spawned process's stdin (on Windows, prompts always go via stdin to dodge command-line length limits and `.cmd` quoting hazards).
  - `CURSOR_WORKSPACE` default now uses `os.homedir()` instead of `$HOME`.
  - `CURSOR_BIN` may point to `.exe`, `.cmd`, `.bat` or `.ps1` binaries — `lib/cursor-cli.mjs` picks the right spawn strategy (direct / `cmd.exe` with quoting / `powershell.exe -File`).
  - New `start.ps1` / `stop.ps1` PowerShell scripts (daemon mode, health check, force-kill fallback) mirroring `start.sh` / `stop.sh`.
  - The bridge loads `.env` by itself via `process.loadEnvFile()` — `node cursor-bridge.mjs` works identically on every platform; real environment variables still win over `.env`.
- **Model allowlist + `select-models.mjs`** — Cursor now exposes 130+ models, which flooded Hermes Agent's `/model` picker. The new interactive tool (`node select-models.mjs` / `npm run models`) probes the live model list, lets you pick a subset (arrow keys / space / type-to-filter), saves it to `models.json`, and offers to sync the selection straight into Hermes (`custom_providers` in `~/.hermes/config.yaml`) and OpenClaw (`~/.openclaw/openclaw.json`). Flags: `--list`, `--set "a,b,c"`, `--sync`, `--clear`.
  - `/v1/models` (and `/v1/cursor-models`) now return only allowlisted models; `?all=1` bypasses the filter. `models.json` is re-read per request — no bridge restart needed.
  - `BRIDGE_MODELS_FILE` env var overrides the allowlist path.
  - `/health` adds `supports.model_allowlist` and `supports.windows`.
- **Official model probing** — model discovery now uses `cursor-agent --list-models` (with display names) instead of parsing the error output of an intentionally-invalid model request. The legacy stderr probe remains as a fallback for older CLIs. New `lib/probe-models.mjs` + `lib/cursor-cli.mjs` modules with 14 unit tests (`tests/probe-models.test.mjs`).

### Changed

- **Default model: `auto`** — the previous default `opus-4.6-thinking` no longer exists (Cursor renamed the family to `claude-4.6-opus-*-thinking` and has since shipped `claude-opus-4-8-*` and `claude-fable-5-*`). `auto` survives Cursor's frequent model renames; docs list current recommended ids.
- `set-hermesagent.sh` / `set-openclaw.sh` sync from the filtered `/v1/models` endpoint, so the allowlist applies to both integrations.
- Docs refreshed for the 2026.06 model catalogue (`claude-fable-5-*`, `claude-opus-4-8-*`, `gpt-5.5-*`, `gpt-5.4-*`, `composer-2.5`, `gemini-3.5-flash`, `grok-4.3`, `kimi-k2.5`, …) and the official native Windows installer (`irm 'https://cursor.com/install?win32=true' | iex`).

### Migration notes

- If your `.env` pins a stale id (e.g. `CURSOR_MODEL=composer-2` or `opus-4.6-thinking`), update it — run `cursor-agent --list-models` or `node select-models.mjs --list` for current ids.
- Existing clients need no changes; without a `models.json` the `/v1/models` output is identical to v2.0.

---

## v2.0 (2026-05-07)

**Per-request options + session continuity + json-format path. Fully backwards-compatible** — existing clients (OpenClaw, Continue.dev, etc.) need zero changes.

### Added

- **`metadata.cursor_*` block** — clients can now pass cursor-agent flags per request without touching env vars:
  - `cursor_mode: "ask" | "plan" | "agent"`
  - `cursor_force_output_format: "text" | "json" | "stream-json"`
  - `cursor_sandbox: "enabled" | "disabled"`
  - `cursor_worktree`, `cursor_worktree_base`, `cursor_skip_worktree_setup`
  - `cursor_resume_chat_id`, `cursor_continue` — session continuity
  - `cursor_stream_partial_output`, `cursor_trust`
- **Model-name prefix tokens** — sugar for the most common knobs:
  - `cursor/ask:<model>` → `--mode=ask`
  - `cursor/plan:<model>` → `--mode=plan`
  - `cursor/agent:<model>` → no `--mode` (full agent)
  - `cursor/worktree:<model>` → `--worktree`
  - Combinable: `cursor/ask:worktree:<model>`
  - Metadata always wins on conflict.
- **`/v1/cursor-sessions/create`** — POST endpoint that spawns `cursor agent create-chat` and returns `{ chat_id }`. Pair with `metadata.cursor_resume_chat_id` for multi-turn flows.
- **`/v1/cursor-sessions`** — GET endpoint that lists prior chats via `cursor agent ls`.
- **`--output-format=json` and `--output-format=text` paths** — non-streaming clients can now request a single JSON object or plain text response, bypassing NDJSON parsing entirely. Significantly faster + simpler for stateless use cases (summarisation, classification).
- **Official fingerprint dedup** — when `--stream-partial-output` is on, cursor-agent emits three variants of `assistant` events (real delta / pre-tool-call replay / final flush). v2.0 filters by the documented `timestamp_ms` + `model_call_id` field combination per [Cursor docs](https://cursor.com/docs/cli/reference/output-format), replacing v1.x's heuristic length-prefix dedup.
- **`--trust`** auto-added (controllable via `cursor_trust=false`) — required for headless operation in untrusted workspaces.
- **`--sandbox enabled|disabled`** explicit pass-through (was previously bridge-internal default).
- **`--worktree-base` / `--skip-worktree-setup`** flags wired through.
- **`/health` advertises capability matrix** — `supports.metadata_block`, `supports.model_prefix_tokens`, `supports.output_formats`, `supports.session_endpoints`, `supports.fingerprint_dedup`.
- **`lib/parse-cursor-options.mjs`** — pure parser extracted to a sibling module for unit testability.
- **`tests/parse-options.test.mjs`** — 22 unit tests covering all parsing edge cases.

### Changed

- `runCursorAgent` now takes a resolved `options` bag instead of reading globals directly. CONFIG.mode / CONFIG.worktree are still honoured as defaults when no per-request value is provided.
- Startup banner bumped to `cursor-bridge v2.0.0`.

### Migration notes

- **OpenClaw / Continue.dev / curl clients**: no action needed. Without `metadata.cursor_*` and without prefix tokens, behaviour is identical to v1.6.
- **LazyBun & similar headless callers**: opt into `metadata: { cursor_mode: "ask", cursor_force_output_format: "json" }` to drop streaming preambles and skill side-effects from research/summary outputs.

---

## v1.6 (2026-04-16)

- **autohackmd / shell-script skill fix** — Removed forced `--mode ask` from Tool Bridge Mode. Previously v1.1 added `--mode ask` whenever tools were present, which prevented cursor-agent from executing write/run operations. Skills like `autohackmd` that execute bash scripts (file writes + HTTP uploads) would receive "I'm in Ask mode, I can't execute" responses. v1.6 defaults to **full agent mode**, so cursor-agent can execute shell scripts natively — `autohackmd` and similar skills now work correctly.
- **`CURSOR_TOOL_BRIDGE_AGENT_MODE`** — New env var (default: `""` = full agent). Set to `"ask"` to restore the old read-only ask mode behaviour if needed.

### v1.6 Tool Calling Behaviour Matrix

In full agent mode, `gpt-5.3-codex-high` applies a smart strategy:

| Tool type | Example | v1.6 behaviour | Outcome |
|-----------|---------|----------------|---------|
| Custom / external tools | `send_slack_message`, `query_database`, any custom API | ✅ Returns `tool_calls` | Hermes executes the tool |
| Browser navigation | `browser_navigate` | ✅ Returns `tool_calls` | Hermes executes the tool |
| Shell execution | `terminal` (simple request, no skill context) | ○ cursor-agent runs natively | Command executes, result in text |
| Shell + file write (with skill context) | `terminal` + `write_file` in autohackmd | ✅/○ Either path | Upload succeeds either way |

**Why this works:** cursor-agent uses its own built-in tools for anything it can execute natively (shell, web fetch). For tools it has no native ability to call (custom APIs, Slack, databases), it outputs `<tool_call>` blocks which cursor-bridge parses into OpenAI-compatible `tool_calls` for Hermes. This is smarter than the old forced `--mode ask`, which blocked all write/execute operations regardless of tool type.

---

## v1.5 (2026-04-16)

- **Tool Bridge Mode fix** — Auto-switches to `gpt-5.3-codex-high` when `tools` are present in the request. Claude-based models (`claude-4.6-*`, etc.) classify the injected `<tool_calling_protocol>` as a "prompt injection attack" and refuse to output `<tool_call>` blocks. `gpt-5.3-codex-high` reliably follows the protocol and handles multi-turn tool loops correctly.
- **`CURSOR_TOOL_BRIDGE_MODEL`** — New env var to override the tool bridge model (default: `gpt-5.3-codex-high`). Set to `""` to disable and use the request model instead.

---

## v1.4 (2026-04-16)

- **Hermes Agent model sync** — `set-hermesagent.sh` now probes all available models from cursor-bridge and writes them into Hermes `custom_providers`, so `/model` → `bridge-cursor-cli` shows the full model list (80+ models) instead of just one.

---

## v1.3

- **Dynamic model discovery** — `GET /v1/models` and `GET /v1/cursor-models` now probe the Cursor CLI on first request and return the real list of models available under your subscription. Result is cached for the process lifetime, so subsequent calls are instant.
- **Workspace auto-setup** — The workspace directory (`~/.cursor-bridge/workspace`) must exist before starting. `install.sh` creates it automatically. If you set up manually, run `mkdir -p ~/.cursor-bridge/workspace`.

---

## v1.2

- **Daily log rotation** — Logs written to `logs/cursor-bridge.yyyyMMdd.log`, one file per day. Auto-rotates at midnight without restart.
- **OpenClaw decoupled** — cursor-bridge now works standalone. OpenClaw integration is an optional step in `install.sh`.
- **Worktree support** — Set `CURSOR_WORKTREE=true` to isolate agent edits in a temporary git worktree (`~/.cursor/worktrees`).
- **Auth visibility** — Startup banner shows active authentication method (`CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` / `cursor agent login`).

---

## v1.1

- **Token usage reporting** — Accurately estimates and reports `prompt_tokens`, `completion_tokens`, and `thinking_tokens` in every response.
- **Tool Bridge Mode** — When the client sends `tools` in the request, cursor-bridge injects them into the prompt and parses `<tool_call>` responses back into OpenAI-compatible `tool_calls` format.
- **Large prompt handling (E2BIG fix)** — Prompts longer than 32KB are piped via stdin instead of CLI arguments.
- **Structured stream-json output** — Uses `--output-format stream-json` for reliable parsing.
- **Improved error handling** — Classifies errors (context overflow, timeout, rate limit, auth) into OpenAI-compatible error types.

---

## v1.0

- Initial release: OpenAI-compatible proxy bridging any OpenAI API client to Cursor CLI models.
