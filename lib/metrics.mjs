// Prometheus-format metrics registry for the bridge (todo 2.4). Pure — no I/O.
//
// Deliberately minimal: counters + gauges rendered as text exposition format
// (version 0.0.4). No client library, matching the project's zero-dep rule.

// Known endpoints, used as the `endpoint` label to keep cardinality bounded.
// Anything else (404 probes, scanners) collapses into "other".
const KNOWN_ENDPOINTS = new Set([
  "/health",
  "/metrics",
  "/v1/models",
  "/v1/cursor-models",
  "/v1/chat/completions",
  "/v1/messages",
  "/v1/messages/count_tokens",
  "/v1/cursor-sessions",
  "/v1/cursor-sessions/create",
]);

/** Normalize a pathname to a bounded endpoint label. */
export function endpointLabel(pathname) {
  if (pathname === "/") return "/health";
  return KNOWN_ENDPOINTS.has(pathname) ? pathname : "other";
}

export function createMetrics({ now = Date.now } = {}) {
  const startedAtMs = now();
  const requestCounts = new Map(); // "endpoint|method|status" → count
  const durations = new Map(); // endpoint → { sumSeconds, count }
  let authFailures = 0;
  let inflight = 0;

  return {
    recordRequest({ endpoint, method, status, durationMs }) {
      const key = `${endpoint}|${method}|${status}`;
      requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
      const d = durations.get(endpoint) || { sumSeconds: 0, count: 0 };
      durations.set(endpoint, {
        sumSeconds: d.sumSeconds + durationMs / 1000,
        count: d.count + 1,
      });
    },
    incAuthFailure() {
      authFailures++;
    },
    incInflight() {
      inflight++;
    },
    decInflight() {
      inflight = Math.max(0, inflight - 1);
    },

    /** Render all metrics in Prometheus text exposition format. */
    render() {
      const lines = [
        "# HELP bridge_requests_total Total HTTP requests handled by the bridge.",
        "# TYPE bridge_requests_total counter",
      ];
      for (const [key, count] of requestCounts) {
        const [endpoint, method, status] = key.split("|");
        lines.push(
          `bridge_requests_total{endpoint="${endpoint}",method="${method}",status="${status}"} ${count}`
        );
      }

      lines.push(
        "# HELP bridge_request_duration_seconds Request duration per endpoint.",
        "# TYPE bridge_request_duration_seconds summary"
      );
      for (const [endpoint, d] of durations) {
        lines.push(
          `bridge_request_duration_seconds_sum{endpoint="${endpoint}"} ${d.sumSeconds.toFixed(3)}`,
          `bridge_request_duration_seconds_count{endpoint="${endpoint}"} ${d.count}`
        );
      }

      lines.push(
        "# HELP bridge_auth_failures_total Requests rejected by bearer auth.",
        "# TYPE bridge_auth_failures_total counter",
        `bridge_auth_failures_total ${authFailures}`,
        "# HELP bridge_inflight_requests Requests currently being handled.",
        "# TYPE bridge_inflight_requests gauge",
        `bridge_inflight_requests ${inflight}`,
        "# HELP bridge_uptime_seconds Seconds since the bridge process started.",
        "# TYPE bridge_uptime_seconds gauge",
        `bridge_uptime_seconds ${Math.floor((now() - startedAtMs) / 1000)}`
      );
      return lines.join("\n") + "\n";
    },
  };
}
