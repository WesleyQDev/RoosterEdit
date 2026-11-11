import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QA_SCHEMA,
  buildQaReport,
  checkFindings,
  eventsFindings,
  faceFindings,
  formatQaMarkdown,
  loudnessFindings,
  probeFindings,
  qaExitCode,
  qaKey,
  silenceFindings,
} from "../lib/qa.mjs";

const plan = {
  schema: "rooster.plan/v1",
  duration: 40,
  music: { src: "assets/music.mp3" },
  elements: [{ id: "el-1", type: "letreiro", start: 0, end: 4 }],
};

const probe = { width: 1920, height: 1080, fps: 30, duration: 40, audio: true };

function report(overrides = {}) {
  return buildQaReport({
    project: { slug: "demo" },
    plan,
    video: "renders/draft.mp4",
    probe,
    ...overrides,
  });
}

test("loudnessFindings accepts a mix inside the target", () => {
  const findings = loudnessFindings({ lufsIntegrated: -14.2, truePeakDb: -1.4, clipping: { count: 0 } });
  assert.deepEqual(findings, []);
});

test("loudnessFindings warns near the target and fails far from it", () => {
  const warning = loudnessFindings({ lufsIntegrated: -15.6, truePeakDb: -2, clipping: { count: 0 } });
  assert.equal(warning[0].severity, "warning");
  assert.match(warning[0].message, /-15\.6 LUFS/);

  const error = loudnessFindings({ lufsIntegrated: -20, truePeakDb: -2, clipping: { count: 0 } });
  assert.equal(error[0].severity, "error");
});

test("loudnessFindings flags true peak and clipping", () => {
  const findings = loudnessFindings({
    lufsIntegrated: -14,
    truePeakDb: 0.4,
    clipping: { count: 3, firstAt: 12.5 },
  });
  assert.ok(findings.some((finding) => finding.code === "audio.truePeak" && finding.severity === "error"));
  assert.ok(findings.some((finding) => finding.code === "audio.clipping"));
});

test("silenceFindings ignores edges and flags long middle silence", () => {
  const findings = silenceFindings(
    [
      { start: 0, end: 0.2 },
      { start: 10, end: 13.5 },
      { start: 39.9, end: 40 },
    ],
    40
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /3\.5 s/);
});

test("probeFindings fails when a planned audio track is missing", () => {
  const findings = probeFindings({ ...probe, audio: false }, plan);
  assert.ok(findings.some((finding) => finding.code === "render.audio" && finding.severity === "error"));
});

test("faceFindings warns when presenter cues have no face", () => {
  const findings = faceFindings({ framesSampled: 8, framesWithFace: 0 }, { expectFace: true });
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].code, "face.missing");
});

test("checkFindings flattens the HyperFrames sections", () => {
  const findings = checkFindings({
    lint: { findings: [{ severity: "error", code: "LINT1", message: "missing asset" }] },
    layout: { findings: [{ severity: "warning", code: "LAY1", message: "overflow" }] },
  });
  assert.deepEqual(
    findings.map((finding) => [finding.severity, finding.code]),
    [
      ["error", "check.lint.LINT1"],
      ["warning", "check.layout.LAY1"],
    ]
  );
});

test("eventsFindings reports static videos as info", () => {
  const findings = eventsFindings({ counts: { cut: 0 } });
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].code, "events.static");
});

test("buildQaReport aggregates status and metrics", () => {
  const result = report({
    audio: { items: [{ loudness: { lufsIntegrated: -18, truePeakDb: -2, clipping: { count: 0 } }, silence: [] }] },
    events: { counts: { cut: 6 } },
    faces: { framesSampled: 8, framesWithFace: 4, face_height: 0.2 },
  });
  assert.equal(result.schema, QA_SCHEMA);
  assert.equal(result.status, "fail");
  assert.equal(result.counts.error, 1);
  assert.equal(result.metrics.cuts, 6);
  assert.equal(result.metrics.faces, 4);
});

test("buildQaReport passes a clean run", () => {
  const result = report({
    audio: { items: [{ loudness: { lufsIntegrated: -14.1, truePeakDb: -1.5, clipping: { count: 0 } }, silence: [] }] },
    events: { counts: { cut: 4 } },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.counts.error, 0);
  assert.equal(qaExitCode(result), 0);
  assert.equal(qaExitCode(result, true), 0);
});

test("formatQaMarkdown is compact and names the verdict", () => {
  const result = report({
    audio: { items: [{ loudness: { lufsIntegrated: -16.4, truePeakDb: -1.2, clipping: { count: 0 } }, silence: [] }] },
    warnings: ["plan: source not found"],
  });
  const markdown = formatQaMarkdown(result);
  assert.match(markdown, /# QA — demo/);
  assert.match(markdown, /WARN/);
  assert.ok(markdown.split("\n").length < 40);
});

test("qaKey is stable and option-sensitive", () => {
  const first = qaKey({ video: "a", plan: 1 });
  assert.equal(first, qaKey({ plan: 1, video: "a" }));
  assert.notEqual(first, qaKey({ video: "a", plan: 2 }));
});
