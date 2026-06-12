// Sync a cursor-bridge model list into OpenClaw's openclaw.json.
// Single source of truth for the OpenClaw patch policy — imported by
// select-models.mjs and invoked as a CLI by set-openclaw.sh:
//   node lib/sync-openclaw.mjs <openclaw.json> <model-ids-json> <base-url> [default-model]

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const OPENCLAW_PROVIDER = "cursor-cli";

const MODEL_ENTRY_DEFAULTS = {
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 65536,
};

export function buildModelEntry(id) {
  return { id, name: `Cursor (${id})`, ...MODEL_ENTRY_DEFAULTS };
}

/**
 * Pure patch: returns a new config with the provider's model list replaced
 * (other provider fields are preserved) plus human-readable notes.
 *
 * Default-model policy:
 *  - `defaultModel` given (installer flow) → set agents.defaults.model.primary
 *    to it unconditionally, creating the path if needed.
 *  - otherwise (picker flow) → only fix primary when it already points at this
 *    provider and names a model that is no longer in the list.
 */
export function patchOpenClawConfig(config, modelIds, { provider = OPENCLAW_PROVIDER, baseUrl, defaultModel = null } = {}) {
  const next = structuredClone(config);
  const notes = [];

  next.models = next.models || {};
  next.models.providers = next.models.providers || {};
  const providerConfig = next.models.providers[provider] || {
    api: "openai-completions",
    apiKey: "cursor-bridge-local",
    baseUrl,
  };
  providerConfig.models = modelIds.map(buildModelEntry);
  next.models.providers[provider] = providerConfig;

  if (defaultModel) {
    next.agents = next.agents || {};
    next.agents.defaults = next.agents.defaults || {};
    next.agents.defaults.model = next.agents.defaults.model || {};
    next.agents.defaults.model.primary = `${provider}/${defaultModel}`;
  } else {
    const defaults = next.agents?.defaults?.model;
    const primary = defaults?.primary;
    if (primary?.startsWith(`${provider}/`)) {
      const currentModel = primary.slice(provider.length + 1);
      if (!modelIds.includes(currentModel) && modelIds.length) {
        defaults.primary = `${provider}/${modelIds[0]}`;
        notes.push(`default model ${currentModel} not in list -> switched to ${modelIds[0]}`);
      }
    }
  }

  return { config: next, notes };
}

// CLI entry (used by set-openclaw.sh; backup is the caller's responsibility).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [configPath, modelIdsJson, baseUrl, defaultModel] = process.argv.slice(2);
  if (!configPath || !modelIdsJson || !baseUrl) {
    console.error("Usage: node lib/sync-openclaw.mjs <openclaw.json> <model-ids-json> <base-url> [default-model]");
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const modelIds = JSON.parse(modelIdsJson);
  const { config: patched, notes } = patchOpenClawConfig(config, modelIds, {
    baseUrl,
    defaultModel: defaultModel || null,
  });
  for (const note of notes) console.log(`  ${note}`);
  writeFileSync(configPath, JSON.stringify(patched, null, 2) + "\n", "utf-8");
  console.log(`Patched ${configPath}`);
}
