/**
 * Media helpers: source fingerprints, ffprobe caching, and encoder selection.
 *
 * I/O is injected at the edges (`run`, `cache`, `hashFile`, `stat`) so callers
 * control subprocesses and storage. This module does not import exec/cache
 * modules and never spawns FFmpeg on import.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROBE_TIMEOUT_MS = 30000;
const ENCODER_CACHE_KEY = "ffmpeg-encoders";
const ENCODER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const DRAFT_ENCODER_ORDER = [
  "h264_nvenc",
  "h264_amf",
  "h264_qsv",
  "h264_videotoolbox",
  "libx264",
];

function toText(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function canonicalPath(file) {
  const resolved = path.resolve(String(file));
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function statFile(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/**
 * SHA-256 for a file in chunks. Synchronous by design: cache keys are built in
 * synchronous code paths. Callers can inject their own `hashFile` instead.
 */
function hashFileLocal(file, { chunkSize = 1024 * 1024 } = {}) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(chunkSize);
    let read = 0;
    while ((read = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Cheap and (optionally) content-addressed source identity.
 *
 * @param {string} file
 * @param {{ full?: boolean, hashFile?: (file: string, options?: object) => string }} [options]
 * @returns {{ path: string, size: number, mtimeMs: number, sha256?: string|null } | null}
 */
export function sourceFingerprint(file, options = {}) {
  options = options || {};
  if (!file) return null;
  const full = Boolean(options.full);
  const resolved = canonicalPath(file);
  const stats = statFile(resolved);
  if (!stats || !stats.isFile()) return null;

  const fingerprint = {
    path: resolved,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
  if (!full) return fingerprint;

  let sha256 = null;
  try {
    const value =
      typeof options.hashFile === "function"
        ? options.hashFile(resolved, { size: stats.size, mtimeMs: stats.mtimeMs })
        : hashFileLocal(resolved);
    if (value && typeof value.then === "function") {
      throw new TypeError("sourceFingerprint: hashFile must be synchronous");
    }
    if (typeof value === "string") sha256 = value;
    else if (value && typeof value.sha256 === "string") sha256 = value.sha256;
    else if (value && typeof value.hash === "string") sha256 = value.hash;
  } catch (error) {
    if (error instanceof TypeError && /must be synchronous/.test(error.message)) throw error;
    sha256 = null;
  }

  return { ...fingerprint, sha256 };
}

/**
 * Parse ffprobe `-of json` output into the shape used by the CLI.
 *
 * @param {string|object} text
 * @returns {object}
 */
export function parseProbeJson(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch (error) {
    return { error: `Could not parse ffprobe output: ${error.message}` };
  }
  if (!data || typeof data !== "object") {
    return { error: "Could not parse ffprobe output: empty result" };
  }

  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream && stream.codec_type === "video") || {};
  const audio = streams.find((stream) => stream && stream.codec_type === "audio") || {};
  const rate = String(
    video.avg_frame_rate && video.avg_frame_rate !== "0/0"
      ? video.avg_frame_rate
      : video.r_frame_rate || "0/1"
  );
  const [numerator, denominator] = rate.split("/").map(Number);
  const fps = denominator && numerator > 0 ? Number((numerator / denominator).toFixed(3)) : null;

  return {
    duration: Number(data.format?.duration) || null,
    bytes: Number(data.format?.size) || null,
    bitRate: Number(data.format?.bit_rate) || null,
    format: data.format?.format_name || null,
    width: video.width || null,
    height: video.height || null,
    fps: Number.isFinite(fps) ? fps : null,
    codec: video.codec_name || null,
    audio: Boolean(audio.codec_name),
    channels: Number(audio.channels) || null,
    sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
  };
}

/**
 * Stable cache key for a probe: realpath + size + mtime + ffprobe version.
 *
 * @param {string} file
 * @param {{ ffprobeVersion?: string|null, stat?: object|Function }} [options]
 * @returns {string|null}
 */
export function probeKey(file, options = {}) {
  options = options || {};
  if (!file) return null;
  const resolved = canonicalPath(file);

  let stats = options.stat;
  if (typeof stats === "function") {
    try {
      stats = stats(resolved);
    } catch {
      stats = null;
    }
  }
  if (!stats) stats = statFile(resolved);
  if (!stats) return null;

  const size = Number(stats.size);
  const mtimeMs = Number(stats.mtimeMs);
  if (!Number.isFinite(size) && !Number.isFinite(mtimeMs)) return null;
  const payload = JSON.stringify({
    path: resolved,
    size: Number.isFinite(size) ? size : null,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null,
    ffprobeVersion: options.ffprobeVersion ? String(options.ffprobeVersion) : null,
  });

  return `probe-${sha256Hex(payload).slice(0, 32)}`;
}

/**
 * FFmpeg arguments for ffprobe JSON output.
 *
 * @param {string} file
 * @returns {string[]}
 */
export function buildProbeArgs(file) {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate,format_name",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate",
    "-of",
    "json",
    String(file ?? ""),
  ];
}

function normalizeRunResult(result) {
  if (result == null) return { ok: false, stdout: "", stderr: "", error: null };
  if (typeof result === "string") {
    return { ok: Boolean(result.trim()), stdout: result, stderr: "", error: null };
  }
  const stdout = toText(result.stdout);
  const stderr = toText(result.stderr);
  let ok;
  if (typeof result.ok === "boolean") ok = result.ok;
  else if (typeof result.code === "number") ok = result.code === 0;
  else if (typeof result.status === "number") ok = result.status === 0;
  else ok = Boolean(stdout.trim() || stderr.trim());
  return { ok, stdout, stderr, error: result.error ? String(result.error) : null };
}

async function cacheRead(cache, key) {
  if (!cache || !key) return null;
  const fn = cache.read || cache.get || cache.load;
  if (typeof fn !== "function") return null;
  try {
    return await fn.call(cache, key);
  } catch {
    return null;
  }
}

function parseCachedValue(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function cacheWrite(cache, key, value) {
  if (!cache || !key) return false;
  const fn = cache.write || cache.set || cache.save;
  if (typeof fn !== "function") return false;
  try {
    await fn.call(cache, key, value);
    return true;
  } catch {
    return false;
  }
}

async function ffprobeVersion(run) {
  try {
    const result = normalizeRunResult(
      await run("ffprobe", ["-version"], { timeout: 15000 })
    );
    if (!result.ok) return null;
    const line = (result.stdout || result.stderr).split(/\r?\n/).find((value) => value.trim());
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Probe a media file, reusing a cached result when the content fingerprint
 * matches. Errors are returned as `{ error }` and are never cached.
 *
 * @param {string} file
 * @param {{
 *   run?: Function,
 *   workspace?: string,
 *   refresh?: boolean,
 *   cache?: { read?: Function, write?: Function, get?: Function, set?: Function },
 *   ffprobeVersion?: string|null,
 * }} [options]
 */
export async function probeMedia(file, options = {}) {
  options = options || {};
  if (!file) return { error: "No media file provided" };
  const run = options.run;
  const cache = options.cache || null;
  const refresh = Boolean(options.refresh);

  let version = options.ffprobeVersion || null;
  if (!version && cache && typeof run === "function") version = await ffprobeVersion(run);

  const key = probeKey(file, { ffprobeVersion: version });
  if (cache && key && !refresh) {
    const cached = parseCachedValue(await cacheRead(cache, key));
    if (cached && typeof cached === "object" && !cached.error) return cached;
  }

  if (typeof run !== "function") {
    return { error: "run is required to probe media" };
  }

  let result;
  try {
    result = normalizeRunResult(await run("ffprobe", buildProbeArgs(file), { timeout: PROBE_TIMEOUT_MS }));
  } catch (error) {
    return { error: String(error?.message || error) };
  }

  if (!result.ok) {
    return { error: result.stderr || result.error || "ffprobe failed" };
  }

  const parsed = parseProbeJson(result.stdout);
  if (parsed.error) return parsed;

  if (cache && key) await cacheWrite(cache, key, parsed);
  return parsed;
}

const ENCODER_LINE =
  /^\s*([VAS])([.A-Z]{5})\s+(\S+)\s*(.*)$/;

/**
 * Parse `ffmpeg -encoders` output.
 *
 * @param {string} text
 * @returns {Array<{ name: string, type: "video"|"audio"|"subtitle", description: string }>}
 */
export function parseEncoders(text) {
  if (!text) return [];
  const types = { V: "video", A: "audio", S: "subtitle" };
  const encoders = [];
  const seen = new Set();

  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.includes("=") && /^\s*[VAS]\.{5}\s*=/.test(line)) continue;
    const match = ENCODER_LINE.exec(line);
    if (!match) continue;
    const [, flag, , name, description] = match;
    if (!name || name === "=") continue;
    const type = types[flag];
    if (!type) continue;
    const key = `${type}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    encoders.push({
      name,
      type,
      description: String(description || "").trim(),
    });
  }

  return encoders;
}

/**
 * List FFmpeg encoders, optionally cached. Returns [] when FFmpeg is missing.
 *
 * @param {{ run?: Function, refresh?: boolean, cache?: object, now?: number }} [options]
 */
export async function detectEncoders(options = {}) {
  options = options || {};
  const run = options.run;
  const cache = options.cache || null;
  const refresh = Boolean(options.refresh);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (cache && !refresh) {
    const cached = parseCachedValue(await cacheRead(cache, ENCODER_CACHE_KEY));
    if (Array.isArray(cached)) return cached;
    if (
      cached &&
      typeof cached === "object" &&
      Array.isArray(cached.encoders) &&
      Number.isFinite(Number(cached.savedAt)) &&
      now - Number(cached.savedAt) <= ENCODER_CACHE_TTL_MS
    ) {
      return cached.encoders;
    }
  }

  if (typeof run !== "function") return [];

  let result;
  try {
    result = normalizeRunResult(
      await run("ffmpeg", ["-hide_banner", "-encoders"], { timeout: PROBE_TIMEOUT_MS })
    );
  } catch {
    return [];
  }

  if (!result.ok) return [];
  const encoders = parseEncoders(result.stdout || result.stderr);
  if (cache && encoders.length > 0) {
    await cacheWrite(cache, ENCODER_CACHE_KEY, {
      schema: "rooster.encoders/v1",
      savedAt: now,
      encoders,
    });
  }
  return encoders;
}

function encoderName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.name === "string") return value.name;
  return null;
}

/**
 * Pick a video encoder. Draft prefers hardware; final prefers libx264 unless
 * the caller passes an explicit `override`/`encoder`.
 *
 * @param {{
 *   quality?: string,
 *   available?: Array<string|{name: string}>,
 *   platform?: NodeJS.Platform,
 *   override?: string,
 *   encoder?: string,
 * }} [options]
 * @returns {string|null}
 */
export function pickEncoder(options = {}) {
  options = options || {};
  const quality = String(options.quality || "draft").toLowerCase();
  const final = quality === "final" || quality === "delivery";
  const available = new Set(
    (Array.isArray(options.available) ? options.available : [])
      .map(encoderName)
      .filter(Boolean)
  );

  const explicit =
    typeof options.override === "string"
      ? options.override
      : typeof options.encoder === "string"
        ? options.encoder
        : null;
  if (explicit) return explicit;

  if (final) {
    if (available.size === 0 || available.has("libx264")) return "libx264";
    return null;
  }

  for (const name of DRAFT_ENCODER_ORDER) {
    if (available.has(name)) return name;
  }
  if (available.size === 0) return "libx264";
  return null;
}
