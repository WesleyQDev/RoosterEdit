/**
 * Render wrapper helpers for RoosterEdit.
 *
 * The argument builders and key/probe helpers are pure. `runRender` starts one
 * child process on demand and never at import time. Engine resolution (finding
 * the HyperFrames/Remotion binary) belongs to `lib/engines.mjs`; callers pass a
 * resolved command here.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_HF_WORKERS = "auto";
const DEFAULT_HF_VIDEO_FRAME_FORMAT = "jpg";
const DEFAULT_REMOTION_LOG = "error";
const CAPTURE_LIMIT = 4 * 1024 * 1024;
const KILL_GRACE_MS = 3000;
const DURATION_TOLERANCE_MIN = 0.5;
const DURATION_TOLERANCE_MAX = 2;
const FPS_TOLERANCE_MIN = 0.05;
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positiveNumber(value) {
  const num = finiteNumber(value);
  return num !== null && num > 0 ? num : null;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value, digits = 3) {
  return String(round(value, digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize a render quality label.
 *
 * HyperFrames calls the final tier `delivery`; the CLI and the plans call it
 * `final`. Both names are accepted here.
 *
 * @param {string|null|undefined} value Quality label.
 * @param {string|null} [fallback] Value returned for null/empty input.
 * @returns {string|null} `draft`, `final`, or the fallback.
 */
export function normalizeRenderQuality(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const quality = String(value).trim().toLowerCase();
  if (quality === "draft") return "draft";
  if (quality === "final" || quality === "delivery" || quality === "high") return "final";
  throw new RangeError(
    `Unknown render quality "${value}". Use "draft" or "final" (HyperFrames: "delivery").`
  );
}

function normalizeWorkers(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_HF_WORKERS;
  const text = String(value).trim().toLowerCase();
  if (text === "auto") return "auto";
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`workers must be "auto" or a positive integer, got "${value}".`);
  }
  return String(count);
}

function normalizeFrameFormat(value) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_HF_VIDEO_FRAME_FORMAT;
  }
  const format = String(value).trim().toLowerCase();
  if (format === "jpg" || format === "jpeg") return "jpg";
  if (format === "png") return "png";
  throw new RangeError(`videoFrameFormat must be "jpg" or "png", got "${value}".`);
}

function normalizeSeconds(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = finiteNumber(value);
  if (seconds === null || seconds < 0) {
    throw new RangeError(`${name} must be a non-negative number of seconds, got "${value}".`);
  }
  return round(seconds);
}

function normalizeExtra(extra) {
  if (extra === null || extra === undefined) return [];
  if (!Array.isArray(extra)) throw new TypeError("extra must be an array of arguments.");
  return extra
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => String(value));
}

function requireString(value, name, fallback = null) {
  if (typeof value === "string" && value.trim()) return value;
  if (fallback !== null) return fallback;
  throw new TypeError(`${name} is required.`);
}

/**
 * Build HyperFrames `render` arguments.
 *
 * Defaults follow the performance audit: draft quality, `--workers auto`,
 * JPEG frame capture, `--quiet`, and a persistent frame cache when a directory
 * is provided. `--start`/`--end` are passed only when explicitly requested;
 * short samples should use a short composition instead (the engine spends more
 * time warming up than rendering a few seconds).
 *
 * @param {object} options
 * @param {string} [options.bin] HyperFrames binary or entry script.
 * @param {string} options.out Output video path.
 * @param {string} [options.quality] `draft` or `final`.
 * @param {string|number} [options.workers] `auto` or a positive integer.
 * @param {boolean} [options.resume] Pass `--resume`.
 * @param {boolean} [options.gpu] Pass `--gpu`.
 * @param {string} [options.framesCacheDir] Persistent frame cache directory.
 * @param {string} [options.videoFrameFormat] `jpg` or `png`.
 * @param {number} [options.start] Optional timeline start in seconds.
 * @param {number} [options.end] Optional timeline end in seconds.
 * @param {string[]} [options.extra] Extra engine arguments.
 * @returns {{command: string, args: string[], out: string}} Invocation.
 */
export function hyperFramesRenderArgs({
  bin = "hyperframes",
  out,
  quality,
  workers,
  resume,
  gpu,
  framesCacheDir,
  videoFrameFormat,
  start,
  end,
  extra,
} = {}) {
  const output = requireString(out, "out");
  const normalizedQuality = normalizeRenderQuality(quality, "draft");
  const workerCount = normalizeWorkers(workers);
  const frameFormat = normalizeFrameFormat(videoFrameFormat);
  const from = normalizeSeconds(start, "start");
  const to = normalizeSeconds(end, "end");
  if (from !== null && to !== null && to <= from) {
    throw new RangeError(`end (${to}s) must be greater than start (${from}s).`);
  }

  const args = [
    "render",
    "--quality",
    normalizedQuality === "final" ? "delivery" : "draft",
    "--workers",
    workerCount,
    "--video-frame-format",
    frameFormat,
  ];

  if (typeof framesCacheDir === "string" && framesCacheDir.trim()) {
    args.push("--frames-cache-dir", framesCacheDir);
  }
  if (resume === true) args.push("--resume");
  if (gpu === true) args.push("--gpu");
  args.push("--quiet");
  if (from !== null) args.push("--start", formatNumber(from));
  if (to !== null) args.push("--end", formatNumber(to));
  args.push(...normalizeExtra(extra), "-o", output);

  return { command: requireString(bin, "bin", "hyperframes"), args, out: output };
}

function normalizeRemotionConcurrency(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (text === "auto") return "auto";
  if (/^\d+%$/.test(text)) return text;
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `concurrency must be a positive integer, a percentage, or "auto", got "${value}".`
    );
  }
  return String(count);
}

function normalizeRemotionGl(value) {
  if (value === null || value === undefined || value === "") return null;
  const renderer = String(value).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(renderer)) {
    throw new RangeError(`gl must be a renderer name such as "angle", got "${value}".`);
  }
  return renderer;
}

function normalizeRemotionFrames(value) {
  if (value === null || value === undefined || value === "") return null;
  if (isObject(value)) {
    const from = Number(value.start);
    const to = Number(value.end);
    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(to) || to < from) {
      throw new RangeError("frames start/end must be non-negative integers with end >= start.");
    }
    return from === to ? String(from) : `${from}-${to}`;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return text;
  const match = text.match(/^(\d+)-(\d+)$/);
  if (!match) {
    throw new RangeError(`frames must look like "start-end", got "${value}".`);
  }
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (to < from) throw new RangeError(`frames end (${to}) must be >= start (${from}).`);
  return `${from}-${to}`;
}

/**
 * Build Remotion `render` arguments.
 *
 * `--gl` is emitted only when a renderer is provided (for example `angle` for
 * WebGL/3D compositions). `--log=error` keeps the render log small by default.
 *
 * @param {object} options
 * @param {string} [options.bin] Remotion CLI binary or entry script.
 * @param {string} [options.entry] Entry file; omitted when the Remotion config has one.
 * @param {string} options.composition Composition id.
 * @param {string} options.out Output video path.
 * @param {string} [options.quality] `draft` or `final`; validated for the caller.
 * @param {string|number} [options.concurrency] Worker count, percentage, or `auto`.
 * @param {string} [options.gl] OpenGL renderer, for example `angle`.
 * @param {string|number|{start: number, end: number}} [options.frames] Frame range.
 * @param {string} [options.log] Remotion log level; defaults to `error`.
 * @param {string} [options.codec] Remotion codec (`h264`, `prores`, `vp8`, ...).
 * @param {string} [options.imageFormat] `jpeg`, `png`, or `none`.
 * @param {string} [options.pixelFormat] For example `yuva444p10le` for ProRes alpha.
 * @param {string} [options.proresProfile] `4444`, `4444-xq`, `hq`, ...
 * @param {object} [options.props] Composition input props.
 * @returns {{command: string, args: string[], out: string, quality: string|null}} Invocation.
 */
export function remotionRenderArgs({
  bin = "remotion",
  entry,
  composition,
  out,
  quality,
  concurrency,
  gl,
  frames,
  log,
  codec,
  imageFormat,
  pixelFormat,
  proresProfile,
  props,
} = {}) {
  const output = requireString(out, "out");
  const compositionId = requireString(composition, "composition");
  const normalizedQuality = normalizeRenderQuality(quality, null);

  const args = ["render"];
  if (typeof entry === "string" && entry.trim()) args.push(entry);
  args.push(compositionId, output);

  const workerCount = normalizeRemotionConcurrency(concurrency);
  if (workerCount !== null) args.push(`--concurrency=${workerCount}`);

  const renderer = normalizeRemotionGl(gl);
  if (renderer !== null) args.push(`--gl=${renderer}`);

  const logLevel =
    typeof log === "string" && log.trim() ? log.trim().toLowerCase() : DEFAULT_REMOTION_LOG;
  args.push(`--log=${logLevel}`);

  const frameRange = normalizeRemotionFrames(frames);
  if (frameRange !== null) args.push(`--frames=${frameRange}`);

  for (const [key, value] of [
    ["codec", codec],
    ["image-format", imageFormat],
    ["pixel-format", pixelFormat],
    ["prores-profile", proresProfile],
  ]) {
    if (typeof value === "string" && value.trim()) args.push(`--${key}=${value.trim()}`);
  }

  if (props && typeof props === "object" && !Array.isArray(props)) {
    args.push(`--props=${JSON.stringify(props)}`);
  }

  return {
    command: requireString(bin, "bin", "remotion"),
    args,
    out: output,
    quality: normalizedQuality,
  };
}

function progressPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "string" ? Number(value.replace(/%/g, "").trim()) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return round(clamp(numeric, 0, 100), 2);
}

/**
 * Parse one progress line from an engine log.
 *
 * Supported shapes:
 * - `@hf-progress {"stage":"capture","percent":42}`;
 * - `@hf-progress {"stage":"capture","frame":120,"total":300}`;
 * - plain `Rendering 42%` / `stage: encode 42%` lines.
 *
 * Malformed input returns null instead of throwing.
 *
 * @param {unknown} line Raw log line.
 * @returns {{percent: number|null, stage: string|null, data: object|null}|null} Progress.
 */
export function parseRenderProgress(line) {
  if (typeof line !== "string") return null;
  const text = line.replace(ANSI_PATTERN, "").trim();
  if (!text) return null;

  const marker = text.lastIndexOf("@hf-progress");
  if (marker !== -1) {
    const payload = text.slice(marker + "@hf-progress".length);
    const open = payload.indexOf("{");
    const close = payload.lastIndexOf("}");
    if (open === -1 || close <= open) return null;
    let data;
    try {
      data = JSON.parse(payload.slice(open, close + 1));
    } catch {
      return null;
    }
    if (!isObject(data)) return null;

    let percent = progressPercent(
      data.percent ?? data.percentage ?? data.progress ?? data.pct ?? null
    );
    if (percent === null && data.frame !== undefined && data.total !== undefined) {
      const frame = finiteNumber(data.frame);
      const total = finiteNumber(data.total);
      if (frame !== null && total !== null && total > 0) {
        percent = round(clamp((frame / total) * 100, 0, 100), 2);
      }
    }
    if (percent === null && data.current !== undefined && data.total !== undefined) {
      const current = finiteNumber(data.current);
      const total = finiteNumber(data.total);
      if (current !== null && total !== null && total > 0) {
        percent = round(clamp((current / total) * 100, 0, 100), 2);
      }
    }

    const stageValue = data.stage ?? data.phase ?? data.status ?? null;
    const stage =
      typeof stageValue === "string" && stageValue.trim() ? stageValue.trim() : null;
    if (percent === null && stage === null) return null;
    return { percent, stage, data };
  }

  const percentMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!percentMatch) return null;
  const percent = progressPercent(percentMatch[1].replace(",", "."));
  if (percent === null) return null;
  const stageText = text.replace(percentMatch[0], " ");
  const stageMatch = stageText.match(/\b(?:stage|phase)\s*[:=]\s*([A-Za-z][A-Za-z0-9 _-]{0,40})/i);
  return {
    percent,
    stage: stageMatch ? stageMatch[1].trim() : null,
    data: null,
  };
}

function canonicalJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * Compute a stable content key for a render artifact.
 *
 * Workers are deliberately excluded: changing the worker count does not change
 * the output. Quality, frame rate, resolution, engine, and engine version are
 * included. Unknown extra keys are ignored.
 *
 * @param {object} options
 * @param {string} options.htmlKey Key of the generated composition source.
 * @param {string} [options.quality] `draft`, `final`, or `delivery`.
 * @param {number} [options.fps] Frame rate.
 * @param {number} [options.width] Output width.
 * @param {number} [options.height] Output height.
 * @param {string} [options.engine] Engine id, for example `hyperframes`.
 * @param {string} [options.engineVersion] Resolved engine version.
 * @returns {string} 32-character hex key.
 */
export function renderKey({ htmlKey, quality, fps, width, height, engine, engineVersion } = {}) {
  const sourceKey = requireString(htmlKey, "htmlKey");
  const payload = {
    version: 1,
    htmlKey: sourceKey,
    quality: normalizeRenderQuality(quality, "draft"),
    fps: finiteNumber(fps),
    width: finiteNumber(width),
    height: finiteNumber(height),
    engine: typeof engine === "string" && engine.trim() ? engine.trim().toLowerCase() : "unknown",
    engineVersion:
      typeof engineVersion === "string" && engineVersion.trim() ? engineVersion.trim() : null,
  };
  return sha256Hex(canonicalJson(payload)).slice(0, 32);
}

function commandName(name) {
  const text = String(name);
  if (process.platform !== "win32") return text;
  if (text.includes("/") || text.includes("\\")) {
    if (/\.(cmd|bat)$/i.test(text)) return text;
    return text;
  }
  if (/^(npm|npx|pnpm|yarn)$/i.test(text)) return `${text}.cmd`;
  return text;
}

function quoteCmd(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function resolveSpawn(command, args) {
  let executable = commandName(command);
  let list = args;
  if (/\.(mjs|cjs|js)$/i.test(executable)) {
    // HyperFrames ships an .mjs entry point; run it with the current Node.
    list = [String(command), ...args];
    executable = process.execPath;
  } else if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    const line = [executable, ...args].map(quoteCmd).join(" ");
    executable = process.env.ComSpec || "cmd.exe";
    list = ["/d", "/s", "/c", line];
  }
  return { command: executable, args: list };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5000,
      });
    } catch {
      // Best effort; fall back to child.kill below.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The process may already be gone.
  }
}

function createCapture(stream) {
  return { stream, parts: [], length: 0, truncated: false };
}

function captureChunk(state, text) {
  if (!text) return;
  state.parts.push(text);
  state.length += text.length;
  while (state.length > CAPTURE_LIMIT && state.parts.length > 0) {
    const excess = state.length - CAPTURE_LIMIT;
    const first = state.parts[0];
    if (first.length <= excess) {
      state.parts.shift();
      state.length -= first.length;
    } else {
      state.parts[0] = first.slice(excess);
      state.length -= excess;
    }
    state.truncated = true;
  }
}

function captureText(state) {
  const text = state.parts.join("");
  if (!state.truncated) return text.trim();
  return `${text.trim()}\n[rooster: output truncated; see the render log]`;
}

/**
 * Run one render command, stream progress lines, and append the full log.
 *
 * Uses `node:child_process.spawn`. On Windows, `.cmd`/`.bat` commands go
 * through `cmd.exe` and `.mjs`/`.js` entry scripts through the current Node
 * binary. A timeout kills the process tree and resolves with `timedOut: true`.
 *
 * @param {object} options
 * @param {string} options.command Executable or script path.
 * @param {string[]} [options.args] Arguments.
 * @param {string} [options.cwd] Working directory.
 * @param {string} [options.logPath] Log file; parent directories are created.
 * @param {number} [options.timeout] Timeout in milliseconds; 0 disables it.
 * @param {(line: string, stream: "stdout"|"stderr") => void} [options.onProgress] Line callback.
 * @returns {Promise<{ok: boolean, status: number|null, stdout: string, stderr: string, error: string|null, timedOut: boolean, elapsedMs: number, logPath: string|null, logError: string|null, truncated: boolean}>} Result.
 */
export function runRender({ command, args = [], cwd, logPath, timeout = 0, onProgress } = {}) {
  const startedAt = Date.now();
  if (typeof command !== "string" || !command.trim()) {
    return Promise.reject(new TypeError("runRender requires command."));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new TypeError("runRender args must be an array."));
  }

  const list = args
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value));
  const invocation = resolveSpawn(command, list);
  const resolvedLogPath =
    typeof logPath === "string" && logPath.trim() ? path.resolve(logPath) : null;

  return new Promise((resolve) => {
    let settled = false;
    let processDone = false;
    let logDone = resolvedLogPath === null;
    let logStream = null;
    let logBroken = false;
    let logError = null;
    let timedOut = false;
    let spawnError = null;
    let timeoutTimer = null;
    let graceTimer = null;
    let status = null;
    let signal = null;

    const stdout = createCapture("stdout");
    const stderr = createCapture("stderr");
    const decoders = {
      stdout: new StringDecoder("utf8"),
      stderr: new StringDecoder("utf8"),
    };
    const pending = { stdout: "", stderr: "" };

    function writeLog(line) {
      if (!logStream || logBroken) return;
      try {
        logStream.write(`${line}\n`);
      } catch (error) {
        logBroken = true;
        logError = String(error.message || error);
      }
    }

    function emitLine(stream, line) {
      if (typeof onProgress !== "function") return;
      try {
        onProgress(line, stream);
      } catch {
        // A progress callback must never break the render.
      }
    }

    function consume(stream, chunk) {
      const text = typeof chunk === "string" ? chunk : decoders[stream].write(chunk);
      captureChunk(stream === "stdout" ? stdout : stderr, text);
      pending[stream] += text;
      const lines = pending[stream].split(/\r\n|\n|\r/);
      pending[stream] = lines.pop();
      for (const line of lines) {
        writeLog(line);
        emitLine(stream, line);
      }
    }

    function flushStreams() {
      for (const stream of ["stdout", "stderr"]) {
        pending[stream] += decoders[stream].end();
        const rest = pending[stream];
        pending[stream] = "";
        if (!rest) continue;
        for (const line of rest.split(/\r\n|\n|\r/)) {
          writeLog(line);
          emitLine(stream, line);
        }
      }
    }

    function closeLog() {
      if (!logStream) {
        logDone = true;
        return;
      }
      const stream = logStream;
      logStream = null;
      try {
        stream.end(() => {
          logDone = true;
          maybeSettle();
        });
        stream.on("error", (error) => {
          logError = String(error.message || error);
          logDone = true;
          maybeSettle();
        });
      } catch (error) {
        logError = String(error.message || error);
        logDone = true;
      }
    }

    function finishProcess() {
      if (processDone) return;
      processDone = true;
      flushStreams();
      closeLog();
      maybeSettle();
    }

    function maybeSettle() {
      if (settled || !processDone || !logDone) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);

      let error = null;
      if (spawnError) error = String(spawnError.message || spawnError);
      else if (timedOut) error = `Render timed out after ${timeout} ms.`;
      else if (status !== 0) {
        error = `Render exited with code ${status}${signal ? ` (signal ${signal})` : ""}.`;
      }

      resolve({
        ok: !spawnError && !timedOut && status === 0,
        status,
        stdout: captureText(stdout),
        stderr: captureText(stderr),
        error,
        timedOut,
        elapsedMs: Date.now() - startedAt,
        logPath: resolvedLogPath,
        logError,
        truncated: stdout.truncated || stderr.truncated,
      });
    }

    if (resolvedLogPath !== null) {
      try {
        fs.mkdirSync(path.dirname(resolvedLogPath), { recursive: true });
        logStream = fs.createWriteStream(resolvedLogPath, { flags: "a", encoding: "utf8" });
        logStream.on("error", (error) => {
          logBroken = true;
          logError = String(error.message || error);
          logDone = true;
          maybeSettle();
        });
        writeLog(`# ${[invocation.command, ...invocation.args].join(" ")}`);
        writeLog(`# started ${new Date(startedAt).toISOString()}`);
      } catch (error) {
        logError = String(error.message || error);
        logStream = null;
        logDone = true;
      }
    }

    let child;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: typeof cwd === "string" && cwd.trim() ? cwd : process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      spawnError = error;
      finishProcess();
      return;
    }

    child.stdout.on("data", (chunk) => consume("stdout", chunk));
    child.stderr.on("data", (chunk) => consume("stderr", chunk));

    child.on("error", (error) => {
      spawnError = error;
      // ENOENT and similar failures may never emit "close".
      if (!child.pid) finishProcess();
    });

    child.on("close", (code, exitSignal) => {
      status = typeof code === "number" ? code : null;
      signal = exitSignal || null;
      finishProcess();
    });

    const timeoutMs = finiteNumber(timeout);
    if (timeoutMs !== null && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        writeLog(`# timeout after ${timeoutMs} ms; killing process`);
        killTree(child);
        graceTimer = setTimeout(() => {
          finishProcess();
        }, KILL_GRACE_MS);
      }, timeoutMs);
    }
  });
}

/**
 * Write render metadata atomically (temp file + rename).
 *
 * The temp file lives in the target directory so the rename stays on the same
 * volume. On Windows, a locked target is unlinked and the rename retried.
 *
 * @param {string} file Target JSON file.
 * @param {object} meta Metadata object.
 * @returns {void}
 */
export function writeRenderMeta(file, meta) {
  const target = requireString(file, "file");
  if (!isObject(meta)) throw new TypeError("writeRenderMeta requires a meta object.");

  const directory = path.dirname(path.resolve(target));
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`
  );

  try {
    fs.writeFileSync(temp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(temp, target);
        return;
      } catch (error) {
        lastError = error;
        if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(error.code)) break;
        try {
          fs.unlinkSync(target);
        } catch {
          // The target may not exist; retry the rename anyway.
        }
      }
    }
    throw new Error(
      `Could not write render meta "${target}": ${lastError?.message || "rename failed"}.`
    );
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Temp cleanup is best effort.
    }
  }
}

/**
 * Read render metadata.
 *
 * @param {string} file JSON file.
 * @returns {object|null} Parsed object, or null when missing/invalid.
 */
export function readRenderMeta(file) {
  if (typeof file !== "string" || !file.trim()) return null;
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const data = JSON.parse(text);
    return isObject(data) ? data : null;
  } catch {
    return null;
  }
}

function durationTolerance(expected) {
  return clamp(expected * 0.02, DURATION_TOLERANCE_MIN, DURATION_TOLERANCE_MAX);
}

/**
 * Validate an ffprobe result against expected render properties.
 *
 * Tolerances: duration within max(0.5 s, 2% capped at 2 s); fps within max(0.05,
 * 0.2%); resolution must match exactly. Audio presence is required by default;
 * pass `requireAudio: false` for intentionally silent renders.
 *
 * @param {object|null} probe Result shaped like the CLI `probeMedia` output.
 * @param {object} [expected]
 * @param {number} [expected.width] Expected width.
 * @param {number} [expected.height] Expected height.
 * @param {number} [expected.fps] Expected frame rate.
 * @param {number} [expected.duration] Expected duration in seconds.
 * @param {boolean} [expected.requireAudio] Require an audio stream; default true.
 * @returns {{ok: boolean, issues: string[]}} Validation result.
 */
export function validateRenderProbe(
  probe,
  { width, height, fps, duration, requireAudio = true } = {}
) {
  if (!isObject(probe)) {
    return { ok: false, issues: ["probe: missing or invalid ffprobe result"] };
  }

  const issues = [];
  if (probe.error) issues.push(`probe: ${probe.error}`);

  const actualDuration = finiteNumber(probe.duration);
  const expectedDuration = positiveNumber(duration);
  if (expectedDuration !== null) {
    if (actualDuration === null) {
      issues.push("duration: missing from probe");
    } else {
      const tolerance = durationTolerance(expectedDuration);
      if (Math.abs(actualDuration - expectedDuration) > tolerance) {
        issues.push(
          `duration: expected ${formatNumber(expectedDuration)}s +/- ${formatNumber(
            tolerance
          )}s, got ${formatNumber(actualDuration)}s`
        );
      }
    }
  } else if (actualDuration !== null && actualDuration <= 0) {
    issues.push(`duration: must be positive, got ${formatNumber(actualDuration)}s`);
  }

  const expectedWidth = positiveNumber(width);
  const expectedHeight = positiveNumber(height);
  if (expectedWidth !== null || expectedHeight !== null) {
    const actualWidth = finiteNumber(probe.width);
    const actualHeight = finiteNumber(probe.height);
    if (
      (expectedWidth !== null && actualWidth !== expectedWidth) ||
      (expectedHeight !== null && actualHeight !== expectedHeight)
    ) {
      issues.push(
        `resolution: expected ${expectedWidth ?? "?"}x${expectedHeight ?? "?"}, got ${
          actualWidth ?? "?"
        }x${actualHeight ?? "?"}`
      );
    }
  }

  const expectedFps = positiveNumber(fps);
  if (expectedFps !== null) {
    const actualFps = finiteNumber(probe.fps);
    if (actualFps === null) {
      issues.push("fps: missing from probe");
    } else {
      const tolerance = Math.max(FPS_TOLERANCE_MIN, expectedFps * 0.002);
      if (Math.abs(actualFps - expectedFps) > tolerance) {
        issues.push(
          `fps: expected ${formatNumber(expectedFps)} +/- ${formatNumber(
            tolerance
          )}, got ${formatNumber(actualFps)}`
        );
      }
    }
  }

  if (requireAudio) {
    const hasAudio =
      probe.audio === true || (probe.audio === undefined && finiteNumber(probe.channels) > 0);
    if (!hasAudio) issues.push("audio: no audio stream detected");
  }

  return { ok: issues.length === 0, issues };
}
