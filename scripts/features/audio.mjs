/**
 * Audio mixing helpers for RoosterEdit.
 *
 * The functions in this module are pure: they normalize `plan.music` /
 * `plan.sfx` entries and build FFmpeg filter graphs or argument arrays.
 * They never spawn FFmpeg, read media, create directories, or touch disk.
 */

import path from "node:path";

/**
 * @typedef {object} PlanMusic
 * @property {string} src Music file path, relative to the project.
 * @property {number} [start] Source in-point in seconds.
 * @property {number} [end] Source out-point in seconds.
 * @property {number} [gainDb] Gain under the voice; default -18.
 * @property {boolean} [duckUnderVoice] Use sidechain ducking; default true.
 */

/**
 * @typedef {object} PlanSfx
 * @property {string} id Stable id for review and QA.
 * @property {string} src SFX file path, relative to the project.
 * @property {number} start Timeline start in seconds.
 * @property {number} end Timeline end in seconds.
 * @property {number} [gainDb] SFX gain; default -12.
 */

const DEFAULT_MUSIC_GAIN_DB = -18;
const DEFAULT_SFX_GAIN_DB = -12;
const DEFAULT_FADE_IN = 1.2;
const DEFAULT_FADE_OUT = 1.5;
const MIN_SEGMENT = 0.1;
const MAX_GAIN_DB = 12;
const MIN_GAIN_DB = -60;
const LOUDNESS_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11";

/**
 * Default loudness target used by the delivery mix.
 * Exported so build keys can hash the exact filter string.
 */
export const DEFAULT_LOUDNORM_FILTER = LOUDNESS_FILTER;

/**
 * Practical ceiling for a single FFmpeg `amix` node.
 *
 * `amix` accepts more inputs, but filter parsing, memory, and graph debugging
 * get worse quickly. Larger sets are mixed as a tree of chunks.
 */
export const MAX_AMIX_INPUTS = 32;

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

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function booleanOr(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return fallback;
}

function formatNumber(value, digits = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return String(Number(num.toFixed(digits)));
}

function decibelsToGain(db) {
  return Math.pow(10, clamp(numberOr(db, 0), MIN_GAIN_DB, MAX_GAIN_DB) / 20);
}

function safeLabel(value, fallback) {
  const label = String(value || fallback);
  if (!/^[A-Za-z0-9_.-]+$/.test(label)) {
    throw new Error(`Invalid FFmpeg label: "${label}"`);
  }
  return label;
}

/**
 * Resolve a `loudnorm` option into an FFmpeg filter string.
 *
 * Accepts `true` for the delivery target, `false`/`null` to disable, a full
 * `loudnorm=...` string, an `I=...:TP=...:LRA=...` fragment, or an object with
 * `I`, `TP`, and `LRA` keys.
 *
 * @param {boolean|string|object|null|undefined} [value=true]
 * @returns {string|null} Filter string, or null when disabled.
 */
export function loudnormFilter(value = true) {
  if (value === false || value === null) return null;
  if (value === undefined || value === true) return LOUDNESS_FILTER;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) throw new TypeError("loudnormFilter: filter string is empty");
    if (/[;\[\]\r\n]/.test(text)) {
      throw new Error("loudnormFilter: filter string must not contain ';', brackets, or newlines");
    }
    return text.startsWith("loudnorm=") ? text : `loudnorm=${text}`;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const integrated = numberOr(value.I ?? value.i, -14);
    const truePeak = numberOr(value.TP ?? value.tp, -1.5);
    const range = numberOr(value.LRA ?? value.lra, 11);
    return (
      `loudnorm=I=${formatNumber(integrated)}:` +
      `TP=${formatNumber(truePeak)}:LRA=${formatNumber(range)}`
    );
  }
  throw new TypeError("loudnormFilter: expected true, false, a string, or an object");
}

/**
 * Resolve the source segment used by the music bed.
 *
 * `start` and `end` are source in/out points. The segment is capped at the
 * video duration because the input is looped with `-stream_loop -1`.
 *
 * @param {{ start?: number, end?: number, duration: number }} options
 * @returns {{ totalDuration: number, start: number, end: number, segmentDuration: number }}
 */
function resolveMusicTiming({ start, end, duration }) {
  const totalDuration = Math.max(MIN_SEGMENT, numberOr(duration, MIN_SEGMENT));
  const safeStart = Math.max(0, numberOr(start, 0));
  const requestedEnd = numberOr(end, safeStart + totalDuration);
  const safeEnd = Math.min(
    safeStart + totalDuration,
    Math.max(safeStart + MIN_SEGMENT, requestedEnd)
  );
  return {
    totalDuration,
    start: safeStart,
    end: safeEnd,
    segmentDuration: Math.max(MIN_SEGMENT, safeEnd - safeStart),
  };
}

/**
 * Normalize a `plan.music` entry into mix-ready values.
 *
 * @param {object|null|undefined} music
 * @param {number} duration Video duration in seconds.
 * @returns {object|null} Null when there is no usable music source.
 */
export function normalizeMusic(music, duration) {
  if (!music || typeof music !== "object") return null;
  const src = typeof music.src === "string" ? music.src.trim() : "";
  if (!src) return null;

  const timing = resolveMusicTiming({
    start: music.start,
    end: music.end,
    duration,
  });

  return {
    src,
    ...timing,
    gainDb: clamp(numberOr(music.gainDb, DEFAULT_MUSIC_GAIN_DB), MIN_GAIN_DB, MAX_GAIN_DB),
    duckUnderVoice: booleanOr(music.duckUnderVoice, true),
    license: music.license ?? null,
    attribution: music.attribution ?? null,
  };
}

/**
 * Normalize a `plan.sfx` array.
 *
 * `start` and `end` are timeline positions in seconds. A clip that starts at
 * or after the video duration is ignored.
 *
 * @param {Array<object>|null|undefined} sfx
 * @param {number} [duration] Video duration in seconds.
 * @returns {Array<object>} Clips with a resolved `duration` and `gainDb`.
 */
export function normalizeSfx(sfx, duration = Number.POSITIVE_INFINITY) {
  if (sfx === undefined || sfx === null) return [];
  if (!Array.isArray(sfx)) {
    throw new TypeError("sfx must be an array");
  }

  const total =
    Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : Number.POSITIVE_INFINITY;

  const clips = [];
  sfx.forEach((clip, index) => {
    if (!clip || typeof clip !== "object") {
      throw new TypeError(`sfx[${index}] must be an object`);
    }
    const src = typeof clip.src === "string" ? clip.src.trim() : "";
    if (!src) throw new TypeError(`sfx[${index}] is missing src`);

    const rawStart = numberOr(clip.start, Number.NaN);
    const rawEnd = numberOr(clip.end, Number.NaN);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      throw new TypeError(`sfx[${index}] needs numeric start/end`);
    }

    const start = Math.max(0, rawStart);
    if (start >= total) return;

    const end = Math.min(total, rawEnd);
    if (end <= start) {
      throw new RangeError(`sfx[${index}] must end after it starts`);
    }

    clips.push({
      id: typeof clip.id === "string" && clip.id.trim() ? clip.id.trim() : `sfx-${index + 1}`,
      src,
      start,
      end,
      gainDb: clamp(numberOr(clip.gainDb, DEFAULT_SFX_GAIN_DB), MIN_GAIN_DB, MAX_GAIN_DB),
      duration: end - start,
    });
  });

  return clips;
}

/**
 * Normalize a TTS voiceover manifest (or a plain line array) for mixing.
 *
 * Lines without an audio file or without measured timing are skipped; the TTS
 * manifest deliberately carries unmeasured placeholders. A line that has audio
 * but malformed timing is also skipped, mirroring the existing build behavior.
 *
 * @param {Array<object>|{lines: Array<object>}|null|undefined} voiceover
 * @param {{ duration?: number }} [options] Timeline duration in seconds.
 * @returns {Array<object>} Lines with `src`, `start`, `duration`, `srcStart`, `gainDb`.
 */
export function normalizeVoiceover(voiceover, { duration = Number.POSITIVE_INFINITY } = {}) {
  if (voiceover === undefined || voiceover === null) return [];
  const list = Array.isArray(voiceover)
    ? voiceover
    : Array.isArray(voiceover.lines)
      ? voiceover.lines
      : null;
  if (!list) {
    throw new TypeError("normalizeVoiceover: expected an array or { lines: [...] }");
  }

  const total =
    Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : Number.POSITIVE_INFINITY;

  const lines = [];
  list.forEach((line, index) => {
    if (!line || typeof line !== "object") {
      throw new TypeError(`voiceover[${index}] must be an object`);
    }
    const src =
      typeof line.audio === "string"
        ? line.audio.trim()
        : typeof line.src === "string"
          ? line.src.trim()
          : typeof line.path === "string"
            ? line.path.trim()
            : typeof line.file === "string"
              ? line.file.trim()
              : "";
    if (!src) return;

    const start = numberOr(line.start, Number.NaN);
    if (!Number.isFinite(start) || start < 0 || start >= total) return;

    let length = numberOr(line.duration, Number.NaN);
    if (!Number.isFinite(length) || length <= 0) {
      const end = numberOr(line.end, Number.NaN);
      length = Number.isFinite(end) ? end - start : Number.NaN;
    }
    if (!Number.isFinite(length) || length <= 0) return;

    const srcStart = Math.max(
      0,
      numberOr(line.srcStart ?? line.sourceStart ?? line.mediaStart ?? line.offset, 0)
    );
    const srcEnd = numberOr(line.srcEnd ?? line.sourceEnd, Number.NaN);
    if (Number.isFinite(srcEnd) && srcEnd > srcStart) {
      length = Math.min(length, srcEnd - srcStart);
    }
    length = Math.min(length, Math.max(0, total - start));
    if (length <= 0) return;

    lines.push({
      id:
        typeof line.id === "string" && line.id.trim()
          ? line.id.trim()
          : typeof line.lineId === "string" && line.lineId.trim()
            ? line.lineId.trim()
            : `voice-${index + 1}`,
      src,
      start,
      duration: length,
      srcStart,
      gainDb: clamp(numberOr(line.gainDb, 0), MIN_GAIN_DB, MAX_GAIN_DB),
    });
  });

  return lines;
}

/**
 * Normalize the plan's keeps for a fused timeline pass.
 *
 * Keeps are source in/out points, so their `end` can be larger than the
 * timeline duration when the plan cuts material. Only negative starts are
 * clamped; an empty or missing list means the full source.
 *
 * @param {Array<{start:number,end:number}>|null|undefined} keeps
 * @param {number} duration Timeline duration in seconds.
 * @returns {Array<{start:number,end:number}>}
 */
export function normalizeTimelineKeeps(keeps, duration) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("normalizeTimelineKeeps: duration must be a positive number");
  }
  if (keeps === undefined || keeps === null) return [{ start: 0, end: total }];
  if (!Array.isArray(keeps)) {
    throw new TypeError("normalizeTimelineKeeps: keeps must be an array");
  }
  if (!keeps.length) return [{ start: 0, end: total }];

  return keeps.map((keep, index) => {
    if (!keep || typeof keep !== "object") {
      throw new TypeError(`normalizeTimelineKeeps: keeps[${index}] must be an object`);
    }
    const start = Number(keep.start);
    const end = Number(keep.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new TypeError(`normalizeTimelineKeeps: keeps[${index}] needs numeric start/end`);
    }
    if (end <= start) {
      throw new RangeError(`normalizeTimelineKeeps: keeps[${index}] must end after it starts`);
    }
    return { start: Math.max(0, start), end };
  });
}

/**
 * Build the trimmed, faded and padded music segment chain.
 *
 * @param {{ totalDuration: number, start: number, end: number, segmentDuration: number }} timing
 * @param {number} gainDb
 * @param {number} inputIndex
 * @param {string} outputLabel
 * @returns {string}
 */
function musicSegmentFilter(timing, gainDb, inputIndex, outputLabel) {
  const fadeIn = Math.min(DEFAULT_FADE_IN, timing.segmentDuration / 2);
  const fadeOut = Math.min(DEFAULT_FADE_OUT, timing.segmentDuration / 2);
  const fadeOutStart = Math.max(0, timing.segmentDuration - fadeOut);

  return (
    `[${inputIndex}:a]atrim=start=${formatNumber(timing.start)}:end=${formatNumber(timing.end)},` +
    `asetpts=PTS-STARTPTS,volume=${formatNumber(decibelsToGain(gainDb), 4)},` +
    `afade=t=in:st=0:d=${formatNumber(fadeIn)},` +
    `afade=t=out:st=${formatNumber(fadeOutStart)}:d=${formatNumber(fadeOut)},` +
    `apad=whole_dur=${formatNumber(timing.totalDuration)}[${outputLabel}]`
  );
}

/**
 * Build a filter graph that mixes a music input under a voice input.
 *
 * Input 0 is voice, input 1 is music. The graph ends at `[aout]` by default.
 * When `duck` is true the voice is split and used as a sidechain key for
 * `sidechaincompress`; when false it falls back to constant gain with `amix`.
 *
 * @param {object} options
 * @param {number} options.duration Video duration in seconds.
 * @param {number} [options.musicStart=0] Music source in-point.
 * @param {number} [options.musicEnd] Music source out-point.
 * @param {number} [options.gainDb=-18] Music gain in dB.
 * @param {boolean} [options.duck=true] Duck music under voice.
 * @param {string} [options.outputLabel="aout"] Final graph label.
 * @returns {string} FFmpeg filter_complex fragment.
 */
export function buildDuckingFilter({
  duration,
  musicStart = 0,
  musicEnd,
  gainDb = DEFAULT_MUSIC_GAIN_DB,
  duck = true,
  outputLabel = "aout",
} = {}) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("buildDuckingFilter: duration must be a positive number");
  }

  const label = safeLabel(outputLabel, "aout");
  if (["music", "voice", "sc", "ducked"].includes(label)) {
    throw new Error(`buildDuckingFilter: "${label}" is reserved for an internal label`);
  }

  const timing = resolveMusicTiming({ start: musicStart, end: musicEnd, duration: total });
  const musicGain = clamp(numberOr(gainDb, DEFAULT_MUSIC_GAIN_DB), MIN_GAIN_DB, MAX_GAIN_DB);
  const music = musicSegmentFilter(timing, musicGain, 1, "music");

  if (!booleanOr(duck, true)) {
    return (
      `${music};` +
      `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[${label}]`
    );
  }

  return (
    `${music};` +
    `[0:a]asplit=2[voice][sc];` +
    `[music][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300:makeup=1[ducked];` +
    `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[${label}]`
  );
}

/**
 * Build one filter chain per SFX clip.
 *
 * Each returned fragment expects input `[N:a]` and produces `[sfx0]`,
 * `[sfx1]`, and so on. Source audio is trimmed from 0 to `end - start`,
 * gained, then delayed to its timeline position.
 *
 * @param {object} options
 * @param {Array<object>} [options.sfx] `plan.sfx` array.
 * @param {number} [options.duration] Video duration in seconds.
 * @param {number} [options.inputStart=2] FFmpeg input index of the first SFX.
 * @returns {string[]} Filter fragments, one per usable SFX clip.
 */
export function buildSfxFilters({
  sfx,
  duration = Number.POSITIVE_INFINITY,
  inputStart = 2,
} = {}) {
  const clips = normalizeSfx(sfx, duration);
  const firstInput = Math.max(0, Math.trunc(numberOr(inputStart, 2)));

  return clips.map((clip, index) => {
    const delayMs = Math.max(0, Math.round(clip.start * 1000));
    return (
      `[${firstInput + index}:a]atrim=start=0:end=${formatNumber(clip.duration, 4)},` +
      `asetpts=PTS-STARTPTS,volume=${formatNumber(decibelsToGain(clip.gainDb), 4)},` +
      `adelay=${delayMs}:all=1[sfx${index}]`
    );
  });
}

/**
 * Describe a base media argument as a path plus stream capabilities.
 *
 * @param {string|object} base Path or a buildBaseMediaCore()-style object.
 * @returns {{ path: string, hasVideo: boolean, hasAudio: boolean, kind: string, duration: number|null }}
 */
function describeBase(base) {
  if (typeof base === "string") {
    const value = base.trim();
    if (!value) throw new TypeError("mixAudioArgs: base path is empty");
    const audioOnly = AUDIO_ONLY_EXT.has(path.extname(value).toLowerCase());
    return {
      path: value,
      hasVideo: !audioOnly,
      hasAudio: true,
      kind: audioOnly ? "audio" : "video",
      duration: null,
    };
  }

  if (!base || typeof base !== "object") {
    throw new TypeError("mixAudioArgs: base must be a path or a media object");
  }

  const file = typeof base.path === "string" ? base.path : base.src;
  if (typeof file !== "string" || !file.trim()) {
    throw new TypeError("mixAudioArgs: base.path is missing");
  }

  const kind =
    typeof base.kind === "string"
      ? base.kind
      : base.hasVideo === false
        ? "audio"
        : "video";
  const hasVideo =
    base.hasVideo === undefined
      ? kind !== "audio" && kind !== "image"
      : Boolean(base.hasVideo);
  const hasAudio = base.hasAudio === undefined ? kind !== "image" : Boolean(base.hasAudio);
  const duration = Number.isFinite(Number(base.duration)) ? Number(base.duration) : null;

  return { path: file.trim(), hasVideo, hasAudio, kind, duration };
}

/**
 * Pick output audio codec arguments from the container extension.
 *
 * @param {string} out Output path.
 * @returns {string[]}
 */
export function audioOutputArgs(out) {
  const ext = path.extname(String(out || "")).toLowerCase();
  switch (ext) {
    case ".wav":
      return ["-c:a", "pcm_s16le"];
    case ".flac":
      return ["-c:a", "flac"];
    case ".mp3":
      return ["-c:a", "libmp3lame", "-b:a", "192k"];
    case ".opus":
      return ["-c:a", "libopus", "-b:a", "160k"];
    case ".ogg":
      return ["-c:a", "libvorbis", "-q:a", "5"];
    default:
      return ["-c:a", "aac", "-b:a", "192k"];
  }
}

/**
 * Build a complete FFmpeg argument array for music + SFX mixing.
 *
 * Input order is: base, music (looped), then SFX clips. The final audio is
 * normalized with `loudnorm` at -14 LUFS / -1.5 dBTP. The caller is responsible
 * for spawning FFmpeg with these arguments.
 *
 * @param {object} options
 * @param {string|object} options.base Base media path or media object.
 * @param {object|string|null} [options.music] `plan.music` entry or a path.
 * @param {Array<object>} [options.sfx] `plan.sfx` array.
 * @param {string} options.out Output path.
 * @param {number} [options.duration] Video duration in seconds.
 * @returns {string[]} FFmpeg args, without the executable name.
 */
export function mixAudioArgs({ base, music = null, sfx = [], out, duration } = {}) {
  const baseInfo = describeBase(base);
  if (typeof out !== "string" || !out.trim()) {
    throw new TypeError("mixAudioArgs: out path is required");
  }
  if (baseInfo.kind === "image") {
    throw new Error(
      "mixAudioArgs: still-image projects need the audio mix in the engine; a timed video or audio base is required"
    );
  }

  const total = numberOr(duration, baseInfo.duration);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("mixAudioArgs: duration must be a positive number");
  }

  const musicEntry =
    typeof music === "string" ? { src: music } : music;
  const musicInfo = normalizeMusic(musicEntry, total);
  const sfxClips = normalizeSfx(sfx, total);

  if (!baseInfo.hasAudio && !musicInfo && !sfxClips.length) {
    throw new Error("mixAudioArgs: nothing to mix (base has no audio, music, or SFX)");
  }

  const args = ["-y", "-i", baseInfo.path];
  let nextInput = 1;
  let musicInput = null;

  if (musicInfo) {
    args.push("-stream_loop", "-1", "-i", musicInfo.src);
    musicInput = nextInput;
    nextInput += 1;
  }

  const sfxInputStart = nextInput;
  for (const clip of sfxClips) {
    args.push("-i", clip.src);
    nextInput += 1;
  }

  const chains = [];
  let current;

  if (musicInfo && baseInfo.hasAudio) {
    chains.push(
      buildDuckingFilter({
        duration: total,
        musicStart: musicInfo.start,
        musicEnd: musicInfo.end,
        gainDb: musicInfo.gainDb,
        duck: musicInfo.duckUnderVoice,
        outputLabel: "mixpre",
      })
    );
    current = "mixpre";
  } else if (musicInfo) {
    chains.push(
      musicSegmentFilter(
        {
          totalDuration: total,
          start: musicInfo.start,
          end: musicInfo.end,
          segmentDuration: musicInfo.segmentDuration,
        },
        musicInfo.gainDb,
        musicInput,
        "mixpre"
      )
    );
    current = "mixpre";
  } else if (baseInfo.hasAudio) {
    chains.push("[0:a]anull[mixpre]");
    current = "mixpre";
  } else {
    // Video-only base with SFX but no music: add a silent bed so the SFX have
    // a full-length first input for `amix duration=first`.
    const silentInput = nextInput;
    args.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=48000:cl=stereo:d=${formatNumber(total)}`
    );
    nextInput += 1;
    chains.push(`[${silentInput}:a]anull[mixpre]`);
    current = "mixpre";
  }

  if (sfxClips.length) {
    chains.push(
      ...buildSfxFilters({
        sfx: sfxClips,
        duration: total,
        inputStart: sfxInputStart,
      })
    );
    const inputs = sfxClips.map((_, index) => `[sfx${index}]`).join("");
    chains.push(
      `[${current}]${inputs}amix=inputs=${sfxClips.length + 1}:duration=first:dropout_transition=2:normalize=0[mixed]`
    );
    current = "mixed";
  }

  chains.push(`[${current}]${LOUDNESS_FILTER}[aout]`);

  args.push("-filter_complex", chains.join(";"));

  if (baseInfo.hasVideo && !AUDIO_ONLY_EXT.has(path.extname(out).toLowerCase())) {
    args.push("-map", "0:v:0", "-c:v", "copy");
  }
  args.push("-map", "[aout]", ...audioOutputArgs(out), "-t", formatNumber(total), out);

  return args;
}

/**
 * Mix a list of already-labelled inputs, chunking above `maxInputs`.
 *
 * The top-level result is always `[prefix]`; intermediate chunk mixes use
 * `[prefix_cN]` labels. Single-input lists pass through without an `amix`.
 *
 * @param {string[]} labels Bracketed labels such as `[tl_line0]`.
 * @param {{ prefix: string, maxInputs?: number, durationMode?: string }} options
 * @returns {{ label: string|null, chains: string[] }}
 */
function mixLabelTree(labels, { prefix, maxInputs = MAX_AMIX_INPUTS, durationMode = "longest" } = {}) {
  if (!labels.length) return { label: null, chains: [] };
  const limit = Math.max(2, Math.trunc(numberOr(maxInputs, MAX_AMIX_INPUTS)));
  const chains = [];
  let chunkIndex = 0;

  const combine = (list) => {
    if (list.length === 1) return list[0];
    if (list.length <= limit) {
      chains.push(
        `${list.join("")}amix=inputs=${list.length}:duration=${durationMode}:` +
          `dropout_transition=2:normalize=0[${prefix}]`
      );
      return `[${prefix}]`;
    }
    const next = [];
    for (let index = 0; index < list.length; index += limit) {
      const slice = list.slice(index, index + limit);
      if (slice.length === 1) {
        next.push(slice[0]);
        continue;
      }
      const label = `${prefix}_c${chunkIndex++}`;
      chains.push(
        `${slice.join("")}amix=inputs=${slice.length}:duration=${durationMode}:` +
          `dropout_transition=2:normalize=0[${label}]`
      );
      next.push(`[${label}]`);
    }
    return combine(next);
  };

  const label = combine(labels);
  return { label, chains };
}

/**
 * Build a single fused FFmpeg filter graph for the whole timeline audio pass.
 *
 * The graph can combine:
 * - keeps from the source (`atrim` + `concat`), or a silent bed when the
 *   source has no audio;
 * - voiceover lines (`atrim` + `adelay` + `amix`, chunked above
 *   `maxAmixInputs`);
 * - a looped music bed (trim, gain, fades, optional sidechain ducking);
 * - SFX clips (`atrim` + `adelay` + `amix`);
 * - one final `loudnorm`.
 *
 * Input order is fixed and returned in `inputs`: source, music, voice lines,
 * SFX clips. The caller must add `-i` arguments in that order and add
 * `-stream_loop -1` before the music input.
 *
 * @param {object} options
 * @param {number} options.duration Timeline duration in seconds.
 * @param {number} [options.sourceInput=0] FFmpeg input index of the source.
 * @param {boolean} [options.hasSourceAudio=true] Whether input `[N:a]` exists.
 * @param {Array<{start:number,end:number}>|null} [options.keeps] Source keeps.
 * @param {Array<object>|{lines:Array<object>}|null} [options.voiceover]
 * @param {object|string|null} [options.music]
 * @param {Array<object>|null} [options.sfx]
 * @param {boolean|string|object|null} [options.loudnorm=true]
 * @param {string} [options.outputLabel="aout"]
 * @param {number} [options.sampleRate=48000]
 * @param {number} [options.maxAmixInputs=MAX_AMIX_INPUTS]
 * @returns {object} Graph, normalized inputs, and the assigned input indices.
 */
export function buildTimelineAudioGraph({
  duration,
  sourceInput = 0,
  hasSourceAudio = true,
  keeps = [],
  voiceover = [],
  music = null,
  sfx = [],
  loudnorm = true,
  outputLabel = "aout",
  sampleRate = 48000,
  maxAmixInputs = MAX_AMIX_INPUTS,
} = {}) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("buildTimelineAudioGraph: duration must be a positive number");
  }

  const sourceIndex = Math.max(0, Math.trunc(numberOr(sourceInput, 0)));
  const rate = Math.trunc(numberOr(sampleRate, 48000));
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("buildTimelineAudioGraph: sampleRate must be a positive number");
  }
  const label = safeLabel(outputLabel, "aout");
  if (label.startsWith("tl_")) {
    throw new Error('buildTimelineAudioGraph: outputLabel must not start with "tl_"');
  }
  const mixLimit = Math.max(2, Math.trunc(numberOr(maxAmixInputs, MAX_AMIX_INPUTS)));
  const sourceAudio = booleanOr(hasSourceAudio, true);

  const keepList = normalizeTimelineKeeps(keeps, total);
  const voiceLines = normalizeVoiceover(voiceover, { duration: total });

  let musicInfo = null;
  if (music !== null && music !== undefined) {
    const entry = typeof music === "string" ? { src: music } : music;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("buildTimelineAudioGraph: music must be an object or a path");
    }
    if (typeof entry.src !== "string" || !entry.src.trim()) {
      throw new TypeError("buildTimelineAudioGraph: music.src is required");
    }
    musicInfo = normalizeMusic(entry, total);
  }

  const sfxClips = normalizeSfx(sfx, total);

  let nextInput = sourceIndex + 1;
  const musicInput = musicInfo ? nextInput++ : null;
  for (const line of voiceLines) line.input = nextInput++;
  for (const clip of sfxClips) clip.input = nextInput++;

  const chains = [];

  if (sourceAudio) {
    if (keepList.length === 1) {
      const keep = keepList[0];
      chains.push(
        `[${sourceIndex}:a]atrim=start=${formatNumber(keep.start, 6)}:` +
          `end=${formatNumber(keep.end, 6)},asetpts=PTS-STARTPTS[tl_cut]`
      );
    } else {
      const cutLabels = keepList.map((keep, index) => {
        const cutLabel = `tl_cut${index}`;
        chains.push(
          `[${sourceIndex}:a]atrim=start=${formatNumber(keep.start, 6)}:` +
            `end=${formatNumber(keep.end, 6)},asetpts=PTS-STARTPTS[${cutLabel}]`
        );
        return `[${cutLabel}]`;
      });
      chains.push(`${cutLabels.join("")}concat=n=${keepList.length}:v=0:a=1[tl_cut]`);
    }
    chains.push(
      `[tl_cut]atrim=start=0:end=${formatNumber(total, 6)},` +
        `apad=whole_dur=${formatNumber(total, 6)}[tl_base]`
    );
  } else {
    chains.push(
      `anullsrc=r=${rate}:cl=stereo,atrim=end=${formatNumber(total, 6)},` +
        "asetpts=PTS-STARTPTS[tl_base]"
    );
  }

  const voiceLabels = voiceLines.map((line, index) => {
    const trimStart = Math.max(0, numberOr(line.srcStart, 0));
    const trimEnd = trimStart + Math.max(0, line.duration);
    const filters = [
      `atrim=start=${formatNumber(trimStart, 6)}:end=${formatNumber(trimEnd, 6)}`,
      "asetpts=PTS-STARTPTS",
    ];
    if (Math.abs(line.gainDb) > 0.001) {
      filters.push(`volume=${formatNumber(decibelsToGain(line.gainDb), 4)}`);
    }
    filters.push(`adelay=${Math.max(0, Math.round(line.start * 1000))}:all=1`);
    const lineLabel = `tl_line${index}`;
    chains.push(`[${line.input}:a]${filters.join(",")}[${lineLabel}]`);
    return `[${lineLabel}]`;
  });

  const voiceMix = mixLabelTree(voiceLabels, {
    prefix: "tl_voice",
    maxInputs: mixLimit,
    durationMode: "longest",
  });
  if (voiceMix.chains.length) chains.push(...voiceMix.chains);

  let current = "[tl_base]";
  let speechPresent = sourceAudio;
  if (voiceMix.label) {
    // Keep a stable `[tl_voice]` label even for a single voice line.
    if (voiceMix.label !== "[tl_voice]") {
      chains.push(`${voiceMix.label}anull[tl_voice]`);
    }
    chains.push(
      `[tl_base][tl_voice]amix=inputs=2:duration=first:` +
        "dropout_transition=2:normalize=0[tl_speech]"
    );
    current = "[tl_speech]";
    speechPresent = true;
  }

  if (musicInfo) {
    chains.push(musicSegmentFilter(musicInfo, musicInfo.gainDb, musicInput, "tl_music"));
    if (musicInfo.duckUnderVoice && speechPresent) {
      chains.push(`${current}asplit=2[tl_prog][tl_sc]`);
      chains.push(
        "[tl_music][tl_sc]sidechaincompress=threshold=0.05:ratio=8:" +
          "attack=20:release=300:makeup=1[tl_ducked]"
      );
      chains.push(
        "[tl_prog][tl_ducked]amix=inputs=2:duration=first:" +
          "dropout_transition=2:normalize=0[tl_musicmix]"
      );
    } else {
      chains.push(
        `${current}[tl_music]amix=inputs=2:duration=first:` +
          "dropout_transition=2:normalize=0[tl_musicmix]"
      );
    }
    current = "[tl_musicmix]";
  }

  if (sfxClips.length) {
    chains.push(
      ...buildSfxFilters({
        sfx: sfxClips,
        duration: total,
        inputStart: sfxClips[0].input,
      })
    );
    const sfxMix = mixLabelTree(
      sfxClips.map((_, index) => `[sfx${index}]`),
      { prefix: "tl_sfxmix", maxInputs: mixLimit, durationMode: "longest" }
    );
    if (sfxMix.chains.length) chains.push(...sfxMix.chains);
    chains.push(
      `${current}${sfxMix.label}amix=inputs=2:duration=first:` +
        "dropout_transition=2:normalize=0[tl_sfx]"
    );
    current = "[tl_sfx]";
  }

  const norm = loudnormFilter(loudnorm);
  chains.push(norm ? `${current}${norm}[${label}]` : `${current}anull[${label}]`);

  return {
    filterComplex: chains.join(";"),
    chains,
    duration: total,
    sampleRate: rate,
    outputLabel: label,
    hasSourceAudio: sourceAudio,
    speechPresent,
    usesSilentBed: !sourceAudio,
    keeps: keepList,
    voiceLines,
    sfxClips,
    music: musicInfo ? { ...musicInfo, input: musicInput, loop: true } : null,
    inputs: {
      source: sourceIndex,
      music: musicInput,
      voice: voiceLines.map((line) => line.input),
      sfx: sfxClips.map((clip) => clip.input),
    },
    counts: {
      voice: voiceLines.length,
      sfx: sfxClips.length,
      music: musicInfo ? 1 : 0,
    },
  };
}
