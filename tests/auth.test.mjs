// Unit tests for optional bearer auth (lib/auth.mjs).
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRequestToken, isAuthorized } from "../lib/auth.mjs";

test("extracts token from Authorization: Bearer header", () => {
  assert.equal(extractRequestToken({ authorization: "Bearer secret123" }), "secret123");
});

test("Bearer prefix is case-insensitive", () => {
  assert.equal(extractRequestToken({ authorization: "bearer abc" }), "abc");
});

test("extracts token from x-api-key header (Anthropic SDK style)", () => {
  assert.equal(extractRequestToken({ "x-api-key": "sk-key" }), "sk-key");
});

test("Authorization header wins over x-api-key when both present", () => {
  assert.equal(
    extractRequestToken({ authorization: "Bearer a", "x-api-key": "b" }),
    "a"
  );
});

test("returns null when no credential headers present", () => {
  assert.equal(extractRequestToken({}), null);
  assert.equal(extractRequestToken({ authorization: "Basic dXNlcg==" }), null);
});

test("auth disabled when apiKey is empty — everything allowed", () => {
  assert.equal(isAuthorized({}, ""), true);
  assert.equal(isAuthorized({}, undefined), true);
});

test("rejects request with no token when apiKey is set", () => {
  assert.equal(isAuthorized({}, "secret"), false);
});

test("rejects wrong token", () => {
  assert.equal(isAuthorized({ authorization: "Bearer wrong" }, "secret"), false);
});

test("rejects token with different length (timing-safe guard)", () => {
  assert.equal(isAuthorized({ authorization: "Bearer secretsecret" }, "secret"), false);
});

test("accepts matching bearer token", () => {
  assert.equal(isAuthorized({ authorization: "Bearer secret" }, "secret"), true);
});

test("accepts matching x-api-key", () => {
  assert.equal(isAuthorized({ "x-api-key": "secret" }, "secret"), true);
});
