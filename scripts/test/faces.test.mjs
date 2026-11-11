import { test } from "node:test";
import assert from "node:assert/strict";

import {
  focusFromBoxes,
  normalizeFaceBox,
  parseMeasureFace,
  planExpectsFace,
  smoothFocusPath,
} from "../lib/faces.mjs";

test("normalizeFaceBox reads shares and clamps", () => {
  assert.deepEqual(normalizeFaceBox({ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }), {
    x: 0.4,
    y: 0.2,
    w: 0.2,
    h: 0.3,
    time: null,
  });
  const clamped = normalizeFaceBox({ x: -0.1, y: 1.2, w: 0.2, h: 0.2 });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 1);
});

test("normalizeFaceBox converts pixel boxes when the frame size is known", () => {
  const box = normalizeFaceBox({ x: 200, y: 100, width: 400, height: 300 }, { width: 1000, height: 500 });
  assert.deepEqual(
    { x: box.x, y: box.y, w: box.w, h: box.h },
    { x: 0.2, y: 0.2, w: 0.4, h: 0.6 }
  );
});

test("normalizeFaceBox rejects pixel boxes without a frame size", () => {
  assert.equal(normalizeFaceBox({ x: 200, y: 100, width: 40, height: 40 }), null);
});

test("parseMeasureFace keeps metadata and drops invalid boxes", () => {
  const parsed = parseMeasureFace({
    boxes: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, { x: "nope" }],
    frames_sampled: 8,
    frames_with_face: 1,
    face_height: 0.2,
    verdict: "pass",
  });
  assert.equal(parsed.boxes.length, 1);
  assert.equal(parsed.framesSampled, 8);
  assert.equal(parsed.framesWithFace, 1);
  assert.equal(parsed.faceHeight, 0.2);
});

test("focusFromBoxes uses the median center", () => {
  const focus = focusFromBoxes([
    { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    { x: 0.9, y: 0.9, w: 0.1, h: 0.1 },
  ]);
  assert.equal(focus.source, "face");
  assert.equal(focus.samples, 3);
  assert.equal(Number(focus.x.toFixed(3)), 0.6);
  assert.equal(Number(focus.y.toFixed(3)), 0.6);
});

test("focusFromBoxes falls back to center with no boxes", () => {
  const focus = focusFromBoxes([]);
  assert.deepEqual(focus, { x: 0.5, y: 0.5, samples: 0, source: "fallback" });
});

test("smoothFocusPath sorts and averages neighbors", () => {
  const path = smoothFocusPath([
    { t: 2, x: 0.8, y: 0.8 },
    { t: 0, x: 0.2, y: 0.2 },
    { t: 1, x: 0.4, y: 0.4 },
  ]);
  assert.deepEqual(path.map((point) => point.t), [0, 1, 2]);
  assert.equal(Number(path[1].x.toFixed(3)), 0.467);
});

test("planExpectsFace detects presenter cues", () => {
  assert.equal(planExpectsFace({ elements: [{ type: "zoom" }] }), true);
  assert.equal(planExpectsFace({ elements: [{ type: "letreiro" }] }), false);
  assert.equal(planExpectsFace({ elements: [{ type: "broll", role: "presenter" }] }), true);
});
