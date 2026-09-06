**[English](how-it-works.md)** | **[繁體中文](how-it-works.zh-TW.md)** · [← README](../README.md)

# How It Works (Technical Details)

## Architecture

```
Any OpenAI- or Anthropic-compatible client
(OpenClaw, Hermes, Claude Code, Continue.dev, curl, …)
                    │
                    │  /v1/chat/completions (OpenAI)
                    │  /v1/messages (Anthropic, v2.2)
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

Zero external dependencies — pure Node.js built-in modules.

## Request Flow

1. **Client** sends an OpenAI-compatible chat completion request (Anthropic `/v1/messages` requests are first translated to the OpenAI shape by `lib/anthropic-compat.mjs`, then follow the same flow; the response is translated back on the way out)
2. **cursor-bridge** converts the messages array into a single prompt string:
   - System messages → `<system_instructions>` block
   - Conversation history → `<conversation_history>` block
   - Latest user message → appended at the end
   - If `tools` are present → injected as `<tool_calling_protocol>` block (see [Tool Bridge Mode](models.md#tool-bridge-mode))
   - Image / audio / video / file parts → written to a temp dir, listed in an `<attached_media>` block (v2.3)
3. **cursor-bridge** spawns:
   ```
   cursor agent --print --force --model <model>
     --output-format stream-json --stream-partial-output
     --workspace <path> [--add-dir <media-dir>] [--worktree] [--mode ask|plan]
   ```
   - Prompts ≤ 32KB: passed as CLI argument (Linux/macOS)
   - Prompts > 32KB — or any prompt on Windows: piped via stdin (avoids Linux `E2BIG` / Windows command-line limits)
4. **cursor agent** processes the prompt via your Cursor subscription
5. The bridge parses NDJSON `stream-json` events (`system`, `assistant`, `tool_call`, `result`) and converts them to OpenAI-compatible SSE
6. Token usage is estimated from character counts and included in the final response

## CLI Flags Reference

| Flag | Purpose |
|------|---------|
| `--print` / `-p` | Non-interactive (headless) mode |
| `--force` / `--yolo` | Apply file modifications directly |
| `--output-format text\|json\|stream-json` | Output format. `json` = single JSON object, simplest for non-streaming clients (v2.0) |
| `--stream-partial-output` | Incremental text deltas for live streaming |
| `--model <id>` | Model selection |
| `--workspace <path>` | Set repository root |
| `--add-dir <path>` | Extra workspace root — used for materialized media files (v2.3) |
| `--worktree` / `--worktree-base <branch>` / `--skip-worktree-setup` | Isolate edits in temp git worktree (v2.0 wired through) |
| `--mode ask\|plan` | Read-only modes |
| `--trust` | Skip workspace trust prompt (auto-added by v2.0 unless `cursor_trust=false`) |
| `--sandbox enabled\|disabled` | Explicit sandbox override (v2.0) |
| `--resume <chat-id>` / `--continue` | Session continuity (v2.0) |

## Fingerprint dedup (v2.0)

When `--stream-partial-output` is enabled, cursor-agent emits **three variants** of `assistant` events per the [official docs](https://cursor.com/docs/cli/reference/output-format):

| `timestamp_ms` | `model_call_id` | Action |
|---|---|---|
| set | unset | **keep** — real new delta |
| set | set | **discard** — pre-tool-call replay |
| unset | unset | **discard** — final flush replay |

v2.0 implements this filter natively in the streaming + non-streaming paths, deprecating the v1.x heuristic length-prefix dedup.

## ACP (Agent Communication Protocol)

The Cursor CLI also supports `cursor agent acp` — a JSON-RPC 2.0 protocol over stdio for advanced custom integrations. cursor-bridge currently uses the simpler `--print` headless mode. ACP provides richer session management and is used by IDE plugins (JetBrains, Neovim, Zed). See [todo.md](todo.md) for the ACP research notes.
