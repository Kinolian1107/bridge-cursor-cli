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

## What's New in v1.6

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

## What's New in v1.5

- **Tool Bridge Mode fix** — Auto-switches to `gpt-5.3-codex-high` when `tools` are present in the request. Claude-based models (`claude-4.6-*`, etc.) classify the injected `<tool_calling_protocol>` as a "prompt injection attack" and refuse to output `<tool_call>` blocks. `gpt-5.3-codex-high` reliably follows the protocol and handles multi-turn tool loops correctly.
- **`CURSOR_TOOL_BRIDGE_MODEL`** — New env var to override the tool bridge model (default: `gpt-5.3-codex-high`). Set to `""` to disable and use the request model instead.

## What's New in v1.4

- **Hermes Agent model sync** — `set-hermesagent.sh` now probes all available models from cursor-bridge and writes them into Hermes `custom_providers`, so `/model` → `bridge-cursor-cli` shows the full model list (80+ models) instead of just one.

## What's New in v1.3

- **Dynamic model discovery** — `GET /v1/models` and `GET /v1/cursor-models` now probe the Cursor CLI on first request and return the real list of models available under your subscription. Result is cached for the process lifetime, so subsequent calls are instant.
- **Workspace auto-setup** — The workspace directory (`~/.cursor-bridge/workspace`) must exist before starting. `install.sh` creates it automatically. If you set up manually, run `mkdir -p ~/.cursor-bridge/workspace`.

## What's New in v1.2

- **Daily log rotation** — Logs written to `logs/cursor-bridge.yyyyMMdd.log`, one file per day. Auto-rotates at midnight without restart.
- **OpenClaw decoupled** — cursor-bridge now works standalone. OpenClaw integration is an optional step in `install.sh`.
- **Worktree support** — Set `CURSOR_WORKTREE=true` to isolate agent edits in a temporary git worktree (`~/.cursor/worktrees`).
- **Auth visibility** — Startup banner shows active authentication method (`CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` / `cursor agent login`).

## What's New in v1.1

- **Token usage reporting** — Accurately estimates and reports `prompt_tokens`, `completion_tokens`, and `thinking_tokens` in every response.
- **Tool Bridge Mode** — When the client sends `tools` in the request, cursor-bridge injects them into the prompt and parses `<tool_call>` responses back into OpenAI-compatible `tool_calls` format.
- **Large prompt handling (E2BIG fix)** — Prompts longer than 32KB are piped via stdin instead of CLI arguments.
- **Structured stream-json output** — Uses `--output-format stream-json` for reliable parsing.
- **Improved error handling** — Classifies errors (context overflow, timeout, rate limit, auth) into OpenAI-compatible error types.

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
| `/health` | GET | Health check |
| `/v1/models` | GET | List available Cursor models (probed from CLI, cached) |
| `/v1/cursor-models` | GET | Alias for `/v1/models` |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |

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
| `--output-format stream-json` | Structured NDJSON event stream |
| `--stream-partial-output` | Incremental text deltas for live streaming |
| `--model <id>` | Model selection |
| `--workspace <path>` | Set repository root |
| `--worktree` | Isolate edits in temp git worktree |
| `--mode ask\|plan` | Read-only modes |

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
