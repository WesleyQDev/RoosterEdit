import test from "node:test";
import assert from "node:assert/strict";

import {
  TECHNIQUE_IDS,
  formatTechniques,
  needsFromPlan,
  recommendTechniques,
  resolveTechniques,
  techniquesReport,
} from "../features/techniques.mjs";

function fullCaps() {
  return {
    ffmpeg: "ffmpeg version 8.1",
    hyperframes: { bin: "C:\\tools\\hyperframes.mjs" },
    blender: { installed: true, version: "Blender 4.2.1" },
    earshot: { installed: true, version: "0.4.0" },
    filmcraft: { installed: true },
    tts: { edgeTts: true, openai: false },
    hardware: { detected: true, recommended: { h264: "h264_amf" } },
  };
}

test("the catalog has unique ids and a reference for each technique", () => {
  assert.equal(new Set(TECHNIQUE_IDS).size, TECHNIQUE_IDS.length);
  assert.ok(TECHNIQUE_IDS.includes("cut"));
  assert.ok(TECHNIQUE_IDS.includes("motion"));
  assert.ok(TECHNIQUE_IDS.includes("blender"));
  assert.ok(TECHNIQUE_IDS.includes("ears"));
  assert.ok(!TECHNIQUE_IDS.includes("remotion"));
});

test("resolveTechniques marks a complete machine as available", () => {
  const rows = resolveTechniques(fullCaps());
  assert.ok(rows.length >= 10);
  assert.ok(rows.every((row) => row.available));
  assert.ok(rows.every((row) => Array.isArray(row.missing) && row.missing.length === 0));
  assert.equal(rows[0].available, true);
});

test("resolveTechniques explains what is missing instead of hiding it", () => {
  const rows = resolveTechniques({
    ffmpeg: "ffmpeg version 8.1",
    hyperframes: { bin: "hf.mjs" },
    tts: {},
  });
  const blender = rows.find((row) => row.id === "blender");
  assert.equal(blender.available, false);
  assert.deepEqual(blender.missing, ["blender"]);
  assert.match(blender.install, /Blender/);

  const ears = rows.find((row) => row.id === "ears");
  assert.equal(ears.available, false);
  assert.deepEqual(ears.missing, ["earshot"]);

  const motion = rows.find((row) => row.id === "motion");
  assert.equal(motion.available, true);

  const tts = rows.find((row) => row.id === "tts");
  assert.equal(tts.available, false);
});

test("resolveTechniques filters by need and puts available rows first", () => {
  const caps = fullCaps();
  const rows = resolveTechniques(caps, { needs: ["3d"] });
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ["blender", "three"]
  );

  const audio = resolveTechniques(caps, { needs: ["audio"] });
  assert.ok(audio.some((row) => row.id === "audio-mix"));
  assert.ok(audio.some((row) => row.id === "ears"));

  const partial = resolveTechniques(
    { ffmpeg: "ffmpeg", hyperframes: { bin: "hf" } },
    { needs: ["3d"] }
  );
  assert.equal(partial[0].id, "three");
  assert.equal(partial[0].available, true);
  assert.equal(partial[1].id, "blender");
  assert.equal(partial[1].available, false);
});

test("recommendTechniques picks the best available tool per need", () => {
  const caps = fullCaps();
  const picks = recommendTechniques(caps, ["3d", "sound-design"]);
  assert.equal(picks[0].need, "3d");
  assert.ok(["blender", "three"].includes(picks[0].technique.id));
  assert.equal(picks[1].need, "sound-design");
  assert.equal(picks[1].technique.id, "ears");
  assert.ok(picks[0].alternatives.length >= 1);
});

test("needsFromPlan maps elements and project settings to needs", () => {
  const needs = needsFromPlan(
    {
      music: { src: "music.mp3" },
      color: { contrast: 1.1 },
      elements: [
        { type: "letreiro", template: "chapter" },
        { type: "canvas", template: "canvas" },
        { type: "scene", template: "block" },
        { type: "zoom" },
      ],
    },
    { captions: { enabled: true }, mode: { voice: "tts" }, timeline: "filmcraft" }
  );
  for (const need of ["cut", "delivery", "motion", "canvas", "3d", "captions", "audio", "voice", "timeline", "color"]) {
    assert.ok(needs.includes(need), `missing ${need}`);
  }
  assert.equal(needs.includes("multicam"), false);
});

test("needsFromPlan is conservative for a cut-only project", () => {
  const needs = needsFromPlan(
    { elements: [], notes: ["clean cut only"] },
    { captions: { enabled: false } }
  );
  assert.deepEqual(needs.sort(), ["cut", "delivery"]);
});

test("techniquesReport is stable JSON and formats as text", () => {
  const report = techniquesReport(fullCaps(), { needs: ["3d"] });
  assert.equal(report.schema, "rooster.techniques/v1");
  assert.deepEqual(report.needs, ["3d"]);
  assert.equal(JSON.parse(JSON.stringify(report)).schema, report.schema);
  const text = formatTechniques(report);
  assert.match(text, /^three|^blender/m);
  assert.match(text, /Recommendation/);
  assert.equal(text.includes("\u001b["), false);
});
