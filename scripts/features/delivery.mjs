/**
 * Delivery helpers for RoosterEdit: metadata and thumbnails.
 *
 * Builds a portable `metadata.json` object from the project, plan, and render
 * probe, and prepares (or optionally runs) an FFmpeg thumbnail extraction.
 * No work happens at import time.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const METADATA_SCHEMA = "rooster.metadata/v1";

/**
 * Build a delivery metadata object.
 *
 * Precedence: render probe values beat plan values, which beat project format
 * values. `chapters` overrides plan/project chapters when passed explicitly.
 *
 * @param {{project?: object, plan?: object, render?: string|object|null, chapters?: object[]}} [options] Project data.
 * @returns {object} `rooster.metadata/v1` object.
 */
export function buildMetadata({ project = {}, plan = {}, render = null, chapters } = {}) {
  if (!isObject(project)) throw new TypeError("project must be an object.");
  if (!isObject(plan)) throw new TypeError("plan must be an object.");

  const format = isObject(project.format) ? project.format : {};
  const info = normalizeRender(render);
  const width = info.width || positiveNumber(format.width);
  const height = info.height || positiveNumber(format.height);
  const duration =
    info.duration ||
    positiveNumber(plan.duration) ||
    positiveNumber(format.duration) ||
    null;
  const fps = info.fps || positiveNumber(format.fps) || positiveNumber(plan.fps) || 30;

  let aspectRatio = width && height ? deriveAspect(width, height) : cleanTitle(format.aspect);
  if (!aspectRatio || aspectRatio === "custom") aspectRatio = deriveAspect(width, height);

  const title =
    cleanTitle(plan.title) ||
    cleanTitle(project.title) ||
    cleanTitle(project.name) ||
    titleFromSlug(project.slug || plan.slug) ||
    "Untitled";

  const description = cleanDescription(plan.description || plan.summary || project.description);
  const tags = normalizeTags(project.tags, plan.tags);
  const chapterSource = chapters !== undefined ? chapters : plan.chapters ?? project.chapters;
  const normalizedChapters = normalizeChapters(chapterSource, duration);

  const files = {
    video: normalizeFile(info.video),
    captions: {
      srt: normalizeFile(info.srt),
      vtt: normalizeFile(info.vtt),
      json: normalizeFile(info.captionsJson),
    },
    thumbnail: normalizeFile(info.thumbnail),
  };

  return {
    schema: METADATA_SCHEMA,
    title,
    description,
    tags,
    chapters: normalizedChapters,
    aspectRatio: aspectRatio || null,
    width: width || null,
    height: height || null,
    duration,
    fps,
    files,
    language: cleanTitle(project.language || plan.language) || null,
    slug: cleanTitle(project.slug || plan.slug) || null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build FFmpeg args to extract one JPEG or PNG thumbnail. No process is executed.
 *
 * @param {{video: string, out: string, time?: number|string, width?: number, height?: number, quality?: number}} options Extraction options.
 * @returns {{args: string[], command: string, out: string, time: string}} Args and printable command.
 */
export function thumbnailArgs({ video, out, time = 1, width, height, quality = 2 } = {}) {
  if (!video) throw new TypeError("thumbnailArgs requires video.");
  if (!out) throw new TypeError("thumbnailArgs requires out.");

  const extension = path.extname(String(out)).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(extension)) {
    throw new RangeError("Thumbnail output must be .jpg, .jpeg, or .png.");
  }

  const seek = formatSeek(time);
  const jpegQuality = Number(quality);
  if (extension !== ".png" && (!Number.isInteger(jpegQuality) || jpegQuality < 2 || jpegQuality > 31)) {
    throw new RangeError("JPEG quality must be an integer from 2 to 31.");
  }

  const args = ["-y", "-ss", seek, "-i", String(video), "-frames:v", "1"];
  const scale = scaleFilter(width, height);
  if (scale) args.push("-vf", scale);
  args.push("-update", "1");
  if (extension === ".png") args.push("-c:v", "png");
  else args.push("-q:v", String(jpegQuality));
  args.push(String(out));

  return { args, command: toCommand(args), out: String(out), time: seek };
}

/**
 * Extract a thumbnail with FFmpeg. This is opt-in: it runs a child process only
 * when called. Failures are returned, not thrown.
 *
 * @param {{video: string, out: string, time?: number|string, width?: number, height?: number, quality?: number, ffmpegPath?: string, timeout?: number}} options Extraction options.
 * @returns {{ok: boolean, status: number|null, out: string, bytes: number, args: string[], command: string, error: string|null, stdout: string, stderr: string}} Result.
 */
export function createThumbnail({
  video,
  out,
  time = 1,
  width,
  height,
  quality = 2,
  ffmpegPath = "ffmpeg",
  timeout = 120000,
} = {}) {
  if (!video) throw new TypeError("createThumbnail requires video.");
  if (!out) throw new TypeError("createThumbnail requires out.");

  const target = path.resolve(String(out));
  const plan = thumbnailArgs({ video, out: target, time, width, height, quality });
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const result = spawnSync(ffmpegPath, plan.args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  let bytes = 0;
  try {
    if (fs.existsSync(target)) bytes = fs.statSync(target).size;
  } catch {
    bytes = 0;
  }

  const ok = !result.error && result.status === 0 && bytes > 0;
  let error = null;
  if (result.error) error = String(result.error.message || result.error);
  else if (result.status !== 0) error = "FFmpeg exited with an error.";
  else if (!bytes) error = "FFmpeg did not write a thumbnail.";

  return {
    ok,
    status: result.status ?? null,
    out: target,
    bytes,
    args: plan.args,
    command: plan.command,
    time: plan.time,
    error,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRender(render) {
  if (!render) return {};
  if (typeof render === "string") return { video: render };
  if (!isObject(render)) return {};

  const fileSet = isObject(render.files) ? render.files : {};
  const captions = isObject(render.captions)
    ? render.captions
    : isObject(fileSet.captions)
      ? fileSet.captions
      : {};
  const probe = isObject(render.probe) ? render.probe : {};

  return {
    video: render.video || render.path || render.file || render.output || fileSet.video || null,
    srt: render.srt || captions.srt || null,
    vtt: render.vtt || captions.vtt || null,
    captionsJson: render.captionsJson || render.captions_json || captions.json || null,
    thumbnail: render.thumbnail || fileSet.thumbnail || null,
    width: positiveNumber(render.width, probe.width),
    height: positiveNumber(render.height, probe.height),
    duration: positiveNumber(render.duration, probe.duration),
    fps: positiveNumber(render.fps, probe.fps),
  };
}

function normalizeChapters(value, duration) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const chapters = [];

  for (let index = 0; index < value.length; index++) {
    const chapter = value[index];
    if (!isObject(chapter)) continue;
    const start = Number(chapter.start);
    if (!Number.isFinite(start) || start < 0) continue;
    if (duration && start > duration + 0.5) continue;

    const key = start.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);

    chapters.push({
      start: round(start, 3),
      title: cleanTitle(chapter.title),
    });
  }

  chapters.sort((a, b) => a.start - b.start);
  return chapters.map((chapter, index) => ({
    start: chapter.start,
    end: index + 1 < chapters.length ? chapters[index + 1].start : duration || null,
    title: chapter.title || `Chapter ${index + 1}`,
    timestamp: formatClock(chapter.start),
  }));
}

function normalizeTags(...lists) {
  const seen = new Set();
  const tags = [];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value !== "string") continue;
      const tag = value.replace(/\s+/g, " ").trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }

  return tags;
}

function deriveAspect(width, height) {
  const w = positiveNumber(width);
  const h = positiveNumber(height);
  if (!w || !h) return null;
  const divisor = gcd(Math.round(w), Math.round(h));
  return `${Math.round(w) / divisor}:${Math.round(h) / divisor}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

function formatSeek(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("time must be a non-negative number of seconds.");
    }
    return String(value);
  }

  const text = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return text;
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(text)) return text;
  throw new RangeError("time must be seconds or HH:MM:SS(.ms).");
}

function scaleFilter(width, height) {
  const w = positiveInteger(width);
  const h = positiveInteger(height);
  if (w && h) return `scale=${w}:${h}`;
  if (w) return `scale=${w}:-2`;
  if (h) return `scale=-2:${h}`;
  return null;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function positiveInteger(value) {
  const number = positiveNumber(value);
  return number && Number.isInteger(number) ? number : null;
}

function cleanTitle(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanDescription(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function titleFromSlug(value) {
  const slug = cleanTitle(value);
  if (!slug) return "";
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeFile(value) {
  const file = String(value ?? "").trim();
  return file ? file.replace(/\\/g, "/") : null;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toCommand(args) {
  return ["ffmpeg", ...args].map(quoteArg).join(" ");
}

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
