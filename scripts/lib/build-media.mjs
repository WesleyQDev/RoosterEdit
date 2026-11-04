/**
 * FFmpeg argument builders and engine-cache preservation for the build stage.
 *
 * Everything here is pure except `preserveEngineCaches` / `restoreEngineCaches`,
 * which only move files. No process is spawned in this module.
 */

import fs from "node:fs";
import path from "node:path";
import {
  audioOutputArgs,
  buildTimelineAudioGraph,
  loudnormFilter,
} from "../features/audio.mjs";

/** Engine cache directories that must survive a forced rebuild. */
export const ENGINE_CACHE_NAMES = [".transcode-cache", ".waveform-cache"];

const AUDIO_ONLY_EXT = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".caf",
  ".flac",
  ".m4a",
  ".m4b",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
]);

function formatNumber(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return String(Number(number.toFixed(digits)));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function isAudioOnlyPath(file) {
  return AUDIO_ONLY_EXT.has(path.extname(String(file || "")).toLowerCase());
}

function booleanOr(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return fallback;
}

/**
 * Build encoder-specific video arguments.
 *
 * Hardware encoders accept different quality flags than libx264/libx265, so a
 * plain `-crf` for every encoder would fail at runtime.
 *
 * @param {{encoder?: string, crf?: number, preset?: string}} options
 * @returns {string[]}
 */
function videoEncoderArgs({ encoder = "libx264", crf = 20, preset = "veryfast" } = {}) {
  const name = String(encoder || "libx264").trim();
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new TypeError(`buildBaseMediaArgs: invalid encoder "${name}"`);
  }
  if (name === "copy") return ["-c:v", "copy"];

  const quality = Number(crf);
  if (!Number.isFinite(quality) || quality < 0 || quality > 63) {
    throw new RangeError("buildBaseMediaArgs: crf must be between 0 and 63");
  }
  const q = String(quality);
  const presetName = String(preset || "").trim();

  switch (name) {
    case "h264_nvenc": {
      const speed = /^p[1-7]$/.test(presetName) ? presetName : "p4";
      return ["-c:v", name, "-preset", speed, "-rc", "vbr", "-cq", q];
    }
    case "h264_amf": {
      const speed = ["speed", "balanced", "quality"].includes(presetName)
        ? presetName
        : "speed";
      return [
        "-c:v",
        name,
        "-quality",
        speed,
        "-rc",
        "cqp",
        "-qp_i",
        q,
        "-qp_p",
        q,
      ];
    }
    case "h264_qsv":
      return ["-c:v", name, "-preset", presetName || "veryfast", "-global_quality", q];
    case "h264_videotoolbox":
      return ["-c:v", name, "-q:v", q];
    default:
      return ["-c:v", name, "-preset", presetName || "veryfast", "-crf", q];
  }
}

/**
 * Normalize and validate keeps for `buildBaseMediaArgs`.
 *
 * A single keep that covers the full `duration` is treated as "no cuts" so the
 * caller can stream-copy instead of re-encoding.
 *
 * @param {Array<{start:number,end:number}>|null|undefined} keeps
 * @param {number|null} duration
 * @returns {Array<{start:number,end:number}>}
 */
function normalizeBaseKeeps(keeps, duration) {
  if (keeps === undefined || keeps === null) return [];
  if (!Array.isArray(keeps)) {
    throw new TypeError("buildBaseMediaArgs: keeps must be an array");
  }
  if (!keeps.length) return [];

  const result = keeps.map((keep, index) => {
    if (!keep || typeof keep !== "object") {
      throw new TypeError(`buildBaseMediaArgs: keeps[${index}] must be an object`);
    }
    const start = Number(keep.start);
    const end = Number(keep.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new TypeError(`buildBaseMediaArgs: keeps[${index}] needs numeric start/end`);
    }
    if (end <= start) {
      throw new RangeError(`buildBaseMediaArgs: keeps[${index}] must end after it starts`);
    }
    return { start: Math.max(0, start), end };
  });

  const total = Number(duration);
  if (
    result.length === 1 &&
    Number.isFinite(total) &&
    total > 0 &&
    result[0].start <= 0.001 &&
    result[0].end >= total - 0.001
  ) {
    return [];
  }
  return result;
}

/**
 * Build FFmpeg args for the fused timeline audio pass.
 *
 * Input order is: source, music (looped), voice lines, SFX clips. The graph
 * cuts source audio with `atrim`/`concat`, mixes voice/music/SFX, and applies
 * exactly one `loudnorm` at the end.
 *
 * @param {object} options
 * @param {string} options.source Source media path.
 * @param {Array<{start:number,end:number}>} [options.keeps] Source keeps.
 * @param {Array<object>|{lines:Array<object>}|null} [options.voiceover]
 * @param {object|string|null} [options.music]
 * @param {Array<object>|null} [options.sfx]
 * @param {number} options.duration Timeline duration in seconds.
 * @param {string} options.out Output audio path (`.m4a`, `.wav`, ...).
 * @param {boolean|string|object|null} [options.loudnorm=true]
 * @param {number} [options.sampleRate=48000]
 * @param {boolean} [options.hasAudio=true] Whether the source has an audio stream.
 * @returns {string[]} FFmpeg args, without the executable name.
 */
export function buildTimelineAudioArgs({
  source,
  keeps,
  voiceover,
  music,
  sfx,
  duration,
  out,
  loudnorm = true,
  sampleRate = 48000,
  hasAudio = true,
} = {}) {
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("buildTimelineAudioArgs: source is required");
  }
  if (typeof out !== "string" || !out.trim()) {
    throw new TypeError("buildTimelineAudioArgs: out is required");
  }
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("buildTimelineAudioArgs: duration must be a positive number");
  }
  const rate = Math.trunc(
    Number(sampleRate === undefined || sampleRate === null || sampleRate === "" ? 48000 : sampleRate)
  );
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("buildTimelineAudioArgs: sampleRate must be a positive number");
  }

  const graph = buildTimelineAudioGraph({
    duration: total,
    hasSourceAudio: booleanOr(hasAudio, true),
    keeps,
    voiceover,
    music,
    sfx,
    loudnorm,
    sampleRate: rate,
  });

  const args = ["-y", "-i", source.trim()];
  if (graph.music) {
    args.push("-stream_loop", "-1", "-i", graph.music.src);
  }
  for (const line of graph.voiceLines) args.push("-i", line.src);
  for (const clip of graph.sfxClips) args.push("-i", clip.src);

  args.push("-filter_complex", graph.filterComplex, "-map", `[${graph.outputLabel}]`);
  args.push(
    ...audioOutputArgs(out),
    "-ar",
    String(rate),
    "-ac",
    "2",
    "-t",
    formatNumber(total, 3),
    out.trim()
  );

  return args;
}

/**
 * Build FFmpeg args for the cut/base media stage.
 *
 * With no cuts, streams are copied (video) and audio is only re-encoded when a
 * loudness pass is requested. With cuts, the video and/or audio are trimmed and
 * concatenated in one filter graph.
 *
 * @param {object} options
 * @param {string} options.source Source media path.
 * @param {Array<{start:number,end:number}>} [options.keeps] Source keeps.
 * @param {string} options.out Output path.
 * @param {boolean} [options.hasVideo=true]
 * @param {boolean} [options.hasAudio=true]
 * @param {string} [options.encoder="libx264"]
 * @param {number} [options.crf=20]
 * @param {string} [options.preset="veryfast"]
 * @param {boolean|string|object|null} [options.loudnorm=true]
 * @param {number|null} [options.duration] Full source duration, used to detect
 *   a single full-length keep and skip the cut pass.
 * @param {number} [options.sampleRate=48000]
 * @returns {string[]} FFmpeg args, without the executable name.
 */
export function buildBaseMediaArgs({
  source,
  keeps,
  out,
  hasVideo = true,
  hasAudio = true,
  encoder = "libx264",
  crf = 20,
  preset = "veryfast",
  loudnorm = true,
  duration = null,
  sampleRate = 48000,
} = {}) {
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("buildBaseMediaArgs: source is required");
  }
  if (typeof out !== "string" || !out.trim()) {
    throw new TypeError("buildBaseMediaArgs: out is required");
  }

  const video = booleanOr(hasVideo, true);
  const audio = booleanOr(hasAudio, true);
  if (!video && !audio) {
    throw new Error("buildBaseMediaArgs: source has neither video nor audio");
  }
  if (video && isAudioOnlyPath(out)) {
    throw new TypeError("buildBaseMediaArgs: out must be a video container when hasVideo is true");
  }

  const rate = Math.trunc(
    Number(sampleRate === undefined || sampleRate === null || sampleRate === "" ? 48000 : sampleRate)
  );
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("buildBaseMediaArgs: sampleRate must be a positive number");
  }

  const cutList = normalizeBaseKeeps(keeps, duration);
  const norm = audio ? loudnormFilter(loudnorm) : null;
  const sourcePath = source.trim();
  const outPath = out.trim();
  const quality = crf === undefined || crf === null || crf === "" ? 20 : crf;
  const speedPreset =
    preset === undefined || preset === null || preset === "" ? "veryfast" : preset;
  if (cutList.length && String(encoder).trim() === "copy") {
    throw new Error("buildBaseMediaArgs: encoder cannot be \"copy\" when applying cuts");
  }

  if (!cutList.length) {
    const args = ["-y", "-i", sourcePath];
    if (video) args.push("-map", "0:v:0");
    if (audio) args.push("-map", "0:a:0");

    if (audio && norm) {
      if (video) args.push("-c:v", "copy");
      args.push("-af", norm);
      args.push(...audioOutputArgs(outPath), "-ar", String(rate), "-ac", "2");
    } else {
      args.push("-c", "copy");
    }

    args.push(outPath);
    return args;
  }

  const chains = [];
  const videoLabels = [];
  const audioLabels = [];

  cutList.forEach((keep, index) => {
    if (video) {
      chains.push(
        `[0:v]trim=start=${formatNumber(keep.start)}:end=${formatNumber(keep.end)},` +
          `setpts=PTS-STARTPTS[bv${index}]`
      );
      videoLabels.push(`[bv${index}]`);
    }
    if (audio) {
      chains.push(
        `[0:a]atrim=start=${formatNumber(keep.start)}:end=${formatNumber(keep.end)},` +
          `asetpts=PTS-STARTPTS[ba${index}]`
      );
      audioLabels.push(`[ba${index}]`);
    }
  });

  let videoLabel = null;
  let audioLabel = null;

  if (video && audio) {
    if (cutList.length === 1) {
      videoLabel = "bv0";
      audioLabel = "ba0";
    } else {
      const pairs = cutList.map((_, index) => `[bv${index}][ba${index}]`).join("");
      chains.push(
        `${pairs}concat=n=${cutList.length}:v=1:a=1[basev][basea]`
      );
      videoLabel = "basev";
      audioLabel = "basea";
    }
  } else if (video) {
    if (cutList.length === 1) {
      videoLabel = "bv0";
    } else {
      chains.push(
        `${videoLabels.join("")}concat=n=${cutList.length}:v=1:a=0[basev]`
      );
      videoLabel = "basev";
    }
  } else if (audio) {
    if (cutList.length === 1) {
      audioLabel = "ba0";
    } else {
      chains.push(
        `${audioLabels.join("")}concat=n=${cutList.length}:v=0:a=1[basea]`
      );
      audioLabel = "basea";
    }
  }

  if (audio && norm) {
    chains.push(`[${audioLabel}]${norm}[aout]`);
    audioLabel = "aout";
  }

  const args = ["-y", "-i", sourcePath, "-filter_complex", chains.join(";")];
  if (video) args.push("-map", `[${videoLabel}]`);
  if (audio) args.push("-map", `[${audioLabel}]`);

  if (video) args.push(...videoEncoderArgs({ encoder, crf: quality, preset: speedPreset }));
  if (audio) {
    args.push(...audioOutputArgs(outPath), "-ar", String(rate), "-ac", "2");
  }
  args.push(outPath);
  return args;
}

/**
 * Move engine caches out of the engine directory before a forced rebuild.
 *
 * @param {string} engineDir Engine project directory.
 * @param {string} cacheDir Directory that keeps the preserved caches.
 * @returns {{engineDir:string,cacheDir:string,moved:Array<object>,missing:string[]}}
 */
export function preserveEngineCaches(engineDir, cacheDir) {
  const { engine, cache } = cacheLocation(engineDir, cacheDir);
  const result = { engineDir: engine, cacheDir: cache, moved: [], missing: [] };

  if (!pathExists(engine)) {
    result.missing = [...ENGINE_CACHE_NAMES];
    return result;
  }

  ensureDir(cache);
  for (const name of ENGINE_CACHE_NAMES) {
    const from = path.join(engine, name);
    const to = path.join(cache, name);
    if (!pathExists(from)) {
      result.missing.push(name);
      continue;
    }
    movePath(from, to);
    result.moved.push({ name, from, to });
  }

  return result;
}

/**
 * Restore engine caches after a rebuild.
 *
 * A cache recreated by the rebuild is replaced by the preserved copy.
 *
 * @param {string} engineDir Engine project directory.
 * @param {string} cacheDir Directory holding the preserved caches.
 * @returns {{engineDir:string,cacheDir:string,restored:Array<object>,missing:string[]}}
 */
export function restoreEngineCaches(engineDir, cacheDir) {
  const { engine, cache } = cacheLocation(engineDir, cacheDir);
  const result = { engineDir: engine, cacheDir: cache, restored: [], missing: [] };

  if (!pathExists(cache)) {
    result.missing = [...ENGINE_CACHE_NAMES];
    return result;
  }

  ensureDir(engine);
  for (const name of ENGINE_CACHE_NAMES) {
    const from = path.join(cache, name);
    const to = path.join(engine, name);
    if (!pathExists(from)) {
      result.missing.push(name);
      continue;
    }
    movePath(from, to);
    result.restored.push({ name, from, to });
  }

  return result;
}

/**
 * Validate and resolve engine/cache locations.
 *
 * @param {string} engineDir
 * @param {string} cacheDir
 * @returns {{engine:string,cache:string}}
 */
function cacheLocation(engineDir, cacheDir) {
  if (typeof engineDir !== "string" || !engineDir.trim()) {
    throw new TypeError("Engine cache helpers: engineDir is required");
  }
  if (typeof cacheDir !== "string" || !cacheDir.trim()) {
    throw new TypeError("Engine cache helpers: cacheDir is required");
  }
  const engine = path.resolve(engineDir);
  const cache = path.resolve(cacheDir);
  const relative = path.relative(engine, cache);
  if (
    relative === "" ||
    (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new Error("Engine caches cannot live inside the engine directory; use a sibling cache directory");
  }
  return { engine, cache };
}

/**
 * Move a file or directory, falling back to copy+remove across volumes.
 *
 * @param {string} from
 * @param {string} to
 */
function movePath(from, to) {
  ensureDir(path.dirname(to));
  if (pathExists(to)) {
    fs.rmSync(to, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  try {
    fs.renameSync(from, to);
    return;
  } catch (error) {
    if (!["EXDEV", "EPERM", "EACCES", "ENOTEMPTY", "EEXIST"].includes(error?.code)) {
      throw error;
    }
  }
  fs.cpSync(from, to, { recursive: true, force: true });
  fs.rmSync(from, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
