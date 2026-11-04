/**
 * Build-stage cache keys and `work/build-state.json` persistence.
 *
 * This module is deliberately small and dependency-free apart from the pure
 * audio helpers it uses to normalize the loudness filter. If `cache.mjs` grows
 * a generic key helper later, this local implementation can be folded into it.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loudnormFilter, normalizeVoiceover } from "../features/audio.mjs";

/** Schema written by `writeBuildState`; other schemas are treated as invalid. */
export const BUILD_STATE_SCHEMA = "rooster.build-state/v1";

const CUT_NAMESPACE = "rooster.build-cut/v1";
const VOICE_NAMESPACE = "rooster.build-voice/v1";
const MUSIC_NAMESPACE = "rooster.build-music/v1";
const HTML_NAMESPACE = "rooster.build-html/v1";
const ELEMENT_NAMESPACE = "rooster.build-element/v1";

/**
 * Recursively sort object keys and normalize JSON-compatible values.
 *
 * Arrays keep their order because keep/voice order changes the resulting media.
 *
 * @param {*} value
 * @param {Set<object>} [seen]
 * @returns {*}
 */
function canonicalize(value, seen = new Set()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") return Number.isFinite(value) ? value : null;
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;
  if (type === "bigint") return `${value}n`;
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("canonicalPlan: circular reference");
    }
    seen.add(value);
    const result = value.map((item) => {
      const next = canonicalize(item, seen);
      // JSON turns undefined array entries into null.
      return next === undefined ? null : next;
    });
    seen.delete(value);
    return result;
  }
  if (type === "object") {
    if (value instanceof Date) return value.toISOString();
    if (seen.has(value)) {
      throw new TypeError("canonicalPlan: circular reference");
    }
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const next = canonicalize(value[key], seen);
      if (next !== undefined) result[key] = next;
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

/**
 * Deterministic JSON for a plan: sorted object keys, stable array order.
 *
 * @param {object} plan
 * @returns {string}
 */
export function canonicalPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("canonicalPlan: plan must be an object");
  }
  return JSON.stringify(canonicalize(plan));
}

/**
 * Local content key helper: canonical JSON of all parts, hashed with sha256.
 *
 * Exported for tests and for callers that need an ad-hoc stage key.
 *
 * @param {*} parts A value or an array of values.
 * @returns {string} 64-character lowercase hex digest.
 */
export function hashKey(parts) {
  const payload = Array.isArray(parts) ? parts : [parts];
  const text = JSON.stringify(canonicalize(payload));
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Snap keep boundaries to the nearest frame.
 *
 * Adjacent keeps that share a boundary round to the same value, so no overlap
 * is introduced. A keep that collapses to zero frames is widened to one frame.
 * Extra metadata on each keep is preserved.
 *
 * @param {Array<{start:number,end:number}>} keeps
 * @param {number} fps Frames per second.
 * @returns {Array<{start:number,end:number}>}
 */
export function roundKeeps(keeps, fps) {
  const rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("roundKeeps: fps must be a positive number");
  }
  if (!Array.isArray(keeps)) {
    throw new TypeError("roundKeeps: keeps must be an array");
  }

  const frame = 1 / rate;
  return keeps.map((keep, index) => {
    if (!keep || typeof keep !== "object") {
      throw new TypeError(`roundKeeps: keeps[${index}] must be an object`);
    }
    const start = Number(keep.start);
    const end = Number(keep.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new TypeError(`roundKeeps: keeps[${index}] needs numeric start/end`);
    }
    if (end <= start) {
      throw new RangeError(`roundKeeps: keeps[${index}] must end after it starts`);
    }

    let alignedStart = Math.max(0, Math.round(start * rate) / rate);
    let alignedEnd = Math.round(end * rate) / rate;
    if (alignedEnd <= alignedStart) alignedEnd = alignedStart + frame;

    return {
      ...keep,
      start: alignedStart === 0 ? 0 : alignedStart,
      end: alignedEnd === 0 ? 0 : alignedEnd,
    };
  });
}

/**
 * Key for the cut/base-media stage.
 *
 * @param {object} options
 * @param {string|object} options.sourceKey Source fingerprint or hash.
 * @param {Array<{start:number,end:number}>} [options.keeps]
 * @param {{fps:number}} options.format Project format; `fps` drives rounding.
 * @param {string} [options.encoder="libx264"]
 * @param {number} [options.crf=20]
 * @param {string} [options.preset="veryfast"]
 * @param {boolean|string|object|null} [options.loudnorm=true]
 * @returns {string}
 */
export function cutKey({
  sourceKey,
  keeps,
  format,
  encoder = "libx264",
  crf = 20,
  preset = "veryfast",
  loudnorm = true,
  punchKeeps = [],
  punchScale = 1.035,
  cutFade = 0,
  toolVersion = "",
} = {}) {
  if (sourceKey === undefined || sourceKey === null || sourceKey === "") {
    throw new TypeError("cutKey: sourceKey is required");
  }
  if (!format || typeof format !== "object" || Array.isArray(format)) {
    throw new TypeError("cutKey: format is required");
  }
  const fps = Number(format.fps);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("cutKey: format.fps must be a positive number");
  }

  const quality = Number(crf === undefined || crf === null || crf === "" ? 20 : crf);
  if (!Number.isFinite(quality)) {
    throw new TypeError("cutKey: crf must be a number");
  }

  const alignedKeeps = roundKeeps(keeps ?? [], fps).map(({ start, end }) => ({ start, end }));
  const punch = Array.isArray(punchKeeps) ? punchKeeps.map(Boolean) : [];
  return hashKey([
    CUT_NAMESPACE,
    sourceKey,
    {
      keeps: alignedKeeps,
      format,
      encoder: String(encoder || "libx264"),
      crf: quality,
      preset: String(preset || "veryfast"),
      loudnorm: loudnormFilter(loudnorm),
      punch,
      punchScale: Number(punchScale) || 1.035,
      cutFade: Math.max(0, Number(cutFade) || 0),
      toolVersion: String(toolVersion || ""),
    },
  ]);
}

/**
 * Read the usable voice lines from a manifest or array for keying.
 *
 * Uses the same normalizer as the mixer so path aliases, timing aliases, and
 * source trims cannot change the mixed audio without changing the key.
 *
 * @param {Array<object>|{lines:Array<object>}|null|undefined} voiceover
 * @returns {Array<object>}
 */
function voiceEntriesForKey(voiceover) {
  if (voiceover === undefined || voiceover === null) return [];
  return normalizeVoiceover(voiceover).map((line) => ({
    id: line.id,
    src: line.src,
    start: line.start,
    duration: line.duration,
    srcStart: line.srcStart,
    gainDb: line.gainDb,
  }));
}

/**
 * Key for the voice stage. Returns the cut key when there is no usable voice,
 * so callers can treat an unchanged key as "reuse the previous artifact".
 *
 * @param {object} options
 * @param {string} options.cutKey
 * @param {Array<object>|{lines:Array<object>}|null} [options.voiceover]
 * @param {Array<object>|object|null} [options.voiceFiles]
 * @returns {string}
 */
export function voiceKey({ cutKey: baseCutKey, voiceover, voiceFiles = [] } = {}) {
  if (typeof baseCutKey !== "string" || !baseCutKey.trim()) {
    throw new TypeError("voiceKey: cutKey is required");
  }
  const lines = voiceEntriesForKey(voiceover);
  if (!lines.length) return baseCutKey;

  return hashKey([VOICE_NAMESPACE, baseCutKey, { lines, voiceFiles: voiceFiles ?? [] }]);
}

/**
 * Key for the music/SFX stage. Returns the voice key when there is nothing to
 * mix, so an unchanged chain can reuse the previous artifact.
 *
 * @param {object} options
 * @param {string} options.voiceKey
 * @param {object|string|null} [options.music]
 * @param {Array<object>|null} [options.sfx]
 * @returns {string}
 */
export function musicKey({ voiceKey: baseVoiceKey, music = null, sfx = [] } = {}) {
  if (typeof baseVoiceKey !== "string" || !baseVoiceKey.trim()) {
    throw new TypeError("musicKey: voiceKey is required");
  }

  let musicEntry = null;
  if (typeof music === "string") {
    musicEntry = music.trim() ? { src: music.trim() } : null;
  } else if (music !== null && music !== undefined) {
    if (typeof music !== "object" || Array.isArray(music)) {
      throw new TypeError("musicKey: music must be an object, a path, or null");
    }
    musicEntry = typeof music.src === "string" && music.src.trim() ? music : null;
  }

  if (sfx !== null && sfx !== undefined && !Array.isArray(sfx)) {
    throw new TypeError("musicKey: sfx must be an array or null");
  }
  const sfxEntries = sfx ?? [];

  if (!musicEntry && !sfxEntries.length) return baseVoiceKey;
  return hashKey([MUSIC_NAMESPACE, baseVoiceKey, { music: musicEntry, sfx: sfxEntries }]);
}

/**
 * Key for the engine HTML/TSX stage.
 *
 * @param {object} options
 * @param {object} options.plan
 * @param {object|string|null} [options.theme]
 * @param {string|number|null} [options.version]
 * @param {string|null} [options.engine]
 * @param {string|null} [options.engineVersion]
 * @returns {string}
 */
export function htmlKey({
  plan,
  theme = null,
  version = null,
  engine = null,
  engineVersion = null,
} = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("htmlKey: plan is required");
  }
  return hashKey([
    HTML_NAMESPACE,
    canonicalPlan(plan),
    theme ?? null,
    version ?? null,
    engine ?? null,
    engineVersion ?? null,
  ]);
}

/**
 * Key for one rendered element clip (transparent overlay).
 *
 * The key changes when the element content, theme, format, renderer, renderer
 * version, or render options change. It is intentionally independent from the
 * whole plan so one edited element does not invalidate the other clips.
 *
 * @param {object} options
 * @param {object} options.element Plan element.
 * @param {object|string|null} [options.theme]
 * @param {{width?:number,height?:number,fps?:number}|null} [options.format]
 * @param {string|null} [options.engine]
 * @param {string|null} [options.engineVersion]
 * @param {object|null} [options.render] Render options (format, alpha, ...).
 * @returns {string}
 */
export function elementKey({
  element,
  theme = null,
  format = null,
  engine = null,
  engineVersion = null,
  render = null,
} = {}) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new TypeError("elementKey: element is required");
  }
  return hashKey([
    ELEMENT_NAMESPACE,
    element,
    theme ?? null,
    format ?? null,
    engine ?? null,
    engineVersion ?? null,
    render ?? null,
  ]);
}

/**
 * Absolute path of the build state file.
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function buildStatePath(projectDir) {
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new TypeError("buildStatePath: projectDir is required");
  }
  return path.join(projectDir, "work", "build-state.json");
}

/**
 * Read `work/build-state.json`.
 *
 * @param {string} projectDir
 * @returns {object|null} Null when the file is missing, malformed, or has an
 *   unexpected schema.
 */
export function readBuildState(projectDir) {
  const file = buildStatePath(projectDir);
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const state = JSON.parse(text);
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    if (state.schema !== BUILD_STATE_SCHEMA) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * Atomically write `work/build-state.json`.
 *
 * Writes a temporary sibling and renames it over the target. On Windows a
 * locked target is removed and the rename is retried once.
 *
 * @param {string} projectDir
 * @param {object} state
 * @returns {string} Written path.
 */
export function writeBuildState(projectDir, state) {
  const file = buildStatePath(projectDir);
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("writeBuildState: state must be an object");
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { ...state, schema: BUILD_STATE_SCHEMA };
  const text = JSON.stringify(payload, null, 2) + "\n";
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;

  try {
    fs.writeFileSync(temp, text, "utf8");
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(error?.code)) throw error;
      fs.rmSync(file, { force: true });
      fs.renameSync(temp, file);
    }
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }

  return file;
}
