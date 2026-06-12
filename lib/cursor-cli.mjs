// Cross-platform helpers for locating and spawning the Cursor CLI.
// Pure logic (arg building / quoting) is exported separately for unit tests.

import { spawn } from "node:child_process";

export const IS_WINDOWS = process.platform === "win32";

/**
 * Whether the configured binary is the agent itself (cursor-agent / agent)
 * or the `cursor` wrapper that needs the `agent` subcommand.
 * Handles Windows extensions (.exe/.cmd/.bat/.ps1) and full paths.
 */
export function isDirectAgentBin(cursorBin) {
  const base = String(cursorBin)
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
  return base === "agent" || base.includes("cursor-agent");
}

/**
 * Prepend the `agent` subcommand when using the `cursor` wrapper binary.
 */
export function agentArgs(cursorBin, args) {
  return isDirectAgentBin(cursorBin) ? args : ["agent", ...args];
}

/**
 * Quote a single argument for cmd.exe. Only needed when the binary is a
 * .cmd/.bat shim (Node refuses to spawn those without a shell since
 * CVE-2024-27980). Prompts are never passed as arguments on Windows
 * (always stdin), so arguments here are flags, model ids and paths.
 */
export function quoteForCmd(arg) {
  if (arg === "") return '""';
  if (!/[\s"&|<>^%()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Spawn the Cursor CLI in a cross-platform way.
 *  - POSIX / Windows .exe: direct spawn (args passed verbatim)
 *  - Windows .cmd/.bat:    via cmd.exe with manual quoting
 *  - Windows .ps1:         via powershell.exe -File
 */
export function spawnCursor(cursorBin, args, options = {}) {
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(cursorBin)) {
    const cmdLine = [cursorBin, ...args].map(quoteForCmd).join(" ");
    return spawn(process.env.comspec || "cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  if (IS_WINDOWS && /\.ps1$/i.test(cursorBin)) {
    return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", cursorBin, ...args], options);
  }
  return spawn(cursorBin, args, options);
}

export const DEFAULT_MAX_ARG_LEN = 32768;

/**
 * Spawn the Cursor CLI with a prompt, deciding arg-vs-stdin delivery here so
 * every call site shares the same policy (and quoteForCmd's invariant — the
 * prompt never travels as a cmd.exe argument — is enforced by construction):
 *  - Windows: always stdin (command-line length limit + .cmd quoting hazards)
 *  - POSIX:   stdin only above maxArgLen (Linux MAX_ARG_STRLEN / E2BIG)
 * Writes and closes stdin itself. Returns { proc, useStdinPipe }.
 */
export function spawnCursorWithPrompt(cursorBin, args, prompt, { maxArgLen = DEFAULT_MAX_ARG_LEN, ...spawnOptions } = {}) {
  const useStdinPipe = IS_WINDOWS || prompt.length > maxArgLen;
  const proc = spawnCursor(cursorBin, useStdinPipe ? args : [...args, prompt], spawnOptions);
  // Ignore EPIPE etc. if the process dies before consuming stdin;
  // the caller's 'error'/'close' handlers produce the actual error response.
  proc.stdin.on("error", () => {});
  if (useStdinPipe) proc.stdin.write(prompt);
  proc.stdin.end();
  return { proc, useStdinPipe };
}
