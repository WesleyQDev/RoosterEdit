/**
 * Timeline compilation helpers for RoosterEdit.
 *
 * Pure, dependency-free builders that compile an approved `rooster.plan/v1`
 * into the engine-agnostic `rooster.timeline/v1` document. Also provides
 * per-element render specs and review markers.
 *
 * No filesystem access, no child processes, no I/O. Nothing happens at import
 * time.
 */

const SCHEMA = "rooster.timeline/v1";
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

/** Engines that can render one element on their own. */
export const ELEMENT_ENGINES = ["hyperframes", "remotion"];

/**
 * Resolve the engine that renders one element.
 *
 * An element may carry `engine: "hyperframes" | "remotion"`; otherwise it
 * inherits the project's element engine. `auto`, unknown values, and a missing
 * fallback resolve to null, and validation reports the unknown ones.
 *
 * @param {{engine?: string}|null|undefined} element
 * @param {string|null|undefined} fallback
 * @returns {string|null}
 */
export function elementEngine(element, fallback) {
  const declared = String(element?.engine || "").trim().toLowerCase();
  if (ELEMENT_ENGINES.includes(declared)) return declared;
  const base = String(fallback || "").trim().toLowerCase();
  return ELEMENT_ENGINES.includes(base) ? base : null;
}
const DEFAULT_FPS = 30;
const MIN_ELEMENT_DURATION = 0.1;
const NON_RENDERABLE_TYPES = new Set(["zoom"]);
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Small pure utilities
// ---------------------------------------------------------------------------

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round3(value) {
  return Number(Number(value).toFixed(3));
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? round3(parsed) : fallback;
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(base, used) {
  if (!used || typeof used.has !== "function" || typeof used.add !== "function") return base;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

function compareSpecs(a, aPosition, b, bPosition) {
  const startA = number(a.start, 0);
  const startB = number(b.start, 0);
  if (startA !== startB) return startA - startB;

  const endA = number(a.end, startA);
  const endB = number(b.end, startB);
  if (endA !== endB) return endB - endA;

  const indexA = number(a.index, aPosition);
  const indexB = number(b.index, bPosition);
  if (indexA !== indexB) return indexA - indexB;
  return aPosition - bPosition;
}

function compareLabels(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Element ids and render specs
// ---------------------------------------------------------------------------

/**
 * Return a stable, filesystem-safe id for one plan element.
 *
 * A safe slug from `element.id` is kept as-is. Accents are removed and unsafe
 * characters become hyphens. When the id is missing or resolves to an empty
 * string, the fallback is `el-001` based on the element's 1-based index.
 *
 * @param {object} element Plan element.
 * @param {number} index Zero-based element index.
 * @param {Set<string>} [used] Optional set of already-used ids. When provided,
 *   duplicate ids receive `-2`, `-3`, ... suffixes and the chosen id is added.
 * @returns {string} Stable element id.
 */
export function elementId(element, index, used = null) {
  const position = Math.max(0, Math.trunc(number(index, 0)));
  const raw = isRecord(element) ? element.id : null;
  let id = "";

  if (raw !== null && raw !== undefined) {
    const text = String(raw).trim();
    if (text) id = SAFE_SLUG.test(text) ? text : slugify(text);
  }

  if (!id) id = `el-${pad3(position + 1)}`;
  return uniqueId(id, used);
}

/**
 * Build render specs for every visual element in the plan.
 *
 * The result is sorted by start, then by end descending, then by original
 * index. `zoom` is the only non-renderable type because it decorates the base
 * clip; unknown types stay renderable for the generic card fallback.
 *
 * @param {object} plan Approved `rooster.plan/v1` (already remapped).
 * @param {object} [options] Reserved for callers; not mutated.
 * @returns {Array<object>} Element specs with overlay tracks assigned.
 */
export function elementSpecs(plan, options = {}) {
  const elements = isRecord(plan) && Array.isArray(plan.elements) ? plan.elements : [];
  const used = new Set();
  const fallbackEngine = ELEMENT_ENGINES.includes(String(options?.engine || "").toLowerCase())
    ? String(options.engine).toLowerCase()
    : null;

  const specs = elements.map((element, index) => {
    const source = isRecord(element) ? element : {};
    const start = round3(Math.max(0, number(source.start, 0)));
    const rawEnd = number(source.end, start);
    const maxDuration = Number(options?.duration);
    const hasMax = Number.isFinite(maxDuration) && maxDuration > 0;
    const end = hasMax ? round3(Math.min(rawEnd, maxDuration)) : round3(rawEnd);
    const within = end > start;
    const duration = round3(Math.max(MIN_ELEMENT_DURATION, end - start));
    const type =
      typeof source.type === "string" && source.type.trim() ? source.type.trim() : "unknown";
    const renderable = within && !NON_RENDERABLE_TYPES.has(type);

    return {
      id: elementId(source, index, used),
      index,
      type,
      start,
      end: round3(start + duration),
      duration,
      engine: elementEngine(source, fallbackEngine),
      element: source,
      renderable,
      reason: !within
        ? "outside the timeline"
        : renderable
          ? null
          : "applies to the base clip",
      trackIndex: null,
    };
  });

  const renderable = specs.filter((spec) => spec.renderable);
  const packed = assignOverlayTracks(renderable);
  const byId = new Map(packed.map((spec) => [spec.id, spec]));
  return specs
    .map((spec) => byId.get(spec.id) || { ...spec, trackIndex: null })
    .sort((a, b) => compareSpecs(a, a.index, b, b.index));
}

/**
 * Group render specs by the engine that has to draw them.
 *
 * Elements without an engine inherit `fallbackEngine`. Groups keep the input
 * order inside each engine and are returned in a stable engine order, so a
 * build renders the same way twice.
 *
 * @param {Array<object>} specs
 * @param {string|null|undefined} fallbackEngine
 * @returns {Array<{engine: string, specs: Array<object>}>}
 */
export function groupSpecsByEngine(specs, fallbackEngine) {
  const list = Array.isArray(specs) ? specs : [];
  const groups = new Map();
  for (const spec of list) {
    if (!spec?.renderable) continue;
    const engine = spec.engine || elementEngine(spec.element, fallbackEngine);
    if (!engine) continue;
    if (!groups.has(engine)) groups.set(engine, []);
    groups.get(engine).push(spec);
  }
  return ELEMENT_ENGINES.filter((engine) => groups.has(engine)).map((engine) => ({
    engine,
    specs: groups.get(engine),
  }));
}

/**
 * Pack specs into overlay tracks with greedy first-fit.
 *
 * Specs are sorted by start, then by end descending, then by original index.
 * A spec reuses the first track whose last end is at or before its start;
 * otherwise it opens a new track. Track indices start at 2 (V2, V3, ...).
 *
 * @param {Array<object>} specs Already-built specs.
 * @returns {Array<object>} New sorted specs with `trackIndex` set.
 */
export function assignOverlayTracks(specs) {
  const list = Array.isArray(specs) ? specs : [];
  const ordered = list
    .map((spec, position) => ({ spec: isRecord(spec) ? spec : {}, position }))
    .sort((a, b) => compareSpecs(a.spec, a.position, b.spec, b.position));

  const trackEnds = [];

  return ordered.map(({ spec }) => {
    const start = number(spec.start, 0);
    const end = Math.max(start, number(spec.end, start));
    let lane = trackEnds.findIndex((lastEnd) => lastEnd <= start);

    if (lane === -1) {
      lane = trackEnds.length;
      trackEnds.push(end);
    } else {
      trackEnds[lane] = end;
    }

    return { ...spec, trackIndex: lane + 2 };
  });
}

// ---------------------------------------------------------------------------
// Timeline compilation
// ---------------------------------------------------------------------------

/**
 * Resolve source keeps without mutating the plan or options.
 *
 * Precedence: options.keeps, plan.keeps, one full-length keep when a duration
 * is available, then an empty array. Keeps are validated, clamped at zero,
 * rounded, and sorted by source time.
 *
 * @param {object} plan Plan document.
 * @param {object} options Timeline options.
 * @returns {Array<{start: number, end: number}>} Source keeps.
 */
function resolveKeeps(plan, options) {
  const optionKeeps = Array.isArray(options.keeps) ? options.keeps : null;
  const planKeeps = Array.isArray(plan.keeps) ? plan.keeps : null;
  const raw =
    optionKeeps && optionKeeps.length
      ? optionKeeps
      : planKeeps && planKeeps.length
        ? planKeeps
        : null;

  if (raw) {
    const keeps = [];
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const start = round3(Math.max(0, number(entry.start, 0)));
      const end = round3(number(entry.end, 0));
      if (!(end > start)) continue;
      keeps.push({ start, end });
    }
    if (keeps.length) {
      keeps.sort((a, b) => a.start - b.start || a.end - b.end);
      return keeps;
    }
  }

  const fallback = finiteOrNull(options.duration) ?? finiteOrNull(plan.duration);
  if (fallback !== null && fallback > 0) {
    return [{ start: 0, end: round3(fallback) }];
  }
  return [];
}

/**
 * Resolve the cut-timeline duration.
 *
 * @param {object} plan Plan document.
 * @param {object} options Timeline options.
 * @param {Array<{start: number, end: number}>} keeps Resolved keeps.
 * @returns {number} Cut duration in seconds.
 */
function resolveDuration(plan, options, keeps) {
  const explicit = finiteOrNull(options.duration);
  if (explicit !== null) return round3(Math.max(0, explicit));

  if (keeps.length) {
    return round3(keeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0));
  }

  const planDuration = finiteOrNull(plan.duration);
  return planDuration !== null ? round3(Math.max(0, planDuration)) : 0;
}

/**
 * Merge format sources, preserving unknown keys and applying fallbacks.
 *
 * @param {object} plan Plan document.
 * @param {object} options Timeline options.
 * @param {number} duration Cut duration.
 * @returns {object} Timeline format.
 */
function resolveFormat(plan, options, duration) {
  const planFormat = isRecord(plan.format) ? plan.format : {};
  const optionFormat = isRecord(options.format) ? options.format : {};
  const merged = { ...planFormat, ...optionFormat };

  return {
    ...merged,
    width: positive(merged.width, DEFAULT_WIDTH),
    height: positive(merged.height, DEFAULT_HEIGHT),
    fps: positive(merged.fps, DEFAULT_FPS),
    duration,
  };
}

/**
 * Build one video clip per keep, using a cursor in cut-timeline time.
 *
 * @param {object} plan Plan document.
 * @param {Array<{start: number, end: number}>} keeps Source keeps.
 * @returns {Array<object>} Video clips.
 */
function videoClips(plan, keeps) {
  const src = typeof plan.source === "string" ? plan.source.trim() : "";
  let cursor = 0;

  return keeps.map((keep, index) => {
    const length = round3(keep.end - keep.start);
    const clip = {
      id: `cut-${pad3(index + 1)}`,
      ...(src ? { src } : {}),
      in: keep.start,
      out: keep.end,
      start: round3(cursor),
      end: round3(cursor + length),
      transitionIn: "cut",
      transitionOut: "cut",
    };
    cursor = round3(cursor + length);
    return clip;
  });
}

/**
 * Build overlay clips from renderable element specs.
 *
 * @param {Array<object>} specs Element specs.
 * @param {string|null} engine Renderer for element clips.
 * @returns {Array<object>} Overlay clips.
 */
function overlayClips(specs, engine) {
  const resolvedEngine =
    typeof engine === "string" && engine.trim() ? engine.trim() : null;

  return specs
    .filter((spec) => spec.renderable)
    .map((spec) => ({
      id: spec.id,
      scene: spec.type,
      start: spec.start,
      end: spec.end,
      props: spec.element,
      elementId: spec.id,
      track: `V${Number.isFinite(spec.trackIndex) ? spec.trackIndex : 2}`,
      engine: resolvedEngine,
    }));
}

/**
 * Normalize optional caption cues into timeline clips.
 *
 * @param {Array<object>|null} captions Caption cues.
 * @returns {Array<object>} Caption clips with `{id, start, end, text}`.
 */
function normalizeCaptions(captions) {
  if (!Array.isArray(captions)) return [];
  const clips = [];

  captions.forEach((caption, index) => {
    if (!isRecord(caption)) return;
    const start = round3(Math.max(0, number(caption.start, 0)));
    const end = round3(number(caption.end, 0));
    if (!(end > start)) return;

    clips.push({
      id:
        caption.id !== undefined && caption.id !== null
          ? caption.id
          : `cap-${pad3(index + 1)}`,
      start,
      end,
      text: String(caption.text ?? "").trim(),
    });
  });

  return clips;
}

/**
 * Normalize plan SFX entries into timeline clips.
 *
 * @param {Array<object>|null} sfx Plan SFX entries.
 * @returns {Array<object>} SFX clips with valid source and timing.
 */
function normalizeSfx(sfx) {
  if (!Array.isArray(sfx)) return [];
  const clips = [];

  sfx.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const src = typeof entry.src === "string" ? entry.src.trim() : "";
    if (!src) return;

    const start = round3(Math.max(0, number(entry.start, 0)));
    const end = round3(number(entry.end, 0));
    if (!(end > start)) return;

    clips.push({
      id:
        entry.id !== undefined && entry.id !== null
          ? entry.id
          : `sfx-${pad3(index + 1)}`,
      src,
      start,
      end,
    });
  });

  return clips;
}

/**
 * Build the music clip when the plan has a source.
 *
 * @param {object} plan Plan document.
 * @param {number} duration Cut duration.
 * @returns {object|null} Music clip or null.
 */
function musicClip(plan, duration) {
  const music = isRecord(plan.music) ? plan.music : null;
  const src = music && typeof music.src === "string" ? music.src.trim() : "";
  if (!src) return null;

  const volume = finiteOrNull(music.volume);
  return {
    id: "music",
    src,
    start: 0,
    end: duration,
    volume: volume === null ? 0.2 : volume,
  };
}

/**
 * Compile an approved plan into a `rooster.timeline/v1` document.
 *
 * Element and chapter times are assumed to be in the cut timeline already;
 * keeps remain in original source time. The plan, its elements, and the
 * options object are never mutated.
 *
 * @param {object} plan Approved `rooster.plan/v1` (already remapped).
 * @param {object} [options] Project slug, format, keeps, duration, engine,
 *   and optional caption cues.
 * @returns {object} Engine-agnostic timeline document.
 */
export function timelineFromPlan(plan, options = {}) {
  const source = isRecord(plan) ? plan : {};
  const opts = isRecord(options) ? options : {};

  const keeps = resolveKeeps(source, opts);
  const duration = resolveDuration(source, opts, keeps);
  const format = resolveFormat(source, opts, duration);
  const specs = elementSpecs(source, opts);
  const music = musicClip(source, duration);

  const projectValue = opts.projectSlug ?? source.project ?? source.slug;
  const project =
    projectValue === undefined || projectValue === null ? "" : String(projectValue);

  return {
    schema: SCHEMA,
    project,
    format,
    tracks: [
      { id: "v1", kind: "video", clips: videoClips(source, keeps) },
      { id: "ov1", kind: "overlay", clips: overlayClips(specs, opts.engine) },
      { id: "cap1", kind: "captions", clips: normalizeCaptions(opts.captions) },
      { id: "a1", kind: "voice", clips: [] },
      { id: "m1", kind: "music", clips: music ? [music] : [] },
      { id: "s1", kind: "sfx", clips: normalizeSfx(source.sfx) },
    ],
    scenes: [],
    markers: timelineMarkers(source, opts),
  };
}

/**
 * Build review and NLE markers from chapters, elements, and keep boundaries.
 *
 * Element and chapter times are used as given (cut timeline). Cut markers use
 * the cumulative cut-timeline time of each keep after the first. The result
 * is sorted by time then label and has no duplicate time+label pairs.
 *
 * @param {object} plan Approved plan (already remapped).
 * @param {object} [options] Uses `keeps` and `duration` like timelineFromPlan.
 * @returns {Array<{time: number, label: string, kind: string}>} Markers.
 */
export function timelineMarkers(plan, options = {}) {
  const source = isRecord(plan) ? plan : {};
  const opts = isRecord(options) ? options : {};
  const markers = [];

  const chapters = Array.isArray(source.chapters) ? source.chapters : [];
  chapters.forEach((chapter, index) => {
    if (!isRecord(chapter)) return;
    const label = String(chapter.title ?? chapter.label ?? `chapter ${index + 1}`).trim();
    markers.push({
      time: round3(Math.max(0, number(chapter.start, 0))),
      label: label || `chapter ${index + 1}`,
      kind: "chapter",
    });
  });

  const elements = Array.isArray(source.elements) ? source.elements : [];
  elements.forEach((element) => {
    if (!isRecord(element)) return;
    const label = String(element.text || element.type || "element").trim();
    markers.push({
      time: round3(Math.max(0, number(element.start, 0))),
      label: label || "element",
      kind: "element",
    });
  });

  const keeps = resolveKeeps(source, opts);
  let cursor = 0;
  keeps.forEach((keep, index) => {
    if (index > 0 && cursor > 0) {
      markers.push({ time: round3(cursor), label: `cut ${index + 1}`, kind: "cut" });
    }
    cursor = round3(cursor + (keep.end - keep.start));
  });

  const seen = new Set();
  const unique = [];
  for (const marker of markers) {
    const key = `${marker.time}\u0000${marker.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(marker);
  }

  unique.sort((a, b) => a.time - b.time || compareLabels(a.label, b.label));
  return unique;
}

/**
 * Summarize a timeline for CLI output.
 *
 * @param {object} timeline Timeline document.
 * @returns {{duration: number, tracks: number, clips: number, overlays: number, markers: number}} Summary.
 */
export function summarizeTimeline(timeline) {
  const doc = isRecord(timeline) ? timeline : {};
  const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
  let clips = 0;
  let overlays = 0;

  for (const track of tracks) {
    if (!isRecord(track)) continue;
    const count = Array.isArray(track.clips) ? track.clips.length : 0;
    clips += count;

    const isOverlay =
      track.kind === "overlay" ||
      (!track.kind && String(track.id ?? "").startsWith("ov"));
    if (isOverlay) overlays += count;
  }

  return {
    duration: round3(Math.max(0, number(doc.format?.duration, 0))),
    tracks: tracks.length,
    clips,
    overlays,
    markers: Array.isArray(doc.markers) ? doc.markers.length : 0,
  };
}
