// Unit tests for the Prometheus metrics registry (lib/metrics.mjs).
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMetrics, endpointLabel } from "../lib/metrics.mjs";

test("endpointLabel keeps known endpoints and collapses unknown paths", () => {
  assert.equal(endpointLabel("/v1/chat/completions"), "/v1/chat/completions");
  assert.equal(endpointLabel("/v1/messages"), "/v1/messages");
  assert.equal(endpointLabel("/"), "/health");
  assert.equal(endpointLabel("/wp-admin/login.php"), "other");
});

test("records requests and renders Prometheus counters", () => {
  const m = createMetrics({ now: () => 0 });
  m.recordRequest({ endpoint: "/v1/messages", method: "POST", status: 200, durationMs: 1500 });
  m.recordRequest({ endpoint: "/v1/messages", method: "POST", status: 200, durationMs: 500 });
  m.recordRequest({ endpoint: "/health", method: "GET", status: 200, durationMs: 2 });
  const out = m.render();
  assert.ok(out.includes('bridge_requests_total{endpoint="/v1/messages",method="POST",status="200"} 2'));
  assert.ok(out.includes('bridge_requests_total{endpoint="/health",method="GET",status="200"} 1'));
  assert.ok(out.includes('bridge_request_duration_seconds_sum{endpoint="/v1/messages"} 2.000'));
  assert.ok(out.includes('bridge_request_duration_seconds_count{endpoint="/v1/messages"} 2'));
});

test("tracks auth failures and inflight gauge", () => {
  const m = createMetrics({ now: () => 0 });
  m.incAuthFailure();
  m.incAuthFailure();
  m.incInflight();
  m.incInflight();
  m.decInflight();
  const out = m.render();
  assert.ok(out.includes("bridge_auth_failures_total 2"));
  assert.ok(out.includes("bridge_inflight_requests 1"));
});

test("inflight gauge never goes negative", () => {
  const m = createMetrics({ now: () => 0 });
  m.decInflight();
  assert.ok(m.render().includes("bridge_inflight_requests 0"));
});

test("uptime gauge derives from injected clock", () => {
  let t = 0;
  const m = createMetrics({ now: () => t });
  t = 65_000;
  assert.ok(m.render().includes("bridge_uptime_seconds 65"));
});

test("renders valid TYPE/HELP headers even with no traffic", () => {
  const out = createMetrics({ now: () => 0 }).render();
  assert.ok(out.includes("# TYPE bridge_requests_total counter"));
  assert.ok(out.includes("# TYPE bridge_uptime_seconds gauge"));
  assert.ok(out.endsWith("\n"));
});
