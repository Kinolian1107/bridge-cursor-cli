**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

# cursor-bridge

Turn your **Cursor subscription** into a local AI API server. cursor-bridge wraps the [Cursor CLI](https://cursor.com/cli) in an HTTP proxy that speaks both the **OpenAI** and **Anthropic** wire formats — so any AI client can use frontier models (Claude Fable 5, Claude Opus 4.8, GPT-5.5, Gemini 3.1 Pro, and 130+ more) **without any provider API keys**.

## What it can do

- **OpenAI-compatible API** — `POST /v1/chat/completions` (streaming & non-streaming) works with OpenClaw, Hermes Agent, Continue.dev, the OpenAI SDK, or plain `curl`
- **Anthropic-compatible API** (v2.2) — `POST /v1/messages` lets the Anthropic SDK and even **Claude Code** (`ANTHROPIC_BASE_URL`) run on Cursor models
- **Tool calling** — full multi-turn `tools` loop, with automatic model switching to a codex model that reliably follows the tool protocol
- **Model allowlist** — an interactive picker (`node select-models.mjs`) tames the 130+ model list and syncs it into Hermes / OpenClaw
- **One-command integrations** — `./set-hermesagent.sh` configures Hermes Agent end-to-end (even on a fresh install, no Nous Portal needed)
- **Ops-ready** (v2.2) — optional bearer auth (`BRIDGE_API_KEY`) for LAN/Tailscale use, Prometheus `/metrics`, daily-rotated logs, session continuity
- **Zero dependencies** — pure Node.js built-in modules; runs on Linux, macOS and Windows

```
OpenAI / Anthropic clients ──► cursor-bridge (port 18790) ──► cursor agent --print ──► your Cursor subscription
```

## Quick Start

Requirements: **Node.js ≥ 22** and the [Cursor CLI](https://cursor.com/cli) logged in (`cursor agent login`).

```bash
git clone https://github.com/Kinolian1107/bridge-cursor-cli.git
cd bridge-cursor-cli

./install.sh        # detects Cursor CLI, creates .env and start/stop scripts
./start.sh daemon   # start in the background (Windows: .\start.ps1 daemon)
```

Or manually: `cp .env.example .env` and `node cursor-bridge.mjs` — the bridge loads `.env` by itself on every platform.

## Try it

```bash
# Health check + model list
curl http://127.0.0.1:18790/health
curl http://127.0.0.1:18790/v1/models

# OpenAI format
curl http://127.0.0.1:18790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'

# Anthropic format — or point ANTHROPIC_BASE_URL here and use the SDK / Claude Code
curl http://127.0.0.1:18790/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"Hello!"}]}'
```

## Documentation

| Topic | Read this |
|-------|-----------|
| **API reference** — endpoints, Anthropic Messages API, bearer auth & Prometheus metrics, per-request `metadata.cursor_*` options, session continuity | [docs/api.md](docs/api.md) |
| **Configuration** — all env vars, Cursor authentication, logs, troubleshooting, uninstall | [docs/configuration.md](docs/configuration.md) |
| **Models** — allowlist picker, recommended models, live model list, Tool Bridge Mode | [docs/models.md](docs/models.md) |
| **Integrations** — Hermes Agent, OpenClaw, Anthropic SDK / Claude Code | [docs/integrations.md](docs/integrations.md) |
| └ Hermes first-time setup (no Nous Portal) | [docs/hermes-setup.md](docs/hermes-setup.md) |
| **How it works** — request flow, CLI flags, fingerprint dedup, ACP | [docs/how-it-works.md](docs/how-it-works.md) |
| **Changelog** — full version history (v1.0 → v2.2) | [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| **Roadmap / research notes** | [docs/todo.md](docs/todo.md) · [docs/research/](docs/research/) |

Every doc has a Traditional Chinese mirror (`*.zh-TW.md`).

## Uninstall

```bash
./uninstall.sh
```

## License

MIT
