// Anthropic Messages API (/v1/messages) compatibility layer. Pure — no I/O.
//
// Strategy: translate at the edges so the existing OpenAI pipeline stays untouched.
//   request:  Anthropic Messages body ──anthropicToOpenAI()──► OpenAI chat body
//   response: runCursorAgent writes OpenAI JSON/SSE into a res-like adapter
//             (createAnthropicResponseAdapter) that rewrites it to Anthropic shape.
//
// This unlocks the Anthropic SDK and Claude Code itself (ANTHROPIC_BASE_URL →
// bridge) as consumers of Cursor models.

const STOP_REASON_MAP = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "max_tokens",
};

// Bridge-internal error types (classifyError/sendError) → Anthropic error types.
const ERROR_TYPE_MAP = {
  invalid_request: "invalid_request_error",
  context_overflow: "invalid_request_error",
  auth: "authentication_error",
  rate_limit: "rate_limit_error",
  not_found: "not_found_error",
  timeout: "api_error",
  upstream_error: "api_error",
  internal_error: "api_error",
};

/** Flatten an Anthropic content value (string | block array) to plain text. */
function blocksToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Convert an Anthropic Messages request body to the OpenAI chat-completions
 * shape consumed by the existing bridge pipeline.
 *
 * Mappings:
 *   system (string | block array)      → leading {role:"system"} message
 *   assistant tool_use blocks          → assistant message with tool_calls
 *   user tool_result blocks            → {role:"tool"} messages
 *   tools[{name,description,input_schema}] → [{type:"function",function:{…}}]
 */
export function anthropicToOpenAI(body) {
  const messages = [];

  const systemText = blocksToText(body?.system);
  if (systemText.trim()) {
    messages.push({ role: "system", content: systemText });
  }

  for (const msg of body?.messages || []) {
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    if (msg.role === "assistant") {
      const text = blocksToText(msg.content);
      const toolUses = msg.content.filter((b) => b?.type === "tool_use");
      if (toolUses.length) {
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((tu) => ({
            id: tu.id || "",
            type: "function",
            function: {
              name: tu.name || "",
              arguments: JSON.stringify(tu.input || {}),
            },
          })),
        });
      } else if (text) {
        messages.push({ role: "assistant", content: text });
      }
      continue;
    }

    // user message — tool_result blocks become role:"tool" messages first
    // (they answer the preceding assistant tool_calls), then any text.
    for (const block of msg.content) {
      if (block?.type === "tool_result") {
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id || "unknown",
          content: blocksToText(block.content),
        });
      }
    }
    const text = blocksToText(msg.content);
    if (text) {
      messages.push({ role: "user", content: text });
    }
  }

  const tools = (body?.tools || [])
    .filter((t) => t?.name)
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));

  return {
    model: body?.model,
    messages,
    tools,
    stream: body?.stream === true,
    max_tokens: body?.max_tokens,
    temperature: body?.temperature,
    // Pass metadata through so cursor_* per-request options keep working.
    metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
  };
}

/** Convert an OpenAI chat.completion response to an Anthropic message. */
export function openAIResponseToAnthropic(resp, requestedModel) {
  const choice = resp?.choices?.[0] || {};
  const msg = choice.message || {};

  const content = [];
  if (typeof msg.content === "string" && msg.content) {
    content.push({ type: "text", text: msg.content });
  }
  for (const tc of msg.tool_calls || []) {
    const fn = tc.function || {};
    let input = {};
    try {
      input = JSON.parse(fn.arguments || "{}");
    } catch {
      input = { _raw_arguments: fn.arguments };
    }
    content.push({ type: "tool_use", id: tc.id || "", name: fn.name || "", input });
  }

  return {
    id: String(resp?.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "msg_"),
    type: "message",
    role: "assistant",
    model: requestedModel || resp?.model || "cursor",
    content,
    stop_reason: STOP_REASON_MAP[choice.finish_reason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: resp?.usage?.prompt_tokens ?? 0,
      output_tokens: resp?.usage?.completion_tokens ?? 0,
    },
  };
}

/** Convert an OpenAI-shaped error body to an Anthropic error body. */
export function openAIErrorToAnthropic(errBody) {
  const e = errBody?.error || {};
  return {
    type: "error",
    error: {
      type: ERROR_TYPE_MAP[e.type] || "api_error",
      message: e.message || "Unknown error",
    },
  };
}

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Stateful translator: OpenAI chat.completion.chunk objects → Anthropic SSE
 * event strings (message_start / content_block_* / message_delta / message_stop).
 *
 * translate(chunk) returns the SSE strings to emit for that chunk;
 * finish() flushes a well-formed ending if the stream stopped early.
 */
export function createAnthropicStreamTranslator({ model } = {}) {
  let started = false;
  let finished = false;
  let textBlockOpen = false;
  let blockIndex = 0;

  function emitStart(chunk, out) {
    if (started) return;
    started = true;
    const msgId = String(chunk.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "msg_");
    out.push(
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          model: model || chunk.model || "cursor",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })
    );
  }

  function openTextBlock(out) {
    if (textBlockOpen) return;
    textBlockOpen = true;
    out.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: blockIndex,
        content_block: { type: "text", text: "" },
      })
    );
  }

  function closeTextBlock(out) {
    if (!textBlockOpen) return;
    textBlockOpen = false;
    out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: blockIndex }));
    blockIndex++;
  }

  function emitEnd(out, finishReason, usage) {
    closeTextBlock(out);
    out.push(
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: STOP_REASON_MAP[finishReason] || "end_turn", stop_sequence: null },
        usage: {
          input_tokens: usage?.prompt_tokens ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
        },
      })
    );
    out.push(sseEvent("message_stop", { type: "message_stop" }));
    finished = true;
  }

  return {
    translate(chunk) {
      const out = [];
      if (finished || !chunk || typeof chunk !== "object") return out;

      if (chunk.error) {
        out.push(sseEvent("error", openAIErrorToAnthropic(chunk)));
        finished = true;
        return out;
      }

      emitStart(chunk, out);
      const choice = chunk.choices?.[0];
      const delta = choice?.delta || {};

      if (typeof delta.content === "string" && delta.content) {
        openTextBlock(out);
        out.push(
          sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "text_delta", text: delta.content },
          })
        );
      }

      // The bridge emits tool_calls as one complete chunk (non-incremental),
      // so each entry maps to a full tool_use block.
      if (Array.isArray(delta.tool_calls)) {
        closeTextBlock(out);
        for (const tc of delta.tool_calls) {
          const fn = tc.function || {};
          out.push(
            sseEvent("content_block_start", {
              type: "content_block_start",
              index: blockIndex,
              content_block: { type: "tool_use", id: tc.id || `toolu_${blockIndex}`, name: fn.name || "", input: {} },
            })
          );
          out.push(
            sseEvent("content_block_delta", {
              type: "content_block_delta",
              index: blockIndex,
              delta: { type: "input_json_delta", partial_json: fn.arguments || "{}" },
            })
          );
          out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: blockIndex }));
          blockIndex++;
        }
      }

      if (choice?.finish_reason) {
        emitEnd(out, choice.finish_reason, chunk.usage);
      }
      return out;
    },

    finish() {
      const out = [];
      if (finished || !started) return out;
      emitEnd(out, "stop", null);
      return out;
    },
  };
}

/**
 * Wrap the real HTTP response in a res-like object that translates the
 * OpenAI output written by runCursorAgent/sendError into Anthropic shape.
 * Only the three methods the pipeline uses are implemented:
 * writeHead / write / end.
 */
export function createAnthropicResponseAdapter(res, { model } = {}) {
  let mode = null; // "stream" | "json"
  let statusCode = 200;
  let jsonBuffer = "";
  let sseBuffer = "";
  let translator = null;

  function translateSse(chunk) {
    sseBuffer += chunk.toString();
    let idx;
    while ((idx = sseBuffer.indexOf("\n\n")) !== -1) {
      const raw = sseBuffer.slice(0, idx).trim();
      sseBuffer = sseBuffer.slice(idx + 2);
      if (!raw.startsWith("data:")) continue;
      const payload = raw.slice(5).trim();
      if (payload === "[DONE]") continue; // translator emits message_stop itself
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      for (const out of translator.translate(obj)) res.write(out);
    }
  }

  return {
    writeHead(status, headers = {}) {
      statusCode = status;
      const contentType = headers["Content-Type"] || headers["content-type"] || "";
      mode = contentType.includes("text/event-stream") ? "stream" : "json";
      if (mode === "stream") {
        translator = createAnthropicStreamTranslator({ model });
      }
      res.writeHead(status, headers);
      return this;
    },

    write(chunk) {
      if (mode === "stream") {
        translateSse(chunk);
      } else {
        jsonBuffer += chunk.toString();
      }
      return true;
    },

    end(chunk) {
      if (mode === "stream") {
        if (chunk) translateSse(chunk);
        for (const out of translator.finish()) res.write(out);
        res.end();
        return;
      }
      if (chunk) jsonBuffer += chunk.toString();
      if (!jsonBuffer) {
        res.end();
        return;
      }
      let out = jsonBuffer;
      try {
        const parsed = JSON.parse(jsonBuffer);
        out = JSON.stringify(
          parsed.error || statusCode >= 400
            ? openAIErrorToAnthropic(parsed)
            : openAIResponseToAnthropic(parsed, model)
        );
      } catch {
        // Not JSON — pass through untouched rather than swallow the body.
      }
      res.end(out);
    },
  };
}
