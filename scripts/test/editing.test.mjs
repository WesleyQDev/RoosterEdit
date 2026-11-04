import { test } from "node:test";
import assert from "node:assert/strict";

import {
  brollContextWarnings,
  cutSmoothing,
  elementSupport,
  elementText,
  keepsFromPlan,
  layoutCollisionWarnings,
  motionMix,
  orphanCutWarnings,
  planQualityReport,
  remapTime,
  shortKeepWarnings,
  textGroundingWarnings,
  visualGaps,
} from "../features/editing.mjs";

const transcript = {
  segments: [
    { start: 0, end: 4, text: "E fala pessoal, hoje eu venho apresentar o app." },
    { start: 5, end: 9, text: "Ela promete ser local, sem login e gratuita." },
    { start: 20, end: 24, text: "Possui um editor de notas em markdown." },
    { start: 30, end: 34, text: "Quanto é 5 vezes 5?" },
    { start: 40, end: 44, text: "Bom, aqui como vocês podem ver ela reconheceu meio errado." },
    { start: 50, end: 54, text: "Outra coisa legal é que ela interage com os lembretes." },
    { start: 60, end: 64, text: "Eu fechei e abri o app e olha que legal." },
  ],
};

test("keepsFromPlan subtracts cuts and remaps source time", () => {
  const plan = {
    duration: 100,
    cuts: [
      { start: 10, end: 20 },
      { start: 40, end: 50 },
    ],
  };
  const keeps = keepsFromPlan(plan);
  assert.deepEqual(keeps, [
    { start: 0, end: 10 },
    { start: 20, end: 40 },
    { start: 50, end: 100 },
  ]);
  assert.equal(remapTime(5, keeps), 5);
  assert.equal(remapTime(25, keeps), 15);
  assert.equal(remapTime(60, keeps), 40);
});

test("visualGaps measures output time, not source time", () => {
  const plan = {
    duration: 100,
    cuts: [{ start: 10, end: 20 }],
    elements: [
      { id: "el-1", type: "grafico", start: 25, end: 30 },
      { id: "el-2", type: "broll", start: 50, end: 55 },
    ],
  };
  const result = visualGaps(plan, { maxGap: 30 });
  assert.equal(result.duration, 90);
  assert.deepEqual(
    result.allGaps.map((gap) => [gap.start, gap.end]),
    [
      [0, 15],
      [20, 40],
      [45, 90],
    ]
  );
  assert.deepEqual(
    result.gaps.map((gap) => [gap.start, gap.end]),
    [[45, 90]]
  );
});

test("elementSupport flags zoom for FilmCraft but not for HyperFrames", () => {
  const plan = {
    elements: [
      { id: "el-1", type: "zoom" },
      { id: "el-2", type: "grafico" },
    ],
  };
  const filmcraft = elementSupport(plan, "filmcraft");
  assert.equal(filmcraft.unsupported.length, 1);
  assert.equal(filmcraft.unsupported[0].id, "el-1");
  assert.equal(elementSupport(plan, "hyperframes").unsupported.length, 0);

  const typo = elementSupport({ elements: [{ id: "el-3", type: "grafico", template: "digram" }] }, "hyperframes");
  assert.equal(typo.unsupported.length, 1);
  assert.match(typo.unsupported[0].reason, /unknown template/);

  const remotion = elementSupport({ elements: [{ id: "el-4", type: "grafico", template: "diagram" }] }, "remotion");
  assert.equal(remotion.fallback.length, 1);
  assert.match(remotion.fallback[0].reason, /card\/text fallback/);

  const custom = elementSupport({ elements: [{ id: "el-5", type: "custom", template: "custom" }] }, "hyperframes");
  assert.equal(custom.unsupported.length, 0);
  const customRemotion = elementSupport({ elements: [{ id: "el-5", type: "custom", template: "custom" }] }, "remotion");
  assert.equal(customRemotion.unsupported.length, 1);
  assert.match(customRemotion.unsupported[0].reason, /cannot execute custom/);
});

test("elementText reads structured data when text is absent", () => {
  assert.equal(
    elementText({ type: "grafico", data: { nodes: ["fala", "intenção", "ação"] } }),
    "fala · intenção · ação"
  );
  assert.equal(
    elementText({ type: "grafico", data: { rows: [{ value: "140 s", label: "instalação" }] } }),
    "140 s instalação"
  );
  assert.equal(elementText({ type: "broll" }), "");
});

test("textGroundingWarnings accepts a shared word and rejects a random title", () => {
  const grounded = {
    elements: [
      { id: "el-1", type: "caption-emphasis", start: 20, end: 24, text: "editor de notas" },
    ],
  };
  const random = {
    elements: [
      { id: "el-2", type: "grafico", start: 20, end: 24, text: "o produto" },
    ],
  };
  assert.equal(textGroundingWarnings(grounded, transcript.segments).length, 0);
  assert.equal(textGroundingWarnings(random, transcript.segments).length, 1);
});

test("textGroundingWarnings trusts an explicit covers quote", () => {
  const plan = {
    elements: [
      {
        id: "el-1",
        type: "grafico",
        start: 20,
        end: 24,
        text: "markdown",
        covers: "editor de notas em markdown",
      },
    ],
  };
  assert.equal(textGroundingWarnings(plan, transcript.segments).length, 0);
});

test("chapter cards are exempt from transcript grounding", () => {
  const plan = {
    elements: [
      { id: "el-1", type: "letreiro", role: "chapter", start: 20, end: 24, text: "o produto" },
    ],
  };
  assert.equal(textGroundingWarnings(plan, transcript.segments).length, 0);
});

test("brollContextWarnings asks for covers, intent and sourceTime", () => {
  const without = {
    elements: [{ id: "el-1", type: "broll", start: 20, end: 24, src: "notes.mp4" }],
  };
  const complete = {
    elements: [
      {
        id: "el-1",
        type: "broll",
        start: 20,
        end: 24,
        src: "notes.mp4",
        covers: "editor de notas em markdown",
        intent: "evidence",
        sourceTime: 21,
      },
    ],
  };
  assert.equal(brollContextWarnings(without, transcript.segments).length, 1);
  assert.match(brollContextWarnings(without, transcript.segments)[0].message, /missing covers, intent, sourceTime/);
  assert.equal(brollContextWarnings(complete, transcript.segments).length, 0);
});

test("brollContextWarnings flags b-roll extracted from a later scene", () => {
  const plan = {
    elements: [
      {
        id: "el-1",
        type: "broll",
        start: 20,
        end: 24,
        src: "notes.mp4",
        covers: "editor de notas em markdown",
        intent: "texture",
        sourceTime: 80,
      },
    ],
  };
  const warnings = brollContextWarnings(plan, transcript.segments, { futureThreshold: 30 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /later/);
  assert.match(warnings[0].message, /custom motion graphic/);
});

test("orphanCutWarnings catches a reaction whose setup was removed", () => {
  const plan = {
    duration: 70,
    cuts: [
      { id: "cut-1", start: 30, end: 40, reason: "retake" },
      { id: "cut-2", start: 55, end: 60, reason: "retake" },
    ],
  };
  const warnings = orphanCutWarnings(plan, transcript.segments);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0].message, /reaction/);
  assert.match(warnings[1].message, /reaction/);
});

test("shortKeepWarnings flags a flash-length keep", () => {
  const plan = {
    duration: 10,
    cuts: [
      { start: 2, end: 4 },
      { start: 4.5, end: 6 },
    ],
  };
  const warnings = shortKeepWarnings(plan, { minKeep: 0.8 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /0\.5 s keep/);
});

test("cutSmoothing punches uncovered silence jumps and skips covered ones", () => {
  const plan = {
    duration: 100,
    cuts: [
      { id: "cut-1", start: 10, end: 20, reason: "silence" },
      { id: "cut-2", start: 45, end: 55, reason: "silence" },
    ],
    elements: [{ id: "el-1", type: "broll", start: 55, end: 63, src: "cover.mp4" }],
  };
  const result = cutSmoothing(plan, { punchScale: 1.04, fade: 0.03 });
  assert.equal(result.punchKeeps.length, 3);
  assert.equal(result.punchKeeps[0], false);
  assert.equal(result.punchKeeps[1], true);
  assert.equal(result.punchKeeps[2], false);
  assert.equal(result.uncovered.length, 1);
  assert.equal(result.uncovered[0].id, "cut-1");
});

test("layoutCollisionWarnings catches two cards in the same corner", () => {
  const plan = {
    elements: [
      { id: "el-1", type: "broll", start: 0, end: 3 },
      { id: "el-2", type: "grafico", template: "counter", start: 2, end: 4 },
      { id: "el-3", type: "caption-emphasis", start: 2, end: 4 },
    ],
  };
  const warnings = layoutCollisionWarnings(plan);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /top-right/);
});

test("motionMix summarizes beats and future b-roll per chapter", () => {
  const plan = {
    duration: 100,
    chapters: [
      { start: 0, title: "Intro" },
      { start: 50, title: "Demo" },
    ],
    elements: [
      { id: "el-1", type: "broll", start: 10, end: 14, sourceTime: 90, intent: "texture" },
      { id: "el-2", type: "grafico", template: "diagram", start: 20, end: 24 },
      { id: "el-3", type: "custom", template: "custom", start: 60, end: 64 },
      { id: "el-4", type: "broll", start: 70, end: 74, sourceTime: 72, intent: "evidence" },
    ],
  };
  const rows = motionMix(plan);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].broll, 1);
  assert.equal(rows[0].graphic, 1);
  assert.equal(rows[0].futureBroll, 1);
  assert.equal(rows[1].custom, 1);
  assert.equal(rows[1].futureBroll, 0);
});

test("planQualityReport aggregates density, support and grounding warnings", () => {
  const plan = {
    duration: 100,
    cuts: [{ id: "cut-1", start: 10, end: 20, reason: "silence" }],
    elements: [
      { id: "el-1", type: "grafico", start: 25, end: 30, text: "o produto" },
      { id: "el-2", type: "zoom", start: 40, end: 42 },
    ],
  };
  const report = planQualityReport(plan, transcript, { engine: "filmcraft", maxGap: 30 });
  assert.ok(report.warnings.some((warning) => warning.type === "density"));
  assert.ok(report.warnings.some((warning) => warning.type === "support"));
  assert.ok(report.warnings.some((warning) => warning.type === "text"));
});
