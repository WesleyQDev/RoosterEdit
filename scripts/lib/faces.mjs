/**
 * Face-box helpers for `reframe --focus auto`.
 *
 * Pure: no process, no filesystem, no clock. Input is the JSON printed by
 * `hyperframes measure face`; output is a normalized focus point that the
 * existing FFmpeg crop builder can use.
 */

function numberOr(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize one face box to { x, y, w, h } in 0..1 shares.
 * HyperFrames documents boxes as shares of the frame. Values above 1.5 are
 * treated as pixels only when a frame size is supplied; without it the box is
 * rejected instead of guessing.
 *
 * @param {object} box
 * @param {{width?:number,height?:number}} [frame]
 * @returns {{x:number,y:number,w:number,h:number,time:number|null}|null}
 */
export function normalizeFaceBox(box, frame = {}) {
  if (!box || typeof box !== "object") return null;
  let x = numberOr(box.x ?? box.left);
  let y = numberOr(box.y ?? box.top);
  let w = numberOr(box.w ?? box.width);
  let h = numberOr(box.h ?? box.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

  const width = numberOr(frame.width);
  const height = numberOr(frame.height);
  if (Math.max(x, y, w, h) > 1.5) {
    if (!(width > 0 && height > 0)) return null;
    x /= width;
    y /= height;
    w /= width;
    h /= height;
  }

  return {
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
    time: Number.isFinite(numberOr(box.t)) ? numberOr(box.t) : null,
  };
}

/**
 * Parse the `measure face` payload.
 * @param {object|null} payload
 * @param {{width?:number,height?:number}} [frame]
 * @returns {{boxes:Array<object>,framesSampled:number,framesWithFace:number,faceHeight:number|null,verdict:string|null,note:string|null}}
 */
export function parseMeasureFace(payload, frame = {}) {
  const boxes = (Array.isArray(payload?.boxes) ? payload.boxes : [])
    .map((box) => normalizeFaceBox(box, frame))
    .filter(Boolean);
  return {
    boxes,
    framesSampled: Math.max(0, Math.round(numberOr(payload?.frames_sampled, 0))),
    framesWithFace: Math.max(0, Math.round(numberOr(payload?.frames_with_face, boxes.length))),
    faceHeight: Number.isFinite(numberOr(payload?.face_height)) ? numberOr(payload.face_height) : null,
    verdict: payload?.verdict ? String(payload.verdict) : null,
    note: payload?.note ? String(payload.note) : null,
  };
}

/**
 * Median focus point of the detected faces.
 *
 * The median is used instead of the mean so one bad detection (a face in the
 * background, a poster) does not drag the crop.
 *
 * @param {Array<object>} boxes
 * @param {{x:number,y:number}} [fallback]
 * @returns {{x:number,y:number,samples:number,source:"face"|"fallback"}}
 */
export function focusFromBoxes(boxes, fallback = { x: 0.5, y: 0.5 }) {
  const centers = (Array.isArray(boxes) ? boxes : [])
    .map((box) => ({
      x: clamp01(box.x + box.w / 2),
      y: clamp01(box.y + box.h / 2),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (!centers.length) {
    return { x: clamp01(numberOr(fallback.x, 0.5)), y: clamp01(numberOr(fallback.y, 0.5)), samples: 0, source: "fallback" };
  }

  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  return {
    x: median(centers.map((point) => point.x)),
    y: median(centers.map((point) => point.y)),
    samples: centers.length,
    source: "face",
  };
}

/**
 * Smooth a sequence of face centers into a focus path.
 *
 * Each entry is `{ t, x, y }` in output seconds. A 3-sample moving average
 * removes jitter without introducing a visible lag on a talking head.
 *
 * @param {Array<{t:number,x:number,y:number}>} points
 * @param {number} [window=3]
 * @returns {Array<{t:number,x:number,y:number}>}
 */
export function smoothFocusPath(points, window = 3) {
  const ordered = (Array.isArray(points) ? points : [])
    .filter(
      (point) =>
        Number.isFinite(Number(point?.t)) &&
        Number.isFinite(Number(point?.x)) &&
        Number.isFinite(Number(point?.y))
    )
    .map((point) => ({ t: Number(point.t), x: clamp01(Number(point.x)), y: clamp01(Number(point.y)) }))
    .sort((a, b) => a.t - b.t);
  if (!ordered.length) return [];

  const size = Math.max(1, Math.floor(window) || 1);
  const half = Math.floor(size / 2);
  return ordered.map((point, index) => {
    const slice = ordered.slice(Math.max(0, index - half), Math.min(ordered.length, index + half + 1));
    return {
      t: point.t,
      x: slice.reduce((sum, item) => sum + item.x, 0) / slice.length,
      y: slice.reduce((sum, item) => sum + item.y, 0) / slice.length,
    };
  });
}

/**
 * Whether a plan should be treated as having presenter cues for QA.
 * @param {object|null} plan
 * @returns {boolean}
 */
export function planExpectsFace(plan) {
  const elements = Array.isArray(plan?.elements) ? plan.elements : [];
  return elements.some((element) => {
    const type = String(element?.type || "").toLowerCase();
    const role = String(element?.role || "").toLowerCase();
    return (
      type === "lower-third" ||
      type === "zoom" ||
      role === "presenter" ||
      role === "speaker" ||
      Boolean(element?.speaker)
    );
  });
}
