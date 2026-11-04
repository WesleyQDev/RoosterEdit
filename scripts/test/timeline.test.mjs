import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assignOverlayTracks,
  elementId,
  elementSpecs,
  summarizeTimeline,
  timelineFromPlan,
  timelineMarkers,
} from "../features/timeline.mjs";

// ---------------------------------------------------------------------------
// elementId
// ---------------------------------------------------------------------------

test("elementId keeps safe slugs and sanitizes accents", () => {
  assert.equal(elementId({ id: "intro-card" }, 0), "intro-card");
  assert.equal(elementId({ id: "Introdução à Ação" }, 0), "introducao-a-acao");
  assert.equal(elementId({ id: "my clip/01" }, 0), "my-clip-01");
});

test("elementId falls back to el-00N and suffixes duplicates", () => {
  assert.equal(elementId({}, 0), "el-001");
  assert.equal(elementId({ id: "   " }, 1), "el-002");

  const used = new Set();
  assert.equal(elementId({ id: "Ação" }, 0, used), "acao");
  assert.equal(elementId({ id: "acao" }, 1, used), "acao-2");
  assert.equal(elementId({ id: "AÇÃO" }, 2, used), "acao-3");

  const specs = elementSpecs({
    elements: [
      { id: "Ação", type: "letreiro", start: 0, end: 1 },
      { id: "acao", type: "letreiro", start: 2, end: 3 },
      { id: "AÇÃO", type: "letreiro", start: 4, end: 5 },
    ],
  });
  assert.deepEqual(
    specs.map((spec) => spec.id),
    ["acao", "acao-2", "acao-3"],
  );
});

// ---------------------------------------------------------------------------
// elementSpecs
// ---------------------------------------------------------------------------

test("elementSpecs sorts, clamps, and marks renderability", () => {
  const elements = [
    { id: "a", type: "letreiro", start: -2, end: 1.5 },
    { id: "b", type: "zoom", start: 2, end: 3 },
    { id: "c", type: "custom-card", start: 1, end: 1.02 },
    { id: "d", type: "grafico", start: 3, end: 2 },
  ];
  const plan = { elements };
  const snapshot = structuredClone(plan);

  const specs = elementSpecs(plan);

  assert.deepEqual(
    specs.map((spec) => spec.id),
    ["a", "c", "b", "d"],
  );
  assert.equal(specs[0].start, 0);
  assert.equal(specs[0].end, 1.5);
  assert.equal(specs[0].duration, 1.5);
  assert.equal(specs[1].duration, 0.1);
  assert.equal(specs[1].end, 1.1);
  assert.equal(specs[2].renderable, false);
  assert.equal(specs[2].reason, "applies to the base clip");
  assert.equal(specs[1].renderable, true);
  assert.equal(specs[1].reason, null);
  assert.equal(specs[3].duration, 0.1);
  assert.equal(specs[3].end, 3.1);

  for (const spec of specs) {
    assert.ok(spec.duration >= 0.1);
    assert.ok(spec.start >= 0);
    if (spec.renderable) {
      assert.ok(Number.isInteger(spec.trackIndex));
      assert.ok(spec.trackIndex >= 2);
    } else {
      assert.equal(spec.trackIndex, null);
    }
    assert.equal(spec.element, elements[spec.index]);
  }

  assert.deepEqual(plan, snapshot);
});

// ---------------------------------------------------------------------------
// assignOverlayTracks
// ---------------------------------------------------------------------------

test("assignOverlayTracks separates overlaps and reuses free tracks", () => {
  const specs = [
    { id: "a", start: 0, end: 4, index: 0 },
    { id: "b", start: 1, end: 3, index: 1 },
    { id: "c", start: 2, end: 5, index: 2 },
    { id: "d", start: 5, end: 6, index: 3 },
  ];

  const packed = assignOverlayTracks(specs);

  assert.deepEqual(
    packed.map((spec) => spec.id),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    packed.map((spec) => spec.trackIndex),
    [2, 3, 4, 2],
  );
  assert.notEqual(packed[0].trackIndex, packed[1].trackIndex);
  assert.notEqual(packed[1].trackIndex, packed[2].trackIndex);
  assert.notEqual(packed[0].trackIndex, packed[2].trackIndex);
  assert.equal(packed[3].trackIndex, packed[0].trackIndex);
  assert.equal("trackIndex" in specs[0], false);
});

test("assignOverlayTracks is stable for equal starts and prefers longer ends", () => {
  const equal = assignOverlayTracks([
    { id: "second", start: 1, end: 2, index: 1 },
    { id: "first", start: 1, end: 2, index: 0 },
  ]);
  assert.deepEqual(
    equal.map((spec) => spec.id),
    ["first", "second"],
  );
  assert.deepEqual(
    equal.map((spec) => spec.trackIndex),
    [2, 3],
  );

  const byEnd = assignOverlayTracks([
    { id: "short", start: 1, end: 2, index: 0 },
    { id: "long", start: 1, end: 5, index: 1 },
  ]);
  assert.deepEqual(
    byEnd.map((spec) => spec.id),
    ["long", "short"],
  );
  assert.deepEqual(
    byEnd.map((spec) => spec.trackIndex),
    [2, 3],
  );
});

// ---------------------------------------------------------------------------
// timelineFromPlan
// ---------------------------------------------------------------------------

test("timelineFromPlan compiles keeps, overlays, music, sfx, and markers", () => {
  const plan = {
    schema: "rooster.plan/v1",
    source: "assets/source/video.mp4",
    duration: 30,
    music: { src: "assets/licensed/music/theme.mp3", gainDb: -18 },
    sfx: [
      { id: "whoosh", src: "library/sfx/whoosh.wav", start: 1.5, end: 2.5 },
      { id: "missing-src", start: 3, end: 4 },
      { id: "zero-length", src: "library/sfx/zero.wav", start: 5, end: 5 },
    ],
    elements: [
      { id: "Intro", type: "letreiro", start: 0.5, end: 2.5, text: "Hello" },
      { id: "zoom", type: "zoom", start: 1, end: 2 },
      { id: "end card", type: "end-card", start: 5, end: 7, text: "Bye" },
    ],
    chapters: [
      { start: 0, title: "Intro" },
      { start: 5, title: "End" },
    ],
  };
  const options = {
    projectSlug: "demo",
    format: { width: 1280, height: 720, fps: 25, aspect: "16:9" },
    keeps: [
      { start: 10, end: 14 },
      { start: 20, end: 26 },
    ],
    engine: "hyperframes",
    captions: [
      { id: "cap-1", start: 0.5, end: 1.5, text: "Hi" },
      { id: "bad", start: 2, end: 2, text: "no" },
    ],
  };
  const planSnapshot = structuredClone(plan);
  const optionsSnapshot = structuredClone(options);

  const timeline = timelineFromPlan(plan, options);

  assert.equal(timeline.schema, "rooster.timeline/v1");
  assert.equal(timeline.project, "demo");
  assert.deepEqual(timeline.format, {
    width: 1280,
    height: 720,
    fps: 25,
    aspect: "16:9",
    duration: 10,
  });
  assert.deepEqual(timeline.scenes, []);

  const tracks = Object.fromEntries(timeline.tracks.map((track) => [track.id, track]));
  assert.deepEqual(Object.keys(tracks), ["v1", "ov1", "cap1", "a1", "m1", "s1"]);

  assert.deepEqual(tracks.v1.clips, [
    {
      id: "cut-001",
      src: "assets/source/video.mp4",
      in: 10,
      out: 14,
      start: 0,
      end: 4,
      transitionIn: "cut",
      transitionOut: "cut",
    },
    {
      id: "cut-002",
      src: "assets/source/video.mp4",
      in: 20,
      out: 26,
      start: 4,
      end: 10,
      transitionIn: "cut",
      transitionOut: "cut",
    },
  ]);

  assert.equal(tracks.ov1.clips.length, 2);
  assert.deepEqual(
    tracks.ov1.clips.map((clip) => clip.id),
    ["intro", "end-card"],
  );
  assert.equal(tracks.ov1.clips[0].scene, "letreiro");
  assert.equal(tracks.ov1.clips[0].track, "V2");
  assert.equal(tracks.ov1.clips[0].elementId, "intro");
  assert.equal(tracks.ov1.clips[0].engine, "hyperframes");
  assert.equal(tracks.ov1.clips[0].props, plan.elements[0]);
  assert.equal(tracks.ov1.clips[1].scene, "end-card");
  assert.equal(tracks.ov1.clips[1].track, "V2");

  assert.deepEqual(tracks.cap1.clips, [{ id: "cap-1", start: 0.5, end: 1.5, text: "Hi" }]);
  assert.deepEqual(tracks.a1.clips, []);
  assert.deepEqual(tracks.m1.clips, [
    {
      id: "music",
      src: "assets/licensed/music/theme.mp3",
      start: 0,
      end: 10,
      volume: 0.2,
    },
  ]);
  assert.deepEqual(tracks.s1.clips, [
    { id: "whoosh", src: "library/sfx/whoosh.wav", start: 1.5, end: 2.5 },
  ]);

  assert.deepEqual(
    timeline.markers.map((marker) => [marker.time, marker.label, marker.kind]),
    [
      [0, "Intro", "chapter"],
      [0.5, "Hello", "element"],
      [1, "zoom", "element"],
      [4, "cut 2", "cut"],
      [5, "Bye", "element"],
      [5, "End", "chapter"],
    ],
  );

  assert.deepEqual(JSON.parse(JSON.stringify(timeline)), timeline);
  assert.deepEqual(plan, planSnapshot);
  assert.deepEqual(options, optionsSnapshot);
});

test("timelineFromPlan handles a missing source and missing keeps", () => {
  const plan = {
    duration: 5,
    elements: [{ type: "letreiro", start: 0, end: 1, text: "Hi" }],
  };

  const timeline = timelineFromPlan(plan, { format: {}, projectSlug: "bare" });

  assert.equal(timeline.project, "bare");
  assert.deepEqual(timeline.format, {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
  });
  assert.equal(timeline.tracks.length, 6);

  const video = timeline.tracks.find((track) => track.id === "v1");
  assert.equal(video.clips.length, 1);
  assert.equal(Object.hasOwn(video.clips[0], "src"), false);
  assert.deepEqual(
    [video.clips[0].in, video.clips[0].out, video.clips[0].start, video.clips[0].end],
    [0, 5, 0, 5],
  );

  const overlay = timeline.tracks.find((track) => track.id === "ov1");
  assert.equal(overlay.clips.length, 1);
  assert.equal(overlay.clips[0].id, "el-001");
  assert.equal(overlay.clips[0].track, "V2");
  assert.equal(overlay.clips[0].engine, null);
  assert.equal(timeline.markers.length, 1);

  const empty = timelineFromPlan({}, {});
  assert.equal(empty.format.duration, 0);
  assert.deepEqual(empty.tracks[0].clips, []);
  assert.deepEqual(empty.markers, []);
  assert.equal(empty.tracks.length, 6);
});

test("timelineFromPlan falls back to plan.keeps", () => {
  const timeline = timelineFromPlan(
    { source: "s.mp4", keeps: [{ start: 2, end: 5 }], duration: 10 },
    {},
  );

  assert.equal(timeline.format.duration, 3);
  const clip = timeline.tracks[0].clips[0];
  assert.equal(clip.src, "s.mp4");
  assert.deepEqual([clip.in, clip.out, clip.start, clip.end], [2, 5, 0, 3]);
});

// ---------------------------------------------------------------------------
// timelineMarkers
// ---------------------------------------------------------------------------

test("timelineMarkers sorts chapters, elements, and cut boundaries", () => {
  const plan = {
    elements: [
      { type: "letreiro", start: 2, end: 3, text: "B" },
      { type: "grafico", start: 1, end: 2, text: "A" },
      { type: "zoom", start: 2, end: 3 },
      { type: "letreiro", start: 2, end: 3, text: "B" },
    ],
    chapters: [
      { start: 5, title: "Second" },
      { start: 0, title: "First" },
      { start: 5, title: "Second" },
    ],
  };

  const markers = timelineMarkers(plan, {
    keeps: [
      { start: 10, end: 12 },
      { start: 20, end: 25 },
      { start: 30, end: 31 },
    ],
  });

  assert.deepEqual(
    markers.map((marker) => [marker.time, marker.label, marker.kind]),
    [
      [0, "First", "chapter"],
      [1, "A", "element"],
      [2, "B", "element"],
      [2, "cut 2", "cut"],
      [2, "zoom", "element"],
      [5, "Second", "chapter"],
      [7, "cut 3", "cut"],
    ],
  );

  const keys = markers.map((marker) => `${marker.time}|${marker.label}`);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------------------
// summarizeTimeline
// ---------------------------------------------------------------------------

test("summarizeTimeline counts tracks, clips, overlays, and markers", () => {
  const timeline = {
    format: { duration: 10.12345 },
    tracks: [
      { id: "v1", kind: "video", clips: [{}, {}, {}] },
      { id: "ov1", kind: "overlay", clips: [{}, {}] },
      { id: "cap1", kind: "captions", clips: [{}] },
      { id: "a1", kind: "voice", clips: [] },
      { id: "m1", kind: "music", clips: [{}] },
      { id: "s1", kind: "sfx", clips: [{}] },
    ],
    markers: [{}, {}],
  };

  assert.deepEqual(summarizeTimeline(timeline), {
    duration: 10.123,
    tracks: 6,
    clips: 8,
    overlays: 2,
    markers: 2,
  });

  assert.deepEqual(summarizeTimeline(null), {
    duration: 0,
    tracks: 0,
    clips: 0,
    overlays: 0,
    markers: 0,
  });
});

test('elementSpecs clamps to the timeline duration', () => {
  const plan = {
    elements: [
      { id: 'inside', type: 'letreiro', start: 1, end: 9 },
      { id: 'outside', type: 'letreiro', start: 12, end: 14 },
    ],
  };
  const specs = elementSpecs(plan, { duration: 5 });
  const inside = specs.find((spec) => spec.id === 'inside');
  const outside = specs.find((spec) => spec.id === 'outside');
  assert.equal(inside.end, 5);
  assert.equal(inside.duration, 4);
  assert.equal(inside.renderable, true);
  assert.equal(outside.renderable, false);
  assert.equal(outside.reason, 'outside the timeline');
});

