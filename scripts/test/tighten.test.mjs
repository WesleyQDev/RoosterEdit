import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampCutsToWords,
  fillerCuts,
  normalizeProtect,
  overcutWarning,
  parseProtect,
  parseSilencedetect,
  retakeReport,
  snapCut,
  tightenCuts,
  tokenSimilarity,
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

test("retakeReport tolerates a mis-transcribed word in the repeat", () => {
  const transcript = {
    segments: [
      { start: 0, end: 4, text: "Hoje eu vou falar sobre o primeiro passo do projeto" },
      { start: 9, end: 13, text: "Hoje eu vou fala sobre o primeiro passo do projeto" },
    ],
  };
  const report = retakeReport(transcript);
  assert.equal(report.possibleRetakes.length, 1);
  const item = report.possibleRetakes[0];
  assert.equal(item.kind, "repeat");
  assert.ok(item.score >= 0.6);
  assert.deepEqual([item.cut.start, item.cut.end], [0, 4]);
  assert.deepEqual([item.keep.start, item.keep.end], [9, 13]);
});

test("retakeReport ignores unrelated takes", () => {
  const transcript = {
    segments: [
      { start: 0, end: 4, text: "Hoje eu vou falar sobre o primeiro passo do projeto" },
      { start: 9, end: 13, text: "A outra ideia era mostrar o resultado final na tela" },
    ],
  };
  assert.equal(retakeReport(transcript).possibleRetakes.length, 0);
});

test("tokenSimilarity scores shared words", () => {
  assert.equal(tokenSimilarity(["a", "b"], ["a", "b"]), 1);
  assert.equal(tokenSimilarity(["a", "b"], ["c", "d"]), 0);
  assert.ok(tokenSimilarity(["a", "b", "c", "d"], ["a", "b", "c", "x"]) > 0.7);
});

test("clampCutsToWords expands a cut that starts or ends inside a word", () => {
  const transcript = {
    words: [
      { start: 1, end: 1.4, word: "um" },
      { start: 1.5, end: 2.0, word: "dois" },
      { start: 2.1, end: 2.6, word: "três" },
    ],
  };
  const clamped = clampCutsToWords(
    [
      { start: 1.2, end: 1.8, reason: "filler" },
      { start: 2.3, end: 3.0, reason: "silence" },
      { start: 4.0, end: 4.5, reason: "silence" },
    ],
    transcript
  );
  assert.deepEqual([clamped[0].start, clamped[0].end], [1, 2]);
  assert.deepEqual([clamped[1].start, clamped[1].end], [2.1, 3.0]);
  assert.deepEqual([clamped[2].start, clamped[2].end], [4.0, 4.5]);

  const untouched = clampCutsToWords([{ start: 0.2, end: 0.4 }], { words: [] });
  assert.deepEqual([untouched[0].start, untouched[0].end], [0.2, 0.4]);
});

test("overcutWarning separates cleanup from a highlight edit", () => {
  assert.equal(overcutWarning(0.2, { usedAudio: true }), null);
  assert.equal(overcutWarning(0.4, { usedAudio: true }), null);
  assert.equal(overcutWarning(0.6, { usedAudio: true }), null);
  assert.match(overcutWarning(0.8, { usedAudio: true }), /highlight edit/);
  assert.match(overcutWarning(0.4, { usedAudio: false }), /transcript-gap fallback/);
  assert.match(overcutWarning(0.8, { usedAudio: true }), /--force/);
  assert.equal(overcutWarning(0, { usedAudio: true }), null);
});
