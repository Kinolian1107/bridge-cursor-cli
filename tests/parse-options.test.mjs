// Unit tests for parseCursorOptions and parseModelPrefixTokens.
// Run: node tests/parse-options.test.mjs

import assert from "node:assert/strict";
import { parseCursorOptions, parseModelPrefixTokens } from "../lib/parse-cursor-options.mjs";

const config = { mode: "", worktree: false };
let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    fail++;
  }
}

console.log("parseModelPrefixTokens");

test("strips cursor/ provider prefix", () => {
  const r = parseModelPrefixTokens("cursor/opus-4.6-thinking");
  assert.equal(r.bare, "opus-4.6-thinking");
  assert.equal(r.tokens.size, 0);
});

test("strips bridge-cursor-cli/ provider prefix", () => {
  const r = parseModelPrefixTokens("bridge-cursor-cli/gpt-5.3-codex");
  assert.equal(r.bare, "gpt-5.3-codex");
});

test("recognises ask: token", () => {
  const r = parseModelPrefixTokens("cursor/ask:opus-4.6-thinking");
  assert.equal(r.bare, "opus-4.6-thinking");
  assert.ok(r.tokens.has("ask"));
});

test("recognises plan: + worktree: combined", () => {
  const r = parseModelPrefixTokens("cursor/plan:worktree:opus-4.6");
  assert.ok(r.tokens.has("plan"));
  assert.ok(r.tokens.has("worktree"));
  assert.equal(r.bare, "opus-4.6");
});

test("ignores unknown prefix tokens", () => {
  const r = parseModelPrefixTokens("cursor/xyz:opus-4.6");
  assert.equal(r.tokens.size, 0);
  assert.equal(r.bare, "opus-4.6"); // last segment wins as bare model
});

test("returns null bare for empty", () => {
  const r = parseModelPrefixTokens("");
  assert.equal(r.bare, null);
});

console.log("\nparseCursorOptions");

test("defaults — empty body, no stream, no tools", () => {
  const o = parseCursorOptions({}, false, false, config);
  assert.equal(o.mode, "");
  assert.equal(o.outputFormat, "stream-json");
  assert.equal(o.worktree, false);
  assert.equal(o.streamPartialOutput, true);
  assert.equal(o.resumeChatId, null);
  assert.equal(o.trust, true);
});

test("metadata.cursor_mode=ask wins over CONFIG default", () => {
  const o = parseCursorOptions({ metadata: { cursor_mode: "ask" } }, false, false, config);
  assert.equal(o.mode, "ask");
});

test("metadata.cursor_mode=agent → empty mode (no --mode flag)", () => {
  const o = parseCursorOptions({ metadata: { cursor_mode: "agent" } }, false, false, config);
  assert.equal(o.mode, "");
});

test("model prefix ask: applied when no metadata", () => {
  const o = parseCursorOptions({ model: "cursor/ask:opus-4.6" }, false, false, config);
  assert.equal(o.mode, "ask");
  assert.equal(o.bareModel, "opus-4.6");
});

test("metadata wins over conflicting model prefix", () => {
  const o = parseCursorOptions(
    { model: "cursor/plan:opus-4.6", metadata: { cursor_mode: "ask" } },
    false, false, config,
  );
  assert.equal(o.mode, "ask");
});

test("non-stream + cursor_force_output_format=json", () => {
  const o = parseCursorOptions({ metadata: { cursor_force_output_format: "json" } }, false, false, config);
  assert.equal(o.outputFormat, "json");
  // streamPartialOutput should be false when output isn't stream-json
  assert.equal(o.streamPartialOutput, false);
});

test("stream=true forces stream-json regardless of metadata", () => {
  const o = parseCursorOptions({ metadata: { cursor_force_output_format: "json" } }, true, false, config);
  assert.equal(o.outputFormat, "stream-json");
});

test("cursor_resume_chat_id wired through", () => {
  const o = parseCursorOptions({ metadata: { cursor_resume_chat_id: "ch-abc-123" } }, false, false, config);
  assert.equal(o.resumeChatId, "ch-abc-123");
});

test("worktree: token + worktree_base metadata combine", () => {
  const o = parseCursorOptions(
    { model: "cursor/worktree:opus-4.6", metadata: { cursor_worktree_base: "main" } },
    false, false, config,
  );
  assert.equal(o.worktree, true);
  assert.equal(o.worktreeBase, "main");
});

test("CONFIG.worktree default propagates when nothing else set", () => {
  const o = parseCursorOptions({}, false, false, { mode: "", worktree: true });
  assert.equal(o.worktree, true);
});

test("invalid metadata.cursor_force_output_format ignored", () => {
  const o = parseCursorOptions({ metadata: { cursor_force_output_format: "yaml" } }, false, false, config);
  assert.equal(o.outputFormat, "stream-json"); // fallback
});

test("metadata.cursor_sandbox=enabled accepted", () => {
  const o = parseCursorOptions({ metadata: { cursor_sandbox: "enabled" } }, false, false, config);
  assert.equal(o.sandbox, "enabled");
});

test("invalid metadata.cursor_sandbox ignored", () => {
  const o = parseCursorOptions({ metadata: { cursor_sandbox: "yolo" } }, false, false, config);
  assert.equal(o.sandbox, null);
});

test("hasTools=true disables streamPartialOutput by default", () => {
  const o = parseCursorOptions({}, true, true, config);
  assert.equal(o.streamPartialOutput, false);
});

test("metadata.cursor_stream_partial_output=false overrides default", () => {
  const o = parseCursorOptions({ metadata: { cursor_stream_partial_output: false } }, true, false, config);
  assert.equal(o.streamPartialOutput, false);
});

test("metadata.cursor_trust=false flips default", () => {
  const o = parseCursorOptions({ metadata: { cursor_trust: false } }, false, false, config);
  assert.equal(o.trust, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
