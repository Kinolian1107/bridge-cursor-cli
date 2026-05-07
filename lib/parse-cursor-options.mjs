// Per-request cursor-agent options parser. Pure — no side effects, no I/O.
// Extracted for unit testability; cursor-bridge.mjs re-exports / re-uses this.

const MODEL_PREFIX_TOKENS = new Set(["ask", "plan", "agent", "worktree"]);

export function parseModelPrefixTokens(requestModel) {
  if (!requestModel) return { tokens: new Set(), bare: null };
  const stripped = requestModel.replace(/^(?:bridge-cursor-cli|cursor)\//, "");
  const parts = stripped.split(":");
  const bare = parts.pop();
  const tokens = new Set();
  for (const t of parts) {
    if (MODEL_PREFIX_TOKENS.has(t)) tokens.add(t);
  }
  return { tokens, bare: bare || null };
}

/**
 * Resolve all per-request cursor-agent options.
 *
 * @param {object} data       OpenAI-style request body
 * @param {boolean} stream    whether the client wants SSE
 * @param {boolean} hasTools  whether `tools` is non-empty
 * @param {object} config     baseline defaults (CONFIG.mode, CONFIG.worktree)
 */
export function parseCursorOptions(data, stream, hasTools, config = {}) {
  const meta = (data && typeof data === "object" && data.metadata && typeof data.metadata === "object")
    ? data.metadata
    : {};
  const { tokens, bare } = parseModelPrefixTokens(data?.model);

  let mode = "";
  if (meta.cursor_mode === "ask" || meta.cursor_mode === "plan" || meta.cursor_mode === "agent") {
    mode = meta.cursor_mode === "agent" ? "" : meta.cursor_mode;
  } else if (tokens.has("ask")) {
    mode = "ask";
  } else if (tokens.has("plan")) {
    mode = "plan";
  } else if (tokens.has("agent")) {
    mode = "";
  } else {
    mode = config.mode || "";
  }

  const ALLOWED_OUTPUT_FORMATS = new Set(["text", "json", "stream-json"]);
  let outputFormat = "stream-json";
  if (stream) {
    outputFormat = "stream-json";
  } else if (typeof meta.cursor_force_output_format === "string" && ALLOWED_OUTPUT_FORMATS.has(meta.cursor_force_output_format)) {
    outputFormat = meta.cursor_force_output_format;
  } else {
    outputFormat = "stream-json";
  }

  const worktree = (meta.cursor_worktree === true) || tokens.has("worktree") || !!config.worktree;
  const worktreeBase = typeof meta.cursor_worktree_base === "string" ? meta.cursor_worktree_base : null;
  const skipWorktreeSetup = meta.cursor_skip_worktree_setup === true;

  const sandbox = (meta.cursor_sandbox === "enabled" || meta.cursor_sandbox === "disabled")
    ? meta.cursor_sandbox
    : null;

  const resumeChatId = typeof meta.cursor_resume_chat_id === "string" && meta.cursor_resume_chat_id.trim()
    ? meta.cursor_resume_chat_id.trim()
    : null;
  const continueSession = meta.cursor_continue === true;

  let streamPartialOutput;
  if (typeof meta.cursor_stream_partial_output === "boolean") {
    streamPartialOutput = meta.cursor_stream_partial_output;
  } else {
    streamPartialOutput = !hasTools && outputFormat === "stream-json";
  }

  return {
    mode,
    bareModel: bare,
    outputFormat,
    worktree,
    worktreeBase,
    skipWorktreeSetup,
    sandbox,
    resumeChatId,
    continueSession,
    streamPartialOutput,
    trust: meta.cursor_trust !== false,
  };
}
