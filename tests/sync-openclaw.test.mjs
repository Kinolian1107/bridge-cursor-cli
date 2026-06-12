// Unit tests for the shared OpenClaw config patch (lib/sync-openclaw.mjs).
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchOpenClawConfig, buildModelEntry } from "../lib/sync-openclaw.mjs";

const BASE_URL = "http://127.0.0.1:18790/v1";

describe("buildModelEntry", () => {
  test("builds the OpenClaw model entry shape", () => {
    const entry = buildModelEntry("composer-2.5");
    assert.equal(entry.id, "composer-2.5");
    assert.equal(entry.name, "Cursor (composer-2.5)");
    assert.equal(entry.contextWindow, 200000);
    assert.deepEqual(entry.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});

describe("patchOpenClawConfig", () => {
  test("creates the provider on an empty config without mutating the input", () => {
    const original = {};
    const { config } = patchOpenClawConfig(original, ["auto"], { baseUrl: BASE_URL });
    assert.deepEqual(original, {});
    const provider = config.models.providers["cursor-cli"];
    assert.equal(provider.baseUrl, BASE_URL);
    assert.equal(provider.api, "openai-completions");
    assert.deepEqual(provider.models.map((m) => m.id), ["auto"]);
  });

  test("preserves existing provider fields, replaces only the model list", () => {
    const original = {
      models: { providers: { "cursor-cli": { api: "openai-completions", apiKey: "custom-key", baseUrl: "http://other/v1", models: [] } } },
    };
    const { config } = patchOpenClawConfig(original, ["composer-2.5"], { baseUrl: BASE_URL });
    const provider = config.models.providers["cursor-cli"];
    assert.equal(provider.apiKey, "custom-key");
    assert.equal(provider.baseUrl, "http://other/v1");
    assert.deepEqual(provider.models.map((m) => m.id), ["composer-2.5"]);
  });

  test("picker flow: fixes primary only when stale and pointing at this provider", () => {
    const original = {
      agents: { defaults: { model: { primary: "cursor-cli/composer-2" } } },
    };
    const { config, notes } = patchOpenClawConfig(original, ["composer-2.5", "auto"], { baseUrl: BASE_URL });
    assert.equal(config.agents.defaults.model.primary, "cursor-cli/composer-2.5");
    assert.equal(notes.length, 1);
  });

  test("picker flow: leaves a valid primary and foreign providers alone", () => {
    const original = {
      agents: { defaults: { model: { primary: "anthropic/claude-fable-5" } } },
    };
    const { config, notes } = patchOpenClawConfig(original, ["auto"], { baseUrl: BASE_URL });
    assert.equal(config.agents.defaults.model.primary, "anthropic/claude-fable-5");
    assert.equal(notes.length, 0);
  });

  test("installer flow: defaultModel sets primary unconditionally", () => {
    const { config } = patchOpenClawConfig({}, ["auto", "composer-2.5"], {
      baseUrl: BASE_URL,
      defaultModel: "composer-2.5",
    });
    assert.equal(config.agents.defaults.model.primary, "cursor-cli/composer-2.5");
  });
});
