/**
 * Asynchronous process execution for RoosterEdit.
 *
 * The CLI still uses synchronous `run()` for short, simple commands. This
 * module is the foundation for independent probes, TTS lines, render
 * segments, and other work that benefits from bounded parallelism.
 *
 * Windows notes:
 * - `.cmd`/`.bat` shims cannot be spawned directly, so they are routed through
 *   `cmd.exe` with the same quoting strategy used by the existing CLI.
 * - timeouts kill the whole process tree with `taskkill` when available.
 */

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;

function isBatchFile(name) {
  return /\.(cmd|bat)$/i.test(name);
}

function spawnCommand(name, args) {
  const executable = commandName(name);
  const list = args.map((arg) => String(arg));
  if (process.platform === "win32" && isBatchFile(executable)) {
    const line = [executable, ...list].map(quoteCmd).join(" ");
    return {
      command: process.env.ComSpec || "cmd.exe",
      // /s strips the first and last quote, so wrap the whole command once
      // more. windowsVerbatimArguments keeps Node from escaping these quotes.
      args: ["/d", "/s", "/c", `"${line}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: executable, args: list, windowsVerbatimArguments: false };
}

function killTree(child) {
  if (!child) return;
  try {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
  } catch {
    // Fall through to child.kill().
  }
  try {
    child.kill();
  } catch {
    // The process may already be gone.
  }
}

function createLineEmitter(onLine) {
  if (typeof onLine !== "function") {
    return { push() {}, end() {} };
  }

  let buffer = "";
  const decoder = new StringDecoder("utf8");

  const emit = (line) => {
    if (!line) return;
    try {
      onLine(line);
    } catch {
      // A logging callback must not break process collection.
    }
  };

  return {
    push(chunk) {
      buffer += decoder.write(chunk);
      let match = buffer.match(/\r\n|\n|\r/);
      while (match) {
        const index = match.index ?? 0;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + match[0].length);
        emit(line);
        match = buffer.match(/\r\n|\n|\r/);
      }
    },
    end() {
      buffer += decoder.end();
      if (buffer) emit(buffer);
      buffer = "";
    },
  };
}

function toLimitedString(chunks, exceeded) {
  const text = Buffer.concat(chunks).toString("utf8");
  return { text: text.trim(), exceeded };
}

/**
 * Resolve a command name for the current platform.
 *
 * On Windows, `npm`, `npx`, `pnpm`, and `yarn` are batch shims. Paths that
 * already carry `.cmd`, `.bat`, or `.exe` are returned unchanged.
 *
 * @param {string} name
 * @returns {string}
 */
export function commandName(name) {
  const text = String(name ?? "").trim();
  if (!text) throw new TypeError("commandName: command name is required");
  if (process.platform !== "win32") return text;

  const lower = text.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat") || lower.endsWith(".exe")) {
    return text;
  }
  if (lower === "npm" || lower === "npx" || lower === "pnpm" || lower === "yarn") {
    return `${text}.cmd`;
  }
  return text;
}

/**
 * Quote a value for a `cmd.exe /c` command line.
 *
 * The implementation follows the MS C runtime rules for embedded quotes and
 * trailing backslashes. It is not a general shell escaper; it is only used for
 * arguments passed to a local executable by `runAsync`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function quoteCmd(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(text)) return text;

  let out = '"';
  let backslashes = 0;
  for (const char of text) {
    if (char === "\\") {
      backslashes += 1;
      out += char;
      continue;
    }
    if (char === '"') {
      out += "\\".repeat(backslashes) + '\\"';
      backslashes = 0;
      continue;
    }
    out += char;
    backslashes = 0;
  }
  out += "\\".repeat(backslashes);
  return `${out}"`;
}

/**
 * Run a command asynchronously.
 *
 * Resolves (it does not reject for command failures) with:
 * `{ ok, status, stdout, stderr, error, timedOut }`.
 *
 * `error` is `"timeout"` when the deadline fired and `"maxBuffer exceeded"`
 * when a stream overflowed. Spawn failures keep their system message. A
 * non-zero exit sets `ok: false` and leaves `error` null.
 *
 * @param {string} name
 * @param {string[]} [args]
 * @param {{
 *   cwd?: string,
 *   timeout?: number,
 *   onLine?: (line: string) => void,
 *   maxBuffer?: number,
 *   env?: NodeJS.ProcessEnv
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean, status: number|null, stdout: string, stderr: string,
 *   error: string|null, timedOut: boolean
 * }>}
 */
export async function runAsync(name, args = [], options = {}) {
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError("runAsync: command name is required");
  }
  if (!Array.isArray(args)) {
    throw new TypeError("runAsync: args must be an array");
  }

  const {
    cwd = process.cwd(),
    timeout = 0,
    onLine,
    maxBuffer = DEFAULT_MAX_BUFFER,
    env = process.env,
  } = options || {};

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new RangeError("runAsync: timeout must be a non-negative number of milliseconds");
  }
  if (!Number.isInteger(maxBuffer) || maxBuffer < 1) {
    throw new RangeError("runAsync: maxBuffer must be a positive integer");
  }
  if (onLine !== undefined && typeof onLine !== "function") {
    throw new TypeError("runAsync: onLine must be a function");
  }

  const { command, args: spawnArgs, windowsVerbatimArguments } = spawnCommand(name, args);

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, spawnArgs, {
        cwd: path.resolve(cwd),
        env,
        windowsHide: true,
        windowsVerbatimArguments,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        stdout: "",
        stderr: "",
        error: String(error.message || error),
        timedOut: false,
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutLines = createLineEmitter(onLine);
    const stderrLines = createLineEmitter(onLine);

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let bufferExceeded = false;
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let timeoutTimer = null;
    let forceTimer = null;

    const forceResolve = () => {
      if (settled) return;
      finish(null, null);
    };

    const stopProcess = () => {
      killTree(child);
      if (!forceTimer) {
        forceTimer = setTimeout(forceResolve, 3000);
        forceTimer.unref?.();
      }
    };

    const collect = (chunk, chunks, streamName) => {
      if (streamName === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;

      const total = streamName === "stdout" ? stdoutBytes : stderrBytes;
      if (total > maxBuffer) {
        bufferExceeded = true;
        const previous = total - chunk.length;
        const remaining = maxBuffer - previous;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        stopProcess();
        return;
      }
      chunks.push(chunk);
    };

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      stdoutLines.end();
      stderrLines.end();

      const stdoutResult = toLimitedString(stdoutChunks, bufferExceeded);
      const stderrResult = toLimitedString(stderrChunks, bufferExceeded);

      let error = null;
      if (spawnError) error = spawnError;
      else if (timedOut) error = "timeout";
      else if (bufferExceeded) error = "maxBuffer exceeded";

      resolve({
        ok: !error && code === 0,
        status: code,
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        error,
        timedOut,
      });
    };

    child.stdout?.on("data", (chunk) => {
      stdoutLines.push(chunk);
      collect(chunk, stdoutChunks, "stdout");
    });
    child.stderr?.on("data", (chunk) => {
      stderrLines.push(chunk);
      collect(chunk, stderrChunks, "stderr");
    });

    child.once("error", (error) => {
      spawnError = String(error.message || error);
      finish(null, null);
    });

    child.once("close", (code, signal) => {
      finish(code, signal);
    });

    if (timeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        stopProcess();
      }, timeout);
      timeoutTimer.unref?.();
    }
  });
}

/**
 * Run tasks with bounded concurrency.
 *
 * Results are settled objects in the same order as `items`, matching
 * `Promise.allSettled`:
 *
 * ```js
 * [
 *   { status: "fulfilled", value },
 *   { status: "rejected", reason }
 * ]
 * ```
 *
 * A rejection does not stop the remaining items from being scheduled; collect
 * all outcomes and decide at the call site. Concurrency never exceeds `limit`.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>|R} fn
 * @returns {Promise<Array<{ status: "fulfilled", value: R } | { status: "rejected", reason: unknown }>>}
 */
export async function runPool(items, limit = 1, fn) {
  if (!Array.isArray(items)) throw new TypeError("runPool: items must be an array");
  if (typeof fn !== "function") throw new TypeError("runPool: fn must be a function");
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("runPool: limit must be a positive integer");
  }

  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        const value = await fn(items[index], index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
