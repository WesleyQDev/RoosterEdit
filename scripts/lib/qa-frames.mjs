/**
 * QA frame extraction helpers: one FFmpeg pass for a tiled contact sheet or for
 * a numbered frame sequence, plus a local content key for caching results.
 *
 * These helpers only build arguments and keys. They never spawn FFmpeg, read
 * media pixels, or write files other than a `stat` for the cache key.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FRAMES_KEY_SCHEMA = "rooster.qa-frames-key/v1";

// Used only when the caller cannot provide a duration. Sampling one frame every
// ten seconds is the same fallback used by the performance audit and avoids a
// `-ss` loop per frame.
const FALLBACK_RATE = "1/10";
const KEY_LENGTH = 32;

/**
 * Build FFmpeg args for a single contact-sheet image.
 *
 * The sheet samples `count` frames evenly across `duration` with one `fps`
 * filter, scales each frame, and tiles them into `cols` x `rows`. When
 * `duration` is absent, `fps` (or the 1/10 fallback) is used instead of a
 * per-frame seek loop.
 *
 * @param {{video:string,out:string,count?:number,cols?:number,scale?:number,duration?:number,fps?:string|number}} options
 * @returns {{args:string[],command:string,out:string,filter:string,count:number,cols:number,rows:number,scale:number,duration:number|null,rate:string}}
 */
export function contactSheetArgs({
  video,
  out,
  count = 12,
  cols = 4,
  scale = 480,
  duration,
  fps,
} = {}) {
  requireText(video, "video");
  requireText(out, "out");

  const options = normalizeOptions({ count, cols, scale, duration, fps });
  const filter = [
    `fps=${options.rate}`,
    `scale=${options.scale}:-1`,
    `tile=${options.cols}x${options.rows}`,
  ].join(",");
  const args = [
    "-y",
    "-i", String(video),
    "-an",
    "-vf", filter,
    "-frames:v", "1",
    "-q:v", "2",
    String(out),
  ];

  return {
    args,
    command: toCommand(args),
    out: String(out),
    filter,
    count: options.count,
    cols: options.cols,
    rows: options.rows,
    scale: options.scale,
    duration: options.duration,
    rate: options.rate,
  };
}

/**
 * Build FFmpeg args that extract a numbered JPEG sequence in one pass.
 *
 * When `duration` is known, a `select` expression picks one frame every
 * `duration / count` seconds and `-vsync vfr` drops the duplicate timestamps.
 * Without a duration, an `fps` sampler is used instead. Both paths are a single
 * FFmpeg pass and never use a per-frame `-ss` loop. The result is capped at
 * `count` files written to `<outDir>/<prefix>-%03d.jpg`.
 *
 * @param {{video:string,outDir:string,count?:number,scale?:number,duration?:number,prefix?:string,fps?:string|number}} options
 * @returns {{args:string[],command:string,outDir:string,pattern:string,filter:string,count:number,scale:number,duration:number|null,rate:string|null,step:number|null}}
 */
export function extractFramesArgs({
  video,
  outDir,
  count = 12,
  scale = 480,
  duration,
  prefix = "f",
  fps,
} = {}) {
  requireText(video, "video");
  requireText(outDir, "outDir");

  const options = normalizeOptions({ count, cols: 1, scale, duration, fps });
  const safePrefix = normalizePrefix(prefix);
  const pattern = path.join(String(outDir), `${safePrefix}-%03d.jpg`);
  const step = options.duration ? Number((options.duration / options.count).toFixed(6)) : null;
  const filter = step
    ? [
        `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${formatNumber(step)})'`,
        `scale=${options.scale}:-1`,
      ].join(",")
    : [`fps=${options.rate}`, `scale=${options.scale}:-1`].join(",");
  const args = [
    "-y",
    "-i", String(video),
    "-an",
    "-vf", filter,
    "-vsync", "vfr",
    "-frames:v", String(options.count),
    "-q:v", "2",
    pattern,
  ];

  return {
    args,
    command: toCommand(args),
    outDir: String(outDir),
    pattern,
    filter,
    count: options.count,
    scale: options.scale,
    duration: options.duration,
    rate: step ? null : options.rate,
    step,
  };
}

/**
 * Local cache key for a QA frame artifact.
 *
 * The key includes the mode, sampling options, and a cheap file fingerprint
 * (resolved path, size, mtime). It does not hash media bytes.
 *
 * @param {{video:string,count?:number,cols?:number,scale?:number,mode?:string}} options
 * @returns {string} 32 lowercase hex characters.
 */
export function framesKey({ video, count = 12, cols = 4, scale = 480, mode = "sheet" } = {}) {
  requireText(video, "video");

  const options = normalizeOptions({ count, cols, scale });
  const canonical = JSON.stringify({
    schema: FRAMES_KEY_SCHEMA,
    mode: String(mode || "sheet").toLowerCase(),
    count: options.count,
    cols: options.cols,
    scale: options.scale,
    video: videoFingerprint(video),
  });

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, KEY_LENGTH);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function normalizeOptions({ count, cols, scale, duration, fps } = {}) {
  const frameCount = positiveInt(count, "count", 12);
  const columns = positiveInt(cols, "cols", 4);
  const width = positiveInt(scale, "scale", 480);
  const seconds = finitePositive(duration);

  let rate;
  if (seconds) {
    const value = frameCount / seconds;
    rate = String(Number(value.toFixed(6)));
  } else if (fps !== undefined && fps !== null && fps !== "") {
    rate = String(fps).trim() || FALLBACK_RATE;
  } else {
    rate = FALLBACK_RATE;
  }

  return {
    count: frameCount,
    cols: columns,
    rows: Math.ceil(frameCount / columns),
    scale: width,
    duration: seconds,
    rate,
  };
}

function positiveInt(value, name, fallback) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 1) {
    throw new RangeError(`${name} must be a positive number.`);
  }
  return Math.max(1, Math.round(number));
}

function finitePositive(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizePrefix(value) {
  const clean = String(value ?? "f")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "f";
}

function videoFingerprint(video) {
  const resolved = path.resolve(String(video));
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  let fingerprint = { path: normalized, size: null, mtimeMs: null };

  try {
    const stat = fs.statSync(resolved);
    fingerprint = {
      path: normalized,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs * 1000) / 1000,
    };
  } catch {
    // Missing files still get a deterministic key; FFmpeg will report the error.
  }

  return fingerprint;
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} is required.`);
  }
}

function formatNumber(value) {
  return String(Number(value));
}

function toCommand(args) {
  return args
    .map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ");
}
