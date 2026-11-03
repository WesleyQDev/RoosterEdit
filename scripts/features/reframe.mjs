/**
 * Reframe a video to another aspect ratio with FFmpeg.
 *
 * This module only builds filter strings and argument arrays. It never spawns
 * FFmpeg, reads media, or writes files, so it is safe to import from tests,
 * agents, and build adapters.
 *
 * The default strategy is the largest possible center crop: keep the full
 * short side of the source and crop the long side to the target aspect, then
 * scale to the delivery size. It is a geometric heuristic, not subject
 * tracking.
 */

/** Preset delivery sizes. */
const TARGETS = Object.freeze({
  "16:9": Object.freeze({ width: 1920, height: 1080 }),
  "9:16": Object.freeze({ width: 1080, height: 1920 }),
  "1:1": Object.freeze({ width: 1080, height: 1080 }),
  "4:5": Object.freeze({ width: 1080, height: 1350 }),
});

const MODES = new Set(["center", "left", "right", "focus"]);

/**
 * Return the delivery dimensions for a preset or an explicit size.
 *
 * @param {"16:9"|"9:16"|"1:1"|"4:5"|{width:number,height:number}} format
 * @returns {{width:number,height:number}}
 * @throws {TypeError|RangeError} When the preset is unknown or a size is invalid.
 */
export function targetDimensions(format) {
  if (format && typeof format === "object") {
    return {
      width: positiveInt(format.width, "format.width"),
      height: positiveInt(format.height, "format.height"),
    };
  }

  const key = String(format ?? "").trim();
  const target = TARGETS[key];
  if (!target) {
    throw new RangeError(
      `Unknown format "${key}". Use 16:9, 9:16, 1:1, 4:5, or { width, height }.`
    );
  }
  return { width: target.width, height: target.height };
}

/**
 * Build the FFmpeg crop/scale filter for one fixed framing.
 *
 * `center` keeps the subject area as large as possible by cropping only the
 * excess axis. `left` and `right` anchor horizontally and center vertically.
 * `focus` centers a normalized point (0..1) in the output.
 *
 * @param {object} options
 * @param {number} options.sourceWidth
 * @param {number} options.sourceHeight
 * @param {number} options.targetWidth
 * @param {number} options.targetHeight
 * @param {"center"|"left"|"right"|"focus"} [options.mode="center"]
 * @param {number} [options.focusX=0.5] Normalized horizontal focus (0 = left).
 * @param {number} [options.focusY=0.5] Normalized vertical focus (0 = top).
 * @returns {string} An FFmpeg `-vf` filter, for example
 *   `crop=608:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1`.
 * @throws {TypeError|RangeError} When dimensions or the mode are invalid.
 */
export function buildReframeFilter({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  mode = "center",
  focusX = 0.5,
  focusY = 0.5,
} = {}) {
  const sw = positiveInt(sourceWidth, "sourceWidth");
  const sh = positiveInt(sourceHeight, "sourceHeight");
  const tw = positiveInt(targetWidth, "targetWidth");
  const th = positiveInt(targetHeight, "targetHeight");
  if (sw < 2 || sh < 2) {
    throw new RangeError("sourceWidth and sourceHeight must be at least 2.");
  }

  const normalizedMode = String(mode || "center").toLowerCase();
  if (!MODES.has(normalizedMode)) {
    throw new RangeError(
      `Unknown reframe mode "${mode}". Use center, left, right, or focus.`
    );
  }

  const box = cropBox({
    sourceWidth: sw,
    sourceHeight: sh,
    targetWidth: tw,
    targetHeight: th,
    mode: normalizedMode,
    focusX: clampFocus(focusX),
    focusY: clampFocus(focusY),
  });

  return [
    `crop=${box.width}:${box.height}:${box.x}:${box.y}`,
    `scale=${tw}:${th}:flags=lanczos`,
    "setsar=1",
  ].join(",");
}

/**
 * Build a complete FFmpeg argument array that crops/scales a video.
 *
 * The caller owns execution. The returned command keeps the first video
 * stream, preserves optional audio as AAC, drops subtitles/data, and encodes
 * H.264/yuv420p for broad platform compatibility.
 *
 * @param {object} options
 * @param {string} options.input Source file.
 * @param {string} options.output Destination file (MP4/MOV recommended).
 * @param {number} options.sourceWidth
 * @param {number} options.sourceHeight
 * @param {"16:9"|"9:16"|"1:1"|"4:5"|{width:number,height:number}} options.format
 * @param {"center"|"left"|"right"|"focus"} [options.mode="center"]
 * @param {number} [options.focusX=0.5]
 * @param {number} [options.focusY=0.5]
 * @param {number} [options.crf=18] H.264 quality (lower is better).
 * @param {string} [options.preset="medium"] x264 speed/size preset.
 * @returns {string[]} FFmpeg arguments, not executed.
 * @throws {TypeError|RangeError} When arguments are missing or invalid.
 */
export function reframeArgs({
  input,
  output,
  sourceWidth,
  sourceHeight,
  format,
  mode = "center",
  focusX = 0.5,
  focusY = 0.5,
  crf = 18,
  preset = "medium",
} = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new TypeError("input must be a non-empty file path.");
  }
  if (typeof output !== "string" || !output.trim()) {
    throw new TypeError("output must be a non-empty file path.");
  }

  const target = targetDimensions(format);
  const filter = buildReframeFilter({
    sourceWidth,
    sourceHeight,
    targetWidth: target.width,
    targetHeight: target.height,
    mode,
    focusX,
    focusY,
  });

  const quality =
    crf === null || crf === undefined || crf === ""
      ? 18
      : Number.isFinite(Number(crf))
        ? Math.min(51, Math.max(0, Number(crf)))
        : 18;
  const speed = typeof preset === "string" && preset.trim() ? preset.trim() : "medium";

  return [
    "-y",
    "-i", input,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", speed,
    "-crf", String(quality),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    output,
  ];
}

/**
 * Compute an even-dimension crop box at the target aspect.
 * @private
 */
function cropBox({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  mode,
  focusX,
  focusY,
}) {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  let width;
  let height;
  if (sourceAspect > targetAspect) {
    // Source is wider: keep full height, trim the sides.
    height = sourceHeight;
    width = Math.round(sourceHeight * targetAspect);
  } else {
    // Source is taller: keep full width, trim top/bottom.
    width = sourceWidth;
    height = Math.round(sourceWidth / targetAspect);
  }

  // Chroma-subsampled output prefers even crop sizes and offsets.
  width = Math.min(toEvenFloor(width), toEvenFloor(sourceWidth));
  height = Math.min(toEvenFloor(height), toEvenFloor(sourceHeight));

  const maxX = Math.max(0, sourceWidth - width);
  const maxY = Math.max(0, sourceHeight - height);

  let x;
  let y;
  if (mode === "left") {
    x = 0;
    y = (sourceHeight - height) / 2;
  } else if (mode === "right") {
    x = maxX;
    y = (sourceHeight - height) / 2;
  } else if (mode === "focus") {
    x = focusX * sourceWidth - width / 2;
    y = focusY * sourceHeight - height / 2;
  } else {
    x = (sourceWidth - width) / 2;
    y = (sourceHeight - height) / 2;
  }

  return {
    width,
    height,
    x: evenOffset(x, maxX),
    y: evenOffset(y, maxY),
  };
}

/**
 * @private
 */
function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive number.`);
  }
  return Math.round(number);
}

/**
 * @private
 */
function toEvenFloor(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * @private
 */
function clampFocus(value) {
  if (value === null || value === undefined || value === "") return 0.5;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

/**
 * @private
 */
function evenOffset(value, max) {
  const clamped = Math.min(max, Math.max(0, value));
  return Math.min(max, Math.floor(clamped / 2) * 2);
}
