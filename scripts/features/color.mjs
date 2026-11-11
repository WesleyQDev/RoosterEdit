/**
 * Color grading and stabilization helpers for RoosterEdit.
 *
 * Pure functions: they normalize `plan.color` and build FFmpeg filters or
 * argument arrays. They never spawn FFmpeg, read media, create directories,
 * or touch disk.
 */

import path from "node:path";

import { videoEncoderArgs } from "../features/encoders.mjs";

/**
 * @typedef {object} PlanColor
 * @property {string} [lut] Path to a .cube or .3dl LUT.
 * @property {number} [brightness] -1..1, default 0.
 * @property {number} [contrast] 0..4, default 1.
 * @property {number} [saturation] 0..3, default 1.
 * @property {number} [temperature] -100..100, default 0 (positive is warm).
 * @property {boolean|number|string|object} [denoise] hqdn3d/nlmeans settings.
 * @property {boolean} [stabilize] Run the separate two-pass vidstab flow.
 */

const HQDN3D_PRESETS = {
  light: "2:1.5:3:2.25",
  medium: "4:3:6:4.5",
  strong: "6:4:9:6",
};

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return String(Number(num.toFixed(digits)));
}

/**
 * Escape a filesystem path for use inside an FFmpeg filter option.
 *
 * Windows drive colons break the filter option parser, so backslashes become
 * forward slashes, colons are escaped, and the value is single-quoted.
 *
 * @param {string} value
 * @returns {string}
 */
function filterPath(value) {
  const normalized = String(value)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  return `'${normalized}'`;
}

/**
 * Build an `hqdn3d` filter from a numeric strength.
 *
 * @param {number} strength
 * @returns {string}
 */
function hqdn3dFilter(strength) {
  const luma = clamp(strength, 0.1, 20);
  return (
    `hqdn3d=${formatNumber(luma)}:` +
    `${formatNumber(luma * 0.75)}:` +
    `${formatNumber(luma * 1.5)}:` +
    `${formatNumber(luma * 1.125)}`
  );
}

/**
 * Build a denoise filter from the `plan.color.denoise` value.
 *
 * Accepts false/null, true, a number, a preset string (`light`, `medium`,
 * `strong`, `nlmeans`), or `{ filter, strength }`.
 *
 * @param {boolean|number|string|object|null|undefined} value
 * @returns {string|null}
 */
function denoiseFilter(value) {
  if (value === undefined || value === null || value === false) return null;

  if (value === true) return `hqdn3d=${HQDN3D_PRESETS.medium}`;

  if (typeof value === "number") {
    return value > 0 ? hqdn3dFilter(value) : null;
  }

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (!text || ["none", "off", "false", "0"].includes(text)) return null;
    if (HQDN3D_PRESETS[text]) return `hqdn3d=${HQDN3D_PRESETS[text]}`;
    if (text === "hqdn3d") return `hqdn3d=${HQDN3D_PRESETS.medium}`;
    if (text.startsWith("hqdn3d:")) {
      return hqdn3dFilter(numberOr(text.slice("hqdn3d:".length), 4));
    }
    if (text === "nlmeans") return "nlmeans=s=3:r=15:p=7";
    if (text.startsWith("nlmeans:")) {
      return `nlmeans=s=${formatNumber(clamp(numberOr(text.slice("nlmeans:".length), 3), 1, 30), 2)}:r=15:p=7`;
    }
    return `hqdn3d=${HQDN3D_PRESETS.medium}`;
  }

  if (typeof value === "object") {
    const type = String(value.filter || value.type || "hqdn3d").toLowerCase();
    const strength = value.strength ?? value.amount;

    if (["none", "off", "false"].includes(type)) return null;

    if (type === "nlmeans") {
      const amount = clamp(numberOr(strength, 3), 1, 30);
      return `nlmeans=s=${formatNumber(amount, 2)}:r=15:p=7`;
    }

    if (typeof strength === "string" && HQDN3D_PRESETS[strength.toLowerCase()]) {
      return `hqdn3d=${HQDN3D_PRESETS[strength.toLowerCase()]}`;
    }

    return hqdn3dFilter(numberOr(strength, 4));
  }

  return null;
}

/**
 * Build FFmpeg video filters for a `plan.color` object.
 *
 * Filter order is denoise, LUT, EQ, then temperature. Identity values are
 * omitted so an empty or partial color block stays cheap.
 *
 * @param {object|null|undefined} color
 * @param {string} [color.lut] Path to a .cube/.3dl LUT.
 * @param {number} [color.brightness] -1..1, default 0.
 * @param {number} [color.contrast] 0..4, default 1.
 * @param {number} [color.saturation] 0..3, default 1.
 * @param {number} [color.temperature] -100..100, default 0 (positive is warm).
 * @param {boolean|number|string|object} [color.denoise] Denoise preset or options.
 * @returns {string[]} Filter strings to join with commas for `-vf`.
 */
export function buildColorFilters(color) {
  if (!color || typeof color !== "object") return [];

  const filters = [];

  const denoise = denoiseFilter(color.denoise);
  if (denoise) filters.push(denoise);

  if (typeof color.lut === "string" && color.lut.trim()) {
    filters.push(`lut3d=file=${filterPath(color.lut.trim())}`);
  }

  const eq = [];
  const brightness = clamp(numberOr(color.brightness, 0), -1, 1);
  const contrast = clamp(numberOr(color.contrast, 1), 0, 4);
  const saturation = clamp(numberOr(color.saturation, 1), 0, 3);

  if (brightness !== 0) eq.push(`brightness=${formatNumber(brightness)}`);
  if (contrast !== 1) eq.push(`contrast=${formatNumber(contrast)}`);
  if (saturation !== 1) eq.push(`saturation=${formatNumber(saturation)}`);
  if (eq.length) filters.push(`eq=${eq.join(":")}`);

  const temperature = clamp(numberOr(color.temperature, 0), -100, 100);
  const tint = (temperature / 100) * 0.15;
  if (Math.abs(tint) >= 0.0001) {
    // A bounded approximation: +100 warms by +0.15 red / -0.15 blue in the
    // shadows, midtones, and highlights. This is not a Kelvin white balance.
    const amount = formatNumber(tint);
    const inverse = formatNumber(-tint);
    filters.push(
      `colorbalance=rs=${amount}:bs=${inverse}:rm=${amount}:bm=${inverse}:rh=${amount}:bh=${inverse}`
    );
  }

  return filters;
}

/**
 * Build the two FFmpeg passes required by vidstab.
 *
 * Pass 1 (`detect`) writes a transforms file. Pass 2 (`transform`) reads it
 * and renders a stabilized intermediate. The caller must run `detect` first,
 * ensure `workDir` exists, and keep the same input and dimensions in both
 * passes. Nothing is executed here.
 *
 * @param {object} options
 * @param {string} options.input Source video path.
 * @param {string} options.workDir Directory for the transforms file and default output.
 * @param {string} [options.output] Stabilized output path.
 * @param {number} [options.shakiness=5] vidstabdetect shakiness (1..10).
 * @param {number} [options.accuracy=15] vidstabdetect accuracy (1..15).
 * @param {number} [options.smoothing=10] vidstabtransform smoothing frames (0..1000).
 * @param {boolean} [options.zoom=true] Auto-zoom to hide stabilized borders.
 * @param {string} [options.encoder="libx264"] Encoder for the transform pass.
 * @param {string} [options.preset="veryfast"] Encoder preset.
 * @param {number} [options.crf=20] Encoder quality.
 * @param {number} [options.filterThreads] `-filter_threads` value.
 * @returns {{ transformsFile: string, output: string, detect: string[], transform: string[], detectArgs: string[], transformArgs: string[] }}
 */
export function buildStabilizePasses({
  input,
  workDir,
  output,
  shakiness = 5,
  accuracy = 15,
  smoothing = 10,
  zoom = true,
  encoder = "libx264",
  preset = "veryfast",
  crf = 20,
  filterThreads,
} = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new TypeError("buildStabilizePasses: input path is required");
  }
  if (typeof workDir !== "string" || !workDir.trim()) {
    throw new TypeError("buildStabilizePasses: workDir is required");
  }

  const transformsFile = path.join(workDir, "transforms.trf");
  const outputPath = typeof output === "string" && output.trim()
    ? output
    : path.join(workDir, "stabilized.mp4");

  const shake = clamp(Math.round(numberOr(shakiness, 5)), 1, 10);
  const acc = clamp(Math.max(shake, Math.round(numberOr(accuracy, 15))), 1, 15);
  const smooth = clamp(Math.round(numberOr(smoothing, 10)), 0, 1000);
  const autoZoom = zoom === false ? 0 : 1;
  const transforms = filterPath(transformsFile);

  const detectFilter =
    `vidstabdetect=shakiness=${shake}:accuracy=${acc}:result=${transforms}`;
  const transformFilter =
    `vidstabtransform=input=${transforms}:smoothing=${smooth}:` +
    `optzoom=${autoZoom}:zoomspeed=0.25:interpol=bicubic`;

  const threads = Number(filterThreads);
  const threadArgs =
    Number.isFinite(threads) && threads > 0
      ? ["-filter_threads", String(Math.min(64, Math.trunc(threads)))]
      : [];

  const detect = [
    "-y",
    ...threadArgs,
    "-i", input,
    "-vf", detectFilter,
    "-an",
    "-f", "null",
    "-",
  ];

  const transform = [
    "-y",
    ...threadArgs,
    "-i", input,
    "-vf", transformFilter,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    ...videoEncoderArgs({ encoder, crf, preset }),
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ];

  return {
    transformsFile,
    output: outputPath,
    detect,
    transform,
    detectArgs: detect,
    transformArgs: transform,
  };
}

/**
 * Build complete FFmpeg arguments for a color-graded video.
 *
 * The video is re-encoded; audio is copied. Stabilization is a separate
 * two-pass flow, so `color.stabilize` is intentionally ignored here.
 * With no active filters and no scale, the call falls back to stream copy.
 *
 * The defaults target an intermediate: the build re-encodes the result, so
 * `veryfast`/CRF 20 is the fast path. Pass `quality: "final"` (or explicit
 * `preset`/`crf`) when the output is a master.
 *
 * @param {object} options
 * @param {string} options.input Source video path.
 * @param {string} options.output Destination path.
 * @param {object} [options.color] `plan.color` object.
 * @param {"fast"|"final"} [options.quality="fast"] Intermediate or master quality.
 * @param {string} [options.preset] x264/encoder preset (overrides quality).
 * @param {number} [options.crf] Quality value (overrides quality).
 * @param {string} [options.encoder="libx264"] Any encoder `videoEncoderArgs` knows.
 * @param {string} [options.scale] Optional `W:H` scale filter (e.g. `1920:1080`).
 * @param {number} [options.filterThreads] `-filter_threads` value.
 * @returns {string[]} FFmpeg args, without the executable name.
 */
export function colorArgs({
  input,
  output,
  color,
  quality = "fast",
  preset,
  crf,
  encoder = "libx264",
  scale,
  filterThreads,
} = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new TypeError("colorArgs: input path is required");
  }
  if (typeof output !== "string" || !output.trim()) {
    throw new TypeError("colorArgs: output path is required");
  }

  const filters = buildColorFilters(color);
  const size = typeof scale === "string" ? scale.trim() : "";
  if (size && !/^-?\d{1,5}:-?\d{1,5}$/.test(size)) {
    throw new RangeError(`colorArgs: scale must be W:H with digits, got "${size}"`);
  }
  if (size) filters.push(`scale=${size}`);

  if (!filters.length) {
    return ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", output];
  }

  const final = String(quality).toLowerCase() === "final";
  const speed = preset === undefined || preset === null || preset === ""
    ? final
      ? "medium"
      : "veryfast"
    : String(preset);
  const value = crf === undefined || crf === null || crf === "" ? (final ? 18 : 20) : Number(crf);
  if (!Number.isFinite(value) || value < 0 || value > 63) {
    throw new RangeError("colorArgs: crf must be between 0 and 63");
  }

  const threads = Number(filterThreads);
  const threadArgs =
    Number.isFinite(threads) && threads > 0
      ? ["-filter_threads", String(Math.min(64, Math.trunc(threads)))]
      : [];

  return [
    "-y",
    ...threadArgs,
    "-i", input,
    "-vf", filters.join(","),
    "-map", "0:v:0",
    "-map", "0:a:0?",
    ...videoEncoderArgs({ encoder, crf: value, preset: speed }),
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    output,
  ];
}
