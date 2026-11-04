import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUILD_STATE_SCHEMA,
  buildStatePath,
  canonicalPlan,
  cutKey,
  elementKey,
  hashKey,
  htmlKey,
  musicKey,
  readBuildState,
  roundKeeps,
  voiceKey,
  writeBuildState,
} from "../lib/build-cache.mjs";

const FORMAT = { width: 1920, height: 1080, fps: 30, aspect: "16:9" };
const HEX = /^[0-9a-f]{64}$/;

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-build-cache-"));
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

test("canonicalPlan sorts keys and preserves array order", () => {
  const a = { beta: 2, alpha: { z: 1, a: [3, 2, 1] } };
  const b = { alpha: { a: [3, 2, 1], z: 1 }, beta: 2 };
  assert.equal(canonicalPlan(a), canonicalPlan(b));
  assert.equal(canonicalPlan(a), '{"alpha":{"a":[3,2,1],"z":1},"beta":2}');
  assert.equal(
    canonicalPlan({ list: [{ b: 1, a: 2 }, { d: 3, c: 4 }] }),
    '{"list":[{"a":2,"b":1},{"c":4,"d":3}]}'
  );
});

test("canonicalPlan rejects non-objects and circular plans", () => {
  assert.throws(() => canonicalPlan(null), /plan must be an object/);
  assert.throws(() => canonicalPlan([]), /plan must be an object/);
  const circular = { name: "x" };
  circular.self = circular;
  assert.throws(() => canonicalPlan(circular), /circular reference/);
  const circularArray = [];
  circularArray.push(circularArray);
  assert.throws(() => canonicalPlan({ list: circularArray }), /circular reference/);
});

test("hashKey is stable across key order and changes with values", () => {
  const a = hashKey(["stage", { b: 2, a: 1 }]);
  const b = hashKey(["stage", { a: 1, b: 2 }]);
  const c = hashKey(["stage", { a: 1, b: 3 }]);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, HEX);
  assert.equal(hashKey("text"), hashKey(["text"]));
});

test("roundKeeps snaps to frames, preserves metadata and widens empty keeps", () => {
  const [keep] = roundKeeps([{ id: "k1", start: 1.01, end: 2.02 }], 30);
  assert.equal(keep.id, "k1");
  assert.ok(Math.abs(keep.start - 1) < 1e-9);
  assert.ok(Math.abs(keep.end - 61 / 30) < 1e-9);

  const [tiny] = roundKeeps([{ start: 0.001, end: 0.002 }], 30);
  assert.equal(tiny.start, 0);
  assert.ok(Math.abs(tiny.end - 1 / 30) < 1e-9);

  assert.throws(() => roundKeeps([{ start: 2, end: 1 }], 30), /must end after/);
  assert.throws(() => roundKeeps([{ start: 0, end: 1 }], 0), /fps must be a positive/);
  assert.throws(() => roundKeeps([{ start: "x", end: 1 }], 30), /numeric start\/end/);
});

test("cutKey is stable and invalidates on cuts, encoder, format and loudnorm", () => {
  const base = {
    sourceKey: "source-hash",
    keeps: [{ start: 0, end: 10 }],
    format: FORMAT,
  };
  const first = cutKey(base);
  const second = cutKey({ ...base, format: { fps: 30, aspect: "16:9", height: 1080, width: 1920 } });
  assert.equal(first, second);
  assert.match(first, HEX);

  assert.notEqual(first, cutKey({ ...base, keeps: [{ start: 0, end: 9.5 }] }));
  assert.notEqual(first, cutKey({ ...base, encoder: "h264_nvenc" }));
  assert.notEqual(first, cutKey({ ...base, crf: 18 }));
  assert.notEqual(first, cutKey({ ...base, preset: "slow" }));
  assert.notEqual(first, cutKey({ ...base, format: { ...FORMAT, fps: 24 } }));
  assert.notEqual(first, cutKey({ ...base, loudnorm: false }));

  // Rounded keeps mean sub-frame edits do not invalidate the key.
  assert.equal(
    first,
    cutKey({ ...base, keeps: [{ start: 0.001, end: 10.001 }] })
  );
  assert.equal(first, cutKey({ ...base, encoder: null, crf: null, preset: null }));

  assert.throws(() => cutKey({ sourceKey: "", format: FORMAT }), /sourceKey is required/);
  assert.throws(() => cutKey({ sourceKey: "s", format: {} }), /format.fps/);
});

test("voiceKey passes through without usable voice and tracks files", () => {
  const baseCutKey = cutKey({
    sourceKey: "source",
    keeps: [{ start: 0, end: 10 }],
    format: FORMAT,
  });
  assert.equal(voiceKey({ cutKey: baseCutKey, voiceover: null }), baseCutKey);

  const manifest = {
    lines: [
      { id: "line-1", audio: "assets/voice/line-1.mp3", start: 1, duration: 2 },
      { id: "line-2", audio: "assets/voice/line-2.mp3", start: null, duration: null },
    ],
  };
  const withVoice = voiceKey({ cutKey: baseCutKey, voiceover: manifest });
  assert.match(withVoice, HEX);
  assert.notEqual(withVoice, baseCutKey);

  const sameVoice = voiceKey({ cutKey: baseCutKey, voiceover: manifest });
  assert.equal(withVoice, sameVoice);

  const withFile = voiceKey({
    cutKey: baseCutKey,
    voiceover: manifest,
    voiceFiles: [{ path: "line-1.mp3", size: 10, mtimeMs: 1 }],
  });
  assert.notEqual(withFile, withVoice);

  // Path/timing aliases normalize to the same mix input.
  assert.equal(
    voiceKey({
      cutKey: baseCutKey,
      voiceover: { lines: [{ audio: "a.mp3", start: 1, duration: 2, mediaStart: 0.5 }] },
    }),
    voiceKey({
      cutKey: baseCutKey,
      voiceover: [{ src: "a.mp3", start: 1, duration: 2, srcStart: 0.5 }],
    })
  );

  // Unmeasured lines are placeholders, not mix inputs.
  assert.equal(
    voiceKey({
      cutKey: baseCutKey,
      voiceover: { lines: [{ audio: "a.mp3", start: null, duration: null }] },
    }),
    baseCutKey
  );
  assert.throws(() => voiceKey({ cutKey: baseCutKey, voiceover: [null] }), /must be an object/);
});

test("musicKey passes through without music/SFX and tracks the mix inputs", () => {
  const baseVoiceKey = "voice-key";
  assert.equal(musicKey({ voiceKey: baseVoiceKey }), baseVoiceKey);
  assert.equal(musicKey({ voiceKey: baseVoiceKey, sfx: [] }), baseVoiceKey);

  const music = { src: "music.mp3", gainDb: -20, duckUnderVoice: true };
  const withMusic = musicKey({ voiceKey: baseVoiceKey, music });
  assert.match(withMusic, HEX);
  assert.notEqual(withMusic, baseVoiceKey);
  assert.equal(withMusic, musicKey({ voiceKey: baseVoiceKey, music: { ...music } }));

  const withSfx = musicKey({
    voiceKey: baseVoiceKey,
    sfx: [{ src: "pop.wav", start: 2, end: 2.5 }],
  });
  assert.notEqual(withSfx, baseVoiceKey);
  assert.notEqual(withSfx, withMusic);
  assert.throws(() => musicKey({ voiceKey: baseVoiceKey, sfx: "pop.wav" }), /sfx must be an array/);
});

test("htmlKey is stable and tracks theme, engine and plan changes", () => {
  const plan = { duration: 10, elements: [{ type: "letreiro", start: 0, end: 2 }] };
  const base = {
    plan,
    theme: { accent: "#fff" },
    version: "0.1.0",
    engine: "hyperframes",
    engineVersion: "1.2.3",
  };
  const first = htmlKey(base);
  const second = htmlKey({ ...base, plan: { elements: [{ end: 2, start: 0, type: "letreiro" }], duration: 10 } });
  assert.equal(first, second);
  assert.match(first, HEX);

  assert.notEqual(first, htmlKey({ ...base, theme: { accent: "#000" } }));
  assert.notEqual(first, htmlKey({ ...base, engine: "remotion" }));
  assert.notEqual(first, htmlKey({ ...base, engineVersion: "1.2.4" }));
  assert.notEqual(first, htmlKey({ ...base, version: "0.2.0" }));
  assert.notEqual(first, htmlKey({ ...base, plan: { ...plan, duration: 11 } }));
  assert.throws(() => htmlKey({ plan: null }), /plan is required/);
});

test("build state round-trips atomically and rejects invalid files", () => {
  const project = tempProject();
  try {
    assert.equal(readBuildState(project.root), null);
    assert.equal(buildStatePath(project.root), path.join(project.root, "work", "build-state.json"));

    const state = {
      stages: { cut: "abc", voice: "def" },
      updatedAt: "2026-11-03T00:00:00.000Z",
    };
    const file = writeBuildState(project.root, state);
    assert.equal(file, buildStatePath(project.root));

    const read = readBuildState(project.root);
    assert.equal(read.schema, BUILD_STATE_SCHEMA);
    assert.deepEqual(read.stages, state.stages);
    assert.equal(read.updatedAt, state.updatedAt);

    const leftovers = fs
      .readdirSync(path.dirname(file))
      .filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, []);

    fs.writeFileSync(file, "{ not json", "utf8");
    assert.equal(readBuildState(project.root), null);

    fs.writeFileSync(file, JSON.stringify({ schema: "other/v1", stages: {} }), "utf8");
    assert.equal(readBuildState(project.root), null);

    assert.throws(() => writeBuildState(project.root, []), /state must be an object/);
    assert.throws(() => readBuildState(""), /projectDir is required/);
  } finally {
    project.cleanup();
  }
});

test('elementKey tracks element content and render context', () => {
  const base = {
    element: { type: 'letreiro', text: 'A' },
    theme: { accent: '#f00' },
    format: { width: 1920, height: 1080, fps: 30 },
    engine: 'hyperframes',
    engineVersion: '0.9.9',
    render: { format: 'mov', alpha: true },
  };
  const key = elementKey(base);
  assert.match(key, HEX);
  assert.equal(key, elementKey({ ...base, theme: { accent: '#f00' } }));
  assert.notEqual(key, elementKey({ ...base, element: { type: 'letreiro', text: 'B' } }));
  assert.notEqual(key, elementKey({ ...base, engine: 'remotion' }));
  assert.notEqual(key, elementKey({ ...base, render: { format: 'mov', alpha: false } }));
  assert.throws(() => elementKey({}), /element is required/);
});

