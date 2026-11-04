/**
 * Hybrid render helpers for RoosterEdit.
 *
 * A hybrid render draws the base timeline with FFmpeg, renders only the short
 * overlay windows with the engine, and composites them back in a single FFmpeg
 * pass. These functions are pure: they inspect the plan, group windows, and
 * build arguments. They never spawn a process or touch disk.
 */

const HYBRID_ELEMENT_TYPES = Object.freeze([
  "letreiro",
  "caption-emphasis",
  "lower-third",
  "broll",
  "grafico",
  "lista",
  "end-card",
]);

const HYBRID_TYPE_SET = new Set(HYBRID_ELEMENT_TYPES);
const DEFAULT_OVERLAY_PADDING = 0.5;
const DEFAULT_MAX_WINDOW = 8;
const MAX_ELEMENT_RATIO = 0.5;
const MAX_COVERAGE_RATIO = 0.6;
const EPSILON = 1e-6;

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

function normalizeType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function planDuration(plan) {
  const direct = positiveNumber(plan?.duration);
  if (direct !== null) return direct;

  let max = 0;
  for (const key of ["keeps", "cuts", "elements"]) {
    const list = Array.isArray(plan?.[key]) ? plan[key] : [];
    for (const item of list) {
      const end = finiteNumber(item?.end);
      if (end !== null && end > max) max = end;
    }
  }
  return max;
}

function listHasSpeedChange(list) {
  if (!Array.isArray(list)) return false;
  return list.some((item) => {
    if (!isObject(item)) return false;
    if (item.speedRamp !== undefined && item.speedRamp !== null) return true;
    if (item.speed !== undefined && item.speed !== null && Number(item.speed) !== 1) return true;
    return false;
  });
}

function hasSpeedChange(plan) {
  if (!isObject(plan)) return false;
  if (plan.speed !== undefined && plan.speed !== null && Number(plan.speed) !== 1) return true;
  if (plan.speedRamp !== undefined && plan.speedRamp !== null) return true;
  for (const key of ["cuts", "keeps", "elements", "clips"]) {
    if (listHasSpeedChange(plan[key])) return true;
  }
  if (isObject(plan.multicam)) {
    const multicam = plan.multicam;
    if (multicam.speedRamp !== undefined && multicam.speedRamp !== null) return true;
    if (multicam.speed !== undefined && multicam.speed !== null && Number(multicam.speed) !== 1) {
      return true;
    }
    if (Array.isArray(multicam.speedRamps) && multicam.speedRamps.length > 0) return true;
    if (listHasSpeedChange(multicam.clips)) return true;
    if (listHasSpeedChange(multicam.cameras)) return true;
  }
  return false;
}

function hasFullFrameTransition(plan) {
  if (!isObject(plan)) return false;
  if (Array.isArray(plan.elements)) {
    if (plan.elements.some((element) => normalizeType(element?.type) === "transition")) {
      return true;
    }
  }
  if (Array.isArray(plan.transitions) && plan.transitions.length > 0) return true;
  if (isObject(plan.transition) && Object.keys(plan.transition).length > 0) return true;
  return false;
}

function overlayEntries(plan) {
  const elements = Array.isArray(plan?.elements) ? plan.elements : [];
  const entries = [];
  for (const element of elements) {
    if (!isObject(element)) continue;
    if (!HYBRID_TYPE_SET.has(normalizeType(element.type))) continue;
    const start = finiteNumber(element.start);
    const end = finiteNumber(element.end);
    if (start === null || end === null || end <= start) continue;
    entries.push({ element, start, end });
  }
  return entries;
}

function mergedCoverage(entries, duration) {
  const intervals = entries
    .map((entry) => ({
      start: clamp(entry.start, 0, duration),
      end: clamp(entry.end, 0, duration),
    }))
    .filter((interval) => interval.end - interval.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let total = 0;
  let current = null;
  for (const interval of intervals) {
    if (!current) {
      current = { ...interval };
      continue;
    }
    if (interval.start <= current.end + EPSILON) {
      current.end = Math.max(current.end, interval.end);
    } else {
      total += current.end - current.start;
      current = { ...interval };
    }
  }
  if (current) total += current.end - current.start;
  return total;
}

/**
 * Decide whether the hybrid path can represent this plan.
 *
 * Returns false when there is no source video, no overlay, an unsupported
 * element (zoom/transition), a speed change, a full-frame transition, invalid
 * timing, or overlay coverage that is too large relative to the video.
 *
 * @param {object|null|undefined} plan `rooster.plan/v1` object.
 * @returns {boolean} True when a hybrid render is a safe fallback-free choice.
 */
export function canRenderHybrid(plan) {
  if (!isObject(plan)) return false;
  if (typeof plan.source !== "string" || !plan.source.trim()) return false;

  const duration = planDuration(plan);
  if (!(duration > 0)) return false;
  if (hasSpeedChange(plan)) return false;
  if (hasFullFrameTransition(plan)) return false;

  const elements = Array.isArray(plan.elements) ? plan.elements : [];
  if (elements.length === 0) return false;

  for (const element of elements) {
    if (!isObject(element)) return false;
    if (!HYBRID_TYPE_SET.has(normalizeType(element.type))) return false;

    const start = finiteNumber(element.start);
    const end = finiteNumber(element.end);
    if (start === null || end === null || start < 0 || end <= start) return false;

    const visible = Math.min(end, duration) - Math.max(start, 0);
    if (visible <= EPSILON) return false;
    if (visible > duration * MAX_ELEMENT_RATIO) return false;
  }

  const coverage = mergedCoverage(overlayEntries(plan), duration);
  if (coverage > duration * MAX_COVERAGE_RATIO) return false;
  return true;
}

/**
 * Group overlay elements into short composition windows.
 *
 * Each element is padded on both sides, clamped to the video duration, and
 * merged with overlapping or adjacent windows. A merged window longer than
 * `maxWindow` is split into consecutive slices so one engine composition stays
 * short.
 *
 * @param {object|null|undefined} plan `rooster.plan/v1` object.
 * @param {object} [options]
 * @param {number} [options.padding] Seconds added before and after each element.
 * @param {number} [options.maxWindow] Maximum composition window in seconds.
 * @returns {Array<{start: number, end: number, elements: object[]}>} Windows in timeline order.
 */
export function planOverlayWindows(
  plan,
  { padding = DEFAULT_OVERLAY_PADDING, maxWindow = DEFAULT_MAX_WINDOW } = {}
) {
  if (!isObject(plan)) return [];
  const duration = planDuration(plan);
  if (!(duration > 0)) return [];

  const padValue = finiteNumber(padding);
  const pad = padValue === null ? DEFAULT_OVERLAY_PADDING : Math.max(0, padValue);
  const capValue = positiveNumber(maxWindow);
  const cap = capValue === null ? DEFAULT_MAX_WINDOW : capValue;

  const entries = overlayEntries(plan)
    .map((entry) => ({
      element: entry.element,
      start: clamp(entry.start - pad, 0, duration),
      end: clamp(entry.end + pad, 0, duration),
    }))
    .filter((entry) => entry.end - entry.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (entries.length === 0) return [];

  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && entry.start <= last.end + EPSILON) {
      last.end = Math.max(last.end, entry.end);
      last.items.push(entry);
    } else {
      groups.push({ start: entry.start, end: entry.end, items: [entry] });
    }
  }

  const windows = [];
  for (const group of groups) {
    let cursor = group.start;
    while (cursor < group.end - EPSILON) {
      const end = Math.min(group.end, cursor + cap);
      const elements = group.items
        .filter((item) => item.end > cursor + EPSILON && item.start < end - EPSILON)
        .map((item) => item.element);
      if (elements.length > 0) {
        windows.push({ start: round(cursor), end: round(end), elements });
      }
      cursor = end;
    }
  }
  return windows;
}

function normalizePosition(value, name, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number.`);
    return formatNumber(value);
  }
  const text = String(value).trim();
  if (!/^[A-Za-z0-9_+\-*/(). ]+$/.test(text)) {
    throw new RangeError(`${name} must be a number or a simple FFmpeg expression.`);
  }
  return text;
}

function normalizeOverlay(overlay, index) {
  if (!isObject(overlay)) {
    throw new TypeError(`overlays[${index}] must be an object.`);
  }
  const overlayPath =
    typeof overlay.path === "string" && overlay.path.trim() ? overlay.path : null;
  if (!overlayPath) throw new TypeError(`overlays[${index}].path is required.`);

  const start = finiteNumber(overlay.start);
  const end = finiteNumber(overlay.end);
  if (start === null || start < 0) {
    throw new RangeError(`overlays[${index}].start must be a non-negative number.`);
  }
  if (end === null || end <= start) {
    throw new RangeError(`overlays[${index}].end must be greater than start.`);
  }

  return {
    path: overlayPath,
    start: round(start),
    end: round(end),
    x: normalizePosition(overlay.x, `overlays[${index}].x`, "0"),
    y: normalizePosition(overlay.y, `overlays[${index}].y`, "0"),
  };
}

function normalizeSize(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const size = finiteNumber(value);
  if (size === null || !Number.isInteger(size) || size <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return size;
}

/**
 * Build a single-pass FFmpeg command that overlays short clips on a base video.
 *
 * Each overlay input starts at its absolute timeline position (via `setpts`)
 * and is enabled only inside `[start, end]`. Overlay clips are expected to be
 * full-frame transparent compositions (ProRes 4444, VP9/WebM alpha, or PNG
 * sequences). The video is re-encoded; base audio is copied, an external audio
 * mix is encoded to AAC.
 *
 * @param {object} options
 * @param {string} options.base Base video produced by FFmpeg.
 * @param {Array<{path: string, start: number, end: number, x?: number|string, y?: number|string}>} [options.overlays] Overlay clips.
 * @param {string|null} [options.audio] External audio mix.
 * @param {string} options.out Output video path.
 * @param {number} [options.duration] Output duration in seconds.
 * @param {number} [options.width] Output width (scales base and overlays).
 * @param {number} [options.height] Output height (scales base and overlays).
 * @param {string} [options.preset] libx264 preset; default `medium`.
 * @param {number} [options.crf] libx264 CRF; default 18.
 * @returns {{command: string, args: string[], filter: string, out: string}} Invocation.
 */
export function compositeArgs({
  base,
  overlays = [],
  audio = null,
  out,
  duration,
  width,
  height,
  preset = "medium",
  crf = 18,
} = {}) {
  if (typeof base !== "string" || !base.trim()) {
    throw new TypeError("compositeArgs requires base.");
  }
  if (typeof out !== "string" || !out.trim()) {
    throw new TypeError("compositeArgs requires out.");
  }
  if (!Array.isArray(overlays)) {
    throw new TypeError("compositeArgs overlays must be an array.");
  }

  const list = overlays.map((overlay, index) => normalizeOverlay(overlay, index));
  const targetWidth = normalizeSize(width, "width");
  const targetHeight = normalizeSize(height, "height");
  if ((targetWidth === null) !== (targetHeight === null)) {
    throw new RangeError("width and height must be provided together.");
  }
  const totalDuration = positiveNumber(duration);
  const audioPath = typeof audio === "string" && audio.trim() ? audio : null;
  const x264Preset = typeof preset === "string" && preset.trim() ? preset.trim() : "medium";
  const x264Crf = finiteNumber(crf);
  if (x264Crf === null || x264Crf < 0 || x264Crf > 51) {
    throw new RangeError("crf must be a number between 0 and 51.");
  }

  const args = ["-y", "-i", base];
  for (const overlay of list) args.push("-i", overlay.path);
  const audioIndex = audioPath === null ? null : 1 + list.length;
  if (audioPath !== null) args.push("-i", audioPath);

  const filters = [];
  const scale = targetWidth !== null ? `scale=${targetWidth}:${targetHeight}:flags=lanczos` : null;
  let current = "0:v";

  if (scale) {
    filters.push(`[0:v]${scale},setsar=1${list.length > 0 ? "[base0]" : "[vout]"}`);
    current = list.length > 0 ? "base0" : "vout";
  } else if (list.length > 0) {
    filters.push("[0:v]setpts=PTS-STARTPTS[base0]");
    current = "base0";
  }

  list.forEach((overlay, index) => {
    const label = `ov${index + 1}`;
    const chain = [`setpts=PTS-STARTPTS+${formatNumber(overlay.start)}/TB`];
    if (scale) chain.unshift(scale);
    filters.push(`[${index + 1}:v]${chain.join(",")}[${label}]`);

    const output = `v${index + 1}`;
    filters.push(
      `[${current}][${label}]overlay=${overlay.x}:${overlay.y}:eof_action=pass:enable='between(t,${formatNumber(
        overlay.start
      )},${formatNumber(overlay.end)})'[${output}]`
    );
    current = output;
  });

  const hasOverlays = list.length > 0;
  if (filters.length > 0) args.push("-filter_complex", filters.join(";"));
  args.push("-map", hasOverlays || scale ? `[${current}]` : "0:v:0");

  if (audioIndex !== null) {
    args.push("-map", `${audioIndex}:a:0`);
  } else {
    args.push("-map", "0:a?");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    x264Preset,
    "-crf",
    String(x264Crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart"
  );

  if (audioIndex !== null) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-c:a", "copy");
  }

  if (totalDuration !== null) args.push("-t", formatNumber(totalDuration));
  args.push(out);

  return {
    command: "ffmpeg",
    args,
    filter: filters.join(";"),
    out,
  };
}
