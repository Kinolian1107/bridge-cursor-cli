# Changelog

All notable changes to cursor-bridge are documented here.

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
