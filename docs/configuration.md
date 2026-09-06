**[English](configuration.md)** | **[繁體中文](configuration.zh-TW.md)** · [← README](../README.md)

# Configuration

All configuration is via environment variables (or the `.env` file — the bridge loads it by itself, so `node cursor-bridge.mjs` alone picks up your configuration on any platform).

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18790` | Port for the proxy server |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address |
| `BRIDGE_API_KEY` | *(empty)* | **v2.2** — optional bearer auth; when set, every endpoint except `/health` requires the key (see [api.md](api.md#bearer-auth--metrics-v22)) |
| `CURSOR_MODEL` | `cursor-grok-4.6-high` | Default model for requests without `tools` |
| `BRIDGE_MEDIA_MAX_BYTES` | `52428800` (50 MB) | **v2.3** — max size per attached image / audio / video / file |
| `BRIDGE_MEDIA_MAX_FILES` | `16` | **v2.3** — max number of media attachments per request |
| `BRIDGE_MEDIA_FETCH_TIMEOUT_MS` | `15000` | **v2.3** — timeout when downloading `http(s)` media URLs |
| `BRIDGE_MEDIA_ALLOW_PRIVATE` | `false` | **v2.3** — allow fetching media from localhost / RFC1918 (default refuses) |
| `BRIDGE_MAX_BODY_BYTES` | `83886080` (80 MB) | **v2.3** — max HTTP request body size |
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

## Exposing the bridge on a LAN

By default the bridge binds to `127.0.0.1` — only the host machine can reach it. To let other computers on the same network use it as an endpoint, do three things on the machine running the bridge:

### 1. Bind to all interfaces

```bash
# .env
BRIDGE_HOST=0.0.0.0
```

`0.0.0.0` listens on every network interface so LAN clients can connect. Restart afterwards (`./stop.sh && ./start.sh daemon`); the startup banner should show `Host: 0.0.0.0`.

### 2. Always set `BRIDGE_API_KEY`

Once bound to `0.0.0.0`, **anyone who can reach the machine can spend your Cursor subscription**. Set a bearer key:

```bash
# .env
BRIDGE_API_KEY=$(openssl rand -hex 32)   # or any sufficiently long random string
```

Every endpoint except `/health` then requires one of these headers:

```bash
-H "Authorization: Bearer <key>"
# or
-H "x-api-key: <key>"
```

> ⚠️ Skipping the key is only acceptable on a fully trusted home segment. For LAN / Tailscale, always set it.

### 3. Find the LAN IP and open the firewall

```bash
# Find the IP (look for 192.168.x.x / 10.x.x.x)
ip addr | grep "inet "          # Linux
ipconfig                         # Windows (PowerShell)

# Open port 18790
sudo ufw allow 18790/tcp                              # Linux (ufw)
```

```powershell
# Windows (Administrator PowerShell)
New-NetFirewallRule -DisplayName "cursor-bridge" -Direction Inbound -LocalPort 18790 -Protocol TCP -Action Allow
```

### Connecting from other machines

Replace `127.0.0.1` with the host's LAN IP and pass the key:

```bash
curl http://192.168.1.50:18790/v1/chat/completions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

OpenClaw / Hermes / SDK clients: set `base_url` to `http://192.168.1.50:18790/v1` and use the same key.

### ⚠️ Running inside WSL2

With WSL mirrored networking, clients use the Windows host's LAN IP. Add a
source-scoped Hyper-V firewall rule from an Administrator PowerShell:

```powershell
New-NetFirewallHyperVRule `
  -Name "WSL-cursor-cli-bridge" `
  -DisplayName "WSL Cursor CLI bridge" `
  -Direction Inbound `
  -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" `
  -Protocol TCP `
  -LocalPorts 18790 `
  -RemoteAddresses "192.168.1.0/24" `
  -Profiles Private `
  -Action Allow
```

Replace the subnet with your trusted LAN. NAT mode is what needs
`netsh interface portproxy`; do not mix portproxy with mirrored networking.

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

### `Workspace path does not exist`
- The bridge auto-creates `CURSOR_WORKSPACE` on startup, but an install from
  before this fix may have a missing directory. Create it manually:
  `mkdir -p ~/.cursor-bridge/workspace` (or the path set in `.env`), then restart
  the bridge. Re-running `./install.sh` (or `.\install.ps1`) also creates it.

### Slow responses
- First request may be slower (Cursor agent startup ~5-15s)
- `thinking` models take longer but produce better results

## Uninstall

```bash
./uninstall.sh
```

Stops the bridge, optionally restores OpenClaw config from backup, and removes the auto-start entry from `~/.bashrc`.

On Windows: run `.\stop.ps1`, then delete the project folder — `install.ps1` only creates the local `.env` (no registry or startup entries).
