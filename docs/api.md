**[English](api.md)** | **[繁體中文](api.zh-TW.md)** · [← README](../README.md)

# API Reference

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (reports `supports.*` capability flags) |
| `/v1/models` | GET | List Cursor models (probed from CLI, cached). **v2.1**: filtered by the `models.json` allowlist; append `?all=1` for the full list |
| `/v1/cursor-models` | GET | Alias for `/v1/models` |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |
| `/v1/messages` | POST | **v2.2** — Anthropic Messages API (streaming & non-streaming), see [below](#anthropic-messages-api-v22) |
| `/v1/messages/count_tokens` | POST | **v2.2** — token count estimate (same ratio as the `usage` fields) |
| `/metrics` | GET | **v2.2** — Prometheus metrics (requests, durations, auth failures, inflight, uptime) |
| `/v1/cursor-sessions/create` | POST | **v2.0** — spawn `cursor agent create-chat`, returns `{ chat_id }` for `metadata.cursor_resume_chat_id` continuity |
| `/v1/cursor-sessions` | GET | **v2.0** — list prior chats via `cursor agent ls` |

All endpoints except `/health` require a key when `BRIDGE_API_KEY` is set (see [Bearer Auth & Metrics](#bearer-auth--metrics-v22)).

### Examples

```bash
# List available models
curl http://127.0.0.1:18790/v1/cursor-models

# Non-streaming
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'

# Streaming
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
```

## Anthropic Messages API (v2.2)

The bridge also speaks the **Anthropic Messages API** (`POST /v1/messages`), so the Anthropic SDK — and Claude Code itself — can consume Cursor models:

```bash
# Anthropic SDK (any language): just point the base URL at the bridge
export ANTHROPIC_BASE_URL=http://127.0.0.1:18790
export ANTHROPIC_API_KEY=anything   # or your BRIDGE_API_KEY if auth is enabled

# Raw curl
curl http://127.0.0.1:18790/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"Hello!"}]}'
```

Supported: `system` (string or blocks), multi-turn history, `tools` / `tool_use` / `tool_result` round-trips (via the same Tool Bridge Mode as the OpenAI path), streaming SSE (`message_start` → `content_block_delta` → `message_stop`), and `POST /v1/messages/count_tokens` (estimate). Internally the request is translated to the OpenAI shape and runs through the exact same pipeline — all `metadata.cursor_*` per-request options work here too.

## Bearer Auth & Metrics (v2.2)

By default the bridge binds to `127.0.0.1` with no auth — fine for local use. To expose it on a LAN or Tailscale network:

```bash
# .env
BRIDGE_HOST=0.0.0.0            # or your Tailscale IP
BRIDGE_API_KEY=$(openssl rand -hex 32)
```

With `BRIDGE_API_KEY` set, every endpoint except `/health` requires the key via either header (comparison is timing-safe):

```bash
curl -H "Authorization: Bearer <key>" http://bridge:18790/v1/models   # OpenAI style
curl -H "x-api-key: <key>" http://bridge:18790/v1/messages -d '…'     # Anthropic style
```

`GET /metrics` exposes Prometheus metrics: `bridge_requests_total{endpoint,method,status}`, `bridge_request_duration_seconds` (sum/count per endpoint), `bridge_auth_failures_total`, `bridge_inflight_requests`, and `bridge_uptime_seconds`.

## Per-request Options (v2.0)

cursor-bridge v2.0 stays OpenAI-compatible on the surface but lets clients pick cursor-agent flags **per request**. Anything omitted falls back to the bridge's CONFIG defaults — so OpenClaw / Continue.dev / older clients keep their current behaviour without changes.

There are two ways to express options, and they can be mixed freely:

### A) `metadata.cursor_*` block (most expressive)

```jsonc
POST /v1/chat/completions
{
  "model": "cursor/claude-fable-5-thinking-medium",
  "messages": [{ "role": "user", "content": "..." }],
  "stream": false,
  "metadata": {
    "cursor_mode": "ask",                  // ask | plan | agent (default: CONFIG.mode)
    "cursor_force_output_format": "json",  // text | json | stream-json
    "cursor_sandbox": "enabled",           // enabled | disabled
    "cursor_worktree": false,
    "cursor_worktree_base": "main",
    "cursor_skip_worktree_setup": false,
    "cursor_resume_chat_id": "ch-abc-123", // session continuity
    "cursor_continue": false,              // continue most recent chat
    "cursor_stream_partial_output": true,  // override default
    "cursor_trust": true                   // default true; set false to require manual trust
  }
}
```

### B) Model-name prefix tokens (syntactic sugar)

```
cursor/ask:claude-fable-5-medium          → --mode=ask
cursor/plan:claude-fable-5-medium         → --mode=plan
cursor/agent:claude-fable-5-medium        → no --mode flag (full agent)
cursor/worktree:claude-fable-5-medium     → --worktree
cursor/ask:worktree:claude-fable-5-medium          → --mode=ask --worktree (combinable)
```

Recognised tokens: `ask`, `plan`, `agent`, `worktree`. Unknown tokens are ignored. **Metadata always wins over conflicting model-name tokens.**

### Output format selection rules

| `stream` | `cursor_force_output_format` | Effective format |
|---|---|---|
| `true` | _(any)_ | `stream-json` (SSE requires events) |
| `false` | `text` | `text` (raw stdout) |
| `false` | `json` | `json` (single JSON object — fastest, simplest) |
| `false` | `stream-json` | `stream-json` (default; preserves usage tracking) |
| `false` | _omitted_ | `stream-json` |

Use `json` mode for stateless calls (summarisation, classification, single-shot queries) where you don't care about token-by-token streaming.

### Session continuity (v2.0)

For multi-turn flows that should share context across requests:

```bash
# 1. Create a fresh session
CHAT_ID=$(curl -s -X POST http://127.0.0.1:18790/v1/cursor-sessions/create | jq -r .chat_id)

# 2. Use it on subsequent requests
curl http://127.0.0.1:18790/v1/chat/completions -H "Content-Type: application/json" -d "{
  \"model\": \"cursor/claude-fable-5-thinking-medium\",
  \"messages\": [{\"role\": \"user\", \"content\": \"...\"}],
  \"stream\": false,
  \"metadata\": { \"cursor_resume_chat_id\": \"$CHAT_ID\" }
}"
```

The bridge passes `--resume <chat-id>` to cursor-agent so the model sees prior turns.
