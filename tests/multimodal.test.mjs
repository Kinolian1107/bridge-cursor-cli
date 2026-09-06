// Unit tests for multimodal input materialization (lib/multimodal.mjs).
// Run: npm test (node --test)

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MediaError,
  assertSafeMediaUrl,
  classifyMediaPart,
  contentPartToText,
  inspectMediaUrl,
  kindFromMime,
  mediaPromptSection,
  parseDataUri,
  parsePositiveInt,
  prepareRequestMedia,
  redactMessagesForLog,
  safeFilename,
} from "../lib/multimodal.mjs";

const publicLookup = async () => ({ address: "1.1.1.1", family: 4 });

const PNG_B64 = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

test("kindFromMime maps image/audio/video/other", () => {
  assert.equal(kindFromMime("image/png"), "image");
  assert.equal(kindFromMime("audio/wav"), "audio");
  assert.equal(kindFromMime("video/mp4"), "video");
  assert.equal(kindFromMime("application/pdf"), "file");
});

test("parseDataUri extracts mime and payload", () => {
  const parsed = parseDataUri(`data:image/png;base64,${PNG_B64}`);
  assert.equal(parsed.mime, "image/png");
  assert.equal(parsed.base64, PNG_B64);
  assert.equal(parseDataUri("https://example.com/a.png"), null);
});

test("classifyMediaPart understands OpenAI image_url (object and string)", () => {
  assert.deepEqual(
    classifyMediaPart({ type: "image_url", image_url: { url: "https://x.test/a.png" } }),
    { kind: "image", url: "https://x.test/a.png", mime: undefined, filename: undefined }
  );
  assert.equal(
    classifyMediaPart({ type: "image_url", image_url: "https://x.test/a.png" }).url,
    "https://x.test/a.png"
  );
});

test("classifyMediaPart unwraps data-URI image_url into base64", () => {
  const media = classifyMediaPart({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${PNG_B64}` },
  });
  assert.equal(media.kind, "image");
  assert.equal(media.mime, "image/png");
  assert.equal(media.base64, PNG_B64);
  assert.equal(media.url, undefined);
});

test("classifyMediaPart understands input_audio, audio_url, video_url", () => {
  assert.equal(
    classifyMediaPart({ type: "input_audio", input_audio: { data: "abc", format: "wav" } }).kind,
    "audio"
  );
  assert.equal(
    classifyMediaPart({ type: "audio_url", audio_url: { url: "https://x.test/a.wav" } }).kind,
    "audio"
  );
  assert.equal(
    classifyMediaPart({ type: "video_url", video_url: { url: "https://x.test/a.mp4" } }).kind,
    "video"
  );
});

test("classifyMediaPart understands Anthropic image / document and Gemini inline_data", () => {
  const image = classifyMediaPart({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "abcd" },
  });
  assert.equal(image.kind, "image");
  assert.equal(image.mime, "image/jpeg");
  assert.equal(image.base64, "abcd");

  const doc = classifyMediaPart({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: "pdfb64" },
    filename: "note.pdf",
  });
  assert.equal(doc.kind, "file");
  assert.equal(doc.filename, "note.pdf");

  const gemini = classifyMediaPart({
    inline_data: { mime_type: "video/mp4", data: "vid" },
  });
  assert.equal(gemini.kind, "video");
  assert.equal(gemini.base64, "vid");
});

test("classifyMediaPart ignores text parts", () => {
  assert.equal(classifyMediaPart({ type: "text", text: "hi" }), null);
});

test("contentPartToText keeps text and marks media", () => {
  assert.equal(contentPartToText({ type: "text", text: "hello" }), "hello");
  assert.equal(
    contentPartToText({ type: "image_url", image_url: { url: "https://x.test/a.png" } }),
    "[attached image: https://x.test/a.png]"
  );
  assert.equal(
    contentPartToText({ type: "input_audio", input_audio: { data: "xx", format: "wav" } }),
    "[attached audio]"
  );
});

test("safeFilename strips path traversal", () => {
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("my photo.png"), "my_photo.png");
});

test("prepareRequestMedia writes a data-URI image and rewrites the part", async () => {
  const result = await prepareRequestMedia([
    {
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
      ],
    },
  ]);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].kind, "image");
  assert.ok(result.attachments[0].absPath.startsWith(join(tmpdir(), "cursor-bridge-media")));
  const written = await readFile(result.attachments[0].absPath);
  assert.equal(written.toString("hex"), "89504e470d0a1a0a");
  assert.equal(result.messages[0].content[0].text, "what is this?");
  assert.match(result.messages[0].content[1].text, /^\[attached image: /);
  await result.dispose();
});

test("prepareRequestMedia downloads https URLs via fetchImpl", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  let fetched = "";
  const result = await prepareRequestMedia(
    [{ role: "user", content: [{ type: "video_url", video_url: { url: "https://cdn.example/clip.mp4" } }] }],
    {
      lookupImpl: publicLookup,
      fetchImpl: async (url) => {
        fetched = url;
        return new Response(png, { status: 200, headers: { "content-type": "video/mp4" } });
      },
    }
  );
  assert.equal(fetched, "https://cdn.example/clip.mp4");
  assert.equal(result.attachments[0].kind, "video");
  assert.equal(result.attachments[0].mime, "video/mp4");
  await result.dispose();
});

test("inspectMediaUrl rejects localhost, private IPs, and dword loopback", () => {
  assert.throws(() => inspectMediaUrl("http://127.0.0.1/a.png"), MediaError);
  assert.throws(() => inspectMediaUrl("http://localhost/a.png"), MediaError);
  assert.throws(() => inspectMediaUrl("http://192.168.1.5/a.png"), MediaError);
  assert.throws(() => inspectMediaUrl("http://2130706433/a.png"), MediaError);
  assert.throws(() => inspectMediaUrl("http://[::1]/a.png"), MediaError);
  const ok = inspectMediaUrl("https://cdn.example/a.png");
  assert.equal(ok.protocol, "https:");
});

test("assertSafeMediaUrl rejects hosts that resolve to loopback", async () => {
  await assert.rejects(
    () => assertSafeMediaUrl("https://evil.test/a.png", {
      lookupImpl: async () => ({ address: "127.0.0.1", family: 4 }),
    }),
    (err) => err instanceof MediaError && /private or local/.test(err.message)
  );
});

test("parsePositiveInt falls back on NaN and non-positive values", () => {
  assert.equal(parsePositiveInt("abc", 16), 16);
  assert.equal(parsePositiveInt("0", 16), 16);
  assert.equal(parsePositiveInt("-3", 16), 16);
  assert.equal(parsePositiveInt("32", 16), 32);
});

test("download aborts once the streamed body exceeds maxBytes", async () => {
  const big = Buffer.alloc(64, 7);
  await assert.rejects(
    () => prepareRequestMedia(
      [{ role: "user", content: [{ type: "video_url", video_url: { url: "https://cdn.example/big.mp4" } }] }],
      {
        maxBytes: 8,
        lookupImpl: publicLookup,
        fetchImpl: async () => new Response(big, { status: 200, headers: { "content-type": "video/mp4" } }),
      }
    ),
    (err) => err instanceof MediaError && /exceeds/.test(err.message)
  );
});

test("prepareRequestMedia rejects file:// and other non-http schemes", async () => {
  await assert.rejects(
    () => prepareRequestMedia([
      { role: "user", content: [{ type: "image_url", image_url: { url: "file:///etc/passwd" } }] },
    ]),
    (err) => err instanceof MediaError && /scheme/.test(err.message)
  );
});

test("prepareRequestMedia dryRun does not write files", async () => {
  const result = await prepareRequestMedia(
    [{ role: "user", content: [{ type: "input_audio", input_audio: { data: PNG_B64, format: "wav" } }] }],
    { dryRun: true }
  );
  assert.equal(result.mediaDir, null);
  assert.equal(result.attachments[0].kind, "audio");
  assert.equal(result.messages[0].content[0].type, "text");
  await result.dispose();
});

test("prepareRequestMedia enforces maxFiles and maxBytes", async () => {
  await assert.rejects(
    () => prepareRequestMedia(
      [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
        ],
      }],
      { maxFiles: 1 }
    ),
    (err) => err instanceof MediaError && /Too many/.test(err.message)
  );

  await assert.rejects(
    () => prepareRequestMedia(
      [{ role: "user", content: [{ type: "input_audio", input_audio: { data: PNG_B64, format: "wav" } }] }],
      { maxBytes: 2 }
    ),
    (err) => err instanceof MediaError && /exceeds/.test(err.message)
  );
});

test("redactMessagesForLog strips inline base64", () => {
  const redacted = redactMessagesForLog([
    {
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
      ],
    },
  ]);
  const dumped = JSON.stringify(redacted);
  assert.ok(!dumped.includes(PNG_B64));
  assert.equal(redacted[0].content[1]._redacted, true);
  assert.equal(redacted[0].content[1].kind, "image");
});

test("mediaPromptSection lists attachments", () => {
  const text = mediaPromptSection([
    { kind: "image", absPath: "/tmp/a.png", mime: "image/png", bytes: 12 },
    { kind: "audio", absPath: "/tmp/b.wav", mime: "audio/wav", bytes: 34 },
  ]);
  assert.match(text, /<attached_media>/);
  assert.match(text, /image — \/tmp\/a\.png/);
  assert.match(text, /audio — \/tmp\/b\.wav/);
  assert.equal(mediaPromptSection([]), "");
});
