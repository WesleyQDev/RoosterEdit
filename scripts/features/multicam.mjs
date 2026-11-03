/**
 * Multi-camera, J/L cut, and speed-ramp planning helpers.
 *
 * The module is pure: it normalizes editorial plans and returns FFmpeg filter
 * fragments. It never probes media, synchronizes cameras, or renders anything.
 */

const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function toPosix(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function formatNumber(value) {
  return String(Number(Number(value).toFixed(6)));
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function atempoFactors(speed) {
  let remaining = speed;
  const factors = [];

  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-9) {
    factors.push(remaining);
  }

  return (factors.length ? factors : [1]).map((factor) => round(factor, 6));
}

// ---------------------------------------------------------------------------
// Multi-camera
// ---------------------------------------------------------------------------

/**
 * Normalize a multi-camera plan into continuous camera segments.
 *
 * Cuts are sorted by time. Overlaps are trimmed to the previous cut, gaps are
 * filled with the previous camera (or the first camera before the first cut),
 * and adjacent segments with the same camera are merged. Gap-filled segments
 * are marked `derived: true`.
 *
 * @param {{cameras?: Array<{id?: string, src: string, angle?: string|number}>, cuts?: Array<{id?: string, start: number, end: number, camera: string}>, duration?: number}} [options]
 * @returns {object} `rooster.multicam/v1` with cameras, normalized cuts, segments, gaps, and warnings.
 */
export function buildMulticamPlan({ cameras, cuts, duration } = {}) {
  if (!Array.isArray(cameras) || cameras.length === 0) {
    throw new TypeError("buildMulticamPlan requires a non-empty cameras array");
  }

  const normalizedCameras = cameras.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new TypeError(`cameras[${index}] must be an object`);
    }
    const id = String(raw.id || raw.cameraId || `cam-${index + 1}`).trim();
    if (!id) throw new TypeError(`cameras[${index}] requires a non-empty id`);

    const src = String(raw.src || raw.source || "").trim();
    if (!src) throw new TypeError(`camera "${id}" requires src`);

    return {
      id,
      cameraId: id,
      src: toPosix(src),
      angle: raw.angle ?? raw.label ?? null,
      index,
    };
  });

  const byId = new Map();
  const byLower = new Map();
  for (const camera of normalizedCameras) {
    if (byId.has(camera.id)) {
      throw new TypeError(`Duplicate camera id "${camera.id}"`);
    }
    byId.set(camera.id, camera);
    byLower.set(camera.id.toLowerCase(), camera);
  }

  const resolveCamera = (value) => {
    if (typeof value === "number") {
      return normalizedCameras[value] || null;
    }
    const key = String(value ?? "").trim();
    if (!key) return null;
    const direct = byId.get(key) || byLower.get(key.toLowerCase());
    if (direct) return direct;
    if (/^\d+$/.test(key)) return normalizedCameras[Number(key)] || null;
    return null;
  };

  const durationLimit = finiteNumber(duration);
  if (durationLimit !== null && durationLimit <= 0) {
    throw new RangeError("duration must be greater than 0 when provided");
  }

  const warnings = [];
  const rawCuts = (Array.isArray(cuts) ? cuts : [])
    .map((raw, index) => ({ raw, index }))
    .filter(({ raw }) => raw && typeof raw === "object")
    .sort((a, b) => {
      const aStart = finiteNumber(a.raw.start) ?? 0;
      const bStart = finiteNumber(b.raw.start) ?? 0;
      return aStart - bStart || a.index - b.index;
    });

  const normalizedCuts = [];
  let cursor = 0;

  for (const { raw, index } of rawCuts) {
    const label = raw.id ? String(raw.id) : `cut-${index + 1}`;
    const camera = resolveCamera(raw.camera ?? raw.cameraId);
    let start = finiteNumber(raw.start);
    let end = finiteNumber(raw.end);

    if (!camera) {
      warnings.push(`${label}: unknown camera "${raw.camera ?? raw.cameraId ?? ""}", skipped`);
      continue;
    }
    if (start === null || end === null) {
      warnings.push(`${label}: start and end must be numeric seconds, skipped`);
      continue;
    }
    if (end <= start) {
      warnings.push(`${label}: end must be greater than start, skipped`);
      continue;
    }

    let adjusted = false;
    if (start < 0) {
      start = 0;
      adjusted = true;
      warnings.push(`${label}: start clamped to 0`);
    }
    if (durationLimit !== null && end > durationLimit) {
      end = durationLimit;
      adjusted = true;
      warnings.push(`${label}: end clamped to duration ${round(durationLimit)}s`);
    }
    if (end <= start) {
      warnings.push(`${label}: outside the requested duration, skipped`);
      continue;
    }
    if (start < cursor) {
      if (end <= cursor + EPSILON) {
        warnings.push(`${label}: fully covered by a previous cut, skipped`);
        continue;
      }
      start = cursor;
      adjusted = true;
      warnings.push(`${label}: overlap trimmed to ${round(start)}s`);
    }

    normalizedCuts.push({
      id: raw.id ? String(raw.id) : `cut-${String(index + 1).padStart(3, "0")}`,
      start: round(start),
      end: round(end),
      camera: camera.id,
      cameraId: camera.id,
      src: camera.src,
      angle: camera.angle,
      adjusted,
    });
    cursor = end;
  }

  const gaps = [];
  const segments = [];

  const pushSegment = ({ start, end, camera, source, derived, cutIds = [] }) => {
    const last = segments[segments.length - 1];
    if (
      last &&
      Math.abs(last.end - start) <= EPSILON &&
      last.camera === camera.id
    ) {
      last.end = round(end);
      last.duration = round(last.end - last.start);
      last.derived = Boolean(last.derived || derived);
      if (last.source !== source) last.source = "mixed";
      last.cutIds = [...new Set([...last.cutIds, ...cutIds])];
      last.cutId = last.cutIds[0] || null;
      return;
    }

    segments.push({
      start: round(start),
      end: round(end),
      duration: round(end - start),
      camera: camera.id,
      cameraId: camera.id,
      cameraIndex: camera.index,
      src: camera.src,
      angle: camera.angle,
      source,
      derived: Boolean(derived),
      cutId: cutIds[0] || null,
      cutIds: [...cutIds],
    });
  };

  let previousEnd = 0;
  let previousCamera = normalizedCameras[0];

  for (const cut of normalizedCuts) {
    const camera = byId.get(cut.camera);
    if (cut.start > previousEnd + EPSILON) {
      const gapStart = previousEnd;
      const gapEnd = cut.start;
      const fillCamera = previousCamera || normalizedCameras[0];
      gaps.push({
        start: round(gapStart),
        end: round(gapEnd),
        duration: round(gapEnd - gapStart),
        camera: fillCamera.id,
        reason: previousEnd <= EPSILON ? "before-first-cut" : "between-cuts",
      });
      pushSegment({
        start: gapStart,
        end: gapEnd,
        camera: fillCamera,
        source: "gap",
        derived: true,
      });
    }

    pushSegment({
      start: cut.start,
      end: cut.end,
      camera,
      source: "cut",
      derived: false,
      cutIds: [cut.id],
    });
    previousEnd = cut.end;
    previousCamera = camera;
  }

  if (!normalizedCuts.length) {
    warnings.push("No valid camera cuts; add at least one cut or provide duration for a default-camera fill.");
  }

  if (durationLimit !== null && previousEnd < durationLimit - EPSILON) {
    const fillCamera = previousCamera || normalizedCameras[0];
    gaps.push({
      start: round(previousEnd),
      end: round(durationLimit),
      duration: round(durationLimit - previousEnd),
      camera: fillCamera.id,
      reason: normalizedCuts.length ? "tail" : "no-cuts",
    });
    pushSegment({
      start: previousEnd,
      end: durationLimit,
      camera: fillCamera,
      source: "gap",
      derived: true,
    });
    previousEnd = durationLimit;
  }

  const finalDuration = durationLimit ?? previousEnd;

  return {
    schema: "rooster.multicam/v1",
    cameras: normalizedCameras,
    cuts: normalizedCuts,
    segments: segments.map((segment, index) => ({
      ...segment,
      id: `seg-${String(index + 1).padStart(3, "0")}`,
    })),
    gaps,
    duration: round(finalDuration),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/**
 * Build FFmpeg setpts/atempo fragments for a constant speed change.
 *
 * atempo preserves pitch. Speeds outside 0.5–2.0 are split into multiple atempo
 * stages because some FFmpeg builds reject a single stage outside that range.
 * `videoFilter` adds an optional fps filter; `video` is the raw setpts fragment.
 *
 * @param {{speed: number, fps?: number}} options Playback speed (1 = normal) and output fps.
 * @returns {{schema:string,speed:number,fps:number,video:string,audio:string,videoFilter:string,audioFilter:string,atempo:number[],warnings:string[]}}
 */
export function speedFilter({ speed, fps = 30 } = {}) {
  const value = Number(speed);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("speedFilter requires a finite speed greater than 0");
  }

  const frameRate = Number(fps);
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError("speedFilter requires a finite fps greater than 0");
  }

  const factors = atempoFactors(value);
  const video = `setpts=(PTS-STARTPTS)/${formatNumber(value)}`;
  const audio = factors.map((factor) => `atempo=${formatNumber(factor)}`).join(",");
  const warnings = [];

  if (factors.length > 1) {
    warnings.push(
      `atempo is chained in ${factors.length} stages to keep each stage within 0.5–2.0.`
    );
  }
  if (value > 4) {
    warnings.push("Speeds above 4x can sound unnatural even with pitch-preserving atempo.");
  }
  if (value < 0.25) {
    warnings.push("Speeds below 0.25x can expose audio artifacts and stretched transients.");
  }

  return {
    schema: "rooster.speed-filter/v1",
    speed: round(value, 6),
    fps: round(frameRate, 6),
    video,
    audio,
    videoFilter: `${video},fps=${formatNumber(frameRate)}`,
    audioFilter: audio,
    atempo: factors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// J/L cuts
// ---------------------------------------------------------------------------

/**
 * Normalize a clip's J/L cut offsets.
 *
 * Offsets are seconds relative to the clip start. Positive values delay that
 * stream; negative values advance it. So `audioOffset < 0` is an audio lead
 * (L-cut into the clip) and `audioOffset > 0` is an audio lag (J-cut from the
 * previous clip). Offsets are clamped to the clip duration when one is known.
 *
 * @param {{clip: object}} options Clip with `audioOffset`/`videoOffset`, optional start/end/in/out.
 * @returns {{schema:string,audioOffset:number,videoOffset:number,audioStart:number|null,videoStart:number|null,clipStart:number|null,clipEnd:number|null,duration:number|null,mode:string,audioLeads:boolean,videoLeads:boolean,clamped:{audio:boolean,video:boolean},warnings:string[]}}
 */
export function jlCutOffsets({ clip } = {}) {
  if (!clip || typeof clip !== "object") {
    throw new TypeError("jlCutOffsets requires a clip object");
  }

  const source =
    clip.jlCut && typeof clip.jlCut === "object" ? clip.jlCut : clip;
  const warnings = [];

  const readOffset = (value, label) => {
    if (value === undefined || value === null || value === "") return 0;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      warnings.push(`${label} must be numeric seconds; using 0`);
      return 0;
    }
    return number;
  };

  let audio = readOffset(
    source.audioOffset ?? clip.audioOffset ?? clip.audio?.offset,
    "audioOffset"
  );
  let video = readOffset(
    source.videoOffset ?? clip.videoOffset ?? clip.video?.offset,
    "videoOffset"
  );

  const start = finiteNumber(clip.start);
  const end = finiteNumber(clip.end);
  const inPoint = finiteNumber(clip.in);
  const outPoint = finiteNumber(clip.out);
  let duration = null;
  if (start !== null && end !== null && end > start) {
    duration = end - start;
  } else if (inPoint !== null && outPoint !== null && outPoint > inPoint) {
    duration = outPoint - inPoint;
  } else {
    const explicit = finiteNumber(clip.duration);
    if (explicit !== null && explicit > 0) duration = explicit;
  }

  let audioClamped = false;
  let videoClamped = false;
  if (duration !== null) {
    if (Math.abs(audio) > duration + EPSILON) {
      audio = Math.sign(audio) * duration;
      audioClamped = true;
      warnings.push(`audioOffset clamped to the clip duration (${round(duration)}s)`);
    }
    if (Math.abs(video) > duration + EPSILON) {
      video = Math.sign(video) * duration;
      videoClamped = true;
      warnings.push(`videoOffset clamped to the clip duration (${round(duration)}s)`);
    }
  }

  audio = round(audio);
  video = round(video);

  const audioStart = start !== null ? round(start + audio) : null;
  const videoStart = start !== null ? round(start + video) : null;

  let mode = "none";
  if (audio !== 0 && video !== 0) mode = "custom";
  else if (audio < 0) mode = "L";
  else if (audio > 0) mode = "J";
  else if (video !== 0) mode = "video-only";

  return {
    schema: "rooster.jl-cut/v1",
    audioOffset: audio,
    videoOffset: video,
    audioStart,
    videoStart,
    clipStart: start,
    clipEnd: end,
    duration: duration === null ? null : round(duration),
    mode,
    audioLeads: audio < 0,
    videoLeads: video < 0,
    clamped: {
      audio: audioClamped,
      video: videoClamped,
    },
    warnings,
  };
}
