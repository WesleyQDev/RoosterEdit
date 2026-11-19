import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_DEFAULTS,
  canvasCameraKeyframes,
  canvasCardTimes,
  canvasCss,
  canvasDepthGroups,
  canvasJitter,
  canvasStyleVars,
  canvasSummary,
  canvasTween,
  fitTextSize,
  normalizeCanvas,
  normalizeCanvasPreset,
  renderCanvasHtml,
} from "../features/canvas.mjs";

const preset = normalizeCanvasPreset({
  id: "archival-dark",
  accent: "#c8102e",
  backdrop: { kind: "grid", grain: 0.06 },
  piece: { frame: "print", rotateJitter: 1.6 },
  animation: { mode: "settle", enter: "settle" },
});

const element = {
  id: "cv-1",
  type: "canvas",
  template: "canvas",
  start: 10,
  end: 22,
  data: {
    slots: [
      { id: "left", at: [20, 20], size: [26, 32] },
      { id: "right", at: [58, 18], size: [26, 30] },
    ],
    cards: [
      { id: "photo", slot: "left", src: "assets/a.png", from: 0, to: 6 },
      { id: "doc", slot: "right", src: "assets/b.png", from: 1, to: 10, enter: "rise" },
      { id: "year", text: "1956", style: "year", at: [40, 70], size: [20, 14], from: 6, to: 12 },
    ],
    annotations: [{ target: "doc", kind: "ellipse", from: 3, to: 8, draw: 0.6 }],
    camera: [
      { at: 0, frame: ["left", "right"], zoom: 1, hold: 2 },
      { at: 6, focus: "doc", zoom: 1.3 },
      { at: 10, focus: "year", zoom: 1 },
    ],
  },
};

test("normalizeCanvasPreset merges defaults and clamps numbers", () => {
  assert.equal(preset.backdrop.kind, "grid");
  assert.equal(preset.piece.frame, "print");
  assert.equal(preset.type.yearSize, CANVAS_DEFAULTS.type.yearSize);
  const clamped = normalizeCanvasPreset({ piece: { radius: 9999 }, backdrop: { vignette: 4 } });
  assert.equal(clamped.piece.radius, 120);
  assert.equal(clamped.backdrop.vignette, 1);
  const fallback = normalizeCanvasPreset({ backdrop: { kind: "nope" }, piece: { frame: "nope" } });
  assert.equal(fallback.backdrop.kind, "solid");
  assert.equal(fallback.piece.frame, "none");
});

test("normalizeCanvas resolves slots, times and annotations", () => {
  const { canvas, errors, warnings } = normalizeCanvas(element, preset);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(canvas.duration, 12);
  assert.equal(canvas.cards.length, 3);
  const photo = canvas.cards.find((card) => card.id === "photo");
  assert.deepEqual([photo.x, photo.y, photo.w, photo.h], [20, 20, 26, 32]);
  assert.equal(photo.style, "photo");
  assert.equal(photo.enter, "settle");
  assert.equal(canvas.cards.find((card) => card.id === "year").style, "year");
  assert.equal(canvas.cards.find((card) => card.id === "doc").annotations[0].kind, "ellipse");
  assert.equal(canvas.camera.length, 3);
});

test("normalizeCanvas reports broken references instead of hiding them", () => {
  const { errors } = normalizeCanvas(
    {
      ...element,
      data: {
        ...element.data,
        cards: [{ id: "a", slot: "missing", src: "x.png", from: 0, to: 4 }],
        annotations: [{ target: "ghost", kind: "ellipse" }],
        camera: [{ at: 0, focus: "ghost", zoom: 1 }],
      },
    },
    preset
  );
  const joined = errors.join("\n");
  assert.match(joined, /unknown slot "missing"/);
  assert.match(joined, /targets unknown card "ghost"/);
  assert.match(joined, /focuses on unknown card "ghost"/);
});

test("normalizeCanvas requires content and ordered times", () => {
  const empty = normalizeCanvas({ ...element, data: { cards: [] } }, preset);
  assert.match(empty.errors.join("\n"), /"cards" is empty/);

  const inverted = normalizeCanvas(
    {
      ...element,
      data: { cards: [{ id: "a", text: "x", at: [10, 10], size: [20, 20], from: 8, to: 2 }] },
    },
    preset
  );
  assert.match(inverted.errors.join("\n"), /ends before it starts/);
});

test("camera keyframes centre the focused card", () => {
  const { canvas } = normalizeCanvas(element, preset);
  const frames = canvasCameraKeyframes(canvas);
  assert.equal(frames.length, 3);
  // The first frame covers the union of both slots: 20..84 x 18..52, so its
  // centre is 52/35 and the camera shifts by the difference.
  assert.equal(frames[0].xPercent, -2);
  assert.equal(frames[0].yPercent, 15);
  // The document sits at 58..84 x 18..48; its centre is 71/33 at 1.3x.
  assert.equal(frames[1].scale, 1.3);
  assert.equal(frames[1].xPercent, Number((((50 - 71) * 1.3).toFixed(3))));
  assert.equal(frames[1].yPercent, Number((((50 - 33) * 1.3).toFixed(3))));
  assert.equal(frames[1].rotate, 0);
});

test("camera keyframes carry a tilt and the tween writes it", () => {
  const tilted = {
    ...element,
    data: {
      ...element.data,
      camera: [
        { at: 0, focus: "photo", zoom: 1.2, rotate: -2.5 },
        { at: 5, focus: "doc", zoom: 1.35, rotate: 1.8 },
      ],
    },
  };
  const { canvas } = normalizeCanvas(tilted, preset);
  const frames = canvasCameraKeyframes(canvas);
  assert.equal(frames[0].rotate, -2.5);
  assert.equal(frames[1].rotate, 1.8);
  const tween = canvasTween(tilted, 3, canvas);
  assert.match(tween, /rotation: -2\.5/);
  assert.match(tween, /rotation: 1\.8/);
  const clamped = canvasCameraKeyframes(normalizeCanvas({ ...element, data: { ...element.data, camera: [{ at: 0, focus: "photo", rotate: 40 }] } }, preset).canvas);
  assert.equal(clamped[0].rotate, 12);
});

test("wave choreography orders cards by reading position", () => {
  const wave = normalizeCanvasPreset({
    animation: { mode: "wave", order: "reading", stagger: 0.5, enter: "rise" },
  });
  const cards = canvasCardTimes(normalizeCanvas(element, wave).canvas);
  const starts = cards.map((card) => card.enterAt);
  // reading order is top-to-bottom, then left-to-right: doc (y 18), photo (20), year (70)
  assert.deepEqual(starts, [0.5, 1, 7]);
  const explicitOff = canvasCardTimes(
    normalizeCanvas(
      { ...element, data: { cards: [{ ...element.data.cards[0], stagger: false }, element.data.cards[1]] } },
      wave
    ).canvas
  );
  assert.equal(explicitOff[0].enterAt, 0);
});

test("jitter is deterministic per card id", () => {
  assert.equal(canvasJitter("photo"), canvasJitter("photo"));
  assert.notEqual(canvasJitter("photo"), canvasJitter("doc"));
  assert.ok(Math.abs(canvasJitter("photo")) <= 1);
});

test("renderCanvasHtml emits cards, annotations and preset variables", () => {
  const { canvas } = normalizeCanvas(element, preset);
  const theme = { bg: "#000", fg: "#fff", muted: "#999", accent: "#0ff", display: "Inter", mono: "Mono" };
  const html = renderCanvasHtml((classes) => `id="el-0" class="clip fx fx-canvas ${classes}"`, element, canvas, theme);
  assert.match(html, /data-backdrop="grid"/);
  assert.match(html, /data-frame="print"/);
  assert.match(html, /--cv-accent:#c8102e/);
  assert.match(html, /data-card="photo"/);
  assert.match(html, /class="cv-depth"/);
  assert.match(html, /--cv-depth:/);
  assert.match(html, /class="cv-media" src="assets\/a.png"/);
  assert.match(html, /data-annot="doc"/);
  assert.match(html, /cv-stroke/);
  assert.match(html, />1956</);
  assert.doesNotMatch(html, /undefined/);
});

test("canvasTween writes camera stops and card entrances", () => {
  const { canvas } = normalizeCanvas(element, preset);
  const tween = canvasTween(element, 2, canvas);
  assert.match(tween, /#el-2 \.cv-camera/);
  assert.match(tween, /scale: 1\.3/);
  assert.match(tween, /\[data-card='photo'\]/);
  assert.match(tween, /autoAlpha: 0/);
  assert.match(tween, /strokeDashoffset: 0/);
  assert.match(tween, /\.cv-depth\[data-depth=/);
  assert.match(tween, /blur\(2\.5px\)/);
  assert.match(tween, /yoyo: true/);
  const total = (tween.match(/duration: 12\.000/g) || []).length;
  assert.ok(total >= 1, "the backdrop drift runs for the whole scene");
});

test("depth groups split cards by depth and clamp the value", () => {
  const withDepth = {
    ...element,
    data: {
      ...element.data,
      cards: [
        { id: "far", text: "far", at: [10, 10], size: [20, 20], depth: 0.2, from: 1, to: 5 },
        { id: "near", text: "near", at: [40, 10], size: [20, 20], depth: 0.95, from: 1, to: 5 },
        { id: "default", text: "default", at: [70, 10], size: [20, 20], from: 1, to: 5 },
        { id: "over", text: "over", at: [10, 60], size: [20, 20], depth: 9, from: 1, to: 5 },
      ],
    },
  };
  const { canvas } = normalizeCanvas(withDepth, preset);
  assert.equal(canvas.cards.find((card) => card.id === "default").depth, 0.7);
  assert.equal(canvas.cards.find((card) => card.id === "over").depth, 1);
  const groups = canvasDepthGroups(canvas.cards);
  assert.deepEqual(
    groups.map((group) => group.depth),
    [0.2, 0.7, 0.95, 1]
  );
  assert.deepEqual(
    groups.map((group) => group.cards.length),
    [1, 1, 1, 1]
  );
});

test("canvasCss and summary stay presentable", () => {
  assert.match(canvasCss(), /\.fx-canvas \.cv-camera/);
  assert.match(canvasCss(), /cv-annot-label/);
  const { canvas } = normalizeCanvas(element, preset);
  assert.equal(canvasSummary(canvas), '3 card(s), 3 camera stop(s), preset "archival-dark"');
});

test("fitTextSize shrinks copy that would spill out of its card", () => {
  assert.equal(fitTextSize("1956", { w: 30, h: 20 }, 190), 190);
  const claim = fitTextSize("DON'T PROGRAM IT", { w: 32, h: 20 }, 88);
  assert.ok(claim < 88, `expected a smaller size, got ${claim}`);
  assert.ok(claim >= 18);
  const tight = fitTextSize("DON'T PROGRAM IT", { w: 20, h: 8 }, 88);
  assert.ok(tight < claim, "a smaller box must shrink further");
  const giant = fitTextSize("SUPERCALIFRAGILISTIC", { w: 8, h: 8 }, 120);
  assert.ok(giant < 60, `expected a big shrink, got ${giant}`);
});

test("fonts accept a stack or a single family", () => {
  const vars = canvasStyleVars(normalizeCanvasPreset({ type: { display: "Inter", mono: "IBM Plex Mono, monospace" } }));
  assert.match(vars, /--cv-display:"Inter", sans-serif/);
  assert.match(vars, /--cv-mono:IBM Plex Mono, monospace/);
});

test("screen cards carry tilt, glow and window chrome", () => {
  const withScreen = {
    ...element,
    data: {
      ...element.data,
      cards: [
        { id: "ui", text: "UI", src: "shot.png", style: "screen", tilt: [6, -14], glow: 0.7, at: [10, 10], size: [40, 40], from: 1, to: 8 },
        { id: "chip", text: "T", style: "icon", at: [60, 10], size: [10, 10], from: 1, to: 8 },
      ],
    },
  };
  const { canvas } = normalizeCanvas(withScreen, preset);
  const ui = canvas.cards.find((card) => card.id === "ui");
  assert.deepEqual(ui.tilt, [6, -14]);
  assert.equal(ui.glow, 0.7);
  const html = renderCanvasHtml((classes) => `class="${classes}"`, withScreen, canvas, {});
  assert.match(html, /cv-screen/);
  assert.match(html, /--cv-tilt-x:6.00deg/);
  assert.match(html, /data-glow="true"/);
  assert.match(html, /cv-glyph/);
});

test("links use the card edges and animate their stroke", () => {
  const linked = {
    ...element,
    data: {
      ...element.data,
      links: [{ from: "photo", to: "doc", curve: 0.2, at: 2, draw: 0.5 }],
    },
  };
  const { canvas } = normalizeCanvas(linked, preset);
  assert.equal(canvas.links.length, 1);
  const link = canvas.links[0];
  // The document sits to the right, so the link leaves photo's right edge and
  // enters the document's left edge, never crossing either title.
  assert.equal(link.x1, 46);
  assert.equal(link.y1, 36);
  assert.equal(link.x2, 58);
  assert.equal(link.y2, 33);
  const html = renderCanvasHtml((classes) => `class="${classes}"`, linked, canvas, {});
  assert.match(html, /cv-link/);
  assert.match(html, /stroke-dashoffset="100"/);
  const tween = canvasTween(linked, 0, canvas);
  assert.match(tween, /data-link='photo->doc'/);
  assert.match(tween, /strokeDashoffset: 0/);
});
