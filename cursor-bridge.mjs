#!/usr/bin/env node
/**
 * cursor-bridge — OpenAI-compatible API proxy for Cursor CLI
 *
 * Architecture:
 *   OpenClaw  ──(OpenAI API)──►  cursor-bridge (port 18790)  ──►  cursor agent --print
 *
 * This proxy server allows OpenClaw to call Cursor CLI AI models
 * (e.g. Claude 4.6 Opus Thinking) via an OpenAI-compatible API interface.
 *
 * Zero dependencies — uses only Node.js built-in modules.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  port: parseInt(process.env.BRIDGE_PORT || "18790"),
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  cursorModel: process.env.CURSOR_MODEL || "opus-4.6-thinking",
  cursorBin: process.env.CURSOR_BIN || "cursor",
  workspace:
    process.env.CURSOR_WORKSPACE ||
    `${process.env.HOME}/.openclaw/workspace`,
  // 'ask' = read-only Q&A, 'plan' = read-only planning, '' = full agent
  mode: process.env.CURSOR_MODE || "",
  timeoutMs: parseInt(process.env.BRIDGE_TIMEOUT_MS || "300000"), // 5 min
  // Maximum prompt length to pass as CLI argument; beyond this, uses temp file
  maxArgLen: 131072,
};

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract text content from an OpenAI message content field.
 * Handles both string and array-of-content-parts formats.
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
 * Convert OpenAI chat messages array to a single prompt string for Cursor CLI.
 *
 * Strategy:
 *  - Single user message → pass as-is
 *  - System + user → prepend system instructions
 *  - Multi-turn → format with conversation history
 */
function messagesToPrompt(messages) {
  if (!messages?.length) return "";

  const systemMsgs = messages.filter((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  // Simple case: single user message, no system prompt
  if (
    conversationMsgs.length === 1 &&
    conversationMsgs[0].role === "user" &&
    !systemMsgs.length
  ) {
    return getContent(conversationMsgs[0]);
  }

  let prompt = "";

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
      const role = msg.role === "user" ? "User" : "Assistant";
      prompt += `${role}: ${getContent(msg)}\n\n`;
    }
    prompt += "</conversation_history>\n\n";
  }

  // Current (latest) message
  const lastMsg = conversationMsgs[conversationMsgs.length - 1];
  if (lastMsg) {
    if (conversationMsgs.length > 1) {
      prompt +=
        "Please respond to the following message based on the system instructions and conversation history above. Respond directly.\n\n";
    }
    prompt += getContent(lastMsg);
  }

  return prompt;
}

/** Write a long prompt to a temp file. Caller is responsible for cleanup. */
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
    unlinkSync(dir);
  } catch {
    // ignore cleanup errors
  }
}

/** Read the full request body as a string. */
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

/** Send a JSON error response. */
function sendError(res, status, message, type = "internal_error") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ error: { message, type } }));
}

// ─── Core: Cursor Agent Runner ───────────────────────────────────

function runCursorAgent(prompt, requestModel, stream, res) {
  const requestId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = CONFIG.cursorModel;
  const modelName = `cursor/${model}`;

  // Build cursor agent arguments.
  // 'cursor' wrapper needs 'agent' subcommand; 'cursor-agent' binary does not.
  const isDirectAgent = CONFIG.cursorBin.includes("cursor-agent");
  const args = isDirectAgent
    ? ["--print", "--force"]
    : ["agent", "--print", "--force"];
  args.push("--model", model);
  args.push("--output-format", "text");
  args.push("--workspace", CONFIG.workspace);

  if (CONFIG.mode) {
    args.push("--mode", CONFIG.mode);
  }

  // Handle long prompts via temp file + shell expansion
  let tempFile = null;
  if (prompt.length > CONFIG.maxArgLen) {
    tempFile = writeTempPrompt(prompt);
    args.push("$(cat '" + tempFile + "')");
  } else {
    args.push(prompt);
  }

  const startTime = Date.now();
  console.log(
    `[${new Date().toISOString()}] ▶ Request ${requestId.slice(-8)}: stream=${stream}, prompt_len=${prompt.length}, model=${model}`
  );

  const spawnOpts = {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  };

  // If using temp file, need shell to expand $(cat ...)
  let proc;
  if (tempFile) {
    const cmdStr = [CONFIG.cursorBin, ...args].join(" ");
    proc = spawn("bash", ["-c", cmdStr], spawnOpts);
  } else {
    proc = spawn(CONFIG.cursorBin, args, spawnOpts);
  }

  let stderrOutput = "";
  let killed = false;

  // Timeout handler
  const timer = setTimeout(() => {
    killed = true;
    proc.kill("SIGTERM");
    console.warn(
      `[${new Date().toISOString()}] ⚠ Request ${requestId.slice(-8)}: timed out after ${CONFIG.timeoutMs / 1000}s`
    );
  }, CONFIG.timeoutMs);

  proc.stderr.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });

  if (stream) {
    // ── Streaming Response (SSE) ──
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial role delta
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

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const event = {
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            delta: { content: text },
            finish_reason: null,
          },
        ],
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const finishEvent = {
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      res.write(`data: ${JSON.stringify(finishEvent)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();

      console.log(
        `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (stream, code=${code})`
      );
      if (code !== 0 && stderrOutput) {
        console.error(`  stderr: ${stderrOutput.slice(0, 500)}`);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);
      console.error(
        `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: spawn error: ${err.message}`
      );
      try {
        res.write(
          `data: ${JSON.stringify({ error: { message: err.message } })}\n\n`
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

    proc.stdout.on("data", (chunk) => {
      fullOutput += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0 && !fullOutput) {
        console.error(
          `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: failed in ${elapsed}s (code=${code})`
        );
        sendError(
          res,
          502,
          `Cursor agent exited with code ${code}: ${stderrOutput.slice(0, 500)}`,
          "upstream_error"
        );
        return;
      }

      const responseText = fullOutput.trim();
      const response = {
        id: requestId,
        object: "chat.completion",
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: responseText },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(responseText.length / 4),
          total_tokens: Math.ceil((prompt.length + responseText.length) / 4),
        },
      };

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(response));

      console.log(
        `[${new Date().toISOString()}] ✓ Request ${requestId.slice(-8)}: completed in ${elapsed}s (non-stream, ${responseText.length} chars)`
      );
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (tempFile) cleanupTempFile(tempFile);
      console.error(
        `[${new Date().toISOString()}] ✗ Request ${requestId.slice(-8)}: spawn error: ${err.message}`
      );
      sendError(res, 500, `Failed to start cursor agent: ${err.message}`);
    });
  }

  proc.stdin.end();
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
        model: CONFIG.cursorModel,
        mode: CONFIG.mode || "agent",
      })
    );
    return;
  }

  // ── GET /v1/models ──
  if (url.pathname === "/v1/models" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: `cursor/${CONFIG.cursorModel}`,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor",
          },
        ],
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

    if (!messages.length) {
      sendError(res, 400, "No messages provided", "invalid_request");
      return;
    }

    const prompt = messagesToPrompt(messages);
    if (!prompt.trim()) {
      sendError(
        res,
        400,
        "Empty prompt after processing messages",
        "invalid_request"
      );
      return;
    }

    runCursorAgent(prompt, data.model, stream, res);
    return;
  }

  // ── 404 ──
  sendError(
    res,
    404,
    `Unknown endpoint: ${req.method} ${url.pathname}`,
    "not_found"
  );
});

// ─── Start ───────────────────────────────────────────────────────

server.listen(CONFIG.port, CONFIG.host, () => {
  const modeLabel = CONFIG.mode || "agent (full capabilities)";
  console.log(`
┌──────────────────────────────────────────────────────────┐
│              cursor-bridge v1.0.0                        │
│    OpenAI-compatible API  →  Cursor CLI Agent            │
├──────────────────────────────────────────────────────────┤
│  Endpoint:   http://${CONFIG.host}:${CONFIG.port}/v1/chat/completions  │
│  Model:      ${CONFIG.cursorModel.padEnd(43)}│
│  Mode:       ${modeLabel.padEnd(43)}│
│  Workspace:  ${CONFIG.workspace.slice(-43).padEnd(43)}│
│  Timeout:    ${(CONFIG.timeoutMs / 1000 + "s").padEnd(43)}│
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
    setTimeout(() => process.exit(1), 5000);
  });
}
