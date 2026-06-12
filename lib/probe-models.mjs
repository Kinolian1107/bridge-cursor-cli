// Model discovery for the Cursor CLI + model allowlist filtering.
// Parsing functions are pure for unit testability; listCursorModels spawns the CLI.

import { readFile } from "node:fs/promises";
import { agentArgs, spawnCursor } from "./cursor-cli.mjs";

/**
 * Parse `cursor-agent --list-models` stdout.
 * Format (one per line): "<model-id> - <Display Name>"
 * Returns [{ id, name }].
 */
export function parseListModelsOutput(stdout) {
  const models = [];
  for (const line of String(stdout).split("\n")) {
    const m = line.match(/^\s*([a-z0-9][a-z0-9._-]*)\s+-\s+(.+?)\s*$/i);
    if (m) models.push({ id: m[1], name: m[2] });
  }
  return models;
}

/**
 * Legacy fallback: parse "Available models: a, b, c" from stderr of an
 * intentionally-invalid model invocation (pre `--list-models` CLI versions).
 */
export function parseStderrProbe(stderr) {
  const match = String(stderr).match(/Available models:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

/**
 * Apply the user's model allowlist (from models.json) to the probed list.
 *  - No selection → full probed list (allowlist disabled)
 *  - Probe failed → trust the selection as-is
 *  - Selection ∩ probed empty (every selected id stale) → full probed list
 *  - Otherwise → selection ∩ probed, in selection order
 */
export function filterModels(probed, selectedIds) {
  if (!selectedIds || selectedIds.length === 0) return probed;
  if (!probed || probed.length === 0) {
    return selectedIds.map((id) => ({ id, name: id }));
  }
  const byId = new Map(probed.map((m) => [m.id, m]));
  const filtered = selectedIds.map((id) => byId.get(id)).filter(Boolean);
  return filtered.length ? filtered : probed;
}

/**
 * Read the model allowlist file (models.json). Returns [] when the file is
 * missing or malformed — i.e. allowlist disabled. Async so the bridge never
 * blocks the event loop on its per-request re-read.
 * Schema: { "selected": ["auto", "claude-fable-5-medium", ...] }
 */
export async function readSelectedModels(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf-8"));
    if (Array.isArray(parsed.selected)) {
      return parsed.selected.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
    }
  } catch {
    // missing or invalid file → no allowlist
  }
  return [];
}

/**
 * Probe the Cursor CLI for available models.
 * Primary path: `--list-models` (official). Fallback: invalid-model stderr parse.
 * Resolves [{ id, name }]; empty array when the CLI is unreachable.
 */
export function listCursorModels({ cursorBin = "cursor", timeoutMs = 15000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const proc = spawnCursor(cursorBin, agentArgs(cursorBin, ["--list-models"]), {
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
    proc.on("close", () => {
      clearTimeout(timer);
      const models = parseListModelsOutput(stdout);
      if (models.length) {
        resolve(models);
        return;
      }
      resolve(parseStderrProbe(stderr));
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}
