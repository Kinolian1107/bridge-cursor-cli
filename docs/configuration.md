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

WSL2 sits behind a NAT, so even with `BRIDGE_HOST=0.0.0.0` other LAN computers **cannot** reach the WSL IP directly — they only see the Windows host. Add a port forward on the **Windows host** (Administrator PowerShell):

```powershell
# Get the WSL IP
wsl hostname -I

# Forward the Windows host's 18790 into WSL (replace <WSL_IP> with the value above)
netsh interface portproxy add v4tov4 `
  listenaddress=0.0.0.0 listenport=18790 `
  connectaddress=<WSL_IP> connectport=18790

# Open the Windows firewall
New-NetFirewallRule -DisplayName "cursor-bridge" -Direction Inbound -LocalPort 18790 -Protocol TCP -Action Allow
```

Other machines then connect to the **Windows host's** LAN IP (from `ipconfig`), not the WSL IP. The WSL IP changes on reboot, so re-run the forward after restarting (`netsh interface portproxy reset` clears the old rules). A native Linux/macOS host needs none of this — steps 1–3 are enough.

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
