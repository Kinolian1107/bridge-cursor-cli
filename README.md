**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

# cursor-bridge

An OpenAI-compatible API proxy that bridges any OpenAI-compatible client to [Cursor CLI](https://cursor.com/cli) — use frontier AI models (Claude 4.6 Opus, GPT-5.2, Gemini 3 Pro, etc.) through your Cursor subscription, **no API keys needed**.

## Architecture

```
Any OpenAI-compatible client
(OpenClaw, Continue.dev, custom apps, curl, etc.)
                    │
                    │  OpenAI-compatible API
                    ▼
       ┌────────────────────────┐
       │     cursor-bridge       │  port 18790
       │   (this proxy server)   │
       └───────────┬────────────┘
                   │  spawns process
                   ▼
       ┌────────────────────────┐
       │  cursor agent --print   │
       │   --output-format       │
       │     stream-json         │
       └────────────────────────┘
```

**How it works:** cursor-bridge exposes an OpenAI-compatible API (`/v1/chat/completions`). When a client sends a request, the bridge translates it into a `cursor agent --print --output-format stream-json` call and streams the response back. Zero external dependencies — pure Node.js built-in modules.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history (v1.0 → v2.0).

> **v2.0 highlights** — per-request `metadata.cursor_*` knobs, model-name prefix tokens (`cursor/ask:opus-4.6`), `--output-format=json|text` paths, official fingerprint dedup, session continuity endpoints (`/v1/cursor-sessions/*`). Fully backwards-compatible — existing clients keep their current behaviour. See [Per-request Options (v2.0)](#per-request-options-v20) below.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 22 |
| [Cursor CLI](https://cursor.com/cli) | Installed (`curl https://cursor.com/install -fsS \| bash`) |
| Cursor account | Logged in (`cursor agent login`) or `CURSOR_API_KEY` set |

## Authentication

cursor-bridge passes authentication credentials to the Cursor CLI automatically. Three methods (in priority order):

**Option 1 — CLI login (recommended for interactive use):**
```bash
cursor agent login
```

**Option 2 — API key (recommended for server/daemon use):**
```bash
# In .env:
CURSOR_API_KEY=your-api-key-here
```

**Option 3 — Auth token:**
```bash
# In .env:
CURSOR_AUTH_TOKEN=your-auth-token-here
```

The startup banner shows which authentication method is active.

## Quick Start

```bash
git clone https://github.com/Kinolian1107/openclaw-bridge-cursor-cli.git
cd openclaw-bridge-cursor-cli

chmod +x install.sh
./install.sh
# → Detects Cursor CLI, creates .env and start/stop scripts
# → Optionally configures OpenClaw integration (if detected)

./start.sh daemon
```

## Manual Setup

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set CURSOR_BIN, CURSOR_MODEL, CURSOR_API_KEY as needed
```

### 2. Start the bridge

```bash
# Foreground (for debugging)
node cursor-bridge.mjs

# Background (daemon)
./start.sh daemon

# Stop
./stop.sh

# Follow today's log
tail -f logs/cursor-bridge.$(date +%Y%m%d).log
```

### 3. Test

```bash
curl http://127.0.0.1:18790/health

# List available models
curl http://127.0.0.1:18790/v1/cursor-models

# Send a chat request
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

## Hermes Agent Integration (Optional)

If you use [Hermes Agent](https://github.com/nousresearch/hermes-agent), run `./set-hermesagent.sh` — it configures Hermes to use cursor-bridge and **syncs all available cursor-bridge models** into Hermes so `/model` shows the full list.

```bash
# Make sure cursor-bridge is running first
./start.sh daemon

# Configure Hermes and sync all models
./set-hermesagent.sh
```

After running, select `bridge-cursor-cli` in Hermes `/model` to see all available models (auto, claude-4.6-opus-*, gpt-5.*, gemini-3.1-pro, etc.).

Re-run `./set-hermesagent.sh` any time to refresh the model list from the bridge.

## OpenClaw Integration (Optional)

If you use [OpenClaw](https://github.com/openclaw/openclaw), run `./install.sh` — it will detect OpenClaw and ask if you want to configure it automatically.

To configure manually, edit `~/.openclaw/openclaw.json`:

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "cursor-cli/opus-4.6-thinking" }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [{
          "id": "opus-4.6-thinking",
          "name": "Cursor CLI (opus-4.6-thinking)",
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 200000,
          "maxTokens": 65536
        }]
      }
    }
  }
}
```

Then restart the OpenClaw gateway:
```bash
openclaw gateway stop && openclaw gateway
```

## Configuration

All configuration is via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18790` | Port for the proxy server |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `CURSOR_MODEL` | `auto` | Default model for requests without `tools` |
| `CURSOR_TOOL_BRIDGE_MODEL` | `gpt-5.3-codex-high` | Model used when `tools` are present. Claude models refuse tool protocols — codex models work reliably. Set `""` to disable override. |
| `CURSOR_TOOL_BRIDGE_AGENT_MODE` | `""` (full agent) | cursor-agent mode for tool bridge requests. Default (empty) = full agent mode, which allows shell/file execution for skills like `autohackmd`. Set `"ask"` to restore read-only ask mode. |
| `CURSOR_BIN` | `cursor` | Path to `cursor` or `cursor-agent` binary |
| `CURSOR_WORKSPACE` | `~/.cursor-bridge/workspace` | Workspace for cursor agent |
| `CURSOR_MODE` | *(empty)* | `ask` (read-only) / `plan` / *(empty)* = full agent |
| `CURSOR_WORKTREE` | `false` | `true` = isolate edits in a temp git worktree |
| `CURSOR_API_KEY` | *(empty)* | Cursor API key (alternative to `cursor agent login`) |
| `CURSOR_AUTH_TOKEN` | *(empty)* | Cursor auth token (alternative to API key) |
| `BRIDGE_TIMEOUT_MS` | `300000` | Request timeout (5 min) |

## Logs

Logs are written to the `logs/` directory with daily rotation:

```
logs/
└── cursor-bridge.20260416.log   ← one file per day
```

```bash
# Follow today's log
tail -f logs/cursor-bridge.$(date +%Y%m%d).log

# View a specific date
cat logs/cursor-bridge.20260416.log
```

The log stream auto-rotates at midnight without requiring a restart.

## Recommended Models

| Use case | Recommended model | Reason |
|----------|-------------------|--------|
| General chat / coding | `claude-4.6-opus-high-thinking` or `auto` | Best quality reasoning |
| Tool-using agents (Hermes, etc.) | `gpt-5.3-codex-high` (**auto-selected**) | Only model that reliably outputs `<tool_call>` blocks without refusing as "prompt injection" |
| Fast / cheap tasks | `gpt-5.3-codex-low` | Lower cost, still follows tool protocol |

> **Important for tool-using agents:** Claude-based models (`claude-4.6-*`, `claude-4.*`) refuse the `<tool_calling_protocol>` instruction as a "prompt injection attack" — they will never output `<tool_call>` blocks. cursor-bridge automatically switches to `gpt-5.3-codex-high` whenever `tools` are present in the request, regardless of which model you specified.

## Available Models

Query the bridge to get the live list of models available under your Cursor subscription:

```bash
curl http://127.0.0.1:18790/v1/cursor-models
```

The bridge probes the Cursor CLI on the first call and caches the result. Example models you may see:

| Model ID | Description |
|----------|-------------|
| `auto` | Let Cursor pick the best model — **recommended** |
| `claude-4.6-opus-high-thinking` | Claude 4.6 Opus, high budget + extended thinking |
| `claude-4.6-opus-max-thinking` | Claude 4.6 Opus, max budget + extended thinking |
| `claude-4.6-sonnet-medium-thinking` | Claude 4.6 Sonnet with extended thinking |
| `composer-2` | Cursor Composer 2 |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gpt-5.2` | GPT-5.2 |
| `gemini-3.1-pro` | Gemini 3.1 Pro |

> Model availability depends on your Cursor subscription plan. The API returns only what your account can actually use.

Change the default model by setting `CURSOR_MODEL` in `.env` and restarting, or pass `model` in each API request for per-request switching.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (v2.0 reports `supports.*` capability flags) |
| `/v1/models` | GET | List available Cursor models (probed from CLI, cached) |
| `/v1/cursor-models` | GET | Alias for `/v1/models` |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |
| `/v1/cursor-sessions/create` | POST | **v2.0** — spawn `cursor agent create-chat`, returns `{ chat_id }` for `metadata.cursor_resume_chat_id` continuity |
| `/v1/cursor-sessions` | GET | **v2.0** — list prior chats via `cursor agent ls` |

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

## Uninstall

```bash
./uninstall.sh
```

Stops the bridge, optionally restores OpenClaw config from backup, and removes the auto-start entry from `~/.bashrc`.

## How It Works (Technical Details)

### Request Flow

1. **Client** sends an OpenAI-compatible chat completion request
2. **cursor-bridge** converts the messages array into a single prompt string:
   - System messages → `<system_instructions>` block
   - Conversation history → `<conversation_history>` block
   - Latest user message → appended at the end
   - If `tools` are present → injected as `<available_tools>` block + `--mode ask`
3. **cursor-bridge** spawns:
   ```
   cursor agent --print --force --model <model>
     --output-format stream-json --stream-partial-output
     --workspace <path> [--worktree] [--mode ask|plan]
   ```
   - Prompts ≤ 32KB: passed as CLI argument
   - Prompts > 32KB: piped via stdin (avoids Linux `E2BIG` limit)
4. **cursor agent** processes the prompt via your Cursor subscription
5. The bridge parses NDJSON `stream-json` events (`system`, `assistant`, `tool_call`, `result`) and converts them to OpenAI-compatible SSE
6. Token usage is estimated from character counts and included in the final response

### CLI Flags Reference

| Flag | Purpose |
|------|---------|
| `--print` / `-p` | Non-interactive (headless) mode |
| `--force` / `--yolo` | Apply file modifications directly |
| `--output-format text\|json\|stream-json` | Output format. `json` = single JSON object, simplest for non-streaming clients (v2.0) |
| `--stream-partial-output` | Incremental text deltas for live streaming |
| `--model <id>` | Model selection |
| `--workspace <path>` | Set repository root |
| `--worktree` / `--worktree-base <branch>` / `--skip-worktree-setup` | Isolate edits in temp git worktree (v2.0 wired through) |
| `--mode ask\|plan` | Read-only modes |
| `--trust` | Skip workspace trust prompt (auto-added by v2.0 unless `cursor_trust=false`) |
| `--sandbox enabled\|disabled` | Explicit sandbox override (v2.0) |
| `--resume <chat-id>` / `--continue` | Session continuity (v2.0) |

## Per-request Options (v2.0)

cursor-bridge v2.0 stays OpenAI-compatible on the surface but lets clients pick cursor-agent flags **per request**. Anything omitted falls back to the bridge's CONFIG defaults — so OpenClaw / Continue.dev / older clients keep their current behaviour without changes.

There are two ways to express options, and they can be mixed freely:

### A) `metadata.cursor_*` block (most expressive)

```jsonc
POST /v1/chat/completions
{
  "model": "cursor/opus-4.6-thinking",
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
cursor/ask:opus-4.6-thinking          → --mode=ask
cursor/plan:opus-4.6-thinking         → --mode=plan
cursor/agent:opus-4.6-thinking        → no --mode flag (full agent)
cursor/worktree:opus-4.6-thinking     → --worktree
cursor/ask:worktree:opus-4.6          → --mode=ask --worktree (combinable)
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

### Fingerprint dedup (v2.0)

When `--stream-partial-output` is enabled, cursor-agent emits **three variants** of `assistant` events per the [official docs](https://cursor.com/docs/cli/reference/output-format):

| `timestamp_ms` | `model_call_id` | Action |
|---|---|---|
| set | unset | **keep** — real new delta |
| set | set | **discard** — pre-tool-call replay |
| unset | unset | **discard** — final flush replay |

v2.0 implements this filter natively in the streaming + non-streaming paths, deprecating the v1.x heuristic length-prefix dedup.

### Session continuity (v2.0)

For multi-turn flows that should share context across requests:

```bash
# 1. Create a fresh session
CHAT_ID=$(curl -s -X POST http://127.0.0.1:18790/v1/cursor-sessions/create | jq -r .chat_id)

# 2. Use it on subsequent requests
curl http://127.0.0.1:18790/v1/chat/completions -H "Content-Type: application/json" -d "{
  \"model\": \"cursor/opus-4.6-thinking\",
  \"messages\": [{\"role\": \"user\", \"content\": \"...\"}],
  \"stream\": false,
  \"metadata\": { \"cursor_resume_chat_id\": \"$CHAT_ID\" }
}"
```

The bridge passes `--resume <chat-id>` to cursor-agent so the model sees prior turns.

### Cursor CLI Authentication

The Cursor CLI supports three authentication methods (checked in this order):

1. **`CURSOR_API_KEY`** environment variable
2. **`CURSOR_AUTH_TOKEN`** environment variable
3. **Session from `cursor agent login`** (stored locally)

cursor-bridge passes all environment variables to the spawned process, so whichever method is set in your `.env` or shell environment will be used automatically.

### Tool Bridge Mode

When a client sends `tools` in the API request:
1. The bridge **automatically switches to `gpt-5.3-codex-high`** (overriding the request model)
2. Tool definitions are injected into the prompt as a `<tool_calling_protocol>` XML block
3. The model outputs `<tool_call>` XML blocks when it needs to call a tool
4. The bridge parses these and returns them as OpenAI `tool_calls` format
5. The client executes the tool and sends the result back — the bridge handles the full multi-turn loop

**Why the model override?** Claude-based models detect `<tool_calling_protocol>` in user messages as a "prompt injection attack" and refuse to output `<tool_call>` blocks — this is Claude's built-in security behavior and cannot be worked around via prompting. `gpt-5.3-codex-high` reliably follows the tool protocol.

Override the tool bridge model via env var:
```bash
CURSOR_TOOL_BRIDGE_MODEL=gpt-5.3-codex-low   # cheaper alternative
CURSOR_TOOL_BRIDGE_MODEL=                     # disable override, use request model
```

If you want tool calls to stay on `composer-2` (no codex override), create a profile like:
```bash
# .env.mode-composer-tools
CURSOR_MODEL=composer-2
CURSOR_TOOL_BRIDGE_MODEL=
```

This keeps `tools` requests on the request/default model instead of forcing codex. Keep in mind codex is still the most reliable option for strict `<tool_call>` protocol behavior.

### ACP (Agent Communication Protocol)

The Cursor CLI also supports `cursor agent acp` — a JSON-RPC 2.0 protocol over stdio for advanced custom integrations. cursor-bridge currently uses the simpler `--print` headless mode. ACP provides richer session management and is used by IDE plugins (JetBrains, Neovim, Zed).

## Troubleshooting

### Bridge won't start
- Check if port 18790 is in use: `ss -tlnp | grep 18790`
- View logs: `tail -f logs/cursor-bridge.$(date +%Y%m%d).log`

### Authentication errors
- Run `cursor agent login` to authenticate interactively
- Or set `CURSOR_API_KEY` in `.env`
- Check status: `cursor agent status`

### Cursor CLI not found
- Install: `curl https://cursor.com/install -fsS | bash`
- Set `CURSOR_BIN` in `.env` to the full path if needed

### Slow responses
- First request may be slower (Cursor agent startup ~5-15s)
- `thinking` models take longer but produce better results

## License

MIT
