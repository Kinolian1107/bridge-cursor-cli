// Optional bearer-token auth for the bridge. Pure — no I/O.
//
// Auth is OFF unless BRIDGE_API_KEY is set (localhost-only deployments don't
// need it). When set, every endpoint except /health requires the key via
// either header form:
//   Authorization: Bearer <key>   (OpenAI SDK style)
//   x-api-key: <key>              (Anthropic SDK style)

import { timingSafeEqual } from "node:crypto";

/** Extract the client-supplied token from request headers, or null. */
export function extractRequestToken(headers) {
  const auth = headers?.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const xApiKey = headers?.["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim()) {
    return xApiKey.trim();
  }
  return null;
}

/**
 * Check whether the request is allowed. An empty/unset apiKey disables auth.
 * Uses timingSafeEqual so the comparison doesn't leak the key via timing.
 */
export function isAuthorized(headers, apiKey) {
  if (!apiKey) return true;
  const token = extractRequestToken(headers);
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(apiKey);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
