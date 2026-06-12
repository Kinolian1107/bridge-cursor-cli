**[English](configuration.md)** | **[繁體中文](configuration.zh-TW.md)** · [← README](../README.md)

# Configuration

All configuration is via environment variables (or the `.env` file — the bridge loads it by itself, so `node cursor-bridge.mjs` alone picks up your configuration on any platform).

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18790` | Port for the proxy server |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `BRIDGE_API_KEY` | *(empty)* | **v2.2** — optional bearer auth; when set, every endpoint except `/health` requires the key (see [api.md](api.md#bearer-auth--metrics-v22)) |
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
| `BRIDGE_MODELS_FILE` | `<project>/models.json` | **v2.1** — model allowlist file managed by `select-models.mjs` |
| `BRIDGE_VERBOSE` | `true` | Log full request/response bodies and cursor-cli I/O; set `false` to disable |

> On Windows, set `CURSOR_BIN` in `.env` to your Cursor CLI binary (e.g. `C:\Users\you\.local\bin\cursor-agent.exe`); `.cmd`/`.bat`/`.ps1` shims are also supported.

## Cursor Authentication

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

The startup banner shows which authentication method is active. cursor-bridge passes all environment variables to the spawned process, so whichever method is set in your `.env` or shell environment is used automatically.

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

## Uninstall

```bash
./uninstall.sh
```

Stops the bridge, optionally restores OpenClaw config from backup, and removes the auto-start entry from `~/.bashrc`.
