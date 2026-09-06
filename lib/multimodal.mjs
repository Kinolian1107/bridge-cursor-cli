// Multimodal input support for OpenAI / Anthropic chat messages.
// Pure helpers + optional disk I/O. cursor-agent has no --file flag, so the
// bridge materializes image / audio / video / document parts onto disk and
// points the agent at them via prompt text + `--add-dir`.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_FILES = 16;
export const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 15_000;

/** @typedef {"image" | "audio" | "video" | "file"} MediaKind */

export class MediaError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, type?: string }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = "MediaError";
    this.status = opts.status ?? 400;
    this.type = opts.type ?? "invalid_request";
  }
}

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/mpeg": "mpeg",
  "video/x-msvideo": "avi",
  "application/pdf": "pdf",
  "application/octet-stream": "bin",
};

const AUDIO_FORMAT_MIME = {
  wav: "audio/wav",
  wave: "audio/wav",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  webm: "audio/webm",
};

const DATA_URI_RE = /^data:([^;,]+)?((?:;[^,]*)*);base64,([\s\S]+)$/i;
const MAX_REDIRECTS = 5;

/**
 * Parse a positive integer env/config value; fall back when missing or NaN.
 * @param {unknown} value
 * @param {number} fallback
 */
export function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Sync URL safety: scheme + literal hosts/IPs. DNS is checked separately.
 * @param {string} url
 * @param {{ allowPrivate?: boolean }} [opts]
 */
export function inspectMediaUrl(url, opts = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new MediaError(`Invalid media URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaError(`Unsupported media URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new MediaError("Media URLs must not include credentials");
  }
  if (!opts.allowPrivate && isBlockedHostname(parsed.hostname)) {
    throw new MediaError("Refusing to download media from a private or local address");
  }
  return parsed;
}

/**
 * Full URL check including DNS resolution of the hostname.
 * @param {string} url
 * @param {{ allowPrivate?: boolean, lookupImpl?: typeof dnsLookup }} [opts]
 */
export async function assertSafeMediaUrl(url, opts = {}) {
  const parsed = inspectMediaUrl(url, opts);
  if (opts.allowPrivate) return parsed;
  if (ipv4FromHostname(parsed.hostname) || isLiteralIpv6(parsed.hostname)) return parsed;
  const lookupFn = opts.lookupImpl || dnsLookup;
  let resolved;
  try {
    resolved = await lookupFn(parsed.hostname);
  } catch (err) {
    throw new MediaError(`Failed to resolve media host: ${parsed.hostname} (${err?.message || "lookup failed"})`, {
      status: 502,
      type: "upstream_error",
    });
  }
  const address = resolved?.address;
  const family = resolved?.family;
  if (address && isBlockedAddress(address, family)) {
    throw new MediaError("Refusing to download media from a private or local address");
  }
  return parsed;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal") return true;
  const v4 = ipv4FromHostname(host);
  if (v4) return isBlockedIpv4(v4);
  if (isLiteralIpv6(host)) return isBlockedIpv6(host);
  return false;
}

function ipv4FromHostname(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.every((p) => p <= 255)) return parts;
    return null;
  }
  // Decimal / dword form: http://2130706433/
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  return null;
}

function isLiteralIpv6(host) {
  return host.includes(":");
}

function isBlockedIpv4(parts) {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIpv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i) || h.match(/::ffff:((?:\d+\.){3}\d+)$/i);
  if (mapped) {
    const parts = ipv4FromHostname(mapped[1]);
    return !!(parts && isBlockedIpv4(parts));
  }
  return false;
}

function isBlockedAddress(address, family) {
  if (family === 4 || /^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const parts = ipv4FromHostname(address);
    return !!(parts && isBlockedIpv4(parts));
  }
  return isBlockedIpv6(address);
}

/**
 * @param {string | undefined} mime
 * @returns {MediaKind}
 */
export function kindFromMime(mime) {
  const lower = String(mime || "").toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  return "file";
}

/**
 * @param {string | undefined} mime
 * @param {MediaKind} kind
 */
export function extFromMime(mime, kind = "file") {
  const lower = String(mime || "").split(";")[0].trim().toLowerCase();
  if (MIME_EXT[lower]) return MIME_EXT[lower];
  const subtype = lower.split("/")[1];
  if (subtype && /^[a-z0-9]+$/.test(subtype) && subtype !== "octet-stream") return subtype;
  return { image: "png", audio: "wav", video: "mp4", file: "bin" }[kind] || "bin";
}

/**
 * @param {string} value
 * @returns {{ mime: string, base64: string } | null}
 */
export function parseDataUri(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DATA_URI_RE);
  if (!match) return null;
  return { mime: match[1] || "application/octet-stream", base64: match[3] };
}

/**
 * @param {unknown} part
 * @returns {{ kind: MediaKind, url?: string, base64?: string, mime?: string, filename?: string } | null}
 */
export function classifyMediaPart(part) {
  if (!part || typeof part !== "object") return null;
  const type = typeof part.type === "string" ? part.type : "";
  const inline = part.inline_data || part.inlineData;

  if (inline?.data) {
    const mime = inline.mime_type || inline.mimeType || inline.media_type;
    return { kind: kindFromMime(mime), mime, base64: inline.data, filename: part.filename };
  }

  if (type === "text" || type === "tool_result" || type === "tool_use") return null;

  if (type === "image_url" || type === "input_image") {
    const raw = part.image_url ?? part.imageUrl ?? part.url ?? part.image;
    const url = typeof raw === "string" ? raw : raw?.url;
    if (!url) return null;
    return fromUrlOrData(url, "image", raw?.mime_type || part.media_type);
  }

  if (type === "audio_url") {
    const raw = part.audio_url ?? part.audioUrl;
    const url = typeof raw === "string" ? raw : raw?.url;
    if (!url) return null;
    return fromUrlOrData(url, "audio", raw?.mime_type || part.media_type);
  }

  if (type === "video_url" || type === "input_video") {
    const raw = part.video_url ?? part.videoUrl ?? part.video;
    const url = typeof raw === "string" ? raw : raw?.url;
    if (!url) return null;
    return fromUrlOrData(url, "video", raw?.mime_type || part.media_type);
  }

  if (type === "input_audio" || type === "audio") {
    const src = part.input_audio || part.source || part.audio || {};
    const format = src.format || part.format;
    const mime = src.media_type || src.mime_type || AUDIO_FORMAT_MIME[String(format || "").toLowerCase()];
    if (src.data) return { kind: "audio", mime: mime || "audio/wav", base64: src.data, filename: part.filename };
    const url = src.url || (typeof part.audio_url === "string" ? part.audio_url : part.audio_url?.url);
    if (url) return fromUrlOrData(url, "audio", mime);
    return null;
  }

  if (type === "video") {
    const src = part.source || part.video || {};
    if (src.data) return { kind: "video", mime: src.media_type || src.mime_type || "video/mp4", base64: src.data, filename: part.filename };
    const url = src.url || (typeof part.video_url === "string" ? part.video_url : part.video_url?.url);
    if (url) return fromUrlOrData(url, "video", src.media_type || src.mime_type);
    return null;
  }

  if (type === "image") {
    const src = part.source || part.image || {};
    if (src.data) return { kind: "image", mime: src.media_type || src.mime_type || "image/png", base64: src.data, filename: part.filename };
    const url = src.url || (typeof part.image_url === "string" ? part.image_url : part.image_url?.url);
    if (url) return fromUrlOrData(url, "image", src.media_type || src.mime_type);
    return null;
  }

  if (type === "file" || type === "input_file" || type === "document") {
    const src = part.file || part.source || part;
    const filename = src.filename || part.filename;
    const mime = src.media_type || src.mime_type || part.media_type;
    const data = src.file_data || src.fileData || src.data || part.file_data;
    if (typeof data === "string") {
      const parsed = parseDataUri(data);
      if (parsed) return { kind: kindFromMime(parsed.mime || mime), mime: parsed.mime || mime, base64: parsed.base64, filename };
      if (/^https?:\/\//i.test(data)) return { kind: kindFromMime(mime), url: data, mime, filename };
      if (data && !data.includes("://")) return { kind: kindFromMime(mime), mime, base64: data, filename };
    }
    const url = src.url || part.url;
    if (url) return fromUrlOrData(url, kindFromMime(mime), mime, filename);
    return null;
  }

  return null;
}

/**
 * @param {string} url
 * @param {MediaKind} kind
 * @param {string} [mime]
 * @param {string} [filename]
 */
function fromUrlOrData(url, kind, mime, filename) {
  const parsed = parseDataUri(url);
  if (parsed) {
    return {
      kind: kindFromMime(parsed.mime) !== "file" ? kindFromMime(parsed.mime) : kind,
      mime: parsed.mime || mime,
      base64: parsed.base64,
      filename,
    };
  }
  return { kind, url, mime, filename };
}

/**
 * Flatten one content part to prompt text. Media parts become short markers
 * so history still mentions them even before materialization.
 * @param {unknown} part
 */
export function contentPartToText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (part.type === "text" && typeof part.text === "string") return part.text;
  const media = classifyMediaPart(part);
  if (!media) return "";
  const hint = media.filename || (media.url && !media.url.startsWith("data:") ? media.url : "");
  return hint ? `[attached ${media.kind}: ${hint}]` : `[attached ${media.kind}]`;
}

/**
 * @param {unknown} content
 * @returns {unknown[] | null}
 */
export function contentAsParts(content) {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object" && (content.type || content.inline_data || content.inlineData)) {
    return [content];
  }
  return null;
}

/**
 * Strip inline base64 from messages before writing them to the verbose log.
 * @param {unknown[]} messages
 */
export function redactMessagesForLog(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    const parts = contentAsParts(msg.content);
    if (!parts) return msg;
    return {
      ...msg,
      content: parts.map((part) => {
        const media = classifyMediaPart(part);
        if (!media) return part;
        const bytes = media.base64 ? estimatedBase64Bytes(media.base64) : undefined;
        return {
          type: part.type || media.kind,
          _redacted: true,
          kind: media.kind,
          mime: media.mime,
          filename: media.filename,
          url: media.url && !media.url.startsWith("data:") ? media.url : undefined,
          bytes,
        };
      }),
    };
  });
}

/**
 * @param {Array<{ kind: MediaKind, absPath?: string, filename?: string, mime?: string, bytes?: number }>} attachments
 */
export function mediaPromptSection(attachments) {
  if (!attachments?.length) return "";
  let section = "<attached_media>\n";
  section += "The user attached media files. They are saved on disk and added as an extra workspace root.\n";
  section += "Read each file with your tools before answering. Do not claim you cannot see attachments.\n\n";
  for (const [i, file] of attachments.entries()) {
    const where = file.absPath || file.filename || file.kind;
    const meta = [file.mime, typeof file.bytes === "number" ? `${file.bytes} bytes` : null].filter(Boolean).join(", ");
    section += `${i + 1}. ${file.kind} — ${where}${meta ? ` (${meta})` : ""}\n`;
  }
  section += "</attached_media>\n\n";
  return section;
}

/**
 * Materialize media parts onto disk and rewrite those parts to text path refs.
 *
 * @param {unknown[]} messages
 * @param {{
 *   mediaDir?: string,
 *   dryRun?: boolean,
 *   maxBytes?: number,
 *   maxFiles?: number,
 *   fetchTimeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   lookupImpl?: Function,
 *   allowPrivate?: boolean,
 * }} [options]
 */
export async function prepareRequestMedia(messages, options = {}) {
  const maxBytes = parsePositiveInt(options.maxBytes, DEFAULT_MEDIA_MAX_BYTES);
  const maxFiles = parsePositiveInt(options.maxFiles, DEFAULT_MEDIA_MAX_FILES);
  const fetchTimeoutMs = parsePositiveInt(options.fetchTimeoutMs, DEFAULT_MEDIA_FETCH_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const lookupImpl = options.lookupImpl;
  const allowPrivate = options.allowPrivate === true;
  const dryRun = options.dryRun === true;

  const attachments = [];
  let mediaDir = options.mediaDir || null;
  let createdDir = false;

  const dispose = async () => {
    if (createdDir && mediaDir) {
      await rm(mediaDir, { recursive: true, force: true });
    }
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: messages || [], attachments, mediaDir: null, dispose: async () => {} };
  }

  try {
    const rewritten = [];
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") {
        rewritten.push(msg);
        continue;
      }
      const parts = contentAsParts(msg.content);
      if (!parts) {
        rewritten.push(msg);
        continue;
      }

      const newParts = [];
      for (const part of parts) {
        const media = classifyMediaPart(part);
        if (!media) {
          newParts.push(part);
          continue;
        }
        if (attachments.length >= maxFiles) {
          throw new MediaError(`Too many media attachments (max ${maxFiles})`);
        }

        if (dryRun) {
          if (media.url) inspectMediaUrl(media.url, { allowPrivate });
          const hint = media.filename || (media.url && !String(media.url).startsWith("data:") ? media.url : `${media.kind}-inline`);
          attachments.push({ kind: media.kind, filename: hint, mime: media.mime, bytes: media.base64 ? estimatedBase64Bytes(media.base64) : undefined });
          newParts.push({ type: "text", text: `[attached ${media.kind}: ${hint}]` });
          continue;
        }

        if (!mediaDir) {
          mediaDir = join(tmpdir(), "cursor-bridge-media", randomUUID());
        }
        if (!createdDir) {
          await mkdir(mediaDir, { recursive: true, mode: 0o700 });
          createdDir = true;
        }

        const file = await materializeOne(media, mediaDir, attachments.length, {
          maxBytes,
          fetchTimeoutMs,
          fetchImpl,
          lookupImpl,
          allowPrivate,
        });
        attachments.push(file);
        newParts.push({ type: "text", text: `[attached ${file.kind}: ${file.absPath}]` });
      }

      rewritten.push({ ...msg, content: newParts });
    }

    return {
      messages: rewritten,
      attachments,
      mediaDir: attachments.length && !dryRun ? mediaDir : null,
      dispose,
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}

/**
 * @param {{ kind: MediaKind, url?: string, base64?: string, mime?: string, filename?: string }} media
 * @param {string} mediaDir
 * @param {number} index
 */
async function materializeOne(media, mediaDir, index, { maxBytes, fetchTimeoutMs, fetchImpl, lookupImpl, allowPrivate }) {
  let bytes;
  let mime = media.mime;
  let filename = media.filename;

  if (media.base64) {
    const estimated = estimatedBase64Bytes(media.base64);
    if (estimated > maxBytes) {
      throw new MediaError(`Media exceeds ${maxBytes} bytes`);
    }
    const buf = Buffer.from(String(media.base64).replace(/\s/g, ""), "base64");
    if (!buf.length) throw new MediaError("Empty media data");
    if (buf.length > maxBytes) throw new MediaError(`Media exceeds ${maxBytes} bytes`);
    bytes = buf;
  } else if (media.url) {
    const downloaded = await downloadMedia(media.url, { maxBytes, fetchTimeoutMs, fetchImpl, lookupImpl, allowPrivate });
    bytes = downloaded.bytes;
    mime = mime || downloaded.mime;
    filename = filename || filenameFromUrl(media.url);
  } else {
    throw new MediaError("Media part has neither data nor url");
  }

  mime = (mime || "").split(";")[0].trim() || defaultMime(media.kind);
  const ext = extFromMime(mime, media.kind);
  const name = uniqueFilename(index, media.kind, ext, filename);
  const absPath = join(mediaDir, name);
  await writeFile(absPath, bytes);
  return { kind: media.kind, absPath, filename: name, mime, bytes: bytes.length };
}

function defaultMime(kind) {
  return { image: "image/png", audio: "audio/wav", video: "video/mp4", file: "application/octet-stream" }[kind] || "application/octet-stream";
}

function uniqueFilename(index, kind, ext, filename) {
  const prefix = String(index + 1).padStart(2, "0");
  if (filename) {
    const safe = safeFilename(filename);
    const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(safe);
    return `${prefix}-${hasExt ? safe : `${safe}.${ext}`}`;
  }
  return `${prefix}-${kind}.${ext}`;
}

export function safeFilename(name) {
  const base = String(name || "file").split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  return cleaned || "file";
}

function filenameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop();
    return last || undefined;
  } catch {
    return undefined;
  }
}

function estimatedBase64Bytes(b64) {
  const clean = String(b64).replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

async function downloadMedia(url, { maxBytes, fetchTimeoutMs, fetchImpl, lookupImpl, allowPrivate }) {
  if (typeof fetchImpl !== "function") {
    throw new MediaError("fetch is not available to download media", { status: 500, type: "internal_error" });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), fetchTimeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = await assertSafeMediaUrl(current, { allowPrivate, lookupImpl });
      let res;
      try {
        res = await fetchImpl(parsed.href, { signal: ac.signal, redirect: "manual" });
      } catch (err) {
        const aborted = err?.name === "AbortError";
        throw new MediaError(
          aborted ? `Timed out downloading media: ${current}` : `Failed to download media: ${err?.message || current}`,
          { status: 502, type: "upstream_error" }
        );
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers?.get?.("location");
        if (!loc) {
          throw new MediaError(`Redirect missing Location header: ${current}`, { status: 502, type: "upstream_error" });
        }
        current = new URL(loc, parsed.href).href;
        continue;
      }

      if (!res.ok) {
        throw new MediaError(`Failed to download media (${res.status}): ${current}`, { status: 502, type: "upstream_error" });
      }

      const headerLen = Number(res.headers?.get?.("content-length") || 0);
      if (headerLen > maxBytes) {
        throw new MediaError(`Media exceeds ${maxBytes} bytes`);
      }

      const mime = res.headers?.get?.("content-type") || undefined;
      const buf = await readResponseCapped(res, maxBytes, ac.signal);
      if (!buf.length) throw new MediaError("Downloaded media was empty", { status: 502, type: "upstream_error" });
      return { bytes: buf, mime };
    }
    throw new MediaError("Too many redirects while downloading media", { status: 502, type: "upstream_error" });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseCapped(res, maxBytes, signal) {
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      if (signal?.aborted) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new MediaError("Timed out downloading media", { status: 502, type: "upstream_error" });
      }
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new MediaError(`Media exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof res.arrayBuffer === "function") {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new MediaError(`Media exceeds ${maxBytes} bytes`);
    return buf;
  }
  if (Buffer.isBuffer(res.body)) {
    if (res.body.length > maxBytes) throw new MediaError(`Media exceeds ${maxBytes} bytes`);
    return res.body;
  }
  throw new MediaError("Download response has no body", { status: 502, type: "upstream_error" });
}
