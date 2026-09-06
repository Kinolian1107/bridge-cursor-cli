// Unit tests for the Anthropic /v1/messages compatibility layer.
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anthropicToOpenAI,
  openAIResponseToAnthropic,
  openAIErrorToAnthropic,
  createAnthropicStreamTranslator,
  createAnthropicResponseAdapter,
} from "../lib/anthropic-compat.mjs";

// ─── anthropicToOpenAI ───────────────────────────────────────────

test("converts string system prompt to a system message", () => {
  const o = anthropicToOpenAI({
    model: "auto",
    system: "Be terse.",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.deepEqual(o.messages[0], { role: "system", content: "Be terse." });
  assert.deepEqual(o.messages[1], { role: "user", content: "hi" });
});

test("converts block-array system prompt to a system message", () => {
  const o = anthropicToOpenAI({
    system: [{ type: "text", text: "A" }, { type: "text", text: "B" }],
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(o.messages[0].role, "system");
  assert.equal(o.messages[0].content, "A\nB");
});

test("converts user content block arrays to plain text", () => {
  const o = anthropicToOpenAI({
    messages: [
      { role: "user", content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }] },
    ],
  });
  assert.deepEqual(o.messages, [{ role: "user", content: "line1\nline2" }]);
});

test("converts assistant tool_use blocks to OpenAI tool_calls", () => {
  const o = anthropicToOpenAI({
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Taipei" } },
        ],
      },
    ],
  });
  const asst = o.messages[1];
  assert.equal(asst.role, "assistant");
  assert.equal(asst.content, "checking");
  assert.equal(asst.tool_calls.length, 1);
  assert.equal(asst.tool_calls[0].id, "toolu_1");
  assert.equal(asst.tool_calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(asst.tool_calls[0].function.arguments), { city: "Taipei" });
});

test("converts user tool_result blocks to role:tool messages", () => {
  const o = anthropicToOpenAI({
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "sunny" },
          { type: "text", text: "and now?" },
        ],
      },
    ],
  });
  assert.deepEqual(o.messages[0], { role: "tool", tool_call_id: "toolu_1", content: "sunny" });
  assert.deepEqual(o.messages[1], { role: "user", content: "and now?" });
});

test("converts tool_result with block-array content", () => {
  const o = anthropicToOpenAI({
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "result text" }] },
        ],
      },
    ],
  });
  assert.equal(o.messages[0].content, "result text");
});

test("converts Anthropic tools to OpenAI function tools", () => {
  const o = anthropicToOpenAI({
    messages: [{ role: "user", content: "x" }],
    tools: [
      {
        name: "search",
        description: "Search the web",
        input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
    ],
  });
  assert.equal(o.tools.length, 1);
  assert.equal(o.tools[0].type, "function");
  assert.equal(o.tools[0].function.name, "search");
  assert.equal(o.tools[0].function.parameters.required[0], "q");
});

test("passes through stream flag and metadata", () => {
  const o = anthropicToOpenAI({
    messages: [{ role: "user", content: "x" }],
    stream: true,
    metadata: { cursor_mode: "ask" },
  });
  assert.equal(o.stream, true);
  assert.deepEqual(o.metadata, { cursor_mode: "ask" });
});

test("preserves Anthropic image / audio / video / document blocks as OpenAI parts", () => {
  const o = anthropicToOpenAI({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "describe these" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aaa" } },
        { type: "audio", source: { type: "base64", media_type: "audio/wav", data: "bbb" } },
        { type: "video", source: { type: "url", url: "https://x.test/c.mp4" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "ccc" }, filename: "note.pdf" },
      ],
    }],
  });
  const parts = o.messages[0].content;
  assert.equal(o.messages[0].role, "user");
  assert.deepEqual(parts[0], { type: "text", text: "describe these" });
  assert.equal(parts[1].type, "image_url");
  assert.equal(parts[1].image_url.url, "data:image/png;base64,aaa");
  assert.equal(parts[2].type, "input_audio");
  assert.equal(parts[2].input_audio.data, "bbb");
  assert.equal(parts[3].type, "video_url");
  assert.equal(parts[3].video_url.url, "https://x.test/c.mp4");
  assert.equal(parts[4].type, "file");
  assert.equal(parts[4].file.filename, "note.pdf");
});

test("preserves interleaved text and image order", () => {
  const o = anthropicToOpenAI({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "before" },
        { type: "image", source: { type: "url", url: "https://x.test/a.png" } },
        { type: "text", text: "after" },
      ],
    }],
  });
  const parts = o.messages[0].content;
  assert.equal(parts[0].text, "before");
  assert.equal(parts[1].type, "image_url");
  assert.equal(parts[2].text, "after");
});

test("Anthropic text documents become user text, not base64 files", () => {
  const o = anthropicToOpenAI({
    messages: [{
      role: "user",
      content: [{ type: "document", source: { type: "text", data: "plain notes" } }],
    }],
  });
  assert.deepEqual(o.messages, [{ role: "user", content: "plain notes" }]);
});

test("image-only Anthropic user message still produces a user message", () => {
  const o = anthropicToOpenAI({
    messages: [{
      role: "user",
      content: [{ type: "image", source: { type: "url", url: "https://x.test/a.png" } }],
    }],
  });
  assert.equal(o.messages.length, 1);
  assert.equal(o.messages[0].role, "user");
  assert.equal(o.messages[0].content[0].type, "image_url");
});

test("ignores unknown roles and empty bodies safely", () => {
  const o = anthropicToOpenAI({ messages: [{ role: "weird", content: "x" }] });
  assert.equal(o.messages.length, 0);
  assert.equal(anthropicToOpenAI({}).messages.length, 0);
});

// ─── openAIResponseToAnthropic ───────────────────────────────────

test("converts a text completion to an Anthropic message", () => {
  const a = openAIResponseToAnthropic(
    {
      id: "chatcmpl-abc123",
      model: "cursor/auto",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
    "claude-test"
  );
  assert.equal(a.id, "msg_abc123");
  assert.equal(a.type, "message");
  assert.equal(a.role, "assistant");
  assert.equal(a.model, "claude-test");
  assert.deepEqual(a.content, [{ type: "text", text: "hello" }]);
  assert.equal(a.stop_reason, "end_turn");
  assert.deepEqual(a.usage, { input_tokens: 10, output_tokens: 5 });
});

test("converts tool_calls completion to tool_use blocks with stop_reason tool_use", () => {
  const a = openAIResponseToAnthropic({
    id: "chatcmpl-x",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "ls", arguments: '{"path":"."}' } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  });
  assert.equal(a.stop_reason, "tool_use");
  assert.deepEqual(a.content, [{ type: "tool_use", id: "call_1", name: "ls", input: { path: "." } }]);
});

test("preserves unparseable tool arguments as _raw_arguments", () => {
  const a = openAIResponseToAnthropic({
    choices: [
      {
        message: {
          role: "assistant",
          tool_calls: [{ id: "c", function: { name: "f", arguments: "not json" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
  assert.deepEqual(a.content[0].input, { _raw_arguments: "not json" });
});

// ─── openAIErrorToAnthropic ──────────────────────────────────────

test("maps bridge error types to Anthropic error types", () => {
  assert.equal(
    openAIErrorToAnthropic({ error: { message: "bad", type: "invalid_request" } }).error.type,
    "invalid_request_error"
  );
  assert.equal(
    openAIErrorToAnthropic({ error: { message: "x", type: "rate_limit" } }).error.type,
    "rate_limit_error"
  );
  const unknown = openAIErrorToAnthropic({ error: { message: "x", type: "whatever" } });
  assert.equal(unknown.type, "error");
  assert.equal(unknown.error.type, "api_error");
});

// ─── createAnthropicStreamTranslator ─────────────────────────────

function parseSse(strings) {
  // "event: X\ndata: {...}\n\n" → [{event, data}]
  return strings.map((s) => {
    const event = s.match(/^event: (.+)$/m)[1];
    const data = JSON.parse(s.match(/^data: (.+)$/m)[1]);
    return { event, data };
  });
}

test("translates a text stream into Anthropic SSE event sequence", () => {
  const t = createAnthropicStreamTranslator({ model: "claude-test" });
  const events = [
    ...t.translate({ id: "chatcmpl-1", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    ...t.translate({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "hel" }, finish_reason: null }] }),
    ...t.translate({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] }),
    ...t.translate({ id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  ];
  const parsed = parseSse(events);
  assert.deepEqual(
    parsed.map((e) => e.event),
    ["message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]
  );
  assert.equal(parsed[0].data.message.id, "msg_1");
  assert.equal(parsed[0].data.message.model, "claude-test");
  assert.equal(parsed[2].data.delta.text, "hel");
  assert.equal(parsed[3].data.delta.text, "lo");
  assert.equal(parsed[5].data.delta.stop_reason, "end_turn");
  assert.equal(parsed[5].data.usage.output_tokens, 2);
});

test("translates tool_calls chunk into tool_use blocks with stop_reason tool_use", () => {
  const t = createAnthropicStreamTranslator({});
  const events = [
    ...t.translate({ id: "chatcmpl-2", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    ...t.translate({
      id: "chatcmpl-2",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "ls", arguments: '{"a":1}' } }],
        },
        finish_reason: null,
      }],
    }),
    ...t.translate({ id: "chatcmpl-2", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  ];
  const parsed = parseSse(events);
  const names = parsed.map((e) => e.event);
  assert.deepEqual(names, ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  assert.equal(parsed[1].data.content_block.type, "tool_use");
  assert.equal(parsed[1].data.content_block.name, "ls");
  assert.equal(parsed[2].data.delta.type, "input_json_delta");
  assert.equal(parsed[2].data.delta.partial_json, '{"a":1}');
  assert.equal(parsed[4].data.delta.stop_reason, "tool_use");
});

test("finish() closes an unterminated stream cleanly", () => {
  const t = createAnthropicStreamTranslator({});
  t.translate({ id: "chatcmpl-3", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] });
  const parsed = parseSse(t.finish());
  assert.deepEqual(parsed.map((e) => e.event), ["content_block_stop", "message_delta", "message_stop"]);
  assert.deepEqual(parseSse(t.finish()), []); // idempotent
});

test("translates error chunks into an error event", () => {
  const t = createAnthropicStreamTranslator({});
  const parsed = parseSse(t.translate({ error: { message: "boom", type: "upstream_error" } }));
  assert.equal(parsed[0].event, "error");
  assert.equal(parsed[0].data.error.type, "api_error");
  assert.equal(parsed[0].data.error.message, "boom");
});

// ─── createAnthropicResponseAdapter ──────────────────────────────

function fakeRes() {
  return {
    status: null,
    headers: null,
    chunks: [],
    ended: false,
    writeHead(s, h) { this.status = s; this.headers = h; },
    write(c) { this.chunks.push(c.toString()); return true; },
    end(c) { if (c) this.chunks.push(c.toString()); this.ended = true; },
  };
}

test("adapter rewrites a non-streaming completion to Anthropic JSON", () => {
  const res = fakeRes();
  const adapter = createAnthropicResponseAdapter(res, { model: "claude-test" });
  adapter.writeHead(200, { "Content-Type": "application/json" });
  adapter.end(JSON.stringify({
    id: "chatcmpl-z",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  }));
  assert.equal(res.status, 200);
  assert.ok(res.ended);
  const body = JSON.parse(res.chunks.join(""));
  assert.equal(body.type, "message");
  assert.equal(body.model, "claude-test");
  assert.deepEqual(body.content, [{ type: "text", text: "hi" }]);
});

test("adapter rewrites error responses to Anthropic error shape", () => {
  const res = fakeRes();
  const adapter = createAnthropicResponseAdapter(res, {});
  adapter.writeHead(400, { "Content-Type": "application/json" });
  adapter.end(JSON.stringify({ error: { message: "nope", type: "invalid_request" } }));
  const body = JSON.parse(res.chunks.join(""));
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "invalid_request_error");
});

test("adapter rewrites an SSE stream, dropping [DONE] and emitting message_stop", () => {
  const res = fakeRes();
  const adapter = createAnthropicResponseAdapter(res, { model: "m" });
  adapter.writeHead(200, { "Content-Type": "text/event-stream" });
  adapter.write(`data: ${JSON.stringify({ id: "chatcmpl-7", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);
  adapter.write(`data: ${JSON.stringify({ id: "chatcmpl-7", choices: [{ index: 0, delta: { content: "yo" }, finish_reason: null }] })}\n\n`);
  adapter.write(`data: ${JSON.stringify({ id: "chatcmpl-7", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
  adapter.write("data: [DONE]\n\n");
  adapter.end();
  const all = res.chunks.join("");
  assert.ok(all.includes("event: message_start"));
  assert.ok(all.includes('"text":"yo"'));
  assert.ok(all.includes("event: message_stop"));
  assert.ok(!all.includes("[DONE]"));
  assert.ok(res.ended);
});

test("adapter handles SSE events split across write() calls", () => {
  const res = fakeRes();
  const adapter = createAnthropicResponseAdapter(res, {});
  adapter.writeHead(200, { "Content-Type": "text/event-stream" });
  const event = `data: ${JSON.stringify({ id: "chatcmpl-8", choices: [{ index: 0, delta: { content: "split" }, finish_reason: null }] })}\n\n`;
  adapter.write(event.slice(0, 20));
  adapter.write(event.slice(20));
  adapter.end();
  const all = res.chunks.join("");
  assert.ok(all.includes('"text":"split"'));
});
