import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fillerCuts,
  normalizeProtect,
  parseProtect,
  parseSilencedetect,
  retakeReport,
  snapCut,
  tightenCuts,
  transcriptGaps,
} from "../features/tighten.mjs";

const words = (items) =>
  items.map(([start, end, text]) => ({ start, end, text, word: text }));

test("parseSilencedetect pairs start/end and closes a trailing gap", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 1.25",
    "[silencedetect @ 0x1] silence_end: 3.5 | silence_duration: 2.25",
    "[silencedetect @ 0x1] silence_start: 10",
    "[silencedetect @ 0x1] silence_end: 12.75 | silence_duration: 2.75",
    "[silencedetect @ 0x1] silence_start: 15",
  ].join("\n");
  assert.deepEqual(parseSilencedetect(stderr, { duration: 20 }), [
    { start: 1.25, end: 3.5 },
    { start: 10, end: 12.75 },
    { start: 15, end: 20 },
  ]);
});

test("snapCut keeps a beat after the line and a lead-in before the next", () => {
  const spans = words([
    [9.5, 9.9, "fim"],
    [14.1, 14.5, "próxima"],
  ]);
  assert.deepEqual(snapCut({ start: 10, end: 14 }, spans), { start: 10.3, end: 14 });
  assert.equal(snapCut({ start: 10, end: 10.6 }, spans), null);
});

test("snapCut removes all leading and trailing dead air", () => {
  const spans = words([[1.0, 1.5, "oi"]]);
  assert.deepEqual(snapCut({ start: 0, end: 1.0 }, spans), { start: 0, end: 0.9 });
  assert.deepEqual(snapCut({ start: 1.5, end: 4 }, spans), { start: 1.9, end: 4 });
});

test("tightenCuts removes a protected span and splits the cut", () => {
  const transcript = {
    words: words([
      [9.5, 9.9, "fim"],
      [14.1, 14.5, "próxima"],
    ]),
  };
  const cuts = tightenCuts({
    transcript,
    silences: [{ start: 10, end: 14 }],
    duration: 20,
    protect: [{ start: 12, end: 13, reason: "laugh" }],
  });
  assert.deepEqual(
    cuts.map((cut) => [cut.start, cut.end]),
    [
      [10.3, 12],
      [13, 14],
    ]
  );
  assert.equal(cuts[0].reason, "long-pause");
});

test("tightenCuts falls back to transcript gaps when audio is missing", () => {
  const transcript = {
    segments: [
      { start: 0, end: 4, text: "primeira" },
      { start: 6, end: 9, text: "segunda" },
    ],
  };
  const gaps = transcriptGaps(transcript, 12);
  assert.deepEqual(gaps, [
    { start: 4, end: 6 },
    { start: 9, end: 12 },
  ]);
  const cuts = tightenCuts({ transcript, silences: [], duration: 12 });
  assert.deepEqual(
    cuts.map((cut) => [cut.start, cut.end]),
    [
      [4.4, 5.9],
      [9.4, 12],
    ]
  );
});

test("fillerCuts removes a standalone filler but keeps mm hmm and glued words", () => {
  const transcript = {
    words: words([
      [0, 0.3, "eu"],
      [0.4, 0.6, "um"],
      [0.7, 1.1, "acho"],
      [2, 2.2, "mm"],
      [2.2, 2.5, "hmm"],
      [2.8, 3.0, "eu"],
      [3.0, 3.2, "um"],
      [3.2, 3.6, "tipo"],
    ]),
  };
  const cuts = fillerCuts(transcript);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].reason, "filler");
  assert.deepEqual([cuts[0].start, cuts[0].end], [0.38, 0.62]);
});

test("retakeReport cuts a short cue and lists repeated takes", () => {
  const transcript = {
    segments: [
      { start: 0, end: 4, text: "A gente começou em duas mil e vinte" },
      { start: 10, end: 14, text: "A gente começou em duas mil e vinte e um" },
      { start: 20, end: 22, text: "Deixa eu repetir isso." },
    ],
  };
  const report = retakeReport(transcript);
  assert.equal(report.cueCuts.length, 1);
  assert.deepEqual([report.cueCuts[0].start, report.cueCuts[0].end], [20, 22]);
  assert.equal(report.possibleRetakes.filter((item) => item.kind === "repeat").length, 1);
});

test("parseProtect accepts seconds and clock values", () => {
  assert.deepEqual(parseProtect("12.4-18,1:02-1:05"), [
    { start: 12.4, end: 18, reason: "cli" },
    { start: 62, end: 65, reason: "cli" },
  ]);
  assert.deepEqual(parseProtect("nope"), []);
});

test("normalizeProtect merges overlaps and keeps the first reason", () => {
  assert.deepEqual(
    normalizeProtect([
      { start: 10, end: 12, reason: "laugh" },
      { start: 11, end: 13 },
      { start: 1, end: 2 },
    ]),
    [
      { start: 1, end: 2 },
      { start: 10, end: 13, reason: "laugh" },
    ]
  );
});
