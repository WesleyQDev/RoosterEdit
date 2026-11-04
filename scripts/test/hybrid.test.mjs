/**
 * Unit tests for scripts/lib/hybrid.mjs.
 *
 * Pure helpers only: no FFmpeg and no engine is executed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { canRenderHybrid, compositeArgs, planOverlayWindows } from "../lib/hybrid.mjs";

function makePlan(overrides = {}) {
  return {
    schema: "rooster.plan/v1",
    source: "assets/source/video.mp4",
    duration: 60,
    cuts: [],
    elements: [{ id: "el-1", type: "letreiro", start: 5, end: 8 }],
    ...overrides,
  };
}

function ids(window) {
  return window.elements.map((element) => element.id);
}

test("canRenderHybrid accepts every localized overlay type", () => {
  const types = [
    "letreiro",
    "caption-emphasis",
    "lower-third",
    "broll",
    "grafico",
    "lista",
    "end-card",
  ];
  for (const type of types) {
    const plan = makePlan({ elements: [{ id: `el-${type}`, type, start: 5, end: 8 }] });
    assert.equal(canRenderHybrid(plan), true, type);
  }
});

test("canRenderHybrid rejects plans without a source video or overlays", () => {
  assert.equal(canRenderHybrid(null), false);
  assert.equal(canRenderHybrid({}), false);
  assert.equal(canRenderHybrid(makePlan({ source: "" })), false);
  assert.equal(canRenderHybrid(makePlan({ source: undefined })), false);
  assert.equal(canRenderHybrid(makePlan({ elements: [] })), false);
  assert.equal(canRenderHybrid(makePlan({ elements: undefined })), false);
});

test("canRenderHybrid rejects full-frame transitions and motion elements", () => {
  const transition = makePlan({
    elements: [{ id: "el-1", type: "transition", start: 5, end: 6 }],
  });
  assert.equal(canRenderHybrid(transition), false);

  const zoom = makePlan({ elements: [{ id: "el-1", type: "zoom", start: 5, end: 8 }] });
  assert.equal(canRenderHybrid(zoom), false);

  const transitionList = makePlan({ transitions: [{ type: "fade", start: 1, end: 2 }] });
  assert.equal(canRenderHybrid(transitionList), false);
});

test("canRenderHybrid rejects speed changes and speed ramps", () => {
  assert.equal(
    canRenderHybrid(makePlan({ cuts: [{ id: "cut-1", start: 10, end: 12, speed: 1.25 }] })),
    false
  );
  assert.equal(
    canRenderHybrid(
      makePlan({
        elements: [
          { id: "el-1", type: "letreiro", start: 5, end: 8, speedRamp: { from: 1, to: 2 } },
        ],
      })
    ),
    false
  );
  assert.equal(canRenderHybrid(makePlan({ speed: 2 })), false);
  assert.equal(
    canRenderHybrid(makePlan({ multicam: { speedRamps: [{ start: 1, end: 2 }] } })),
    false
  );
  assert.equal(
    canRenderHybrid(makePlan({ cuts: [{ id: "cut-1", start: 10, end: 12, speed: 1 }] })),
    true
  );
});

test("canRenderHybrid rejects invalid timing", () => {
  assert.equal(
    canRenderHybrid(makePlan({ elements: [{ id: "el-1", type: "letreiro", start: 8, end: 8 }] })),
    false
  );
  assert.equal(
    canRenderHybrid(makePlan({ elements: [{ id: "el-1", type: "letreiro", start: -1, end: 4 }] })),
    false
  );
  assert.equal(canRenderHybrid(makePlan({ elements: [null] })), false);
  assert.equal(
    canRenderHybrid(makePlan({ elements: [{ id: "el-1", type: "letreiro", start: 90, end: 95 }] })),
    false
  );
});

test("canRenderHybrid falls back when overlays cover too much of the video", () => {
  const longSingle = makePlan({
    duration: 20,
    elements: [{ id: "el-1", type: "grafico", start: 0, end: 12 }],
  });
  assert.equal(canRenderHybrid(longSingle), false);

  const halfSingle = makePlan({
    duration: 20,
    elements: [{ id: "el-1", type: "grafico", start: 0, end: 9 }],
  });
  assert.equal(canRenderHybrid(halfSingle), true);

  const total = makePlan({
    duration: 20,
    elements: [
      { id: "el-1", type: "letreiro", start: 0, end: 5 },
      { id: "el-2", type: "lower-third", start: 10, end: 15 },
      { id: "el-3", type: "end-card", start: 16, end: 19 },
    ],
  });
  assert.equal(canRenderHybrid(total), false);
});

test("canRenderHybrid derives duration from keeps when plan.duration is missing", () => {
  const plan = makePlan({
    duration: undefined,
    keeps: [{ id: "keep-1", start: 0, end: 60 }],
    elements: [{ id: "el-1", type: "letreiro", start: 5, end: 8 }],
  });
  assert.equal(canRenderHybrid(plan), true);
});

test("planOverlayWindows merges padded overlapping windows", () => {
  const plan = makePlan({
    elements: [
      { id: "a", type: "letreiro", start: 10, end: 11 },
      { id: "b", type: "lower-third", start: 11.4, end: 12.4 },
      { id: "c", type: "grafico", start: 30, end: 32 },
    ],
  });
  const windows = planOverlayWindows(plan, { padding: 0.5, maxWindow: 8 });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].start, 9.5);
  assert.equal(windows[0].end, 12.9);
  assert.deepEqual(ids(windows[0]), ["a", "b"]);
  assert.equal(windows[1].start, 29.5);
  assert.equal(windows[1].end, 32.5);
  assert.deepEqual(ids(windows[1]), ["c"]);
});

test("planOverlayWindows merges adjacent padded windows", () => {
  const plan = makePlan({
    elements: [
      { id: "a", type: "letreiro", start: 0, end: 1 },
      { id: "b", type: "lower-third", start: 2, end: 3 },
    ],
  });
  const windows = planOverlayWindows(plan, { padding: 0.5, maxWindow: 8 });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start, 0);
  assert.equal(windows[0].end, 3.5);
  assert.deepEqual(ids(windows[0]), ["a", "b"]);
});

test("planOverlayWindows keeps a gap without padding", () => {
  const plan = makePlan({
    elements: [
      { id: "a", type: "letreiro", start: 10, end: 11 },
      { id: "b", type: "lower-third", start: 11.4, end: 12.4 },
    ],
  });
  const windows = planOverlayWindows(plan, { padding: 0, maxWindow: 8 });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].start, 10);
  assert.equal(windows[0].end, 11);
  assert.equal(windows[1].start, 11.4);
  assert.equal(windows[1].end, 12.4);
});

test("planOverlayWindows clamps windows to the video duration", () => {
  const start = planOverlayWindows(
    makePlan({ elements: [{ id: "a", type: "letreiro", start: 0.1, end: 1 }] }),
    { padding: 0.5 }
  );
  assert.equal(start[0].start, 0);
  assert.equal(start[0].end, 1.5);

  const end = planOverlayWindows(
    makePlan({ elements: [{ id: "a", type: "end-card", start: 59, end: 60 }] }),
    { padding: 0.5 }
  );
  assert.equal(end[0].start, 58.5);
  assert.equal(end[0].end, 60);
});

test("planOverlayWindows splits merged windows at maxWindow", () => {
  const plan = makePlan({
    elements: [{ id: "a", type: "broll", start: 0, end: 20 }],
  });
  const windows = planOverlayWindows(plan, { padding: 0, maxWindow: 8 });
  assert.deepEqual(
    windows.map((window) => [window.start, window.end]),
    [
      [0, 8],
      [8, 16],
      [16, 20],
    ]
  );
  for (const window of windows) assert.deepEqual(ids(window), ["a"]);
});

test("planOverlayWindows keeps only elements that touch each split slice", () => {
  const plan = makePlan({
    elements: [
      { id: "a", type: "letreiro", start: 0, end: 5 },
      { id: "b", type: "grafico", start: 4, end: 9 },
    ],
  });
  const windows = planOverlayWindows(plan, { padding: 0, maxWindow: 8 });
  assert.deepEqual(
    windows.map((window) => [window.start, window.end]),
    [
      [0, 8],
      [8, 9],
    ]
  );
  assert.deepEqual(ids(windows[0]), ["a", "b"]);
  assert.deepEqual(ids(windows[1]), ["b"]);
});

test("planOverlayWindows applies defaults and filters non-overlay elements", () => {
  const plan = makePlan({
    elements: [
      { id: "zoom-1", type: "zoom", start: 1, end: 2 },
      { id: "title", type: "letreiro", start: 5, end: 8 },
      { id: "bad", type: "letreiro", start: 9, end: 9 },
    ],
  });
  const windows = planOverlayWindows(plan);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start, 4.5);
  assert.equal(windows[0].end, 8.5);
  assert.deepEqual(ids(windows[0]), ["title"]);
});

test("planOverlayWindows handles missing plans, empty elements and duration fallback", () => {
  assert.deepEqual(planOverlayWindows(null), []);
  assert.deepEqual(planOverlayWindows(makePlan({ elements: [] })), []);
  assert.deepEqual(planOverlayWindows(makePlan({ duration: 0, keeps: [], elements: [] })), []);

  const fallback = makePlan({
    duration: undefined,
    keeps: [{ id: "keep-1", start: 0, end: 10 }],
    elements: [{ id: "a", type: "letreiro", start: 5, end: 7 }],
  });
  const windows = planOverlayWindows(fallback, { padding: 0 });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start, 5);
  assert.equal(windows[0].end, 7);
});

test("compositeArgs builds a scaled overlay chain with audio copy", () => {
  const result = compositeArgs({
    base: "work/base.mp4",
    overlays: [{ path: "renders/ov1.mov", start: 2, end: 5 }],
    audio: null,
    out: "renders/draft.mp4",
    duration: 60,
    width: 1920,
    height: 1080,
  });

  assert.equal(result.command, "ffmpeg");
  assert.equal(result.out, "renders/draft.mp4");
  assert.equal(result.args.at(-1), "renders/draft.mp4");
  assert.deepEqual(result.args.slice(0, 5), [
    "-y",
    "-i",
    "work/base.mp4",
    "-i",
    "renders/ov1.mov",
  ]);

  const lines = result.filter.split(";");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "[0:v]scale=1920:1080:flags=lanczos,setsar=1[base0]");
  assert.equal(lines[1], "[1:v]scale=1920:1080:flags=lanczos,setpts=PTS-STARTPTS+2/TB[ov1]");
  assert.equal(
    lines[2],
    "[base0][ov1]overlay=0:0:eof_action=pass:enable='between(t,2,5)'[v1]"
  );

  assert.ok(result.args.includes("-filter_complex"));
  assert.ok(result.args.includes("[v1]"));
  assert.ok(result.args.includes("0:a?"));
  assert.ok(result.args.includes("libx264"));
  assert.ok(result.args.includes("copy"));
  assert.equal(result.args[result.args.indexOf("-t") + 1], "60");
});

test("compositeArgs maps an external audio mix to AAC", () => {
  const result = compositeArgs({
    base: "work/base.mp4",
    overlays: [
      { path: "renders/ov1.mov", start: 2, end: 5 },
      { path: "renders/ov2.mov", start: 8, end: 10 },
    ],
    audio: "work/mix.m4a",
    out: "renders/final.mp4",
    duration: 60,
  });

  assert.ok(result.args.includes("work/mix.m4a"));
  assert.ok(result.args.includes("[v2]"));
  assert.ok(result.args.includes("3:a:0"));
  assert.ok(result.args.includes("aac"));
  assert.ok(result.args.includes("192k"));
  assert.ok(result.args.includes("-filter_complex"));
  assert.equal(result.filter.split("overlay=").length - 1, 2);
  assert.match(result.filter, /\[v1\]\[ov2\]overlay=/);
});

test("compositeArgs supports explicit overlay positions", () => {
  const result = compositeArgs({
    base: "base.mp4",
    overlays: [{ path: "ov.mov", start: 2, end: 5, x: 100, y: "(H-h)/2" }],
    out: "out.mp4",
  });
  assert.match(
    result.filter,
    /\[base0\]\[ov1\]overlay=100:\(H-h\)\/2:eof_action=pass:enable='between\(t,2,5\)'\[v1\]/
  );
});

test("compositeArgs handles a base with no overlays", () => {
  const result = compositeArgs({
    base: "base.mp4",
    overlays: [],
    out: "out.mp4",
    duration: 30,
  });
  assert.equal(result.filter, "");
  assert.equal(result.args.includes("-filter_complex"), false);
  assert.ok(result.args.includes("0:v:0"));
  assert.ok(result.args.includes("0:a?"));
  assert.ok(result.args.includes("copy"));
  assert.equal(result.args[result.args.indexOf("-t") + 1], "30");
});

test("compositeArgs scales the base when there are no overlays", () => {
  const result = compositeArgs({
    base: "base.mp4",
    overlays: [],
    out: "out.mp4",
    width: 1080,
    height: 1920,
  });
  assert.equal(result.filter, "[0:v]scale=1080:1920:flags=lanczos,setsar=1[vout]");
  assert.ok(result.args.includes("[vout]"));
});

test("compositeArgs omits duration when not provided", () => {
  const result = compositeArgs({
    base: "base.mp4",
    overlays: [{ path: "ov.mov", start: 0, end: 1 }],
    out: "out.mp4",
  });
  assert.equal(result.args.includes("-t"), false);
});

test("compositeArgs passes paths with spaces as single arguments", () => {
  const overlayPath = "C:\\My Media\\overlay 1.mov";
  const result = compositeArgs({
    base: "C:\\My Media\\base video.mp4",
    overlays: [{ path: overlayPath, start: 1, end: 2 }],
    out: "C:\\My Media\\out video.mp4",
  });
  assert.ok(result.args.includes("C:\\My Media\\base video.mp4"));
  assert.ok(result.args.includes(overlayPath));
  assert.equal(result.args.at(-1), "C:\\My Media\\out video.mp4");
});

test("compositeArgs validates required fields and ranges", () => {
  assert.throws(() => compositeArgs({ out: "out.mp4" }), TypeError);
  assert.throws(() => compositeArgs({ base: "base.mp4" }), TypeError);
  assert.throws(() => compositeArgs({ base: "b.mp4", out: "o.mp4", overlays: "nope" }), TypeError);
  assert.throws(
    () => compositeArgs({ base: "b.mp4", out: "o.mp4", overlays: [null] }),
    TypeError
  );
  assert.throws(
    () => compositeArgs({ base: "b.mp4", out: "o.mp4", overlays: [{ start: 1, end: 2 }] }),
    TypeError
  );
  assert.throws(
    () =>
      compositeArgs({
        base: "b.mp4",
        out: "o.mp4",
        overlays: [{ path: "ov.mov", start: 2, end: 2 }],
      }),
    RangeError
  );
  assert.throws(
    () =>
      compositeArgs({
        base: "b.mp4",
        out: "o.mp4",
        overlays: [{ path: "ov.mov", start: -1, end: 2 }],
      }),
    RangeError
  );
  assert.throws(
    () => compositeArgs({ base: "b.mp4", out: "o.mp4", width: 1920 }),
    RangeError
  );
  assert.throws(
    () => compositeArgs({ base: "b.mp4", out: "o.mp4", width: 0, height: 1080 }),
    RangeError
  );
  assert.throws(() => compositeArgs({ base: "b.mp4", out: "o.mp4", crf: 60 }), RangeError);
  assert.throws(
    () =>
      compositeArgs({
        base: "b.mp4",
        out: "o.mp4",
        overlays: [{ path: "ov.mov", start: 1, end: 2, x: "0;rm" }],
      }),
    RangeError
  );
});
