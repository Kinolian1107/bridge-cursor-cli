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

curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opus-4.6-thinking","messages":[{"role":"user","content":"Hello!"}]}'
```

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
| `CURSOR_MODEL` | `opus-4.6-thinking` | Cursor CLI model ID |
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

## Available Models

Run `cursor agent --list-models` to see all models available under your subscription:

| Model ID | Description |
|----------|-------------|
| `opus-4.6-thinking` | Claude 4.6 Opus with extended thinking — **recommended** |
| `opus-4.6` | Claude 4.6 Opus |
| `sonnet-4.6-thinking` | Claude 4.6 Sonnet with extended thinking |
| `gpt-5.2-codex-high` | GPT-5.2 Codex High |
| `gemini-3-pro` | Gemini 3 Pro |

Change the model by setting `CURSOR_MODEL` in `.env` and restarting, or pass the `model` field in each API request for per-request switching.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |

### Example

```bash
# Non-streaming
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opus-4.6-thinking","messages":[{"role":"user","content":"Hello!"}]}'

# Streaming
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"opus-4.6-thinking","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
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
1. The bridge injects tool definitions into the prompt as `<available_tools>` XML
2. The Cursor workspace rule (`workspace-rules/tool-bridge.mdc`) instructs the model to output `<tool_call>` XML blocks
3. The bridge parses these and converts them to OpenAI `tool_calls` format

To enable Tool Bridge Mode, copy the workspace rule:
```bash
mkdir -p ~/.cursor-bridge/workspace/.cursor/rules/
cp workspace-rules/tool-bridge.mdc ~/.cursor-bridge/workspace/.cursor/rules/
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
