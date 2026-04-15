#!/usr/bin/env node
/**
 * cursor-bridge v1.4 — OpenAI-compatible API proxy for Cursor CLI
 *
 * 架構:
 *   Any OpenAI-compatible client  ──(OpenAI API)──►  cursor-bridge (port 18790)  ──►  cursor-agent --print --stream-json
 *
 * 這個代理伺服器提供 OpenAI 相容的 API 格式，
 * 讓任何支援 OpenAI API 的用戶端可以呼叫 Cursor CLI 的 AI 模型。
 *
 * v1.4 改進:
 *   - 修復 Tool Bridge Mode 的工具調用問題：正確設定 tool-calling protocol
 *   - toolsToPromptSection 加入明確指令，告訴 cursor-agent 輸出 <tool_call> block
 *   - tool protocol 放在 system messages 之前，覆蓋 cursor ask-mode 限制
 *   - 解決 "ask 模式無法執行工具" 的回應問題
 *
 * v1.3 改進:
 *   - 詳細日誌：完整請求參數、完整回應、cursor-cli 通訊內容
 *   - 新增 BRIDGE_VERBOSE 環境變數（預設 true）控制詳細日誌
 *   - cursor-cli 的 stdout/stderr 即時記錄到 log
 *
 * v1.2 改進:
 *   - Daily log rotation：logs/cursor-bridge.yyyyMMdd.log，一天一份
 *   - 解耦 OpenClaw 依賴，install.sh OpenClaw 整合改為可選
 *
 * v1.1 改進:
 *   - 使用 stream-json 格式取得結構化輸出（thinking, tool_call, assistant, result）
 *   - 正確的 usage token 估算（streaming 與 non-streaming）
 *   - 支援 tools 參數注入到 prompt
 *   - 改善 error response 格式（支援 context_overflow 辨識）
 *   - 長 prompt 使用 stdin pipe 避免 E2BIG
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, writeFileSync, unlinkSync, mkdtempSync, rmdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Daily log setup ─────────────────────────────────────────────
const LOG_DIR = join(SCRIPT_DIR, "logs");
mkdirSync(LOG_DIR, { recursive: true });

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

let _logDay = todayStamp();
let _logStream = createWriteStream(join(LOG_DIR, `cursor-bridge.${_logDay}.log`), { flags: "a" });

function getLogStream() {
  const today = todayStamp();
  if (today !== _logDay) {
    _logStream.end();
    _logDay = today;
    _logStream = createWriteStream(join(LOG_DIR, `cursor-bridge.${_logDay}.log`), { flags: "a" });
  }
  return _logStream;
}

// Override console to write to log file AND stdout
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);

function writeToLog(prefix, args) {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  getLogStream().write(`${prefix}${msg}\n`);
}

console.log = (...args) => { writeToLog("", args); _origLog(...args); };
console.error = (...args) => { writeToLog("[ERROR] ", args); _origError(...args); };
console.warn = (...args) => { writeToLog("[WARN] ", args); _origWarn(...args); };

/**
 * Verbose log — always writes to the log file.
 * Also prints to stdout only when BRIDGE_VERBOSE is enabled.
 * Use this for full request/response bodies and cursor-cli I/O.
 */
function verboseLog(tag, content) {
  const line = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  const entry = `[VERBOSE:${tag}]\n${line}\n[/VERBOSE:${tag}]\n`;
  getLogStream().write(entry);
  if (CONFIG.verbose) {
    _origLog(entry);
  }
}

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  port: parseInt(process.env.BRIDGE_PORT || "18790"),
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  cursorModel: process.env.CURSOR_MODEL || "opus-4.6-thinking",
  cursorBin: process.env.CURSOR_BIN || "cursor",
  workspace: process.env.CURSOR_WORKSPACE || `${process.env.HOME}/.cursor-bridge/workspace`,
  // 'ask' = read-only Q&A, 'plan' = read-only planning, '' = full agent (can edit files/run commands)
  mode: process.env.CURSOR_MODE || "",
  // Isolate edits in a temporary git worktree (stored under ~/.cursor/worktrees)
  // Equivalent to `cursor agent --worktree`
  worktree: process.env.CURSOR_WORKTREE === "true",
  timeoutMs: parseInt(process.env.BRIDGE_TIMEOUT_MS || "300000"), // 5 minutes
  // Maximum prompt length (chars) to pass as CLI argument.
  // Linux MAX_ARG_STRLEN = 131072 bytes; with multi-byte chars (Chinese = 3 bytes/char)
  // and env overhead, we need a very conservative limit.
  // Above this, prompt is written to a temp file and piped via stdin.
  maxArgLen: parseInt(process.env.BRIDGE_MAX_ARG_LEN || "32768"),
  // Token estimation ratio: chars per token (lower = more conservative estimate)
  // For mixed English/Chinese content, ~3.0 is reasonable
  charsPerToken: parseFloat(process.env.BRIDGE_CHARS_PER_TOKEN || "3.0"),
  // Verbose logging: log full request/response bodies and cursor-cli I/O
  // Set BRIDGE_VERBOSE=false to disable (defaults to true)
  verbose: process.env.BRIDGE_VERBOSE !== "false",
};

// Cache for available Cursor models (populated on first request)
let _cachedModels = null;

/**
 * Probe the Cursor CLI for available model names by intentionally using
 * an invalid model name and parsing the "Available models: ..." from stderr.
 * Result is cached after the first successful probe.
 */
function probeAvailableModels() {
  return new Promise((resolve) => {
    if (_cachedModels) {
      resolve(_cachedModels);
      return;
    }

    const isDirectAgent = CONFIG.cursorBin.includes("cursor-agent");
    const args = isDirectAgent
      ? ["--model", "__probe__", "--print", "--force", "--output-format", "stream-json", "--workspace", CONFIG.workspace, "x"]
      : ["agent", "--model", "__probe__", "--print", "--force", "--output-format", "stream-json", "--workspace", CONFIG.workspace, "x"];

    const proc = spawn(CONFIG.cursorBin, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin.end();

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => { proc.kill("SIGTERM"); }, 10000);

    proc.on("close", () => {
      clearTimeout(timer);
      // Parse "Available models: model1, model2, ..." from stderr
      const match = stderr.match(/Available models:\s*([^\n]+)/i);
      if (match) {
        const models = match[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        _cachedModels = models;
        console.log(`[cursor-bridge] Probed ${models.length} available models from Cursor CLI`);
        resolve(models);
      } else {
        // Probe failed — return empty list (don't cache so next request retries)
        console.warn("[cursor-bridge] Could not probe available models from Cursor CLI");
        resolve([]);
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}

// Tools that cursor-agent already has natively (no need to inject)
const CURSOR_NATIVE_TOOLS = new Set([
  "read", "write", "edit", "exec", "process", "browser",
]);

/**
 * Merge assistant text segments with overlap/duplicate detection.
 * Handles: exact duplicates, cumulative re-emissions, shorter re-emissions,
 * non-adjacent duplicates (via seen set), and independent segments.
 */
function mergeAssistantSegments(segments) {
  if (!segments.length) return "";
  let result = segments[0];
  const seen = new Set([segments[0].trim()]);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const trimSeg = seg.trim();
    if (!trimSeg || seg === result) {
      // Empty or exact duplicate of current result — skip
    } else if (seg.startsWith(result)) {
      // Cumulative: new segment is a superset of current result
      result = seg;
      seen.add(trimSeg);
    } else if (result.startsWith(seg)) {
      // Shorter re-emission (e.g. cursor-agent clean final) — skip
    } else if (result.endsWith(trimSeg)) {
      // Trailing duplicate — skip (result already ends with this text)
    } else if (seen.has(trimSeg)) {
      // Non-adjacent duplicate — skip (we saw this exact text earlier)
      console.log(`  [mergeSegments] skipped non-adjacent duplicate (${trimSeg.length} chars)`);
    } else {
      // Truly independent segment — append
      result += seg;
      seen.add(trimSeg);
    }
  }
  return result;
}

// Regex to extract <tool_call> blocks from model output
const TOOL_CALL_REGEX = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
// Also handle markdown-fenced variants: ```xml\n<tool_call>...\n```
const TOOL_CALL_FENCED_REGEX = /```(?:xml)?\s*\n?\s*<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>\s*\n?\s*```/g;

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract text content from an OpenAI message content field
 * (handles both string and array-of-content-parts formats)
 */
function getContent(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return String(msg.content ?? "");
}

/**
 * Estimate token count from a string.
 * Uses configurable chars-per-token ratio.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CONFIG.charsPerToken);
}

/**
 * Parse <tool_call> blocks from model output.
 * Returns array of {name, arguments} or empty array if no tool calls found.
 */
function parseToolCalls(text) {
  const calls = [];
  const seen = new Set();
  for (const regex of [TOOL_CALL_REGEX, TOOL_CALL_FENCED_REGEX]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name) {
          const argsStr = JSON.stringify(parsed.arguments || {});
          const key = `${parsed.name}::${argsStr}`;
          if (seen.has(key)) continue;
          seen.add(key);
          calls.push({
            id: `call_${randomUUID().slice(0, 12)}`,
            name: parsed.name,
            arguments: parsed.arguments || {},
          });
        }
      } catch {
        // JSON parse failed, skip
      }
    }
  }
  return calls;
}

/**
 * Remove text duplication from a buffer.
 * Handles multiple patterns:
 *   1. Exact 50% split (text repeated twice, with optional whitespace)
 *   2. Opening block repeated at the end (greeting + reasoning + greeting)
 *   3. Paragraph-level consecutive duplicates
 */
function deduplicateBuffer(text) {
  if (!text || text.length < 2) return text;
  const trimmed = text.trim();
  if (!trimmed) return text;

  const len = trimmed.length;

  // 1. Check for exact duplication: text repeated twice (40-60% split)
  for (let splitPoint = Math.floor(len * 0.4); splitPoint <= Math.ceil(len * 0.6); splitPoint++) {
    const first = trimmed.substring(0, splitPoint).trim();
    const second = trimmed.substring(splitPoint).trim();
    if (first && first === second) {
      return first;
    }
  }

  // 2. Check if the opening block (first meaningful chunk) repeats later in the text.
  //    This catches: "greeting + reasoning/meta-text + greeting" where
  //    the model re-generates its answer after internal processing.
  const MIN_BLOCK = 15;
  const lines = trimmed.split("\n");
  if (lines.length >= 2) {
    // Try progressively larger opening blocks (1 line, 2 lines, …)
    for (let blockLines = 1; blockLines <= Math.min(lines.length - 1, 5); blockLines++) {
      const opening = lines.slice(0, blockLines).join("\n").trim();
      if (opening.length < MIN_BLOCK) continue;

      // Search for an exact repeat of the opening block after the first occurrence
      const afterFirst = trimmed.indexOf(opening) + opening.length;
      const repeatIdx = trimmed.indexOf(opening, afterFirst);
      if (repeatIdx > 0) {
        // Keep only up to where the repeat starts (trim intermediate reasoning)
        const kept = trimmed.substring(repeatIdx).trim();
        console.log(`  [dedup] removed repeated opening block (${opening.length} chars, repeat at offset ${repeatIdx})`);
        return kept;
      }
    }
  }

  // 3. Remove consecutive duplicate paragraphs
  const paragraphs = trimmed.split(/\n\n+/);
  if (paragraphs.length >= 2) {
    const unique = [paragraphs[0]];
    let changed = false;
    for (let i = 1; i < paragraphs.length; i++) {
      if (paragraphs[i].trim() === paragraphs[i - 1].trim()) {
        changed = true;
        continue;
      }
      unique.push(paragraphs[i]);
    }
    if (changed) {
      console.log(`  [dedup] removed ${paragraphs.length - unique.length} duplicate paragraph(s)`);
      return unique.join("\n\n");
    }
  }

  return trimmed;
}

/**
 * Check if the model output contains tool_call blocks (even partially).
 */
function hasToolCalls(text) {
  return text.includes("<tool_call>") || text.includes("&lt;tool_call&gt;");
}

/**
 * Convert OpenAI tools array to a prompt section for Tool Bridge Mode.
 * When tools are provided, we activate Tool Bridge Mode where the model
 * outputs <tool_call> blocks instead of using cursor-agent's built-in tools.
 *
 * Placed BEFORE system messages so the tool-calling protocol overrides
 * cursor-agent's ask-mode restriction (which is a model-level system prompt).
 */
function toolsToPromptSection(tools) {
  if (!tools?.length) return "";

  let toolList = "";
  for (const tool of tools) {
    const fn = tool.function || tool;
    const name = fn.name;
    const desc = fn.description || "";
    const params = fn.parameters;
    let argsDesc = "";
    if (params?.properties) {
      const props = Object.entries(params.properties).map(([k, v]) => {
        const type = v.type || "string";
        const req = (params.required || []).includes(k) ? " (required)" : "";
        return `${k}: ${type}${req}`;
      });
      argsDesc = ` Args: {${props.join(", ")}}`;
    }
    toolList += `- ${name}: ${desc.slice(0, 300)}${argsDesc}\n`;
  }

  // Explicit tool-calling protocol: tell cursor-agent exactly what to do.
  // This must override any internal ask-mode restrictions since these are
  // EXTERNAL tools managed by the calling framework (e.g. Hermes Agent),
  // not cursor-agent's own native capabilities.
  let section = "<tool_calling_protocol>\n";
  section += "You are operating as a FUNCTION-CALLING LANGUAGE MODEL API endpoint.\n";
  section += "The tools below are provided by the EXTERNAL calling framework and are NOT cursor-agent's built-in tools.\n";
  section += "When you need to use a tool, output a <tool_call> block and stop:\n\n";
  section += "<tool_call>\n{\"name\": \"tool_name\", \"arguments\": {\"param\": \"value\"}}\n</tool_call>\n\n";
  section += "CRITICAL RULES — follow these exactly:\n";
  section += "1. NEVER say you are in 'ask mode' or that you cannot execute tools. That restriction is for cursor's internal tools only.\n";
  section += "2. These external tools ARE available to you. When you need one, call it via <tool_call>.\n";
  section += "3. After outputting a <tool_call> block, STOP — do not add explanations or continue the response.\n";
  section += "4. If you can answer without tools, respond directly in plain text.\n";
  section += "5. Call one tool at a time. The calling framework will return the result and ask you to continue.\n\n";
  section += "Available external tools:\n";
  section += toolList;
  section += "</tool_calling_protocol>";
  return section;
}

/**
 * Convert OpenAI chat messages array to a single prompt string for Cursor CLI.
 *
 * Strategy:
 *  - Single user message → pass as-is
 *  - System + user → prepend system instructions
 *  - Multi-turn → format with conversation history
 *  - Tools → append tool reference section
 */
function messagesToPrompt(messages, tools) {
  if (!messages?.length) return "";

  const systemMsgs = messages.filter((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  // Simple case: single user message, no system prompt, no tools
  if (
    conversationMsgs.length === 1 &&
    conversationMsgs[0].role === "user" &&
    !systemMsgs.length &&
    !tools?.length
  ) {
    return getContent(conversationMsgs[0]);
  }

  let prompt = "";

  // Tool-calling protocol comes FIRST when tools are present.
  // This placement is intentional: cursor-agent's ask-mode restriction is
  // injected as a model-level system prompt by cursor itself. By putting our
  // tool protocol before any other content, we establish the "function-calling
  // LLM" role before the system instructions, giving it the highest priority.
  const toolSection = toolsToPromptSection(tools);
  if (toolSection) {
    prompt += toolSection + "\n\n";
  }

  // System instructions
  if (systemMsgs.length) {
    prompt += "<system_instructions>\n";
    prompt += systemMsgs.map((m) => getContent(m)).join("\n\n");
    prompt += "\n</system_instructions>\n\n";
  }

  // Conversation history (all messages except the last one)
  if (conversationMsgs.length > 1) {
    prompt += "<conversation_history>\n";
    for (const msg of conversationMsgs.slice(0, -1)) {
      if (msg.role === "user") {
        prompt += `User: ${getContent(msg)}\n\n`;
      } else if (msg.role === "assistant") {
        // Handle assistant messages that may contain tool_calls
        const toolCalls = msg.tool_calls;
        if (toolCalls?.length) {
          prompt += "Assistant: [Used tools]\n";
          for (const tc of toolCalls) {
            const fn = tc.function || {};
            prompt += `<tool_call>\n{"name": "${fn.name}", "arguments": ${fn.arguments || "{}"}}\n</tool_call>\n`;
          }
          prompt += "\n";
        } else {
          prompt += `Assistant: ${getContent(msg)}\n\n`;
        }
      } else if (msg.role === "tool") {
        // Tool result from OpenClaw
        const callId = msg.tool_call_id || "unknown";
        const toolName = msg.name || "unknown";
        prompt += `<tool_result name="${toolName}" call_id="${callId}">\n${getContent(msg)}\n</tool_result>\n\n`;
      } else {
        prompt += `${msg.role}: ${getContent(msg)}\n\n`;
      }
    }
    prompt += "</conversation_history>\n\n";
  }

  // Current (latest) message
  const lastMsg = conversationMsgs[conversationMsgs.length - 1];
  if (lastMsg) {
    if (lastMsg.role === "tool") {
      // If the last message is a tool result, instruct the model to respond based on it
      const callId = lastMsg.tool_call_id || "unknown";
      const toolName = lastMsg.name || "unknown";
      prompt += `<tool_result name="${toolName}" call_id="${callId}">\n${getContent(lastMsg)}\n</tool_result>\n\n`;
      prompt += "Based on the tool result(s) above, provide your response to the user. Respond directly with text.\n";
    } else {
      if (conversationMsgs.length > 1) {
        prompt += "Please respond to the following message based on the system instructions and conversation history above. Respond directly.\n\n";
      }
      prompt += getContent(lastMsg);
    }
  }

  return prompt;
}

/**
 * Write a long prompt to a temp file, return the file path.
 * Caller is responsible for cleanup.
 */
function writeTempPrompt(prompt) {
  const dir = mkdtempSync(join(tmpdir(), "cursor-bridge-"));
  const filePath = join(dir, "prompt.txt");
  writeFileSync(filePath, prompt, "utf-8");
  return filePath;
}

function cleanupTempFile(filePath) {
  try {
    unlinkSync(filePath);
    const dir = filePath.replace(/\/[^/]+$/, "");
    rmdirSync(dir);
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Read the full request body as a string
 */
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

/**
 * Send a JSON error response
 */
function sendError(res, status, message, type = "internal_error") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ error: { message, type } }));
}

/**
 * Classify a spawn/process error into an OpenAI-compatible error type
 * that OpenClaw can recognize (especially context_overflow).
 */
function classifyError(err, stderrOutput) {
  const msg = (err?.message || "") + " " + (stderrOutput || "");
  const lower = msg.toLowerCase();

  if (err?.code === "E2BIG" || lower.includes("e2big") || lower.includes("argument list too long")) {
    return {
      type: "context_overflow",
      message: "Prompt too large for system argument limit (E2BIG). Context compaction needed.",
      status: 413,
    };
  }
  if (lower.includes("context") && (lower.includes("overflow") || lower.includes("too long") || lower.includes("exceed"))) {
    return {
      type: "context_overflow",
      message: `Context window exceeded: ${msg.slice(0, 300)}`,
      status: 413,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { type: "timeout", message: `Request timed out: ${msg.slice(0, 200)}`, status: 504 };
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return { type: "rate_limit", message: `Rate limited: ${msg.slice(0, 200)}`, status: 429 };
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("auth")) {
    return { type: "auth", message: `Authentication error: ${msg.slice(0, 200)}`, status: 401 };
  }

  return { type: "upstream_error", message: msg.slice(0, 500), status: 502 };
}

// ─── Core: Cursor Agent Runner (v1.1 — stream-json) ─────────────

function runCursorAgent(prompt, requestModel, stream, res, tools) {
  const requestId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  // Support dynamic model switching: use the model from the request if provided,
  // otherwise fall back to the configured default.
  // The request model may come as "opus-4.6-thinking", "cursor/opus-4.6-thinking",
  // or "bridge-cursor-cli/opus-4.6-thinking" — extract the bare model ID.
  let model = CONFIG.cursorModel;
  if (requestModel) {
    const bare = requestModel.replace(/^(?:bridge-cursor-cli|cursor)\//, "");
    if (bare) model = bare;
  }
  const modelName = `cursor/${model}`;

  // Build cursor agent arguments
  const isDirectAgent = CONFIG.cursorBin.includes("cursor-agent");
  const args = isDirectAgent ? ["--print", "--force"] : ["agent", "--print", "--force"];
  args.push("--model", model);
  // When tools are provided, use --mode ask to prevent cursor-agent from
  // executing its own tools. The model will output <tool_call> blocks instead,
  // which we parse and return as OpenAI tool_calls format.
  const toolBridgeMode = tools?.length > 0;

  args.push("--output-format", "stream-json");
  // In tool bridge mode we buffer all output to parse <tool_call> blocks,
  // so partial streaming adds no value and risks dedup-related doubling.
  if (!toolBridgeMode) {
    args.push("--stream-partial-output");
  }
  args.push("--workspace", CONFIG.workspace);
  if (toolBridgeMode) {
    args.push("--mode", "ask");
  } else if (CONFIG.mode) {
    args.push("--mode", CONFIG.mode);
  }
  // Isolate edits in a temporary git worktree (edits stored under ~/.cursor/worktrees)
  if (CONFIG.worktree) {
    args.push("--worktree");
  }

  // Decide how to pass the prompt
  let tempFile = null;
  const useStdinPipe = prompt.length > CONFIG.maxArgLen;

  if (!useStdinPipe) {
    args.push(prompt);
  }

  const startTime = Date.now();
  const promptTokensEst = estimateTokens(prompt);
  console.log(
    `[${new Date().toISOString()}] ▶ Request ${requestId.slice(-8)}: stream=${stream}, prompt_len=${prompt.length}, est_tokens=${promptTokensEst}, method=${useStdinPipe ? "stdin-pipe" : "arg"}, model=${model}`
  );

  // Log the full cursor-cli command and prompt
  verboseLog(`${requestId.slice(-8)}:CURSOR_CMD`,
    `${CONFIG.cursorBin} ${args.map(a => a.includes(" ") ? `'${a}'` : a).join(" ")}`
    + (useStdinPipe ? `\n[prompt via stdin pipe]` : "")
  );
  verboseLog(`${requestId.slice(-8)}:PROMPT`, prompt);

  const spawnOpts = {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  };

  let proc;
  if (useStdinPipe) {
    tempFile = writeTempPrompt(prompt);
    const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const cmdStr = `cat "${tempFile}" | ${CONFIG.cursorBin} ${escapedArgs}`;
    proc = spawn("bash", ["-c", cmdStr], spawnOpts);
  } else {
    proc = spawn(CONFIG.cursorBin, args, spawnOpts);
  }

  let stderrOutput = "";
  let killed = false;

  // Usage tracking
  let thinkingChars = 0;
  let outputChars = 0;
  let toolCallCount = 0;
  let resultDurationMs = 0;
  let isError = false;
  let lineBuffer = "";

  // Timeout handler
  const timer = setTimeout(() => {
    killed = true;
    proc.kill("SIGTERM");
    console.warn(
      `[${new Date().toISOString()}] ⚠ Request ${requestId.slice(-8)}: timed out after ${CONFIG.timeoutMs / 1000}s`
    );
  }, CONFIG.timeoutMs);

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrOutput += text;
    verboseLog(`${requestId.slice(-8)}:CURSOR_STDERR`, text.trimEnd());
  });

  /**
   * Build usage object from tracked metrics
   */
  function buildUsage() {
    const thinkingTokens = estimateTokens(" ".repeat(thinkingChars)); // thinking text
    const outputTokens = estimateTokens(" ".repeat(outputChars));
    return {
      prompt_tokens: promptTokensEst,
      completion_tokens: outputTokens + thinkingTokens,
      total_tokens: promptTokensEst + outputTokens + thinkingTokens,
      // Extended fields for OpenClaw usage normalization
      thinking_tokens: thinkingTokens,
    };
  }

  if (stream) {
    // ── Streaming Response (SSE) ──
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Buffer for tool bridge mode — we need to collect full output to detect tool_calls
    let toolBridgeBuffer = "";
    // In tool bridge mode, collect raw segments for robust dedup on close.
    // In non-tool-bridge mode, use inline dedup with the accumulator.
    let assistantSegments = [];
    let assistantAccum = "";

    // Send role delta first
    const roleEvent = {
      id: requestId,
      object: "chat.completion.chunk",
      created,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(roleEvent)}\n\n`);

    // Process stdout as NDJSON lines
    proc.stdout.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      // Keep the last incomplete line in buffer
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        // Log each raw line from cursor-cli stdout (streaming mode)
        verboseLog(`${requestId.slice(-8)}:CURSOR_STDOUT`, line);

        let event;
        try {
          event = JSON.parse(line);
        } catch {
          // Not JSON — treat as raw text (fallback)
          outputChars += line.length;
          if (toolBridgeMode) {
            toolBridgeBuffer += line;
          } else {
            const textEvent = {
              id: requestId,
              object: "chat.completion.chunk",
              created,
              model: modelName,
              choices: [{ index: 0, delta: { content: line }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(textEvent)}\n\n`);
          }
          continue;
        }

        const type = event.type;
        const subtype = event.subtype;

        if (type === "thinking" && subtype === "delta") {
          // Track thinking tokens but don't send to OpenClaw
          // (OpenClaw handles thinking through the reasoning model config)
          thinkingChars += (event.text || "").length;
        } else if (type === "assistant") {
          // Extract text delta from assistant message
          const content = event.message?.content;
          let textChunk = "";
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === "text" && part.text) {
                textChunk += part.text;
              }
            }
          } else if (typeof content === "string" && content) {
            textChunk = content;
          }

          if (textChunk) {
            if (toolBridgeMode) {
              // Collect raw segments; dedup happens on close for robustness.
              assistantSegments.push(textChunk);
              console.log(
                `  [${requestId.slice(-8)}] assistant seg#${assistantSegments.length}: len=${textChunk.length} preview="${textChunk.slice(0, 80).replace(/\n/g, "\\n")}"`
              );
            } else {
              // Inline dedup for non-tool-bridge streaming
              let delta = textChunk;
              if (assistantAccum.length > 0 && textChunk === assistantAccum) {
                delta = "";
              } else if (assistantAccum.length > 0 && textChunk.startsWith(assistantAccum)) {
                delta = textChunk.slice(assistantAccum.length);
                assistantAccum = textChunk;
              } else {
                assistantAccum = textChunk;
              }
              if (delta) {
                outputChars += delta.length;
                const sseEvent = {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created,
                  model: modelName,
                  choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
                };
                res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);
              }
            }
          }
        } else if (type === "tool_call") {
          toolCallCount++;
          // Do NOT reset assistantAccum here. cursor-agent may re-emit
          // the same assistant text after internal tool calls (especially in
          // --mode ask where reads still emit tool_call events). Keeping the
          // accumulator intact allows the dedup logic to catch re-emitted text.
          if (subtype === "started") {
            const toolName = Object.keys(event.tool_call || {})[0] || "unknown";
            console.log(
              `  [${requestId.slice(-8)}] tool_call: ${toolName} (${event.call_id?.slice(-8) || "?"})`
            );
          }
        } else if (type === "result") {
          resultDurationMs = event.duration_ms || 0;
          isError = event.is_error || event.subtype === "error";
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      // Process any remaining data in buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          if (event.type === "result") {
            resultDurationMs = event.duration_ms || 0;
            isError = event.is_error || event.subtype === "error";
          }
        } catch {
          if (lineBuffer.trim()) {
            if (toolBridgeMode) {
              assistantSegments.push(lineBuffer);
            } else {
              const textEvent = {
                id: requestId,
                object: "chat.completion.chunk",
                created,
                model: modelName,
                choices: [{ index: 0, delta: { content: lineBuffer }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(textEvent)}\n\n`);
            }
            outputChars += lineBuffer.length;
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // In tool bridge mode, merge collected segments with dedup
      if (toolBridgeMode && assistantSegments.length > 0) {
        // Prepend any raw (non-JSON) text that was already buffered
        if (toolBridgeBuffer.trim()) {
          assistantSegments.unshift(toolBridgeBuffer);
        }
        toolBridgeBuffer = mergeAssistantSegments(assistantSegments);
        outputChars = toolBridgeBuffer.length;
        console.log(
          `  [${requestId.slice(-8)}] merged ${assistantSegments.length} segments → ${toolBridgeBuffer.length} chars`
        );
      }
      const usage = buildUsage();

      // In tool bridge mode, check if the buffered output contains tool_calls
      if (toolBridgeMode) {
        const parsedToolCalls = parseToolCalls(toolBridgeBuffer);
        if (parsedToolCalls.length > 0) {
          // Send a single chunk with tool_calls (non-incremental for simplicity)
          const toolChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: parsedToolCalls.map((tc, i) => ({
                  index: i,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: typeof tc.arguments === "string"
                      ? tc.arguments
                      : JSON.stringify(tc.arguments),
                  },
                })),
              },
              finish_reason: null,
            }],
          };
          res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);

          // Send finish with tool_calls reason
          const finishEvent = {
            id: requestId,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            usage,
          };
          res.write(`data: ${JSON.stringify(finishEvent)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();

          verboseLog(`${requestId.slice(-8)}:RESPONSE_STREAM`,
            `[tool_calls] ${parsedToolCalls.map((t) => t.name).join(",")} | usage=${JSON.stringify(usage)}`
          );
          console.log(
            `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (stream, tool_calls=${parsedToolCalls.map((t) => t.name).join(",")}, usage=${JSON.stringify(usage)})`
          );
          return;
        }
        // No tool calls found — send the buffered text as normal content
        const dedupedText = deduplicateBuffer(toolBridgeBuffer);
        if (dedupedText !== toolBridgeBuffer) {
          console.log(
            `  [${requestId.slice(-8)}] deduplicateBuffer: ${toolBridgeBuffer.length} → ${dedupedText.length} chars`
          );
        }
        if (dedupedText) {
          const textEvent = {
            id: requestId,
            object: "chat.completion.chunk",
            created,
            model: modelName,
            choices: [{ index: 0, delta: { content: dedupedText }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(textEvent)}\n\n`);
        }
      }

      // Send finish event with usage
      const finishEvent = {
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage,
      };
      res.write(`data: ${JSON.stringify(finishEvent)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();

      verboseLog(`${requestId.slice(-8)}:RESPONSE_STREAM`,
        `[stop] code=${code} | tools_invoked=${toolCallCount} | usage=${JSON.stringify(usage)}`
      );
      console.log(
        `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (stream, code=${code}, tools=${toolCallCount}, usage=${JSON.stringify(usage)})`
      );
      if (code !== 0 && stderrOutput) {
        console.error(`  stderr: ${stderrOutput.slice(0, 500)}`);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      const classified = classifyError(err, stderrOutput);
      console.error(
        `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: spawn error: ${err.message} → ${classified.type}`
      );

      try {
        // Send error in SSE format with proper error type
        res.write(
          `data: ${JSON.stringify({
            error: { message: classified.message, type: classified.type },
          })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        res.end();
      }
    });
  } else {
    // ── Non-Streaming Response ──
    let fullOutput = "";
    let assistantAccumNS = "";

    proc.stdout.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        // Log each raw line from cursor-cli stdout (non-streaming mode)
        verboseLog(`${requestId.slice(-8)}:CURSOR_STDOUT`, line);

        let event;
        try {
          event = JSON.parse(line);
        } catch {
          fullOutput += line;
          outputChars += line.length;
          continue;
        }

        const type = event.type;
        const subtype = event.subtype;

        if (type === "thinking" && subtype === "delta") {
          thinkingChars += (event.text || "").length;
        } else if (type === "assistant") {
          const content = event.message?.content;
          let textChunk = "";
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === "text" && part.text) {
                textChunk += part.text;
              }
            }
          } else if (typeof content === "string" && content) {
            textChunk = content;
          }
          if (textChunk) {
            let delta = textChunk;
            if (assistantAccumNS.length > 0 && textChunk === assistantAccumNS) {
              delta = "";
            } else if (assistantAccumNS.length > 0 && textChunk.startsWith(assistantAccumNS)) {
              delta = textChunk.slice(assistantAccumNS.length);
              assistantAccumNS = textChunk;
            } else {
              assistantAccumNS = textChunk;
            }
            if (delta) {
              fullOutput += delta;
              outputChars += delta.length;
            }
          }
        } else if (type === "tool_call") {
          toolCallCount++;
        } else if (type === "result") {
          resultDurationMs = event.duration_ms || 0;
          isError = event.is_error || event.subtype === "error";
          // Use result text if we haven't collected output yet
          if (!fullOutput && event.result) {
            fullOutput = event.result;
            outputChars = fullOutput.length;
          }
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      // Process remaining buffer
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          if (event.type === "result") {
            resultDurationMs = event.duration_ms || 0;
            if (!fullOutput && event.result) {
              fullOutput = event.result;
              outputChars = fullOutput.length;
            }
          }
        } catch {
          fullOutput += lineBuffer;
          outputChars += lineBuffer.length;
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0 && !fullOutput) {
        const classified = classifyError(null, stderrOutput);
        console.error(
          `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: failed in ${elapsed}s (code=${code}) → ${classified.type}`
        );
        sendError(res, classified.status, classified.message, classified.type);
        return;
      }

      const responseText = toolBridgeMode ? deduplicateBuffer(fullOutput) : fullOutput.trim();
      const usage = buildUsage();

      // Check if the model output contains <tool_call> blocks (Tool Bridge Mode)
      const parsedToolCalls = toolBridgeMode ? parseToolCalls(responseText) : [];
      const hasTools = parsedToolCalls.length > 0;

      let response;
      if (hasTools) {
        // Return as OpenAI tool_calls format
        response = {
          id: requestId,
          object: "chat.completion",
          created,
          model: modelName,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: parsedToolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: typeof tc.arguments === "string"
                      ? tc.arguments
                      : JSON.stringify(tc.arguments),
                  },
                })),
              },
              finish_reason: "tool_calls",
            },
          ],
          usage,
        };
        console.log(
          `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (non-stream, tool_calls=${parsedToolCalls.map((t) => t.name).join(",")}, usage=${JSON.stringify(usage)})`
        );
      } else {
        response = {
          id: requestId,
          object: "chat.completion",
          created,
          model: modelName,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: responseText,
              },
              finish_reason: "stop",
            },
          ],
          usage,
        };
        console.log(
          `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (non-stream, ${responseText.length} chars, tools=${toolCallCount}, usage=${JSON.stringify(usage)})`
        );
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      verboseLog(`${requestId.slice(-8)}:RESPONSE_BODY`, response);
      res.end(JSON.stringify(response));
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      const classified = classifyError(err, stderrOutput);
      console.error(
        `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: spawn error: ${err.message} → ${classified.type}`
      );
      sendError(res, classified.status, classified.message, classified.type);
    });
  }

  // Close stdin if not piping (when using stdin pipe, bash handles this)
  if (!useStdinPipe) {
    proc.stdin.end();
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${CONFIG.host}:${CONFIG.port}`);

  // ── Health check ──
  if (
    (url.pathname === "/health" || url.pathname === "/") &&
    req.method === "GET"
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "cursor-bridge",
        version: "1.1.0",
        model: CONFIG.cursorModel,
        mode: CONFIG.mode || "agent",
        outputFormat: "stream-json",
      })
    );
    return;
  }

  // ── GET /v1/models  or  GET /v1/cursor-models ──
  if (
    (url.pathname === "/v1/models" || url.pathname === "/v1/cursor-models") &&
    req.method === "GET"
  ) {
    const models = await probeAvailableModels();
    const now = Math.floor(Date.now() / 1000);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        object: "list",
        data: models.map((id) => ({
          id,
          object: "model",
          created: now,
          owned_by: "cursor",
        })),
      })
    );
    return;
  }

  // ── POST /v1/chat/completions ──
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      sendError(res, 400, "Failed to read request body");
      return;
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      sendError(res, 400, "Invalid JSON in request body", "invalid_request");
      return;
    }

    const messages = data.messages || [];
    const stream = data.stream === true;
    const tools = data.tools || [];

    // Log full request params
    verboseLog("REQUEST_PARAMS", {
      model: data.model,
      stream,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      tools_count: tools.length,
      messages_count: messages.length,
      messages,
      ...(tools.length ? { tools } : {}),
    });

    if (!messages.length) {
      sendError(res, 400, "No messages provided", "invalid_request");
      return;
    }

    // Convert messages to prompt, including tools reference
    const prompt = messagesToPrompt(messages, tools);
    if (!prompt.trim()) {
      sendError(res, 400, "Empty prompt after processing messages", "invalid_request");
      return;
    }

    if (tools.length) {
      const nativeCount = tools.filter((t) => CURSOR_NATIVE_TOOLS.has(t?.function?.name || t?.name)).length;
      const extraCount = tools.length - nativeCount;
      console.log(
        `  [tools] ${tools.length} total (${nativeCount} native, ${extraCount} injected into prompt)`
      );
    }

    runCursorAgent(prompt, data.model, stream, res, tools);
    return;
  }

  // ── 404 ──
  sendError(res, 404, `Unknown endpoint: ${req.method} ${url.pathname}`, "not_found");
});

// ─── Start ───────────────────────────────────────────────────────

server.listen(CONFIG.port, CONFIG.host, () => {
  const modeLabel = CONFIG.mode || "agent (full capabilities)";
  const logPath = join(LOG_DIR, `cursor-bridge.${todayStamp()}.log`);
  const authLabel = process.env.CURSOR_API_KEY
    ? "CURSOR_API_KEY"
    : process.env.CURSOR_AUTH_TOKEN
    ? "CURSOR_AUTH_TOKEN"
    : "cursor agent login";
  console.log(`
┌──────────────────────────────────────────────────────────┐
│              cursor-bridge v1.4.0                        │
│    OpenAI-compatible API  →  Cursor CLI Agent            │
├──────────────────────────────────────────────────────────┤
│  Endpoint:   http://${CONFIG.host}:${CONFIG.port}/v1/chat/completions  │
│  Model:      ${CONFIG.cursorModel.padEnd(43)}│
│  Mode:       ${modeLabel.padEnd(43)}│
│  Worktree:   ${(CONFIG.worktree ? "enabled" : "disabled").padEnd(43)}│
│  Auth:       ${authLabel.padEnd(43)}│
│  Workspace:  ${CONFIG.workspace.slice(-43).padEnd(43)}│
│  Timeout:    ${(CONFIG.timeoutMs / 1000 + "s").padEnd(43)}│
│  Log:        ${logPath.slice(-43).padEnd(43)}│
│  Verbose:    ${(CONFIG.verbose ? "on (BRIDGE_VERBOSE=false to disable)" : "off").padEnd(43)}│
│  Output:     stream-json + stream-partial-output         │
│  MaxArgLen:  ${(CONFIG.maxArgLen + " chars").padEnd(43)}│
└──────────────────────────────────────────────────────────┘
  `);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `✗ Port ${CONFIG.port} is already in use. Set BRIDGE_PORT to use a different port.`
    );
  } else {
    console.error(`✗ Server error: ${err.message}`);
  }
  process.exit(1);
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n[cursor-bridge] Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000);
  });
}
