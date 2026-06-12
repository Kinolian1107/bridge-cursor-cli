// Unit tests for probe-models parsing/filtering and cursor-cli helpers.
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseListModelsOutput,
  parseStderrProbe,
  filterModels,
  readSelectedModels,
} from "../lib/probe-models.mjs";
import { isDirectAgentBin, agentArgs, quoteForCmd } from "../lib/cursor-cli.mjs";

describe("parseListModelsOutput", () => {
  test("parses 'id - Display Name' lines", () => {
    const out = "Available models\n\nauto - Auto\ngpt-5.3-codex-high - Codex 5.3 High\nclaude-fable-5-thinking-medium - Claude Fable 5 Thinking Medium\n";
    const models = parseListModelsOutput(out);
    assert.equal(models.length, 3);
    assert.deepEqual(models[0], { id: "auto", name: "Auto" });
    assert.deepEqual(models[1], { id: "gpt-5.3-codex-high", name: "Codex 5.3 High" });
  });

  test("ignores header and blank lines", () => {
    const models = parseListModelsOutput("Available models\n\n\n");
    assert.equal(models.length, 0);
  });

  test("trims trailing whitespace in display names", () => {
    const models = parseListModelsOutput("composer-2.5 - Composer 2.5  \n");
    assert.deepEqual(models[0], { id: "composer-2.5", name: "Composer 2.5" });
  });

  test("handles ids with dots, dashes and digits", () => {
    const models = parseListModelsOutput("gpt-5.1-codex-max-xhigh-fast - Codex Max\nkimi-k2.5 - Kimi K2.5\n");
    assert.equal(models.length, 2);
    assert.equal(models[1].id, "kimi-k2.5");
  });
});

describe("parseStderrProbe", () => {
  test("parses legacy 'Available models: a, b' stderr", () => {
    const models = parseStderrProbe("Cannot use this model: x. Available models: auto, gpt-5.2, composer-2.5\n");
    assert.deepEqual(models.map((m) => m.id), ["auto", "gpt-5.2", "composer-2.5"]);
  });

  test("returns empty array when no match", () => {
    assert.deepEqual(parseStderrProbe("some unrelated error"), []);
  });
});

describe("filterModels", () => {
  const probed = [
    { id: "auto", name: "Auto" },
    { id: "gpt-5.5-high", name: "GPT-5.5 High" },
    { id: "composer-2.5", name: "Composer 2.5" },
  ];

  test("no selection → full probed list", () => {
    assert.equal(filterModels(probed, []), probed);
    assert.equal(filterModels(probed, null), probed);
  });

  test("selection intersects probed list, in selection order", () => {
    const r = filterModels(probed, ["composer-2.5", "auto", "gone-model"]);
    assert.deepEqual(r.map((m) => m.id), ["composer-2.5", "auto"]);
    assert.equal(r[0].name, "Composer 2.5");
  });

  test("probe failed → selection trusted as-is", () => {
    const r = filterModels([], ["auto", "gpt-5.5-high"]);
    assert.deepEqual(r, [{ id: "auto", name: "auto" }, { id: "gpt-5.5-high", name: "gpt-5.5-high" }]);
  });

  test("every selected id stale → falls back to full probed list", () => {
    assert.equal(filterModels(probed, ["gone-1", "gone-2"]), probed);
  });
});

describe("readSelectedModels", () => {
  test("reads selected ids from models.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-test-"));
    const file = join(dir, "models.json");
    writeFileSync(file, JSON.stringify({ selected: ["auto", "  composer-2.5  ", "", 42] }));
    assert.deepEqual(await readSelectedModels(file), ["auto", "composer-2.5"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing or invalid file → empty allowlist", async () => {
    assert.deepEqual(await readSelectedModels("/nonexistent/models.json"), []);
    const dir = mkdtempSync(join(tmpdir(), "bridge-test-"));
    const file = join(dir, "models.json");
    writeFileSync(file, "not json");
    assert.deepEqual(await readSelectedModels(file), []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("cursor-cli helpers", () => {
  test("isDirectAgentBin recognises agent binaries across platforms", () => {
    assert.equal(isDirectAgentBin("cursor-agent"), true);
    assert.equal(isDirectAgentBin("/home/u/.local/bin/cursor-agent"), true);
    assert.equal(isDirectAgentBin("C:\\Users\\u\\.local\\bin\\cursor-agent.exe"), true);
    assert.equal(isDirectAgentBin("agent.exe"), true);
    assert.equal(isDirectAgentBin("cursor"), false);
    assert.equal(isDirectAgentBin("C:\\Program Files\\cursor\\cursor.cmd"), false);
  });

  test("agentArgs prepends 'agent' only for the cursor wrapper", () => {
    assert.deepEqual(agentArgs("cursor", ["--list-models"]), ["agent", "--list-models"]);
    assert.deepEqual(agentArgs("cursor-agent", ["--list-models"]), ["--list-models"]);
  });

  test("quoteForCmd quotes args with spaces and specials", () => {
    assert.equal(quoteForCmd("plain-arg"), "plain-arg");
    assert.equal(quoteForCmd("C:\\My Files\\ws"), '"C:\\My Files\\ws"');
    assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
    assert.equal(quoteForCmd(""), '""');
  });
});
