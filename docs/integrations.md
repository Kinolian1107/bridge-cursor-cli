**[English](integrations.md)** | **[繁體中文](integrations.zh-TW.md)** · [← README](../README.md)

# Integrations

## Hermes Agent

If you use [Hermes Agent](https://github.com/nousresearch/hermes-agent), run `./set-hermesagent.sh` — it configures Hermes to use cursor-bridge and syncs the bridge's model list into Hermes so `/model` shows them.

**First-time install, no Nous Portal?** `./set-hermesagent.sh` bootstraps a fresh Hermes config for you (via `hermes setup --non-interactive`, which never touches the Portal) before pointing it at the bridge — so a brand-new Hermes install works with the same one command. Full walkthrough: **[hermes-setup.md](hermes-setup.md)** ([中文](hermes-setup.zh-TW.md)).

```bash
# Make sure cursor-bridge is running first
./start.sh daemon

# Optional but recommended: trim the model list first (see docs/models.md)
node select-models.mjs

# Configure Hermes and sync models
./set-hermesagent.sh
```

After running, select `bridge-cursor-cli` in Hermes `/model`. With an allowlist in place the menu only shows the models you actually use instead of all 130+.

Re-run `./set-hermesagent.sh` (or `node select-models.mjs --sync`) any time to refresh the model list. To remove the integration, run `./clearset-hermesagent.sh`.

## OpenClaw

If you use [OpenClaw](https://github.com/openclaw/openclaw), run `./install.sh` — it will detect OpenClaw and ask if you want to configure it automatically.

To configure manually, edit `~/.openclaw/openclaw.json`:

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "cursor-cli/claude-fable-5-thinking-medium" }
    }
  },
  "models": {
    "providers": {
      "cursor-cli": {
        "api": "openai-completions",
        "apiKey": "cursor-bridge-local",
        "baseUrl": "http://127.0.0.1:18790/v1",
        "models": [{
          "id": "claude-fable-5-thinking-medium",
          "name": "Cursor CLI (claude-fable-5-thinking-medium)",
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

## Anthropic SDK / Claude Code

Point `ANTHROPIC_BASE_URL` at the bridge — no config files needed. See [api.md — Anthropic Messages API](api.md#anthropic-messages-api-v22).
