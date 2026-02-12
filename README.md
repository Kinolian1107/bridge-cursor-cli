# openclaw-bridge-cursorcli

Bridge [OpenClaw](https://github.com/openclaw/openclaw) to [Cursor CLI](https://cursor.com/cli) — use frontier AI models (Claude 4.6 Opus, GPT-5.2, Gemini 3 Pro, etc.) through your Cursor subscription, **no API keys needed**.

## Why?

OpenClaw is a great personal AI assistant, but running local models (e.g. Qwen3-14B on Ollama) requires powerful GPUs and the quality can't match frontier models. If you already have a **Cursor subscription** (Pro/Business), you have access to the best models — this bridge lets OpenClaw use them.

## Architecture

```
Telegram / WhatsApp / Discord / Signal / etc.
                    │
                    ▼
       ┌────────────────────────┐
       │    OpenClaw Gateway     │  port 18789
       │   (personal assistant)  │
       └───────────┬────────────┘
                   │  OpenAI-compatible API
                   ▼
       ┌────────────────────────┐
       │    cursor-bridge        │  port 18790
       │   (this proxy server)   │
       └───────────┬────────────┘
                   │  spawns process
                   ▼
       ┌────────────────────────┐
       │    cursor agent --print │
       │   (Cursor CLI headless) │
       │   uses your Cursor sub  │
       └────────────────────────┘
```

**How it works:** cursor-bridge exposes an OpenAI-compatible API (`/v1/chat/completions`). When OpenClaw sends a request, the bridge translates it into a `cursor agent --print` call and streams the response back. Zero external dependencies — pure Node.js built-in modules.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 22 |
| [Cursor CLI](https://cursor.com/cli) | Installed and logged in (`cursor agent login`) |
| [OpenClaw](https://github.com/openclaw/openclaw) | Installed and running |

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/openclaw-bridge-cursorcli.git
cd openclaw-bridge-cursorcli

# Run the installer (patches OpenClaw config automatically)
chmod +x install.sh
./install.sh

# Start the bridge
./start.sh daemon

# Restart OpenClaw gateway to pick up new config
openclaw gateway stop
openclaw gateway
```

## Manual Setup

If you prefer to set things up manually:

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set CURSOR_BIN to your cursor-agent path
```

### 2. Start the bridge

```bash
# Foreground (for debugging)
node cursor-bridge.mjs

# Background (daemon)
./start.sh daemon

# Stop
./stop.sh
```

### 3. Patch OpenClaw config

Edit `~/.openclaw/openclaw.json`:

```jsonc
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "cursor-cli/opus-4.6-thinking"  // ← change this
      }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {                              // ← add this block
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [
          {
            "id": "opus-4.6-thinking",
            "name": "Claude 4.6 Opus (Thinking) via Cursor CLI",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 65536
          }
        ]
      }
    }
  }
}
```

Also update `~/.openclaw/agents/main/agent/models.json` with the same provider config.

### 4. Restart OpenClaw gateway

```bash
openclaw gateway stop
openclaw gateway
```

## Configuration

All configuration is via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18790` | Port for the proxy server |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `CURSOR_MODEL` | `opus-4.6-thinking` | Cursor CLI model ID |
| `CURSOR_BIN` | `cursor` | Path to `cursor` or `cursor-agent` binary |
| `CURSOR_WORKSPACE` | `~/.openclaw/workspace` | Workspace for cursor agent |
| `CURSOR_MODE` | *(empty)* | `ask` (read-only) / `plan` / *(empty)* = full agent |
| `BRIDGE_TIMEOUT_MS` | `300000` | Request timeout (5 min) |

## Available Models

Run `cursor agent --list-models` to see all available models. Popular choices:

| Model ID | Name |
|----------|------|
| `opus-4.6-thinking` | Claude 4.6 Opus (Thinking) — **recommended** |
| `opus-4.6` | Claude 4.6 Opus |
| `sonnet-4.5-thinking` | Claude 4.5 Sonnet (Thinking) |
| `gpt-5.2-codex-high` | GPT-5.2 Codex High |
| `gpt-5.3-codex` | GPT-5.3 Codex |
| `gemini-3-pro` | Gemini 3 Pro |
| `grok` | Grok |

Change models by setting `CURSOR_MODEL` in `.env` and restarting the bridge.

## API Endpoints

The bridge exposes a standard OpenAI-compatible API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) |

### Example: Direct API call

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

This restores the original OpenClaw config from backup and removes the auto-start entry from `~/.bashrc`.

## How It Works (Technical Details)

1. **OpenClaw** sends an OpenAI-compatible chat completion request to the bridge
2. **cursor-bridge** converts the messages array into a single prompt string:
   - System messages → `<system_instructions>` block
   - Conversation history → `<conversation_history>` block
   - Latest user message → appended at the end
3. **cursor-bridge** spawns `cursor agent --print --force --model <model>` with the prompt
4. **cursor agent** processes the prompt using the selected model via your Cursor subscription
5. The response is streamed back as OpenAI-compatible SSE events (or a single JSON response)

For prompts longer than 128KB, the bridge writes to a temp file and uses shell expansion to pass it.

## Troubleshooting

### Bridge won't start
- Check if port 18790 is already in use: `ss -tlnp | grep 18790`
- Check logs: `tail -f cursor-bridge.log`

### OpenClaw still uses old model
- Make sure you restarted the OpenClaw gateway after changing config
- Check `~/.openclaw/openclaw.json` — `agents.defaults.model.primary` should be `cursor-cli/opus-4.6-thinking`
- Check `~/.openclaw/agents/main/agent/models.json` — should have `cursor-cli` provider

### Cursor CLI authentication
- Run `cursor agent login` or `cursor agent status` to check auth
- Ensure you have an active Cursor subscription

### Slow responses
- First request may be slower (Cursor agent startup time ~5-15s)
- Subsequent requests are typically faster
- The `thinking` models take longer but produce better results

## License

MIT
