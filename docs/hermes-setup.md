# Hermes Agent + cursor-bridge — First-Time Setup (no Nous Portal)

This guide wires [Hermes Agent](https://github.com/nousresearch/hermes-agent) to
**cursor-bridge** as its model endpoint on a brand-new install — **without using
the Nous Portal**. The result: every Cursor model you select shows up in Hermes'
`/model` menu and runs through your local Cursor subscription. No Portal OAuth,
no extra inference API key.

> 中文版 / Traditional Chinese: [hermes-setup.zh-TW.md](./hermes-setup.zh-TW.md)

---

## How it works

Hermes talks to any OpenAI-compatible `/v1/chat/completions` endpoint. cursor-bridge
**is** such an endpoint (it spawns the Cursor CLI under the hood). So we just point
Hermes' model provider at `http://127.0.0.1:18790/v1` and let it call Cursor models
as if they were a normal hosted provider.

Two things get written into `~/.hermes/config.yaml`:

- `model:` — the active provider (`provider: custom`, `base_url` → the bridge,
  `api_mode: chat_completions`, `default` → your chosen model)
- `custom_providers:` — one entry per allowlisted model so they appear in `/model`

---

## Prerequisites

- **Cursor CLI** installed and logged in (`cursor-agent` or `cursor` on `PATH`).
- **Node.js ≥ 22** (cursor-bridge has zero npm dependencies).
- **Hermes Agent** installed:
  ```bash
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  # Windows PowerShell:  iex (irm https://hermes-agent.nousresearch.com/install.ps1)
  ```
  After installing, **do not** run `hermes setup --portal`. Leave the Portal alone —
  the script below configures a custom endpoint instead.

---

## Quick start (3 commands)

From the cursor-bridge repo directory:

```bash
# 1. Start the bridge as a background daemon (default port 18790)
./start.sh daemon

# 2. (Recommended) Pick a short model allowlist — keeps Hermes' /model menu usable.
#    Cursor exposes 130+ models; this trims it to the ones you actually use.
node select-models.mjs

# 3. Point Hermes at the bridge and sync the model list
./set-hermesagent.sh
```

That's it. `set-hermesagent.sh` now **bootstraps a fresh Hermes config for you** if
none exists yet (it runs `hermes setup --non-interactive`, which never touches the
Portal), then rewrites the `model:` block and `custom_providers:` list.

When it finishes:

```bash
hermes            # start chatting; run /model to switch between Cursor models
```

Select **`bridge-cursor-cli`** in `/model`. With an allowlist in place the menu shows
only your chosen models instead of all 130+.

---

## What ends up in `~/.hermes/config.yaml`

```yaml
model:
  default: composer-2.5
  provider: custom
  base_url: http://127.0.0.1:18790/v1
  api_mode: chat_completions

custom_providers:
- name: bridge-cursor-cli
  base_url: http://127.0.0.1:18790/v1
  api_key: ''
  api_mode: chat_completions
  model: auto
- name: bridge-cursor-cli
  base_url: http://127.0.0.1:18790/v1
  api_key: ''
  api_mode: chat_completions
  model: composer-2.5
# ... one entry per allowlisted model
```

`api_key` is empty because the bridge is local and unauthenticated by default. If you
set `BRIDGE_API_KEY` in cursor-bridge's `.env`, put the same value here (the sync
scripts carry it through automatically).

---

## Refreshing the model list

Cursor renames and rotates models often. Whenever you change your allowlist, re-sync:

```bash
node select-models.mjs            # re-pick interactively, then it offers to sync
# or, to push the current allowlist without re-picking:
node select-models.mjs --sync
# or just re-run:
./set-hermesagent.sh
```

The sync also **fixes a stale default**: if `model.default` points at a model Cursor
removed, it switches to the first model in your list so Hermes always boots with a
selectable default.

---

## Switching models inside Hermes

```text
/model                       # interactive picker
/model composer-2.5          # switch the active model for this session
```

To make a switch permanent, append `--global` (writes back to `config.yaml`).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/model` menu floods with 130+ models | Run `node select-models.mjs` to set an allowlist, then `./set-hermesagent.sh`. |
| Hermes still uses the old model after sync | Restart the gateway: `hermes gateway restart` (the script offers to do this). |
| `cursor-bridge does not appear to be running` | `./start.sh daemon`, then check `curl http://127.0.0.1:18790/health`. |
| Default model is an id Cursor removed | Re-run the sync — it auto-switches `model.default` to a valid model. |
| Responses error with a model name | Confirm the model is in `curl http://127.0.0.1:18790/v1/models`; re-pick if Cursor renamed it. |
| Want to see *all* models, ignoring the allowlist | `curl "http://127.0.0.1:18790/v1/models?all=1"` |

Diagnose Hermes itself with `hermes doctor`.

---

## Manual configuration (fallback)

If you prefer not to run the script, configure Hermes by hand:

```bash
hermes setup --non-interactive          # bootstrap a default config (no Portal)
hermes config set model.provider custom
hermes config set model.base_url http://127.0.0.1:18790/v1
hermes config set model.api_mode chat_completions
hermes config set model.default composer-2.5
```

Then sync the `custom_providers` list so `/model` is populated:

```bash
node select-models.mjs --sync
```

---

## Removing the integration

```bash
./clearset-hermesagent.sh
```

It restores the pre-integration backup (`~/.hermes/config.yaml.bak.pre-cursor-bridge`)
if one exists, or resets the `model:` block to Hermes defaults otherwise.
