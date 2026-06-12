**[English](models.md)** | **[繁體中文](models.zh-TW.md)** · [← README](../README.md)

# Models

## Model Allowlist (select-models)

Cursor exposes **130+ models**, which floods model pickers (Hermes' `/model` menu becomes unusable). Pick a short allowlist once with the interactive picker:

```bash
node select-models.mjs        # or: npm run models
```

- ↑/↓ move · **space** toggle · **a** all · **n** none · type to filter · **enter** save
- The selection is saved to `models.json`; the bridge's `/v1/models` then only advertises those models — **no restart needed**
- After saving, the tool offers to sync the selection straight into Hermes Agent (`~/.hermes/config.yaml`) and OpenClaw (`~/.openclaw/openclaw.json`)

Non-interactive usage:

```bash
node select-models.mjs --list                       # print all probed models
node select-models.mjs --set "auto,gpt-5.3-codex-high,claude-fable-5-thinking-medium"
node select-models.mjs --sync                       # re-sync current allowlist to Hermes/OpenClaw
node select-models.mjs --clear                      # remove the allowlist (show everything)
curl "http://127.0.0.1:18790/v1/models?all=1"       # bypass the allowlist
```

## Recommended Models

| Use case | Recommended model | Reason |
|----------|-------------------|--------|
| General chat / coding | `claude-fable-5-thinking-medium`, `claude-opus-4-8-thinking-high` or `auto` | Best quality reasoning |
| Tool-using agents (Hermes, etc.) | `gpt-5.3-codex-high` (**auto-selected**) | Reliably outputs `<tool_call>` blocks without refusing as "prompt injection" |
| Fast / cheap tasks | `composer-2.5` or `gpt-5.3-codex-low` | Lower cost, fast |

> **Important for tool-using agents:** Claude-based models (`claude-4.6-*`, `claude-4.*`) refuse the `<tool_calling_protocol>` instruction as a "prompt injection attack" — they will never output `<tool_call>` blocks. cursor-bridge automatically switches to `gpt-5.3-codex-high` whenever `tools` are present in the request, regardless of which model you specified. See [Tool Bridge Mode](#tool-bridge-mode) below.

## Available Models

Query the bridge to get the live list of models available under your Cursor subscription:

```bash
curl http://127.0.0.1:18790/v1/cursor-models
```

The bridge probes the Cursor CLI (`cursor-agent --list-models`) on the first call and caches the result. Example models you may see (as of cursor-agent 2026.06 — 130+ total):

| Model ID | Description |
|----------|-------------|
| `auto` | Let Cursor pick the best model — **recommended** |
| `claude-fable-5-thinking-medium` | Claude Fable 5 with extended thinking (also `-low`/`-high`/`-xhigh`/`-max`) |
| `claude-opus-4-8-thinking-high` | Claude Opus 4.8 with extended thinking |
| `claude-4.6-opus-high-thinking` | Claude 4.6 Opus, high budget + extended thinking |
| `gpt-5.5-high` | GPT-5.5 High (also `-none`/`-low`/`-medium`/`-extra-high`) |
| `gpt-5.3-codex-high` | GPT-5.3 Codex High — best for tool calling |
| `composer-2.5` | Cursor Composer 2.5 (fast) |
| `gemini-3.1-pro` | Gemini 3.1 Pro |
| `grok-4.3` / `kimi-k2.5` | Grok 4.3 / Kimi K2.5 |

> Model availability depends on your Cursor subscription plan. The API returns only what your account can actually use. Cursor renames models frequently — old ids like `opus-4.6-thinking` or `composer-2` no longer exist, which is another reason `auto` is the default.

Change the default model by setting `CURSOR_MODEL` in `.env` and restarting, or pass `model` in each API request for per-request switching.

## Tool Bridge Mode

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

If you want tool calls to stay on `composer-2.5` (no codex override), create a profile like:

```bash
# .env.mode-composer-tools
CURSOR_MODEL=composer-2.5
CURSOR_TOOL_BRIDGE_MODEL=
```

This keeps `tools` requests on the request/default model instead of forcing codex. Keep in mind codex is still the most reliable option for strict `<tool_call>` protocol behavior.
