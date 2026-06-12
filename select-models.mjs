#!/usr/bin/env node
/**
 * select-models — interactive model allowlist picker for cursor-bridge (v2.1)
 *
 * Cursor exposes 130+ models, which floods pickers like Hermes Agent's /model
 * menu. This tool lets you choose a short allowlist once; the bridge then only
 * advertises those models via /v1/models, and the selection can be synced
 * straight into Hermes Agent / OpenClaw configs.
 *
 * Usage:
 *   node select-models.mjs              # interactive picker (then optional sync)
 *   node select-models.mjs --list       # print all models probed from Cursor CLI
 *   node select-models.mjs --set a,b,c  # non-interactive: write allowlist
 *   node select-models.mjs --clear      # remove the allowlist (show all models)
 *   node select-models.mjs --sync       # re-sync current allowlist to Hermes/OpenClaw
 *
 * Keys (interactive): ↑/↓ move · space toggle · a all · n none · type to filter
 *                     backspace edit filter · enter save · q/esc cancel
 *
 * Cross-platform: pure Node, no dependencies. Works on Linux/macOS/Windows.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { listCursorModels, readSelectedModels } from "./lib/probe-models.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(SCRIPT_DIR, ".env"));
} catch {
  // no .env — defaults apply
}

const CURSOR_BIN = process.env.CURSOR_BIN || "cursor";
const BRIDGE_PORT = process.env.BRIDGE_PORT || "18790";
const MODELS_FILE = process.env.BRIDGE_MODELS_FILE || join(SCRIPT_DIR, "models.json");
const HERMES_CONFIG = join(process.env.HERMES_DIR || join(homedir(), ".hermes"), "config.yaml");
const OPENCLAW_CONFIG = join(process.env.OPENCLAW_DIR || join(homedir(), ".openclaw"), "openclaw.json");
const HERMES_PROVIDER = "bridge-cursor-cli";
const OPENCLAW_PROVIDER = "cursor-cli";
const BASE_URL = `http://127.0.0.1:${BRIDGE_PORT}/v1`;

// ─── allowlist persistence ───────────────────────────────────────

function saveSelection(selected) {
  const payload = { selected, updatedAt: new Date().toISOString() };
  writeFileSync(MODELS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(`✓ Saved ${selected.length} model(s) to ${MODELS_FILE}`);
}

// ─── sync targets ────────────────────────────────────────────────

function backupOnce(path) {
  const backup = `${path}.bak.pre-cursor-bridge`;
  if (!existsSync(backup)) {
    copyFileSync(path, backup);
    console.log(`  backed up to ${backup}`);
  }
}

/**
 * Rewrite Hermes custom_providers (YAML) with one entry per selected model.
 * YAML editing is delegated to python+pyyaml — Hermes itself is a Python tool,
 * so python with pyyaml is reliably present wherever Hermes is installed.
 */
function syncHermes(selected) {
  if (!existsSync(HERMES_CONFIG)) {
    console.log(`- Hermes config not found (${HERMES_CONFIG}) — skipped`);
    return false;
  }
  backupOnce(HERMES_CONFIG);

  const py = `
import sys, json, yaml
config_path, models_json, base_url, provider = sys.argv[1:5]
models = json.loads(models_json)
with open(config_path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f) or {}
kept = [p for p in (cfg.get("custom_providers") or []) if p.get("name") != provider]
cfg["custom_providers"] = kept + [
    {"name": provider, "base_url": base_url, "api_key": "",
     "api_mode": "chat_completions", "model": m}
    for m in models
]
# Keep model.default valid: only touch it when it points at this bridge
# and names a model that is no longer in the allowlist (e.g. a removed id).
top = cfg.get("model") or {}
if top.get("base_url") == base_url and models and top.get("default") not in models:
    old = top.get("default")
    top["default"] = models[0]
    cfg["model"] = top
    print(f"  default model {old} not in allowlist -> switched to {models[0]}")
with open(config_path, "w", encoding="utf-8") as f:
    yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
print(f"  -> {len(models)} models written for {provider}")
`;

  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const bin of candidates) {
    const r = spawnSync(bin, ["-c", py, HERMES_CONFIG, JSON.stringify(selected), BASE_URL, HERMES_PROVIDER], {
      encoding: "utf-8",
    });
    if (r.error) continue; // binary not found — try next
    if (r.status === 0) {
      process.stdout.write(r.stdout);
      console.log(`✓ Hermes synced (${HERMES_CONFIG})`);
      console.log("  restart to apply: hermes gateway restart");
      return true;
    }
    console.error(`✗ Hermes sync failed via ${bin}: ${(r.stderr || "").slice(0, 300)}`);
    return false;
  }
  console.error("✗ python with pyyaml not found — run ./set-hermesagent.sh instead");
  return false;
}

/**
 * Patch OpenClaw's JSON config: replace the cursor-cli provider's model list.
 */
function syncOpenClaw(selected) {
  if (!existsSync(OPENCLAW_CONFIG)) {
    console.log(`- OpenClaw config not found (${OPENCLAW_CONFIG}) — skipped`);
    return false;
  }
  backupOnce(OPENCLAW_CONFIG);

  const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, "utf-8"));
  config.models = config.models || {};
  config.models.providers = config.models.providers || {};
  const provider = config.models.providers[OPENCLAW_PROVIDER] || {
    api: "openai-completions",
    apiKey: "cursor-bridge-local",
    baseUrl: BASE_URL,
  };
  provider.models = selected.map((id) => ({
    id,
    name: `Cursor (${id})`,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 65536,
  }));
  config.models.providers[OPENCLAW_PROVIDER] = provider;

  // Keep the default model valid: only touch it if missing or now out of list.
  const defaults = config.agents?.defaults?.model;
  const primary = defaults?.primary;
  if (primary?.startsWith(`${OPENCLAW_PROVIDER}/`)) {
    const currentModel = primary.slice(OPENCLAW_PROVIDER.length + 1);
    if (!selected.includes(currentModel) && selected.length) {
      defaults.primary = `${OPENCLAW_PROVIDER}/${selected[0]}`;
      console.log(`  default model ${currentModel} not in allowlist → switched to ${selected[0]}`);
    }
  }

  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`✓ OpenClaw synced (${OPENCLAW_CONFIG})`);
  console.log("  restart to apply: openclaw gateway stop && openclaw gateway");
  return true;
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      resolve(answer.trim() === "" || /^y/i.test(answer.trim()));
    });
  });
}

async function runSyncs(selected) {
  const hasHermes = existsSync(HERMES_CONFIG);
  const hasOpenClaw = existsSync(OPENCLAW_CONFIG);
  if (!hasHermes && !hasOpenClaw) {
    console.log("No Hermes/OpenClaw config found — nothing to sync.");
    console.log("The bridge itself picks up models.json automatically (no restart needed).");
    return;
  }
  if (!process.stdin.isTTY) {
    console.log("Non-interactive session — skipping Hermes/OpenClaw sync prompts.");
    console.log("Run `node select-models.mjs --sync` to sync the allowlist later.");
    return;
  }
  if (hasHermes && (await askYesNo(`Sync ${selected.length} model(s) to Hermes Agent (${HERMES_CONFIG})?`))) {
    syncHermes(selected);
  }
  if (hasOpenClaw && (await askYesNo(`Sync ${selected.length} model(s) to OpenClaw (${OPENCLAW_CONFIG})?`))) {
    syncOpenClaw(selected);
  }
}

// ─── interactive picker ──────────────────────────────────────────

function interactivePick(models, preselected) {
  return new Promise((resolve) => {
    const selected = new Set(preselected.filter((id) => models.some((m) => m.id === id)));
    let cursor = 0;
    let scrollTop = 0;
    let filter = "";
    let resolved = false;

    const visible = () =>
      filter ? models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase())) : models;

    function pageSize() {
      return Math.max(5, (process.stdout.rows || 24) - 7);
    }

    function render() {
      const list = visible();
      const ps = pageSize();
      if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
      if (cursor < scrollTop) scrollTop = cursor;
      if (cursor >= scrollTop + ps) scrollTop = cursor - ps + 1;

      const lines = [];
      lines.push(`cursor-bridge model allowlist — ${selected.size}/${models.length} selected`);
      lines.push(`filter: ${filter || "(type to filter)"}`);
      lines.push("─".repeat(60));
      for (let i = scrollTop; i < Math.min(scrollTop + ps, list.length); i++) {
        const m = list[i];
        const mark = selected.has(m.id) ? "[x]" : "[ ]";
        const ptr = i === cursor ? "›" : " ";
        lines.push(`${ptr} ${mark} ${m.id}${m.name && m.name !== m.id ? `  — ${m.name}` : ""}`);
      }
      if (!list.length) lines.push("  (no models match the filter)");
      lines.push("─".repeat(60));
      lines.push("↑/↓ move · space toggle · a all · n none · enter save · q/esc cancel");

      process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
    }

    function finish(result) {
      if (resolved) return;
      resolved = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKey);
      process.stdout.write("\x1b[2J\x1b[H");
      resolve(result);
    }

    function onKey(key) {
      const s = key.toString();
      const list = visible();

      if (s === "\x03" || s === "\x1b" || s === "q") {
        // Ctrl-C / esc / q — but esc may prefix arrow sequences, check length
        if (s === "\x1b") return finish(null);
        if (s === "q" && !filter) return finish(null);
        if (s === "\x03") return finish(null);
      }
      if (s === "\x1b[A" || s === "\x1bOA") { cursor = Math.max(0, cursor - 1); return render(); }
      if (s === "\x1b[B" || s === "\x1bOB") { cursor = Math.min(list.length - 1, cursor + 1); return render(); }
      if (s === "\x1b[5~") { cursor = Math.max(0, cursor - pageSize()); return render(); }   // PgUp
      if (s === "\x1b[6~") { cursor = Math.min(list.length - 1, cursor + pageSize()); return render(); } // PgDn
      if (s === "\r" || s === "\n") return finish([...selected]);
      if (s === " ") {
        const m = list[cursor];
        if (m) selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
        return render();
      }
      if (s === "a" && !filterCaptures()) { for (const m of list) selected.add(m.id); return render(); }
      if (s === "n" && !filterCaptures()) { for (const m of list) selected.delete(m.id); return render(); }
      if (s === "\x7f" || s === "\b") { filter = filter.slice(0, -1); cursor = 0; scrollTop = 0; return render(); }
      // printable chars build the filter (model ids: letters, digits, . - _ /)
      if (/^[a-z0-9.\-_/]$/i.test(s)) { filter += s; cursor = 0; scrollTop = 0; return render(); }
    }

    // When a filter is being typed, "a"/"n" should append to the filter rather
    // than toggling — only treat them as commands when no filter text exists.
    function filterCaptures() {
      return filter.length > 0;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
    render();
  });
}

// ─── main ────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const has = (flag) => argv.includes(flag);
  const argValue = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  if (has("--clear")) {
    saveSelection([]);
    console.log("Allowlist cleared — /v1/models now returns the full Cursor model list.");
    return;
  }

  if (has("--sync")) {
    const selected = readSelectedModels(MODELS_FILE);
    if (!selected.length) {
      console.error(`No allowlist in ${MODELS_FILE} — run \`node select-models.mjs\` first.`);
      process.exitCode = 1;
      return;
    }
    await runSyncs(selected);
    return;
  }

  console.log(`Probing models from Cursor CLI (${CURSOR_BIN})...`);
  const models = await listCursorModels({ cursorBin: CURSOR_BIN });
  if (!models.length) {
    console.error("✗ Could not list models — is the Cursor CLI installed and logged in?");
    console.error("  Try: cursor-agent --list-models");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${models.length} models available`);

  if (has("--list")) {
    for (const m of models) console.log(`${m.id}  — ${m.name}`);
    return;
  }

  const setArg = argValue("--set");
  if (setArg) {
    const wanted = setArg.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = wanted.filter((id) => models.some((m) => m.id === id));
    const invalid = wanted.filter((id) => !valid.includes(id));
    if (invalid.length) console.warn(`⚠ Unknown model id(s) skipped: ${invalid.join(", ")}`);
    if (!valid.length) {
      console.error("✗ No valid model ids — nothing written.");
      process.exitCode = 1;
      return;
    }
    saveSelection(valid);
    await runSyncs(valid);
    return;
  }

  if (!process.stdin.isTTY) {
    console.error("✗ Interactive mode needs a TTY. Use --set \"model1,model2\" instead.");
    process.exitCode = 1;
    return;
  }

  const previous = readSelectedModels(MODELS_FILE);
  const picked = await interactivePick(models, previous);
  if (picked === null) {
    console.log("Cancelled — no changes written.");
    return;
  }
  if (!picked.length) {
    console.log("Nothing selected — writing an empty allowlist would hide nothing.");
    console.log("(/v1/models falls back to the full list when the allowlist is empty.)");
  }
  saveSelection(picked);
  await runSyncs(picked);
}

main();
