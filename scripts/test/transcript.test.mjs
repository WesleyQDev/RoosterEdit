import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSCRIPT_SCHEMA,
  cleanTranscriptText,
  groupWordsIntoSegments,
  normalizeTranscript,
} from "../features/transcript.mjs";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

function word(text, start, end) {
  return { text, start, end };
}

test("groupWordsIntoSegments splits on gaps", () => {
  const words = [
    word("um", 0, 0.4),
    word("dois", 0.5, 0.9),
    word("tres", 2.0, 2.4),
    word("quatro", 2.5, 2.9),
  ];

  assert.deepEqual(groupWordsIntoSegments(words), [
    { id: 0, start: 0, end: 0.9, text: "um dois" },
    { id: 1, start: 2.0, end: 2.9, text: "tres quatro" },
  ]);
});

test("groupWordsIntoSegments respects maxWords", () => {
  const words = Array.from({ length: 5 }, (_, index) => word(`w${index}`, index, index + 0.5));
  assert.deepEqual(
    groupWordsIntoSegments(words, 2).map((segment) => segment.text),
    ["w0 w1", "w2 w3", "w4"]
  );
});

test("groupWordsIntoSegments flushes on sentence punctuation and fixes spacing", () => {
  const words = [
    word("Olá", 0, 0.3),
    word("mundo", 0.4, 0.7),
    word(".", 0.7, 0.75),
    word("Tudo", 0.9, 1.2),
    word("bem", 1.3, 1.6),
    word("!", 1.6, 1.65),
  ];

  assert.deepEqual(groupWordsIntoSegments(words), [
    { id: 0, start: 0, end: 0.75, text: "Olá mundo." },
    { id: 1, start: 0.9, end: 1.65, text: "Tudo bem!" },
  ]);
});

test("groupWordsIntoSegments handles empty and missing input", () => {
  assert.deepEqual(groupWordsIntoSegments([]), []);
  assert.deepEqual(groupWordsIntoSegments(null), []);
  assert.deepEqual(groupWordsIntoSegments(undefined), []);
});

test("cleanTranscriptText removes spaces before punctuation", () => {
  assert.equal(cleanTranscriptText("  Olá , mundo !  "), "Olá, mundo!");
  // Only spaces before punctuation are removed; inner whitespace is preserved.
  assert.equal(cleanTranscriptText("Olá,  mundo"), "Olá,  mundo");
  assert.equal(cleanTranscriptText("a ; b : c ? d"), "a; b: c? d");
  assert.equal(cleanTranscriptText(null), "");
});

test("normalizeTranscript keeps raw segments, text, language and word ids", () => {
  const raw = {
    text: "Olá , mundo !",
    language: "pt-BR",
    words: [
      { text: "Olá", start: 0, end: 0.5, id: "x" },
      word("mundo", 0.6, 1.0),
      word("!", 1.0, 1.1),
    ],
    segments: [
      { start: 0, end: 1.1, text: " Olá, mundo! " },
      { id: "custom", start: 1.2, end: 1.8, text: "Tudo bem." },
    ],
  };
  const before = JSON.stringify(raw);

  const transcript = normalizeTranscript(raw, "assets/source/a.mp4", "en", { createdAt: CREATED_AT });

  assert.equal(transcript.schema, TRANSCRIPT_SCHEMA);
  assert.equal(transcript.source, "assets/source/a.mp4");
  assert.equal(transcript.language, "pt-BR");
  assert.equal(transcript.text, "Olá, mundo!");
  assert.deepEqual(transcript.segments, [
    { id: 0, start: 0, end: 1.1, text: "Olá, mundo!" },
    { id: "custom", start: 1.2, end: 1.8, text: "Tudo bem." },
  ]);
  assert.deepEqual(transcript.words, [
    { id: "x", text: "Olá", start: 0, end: 0.5 },
    { id: "w1", text: "mundo", start: 0.6, end: 1.0 },
    { id: "w2", text: "!", start: 1.0, end: 1.1 },
  ]);
  assert.equal(transcript.createdAt, CREATED_AT);
  assert.equal(JSON.stringify(raw), before, "normalizeTranscript must not mutate its input");
});

test("normalizeTranscript builds segments from words and uses the requested language", () => {
  const raw = {
    text: "",
    words: [word("Hello", 0, 0.4), word("world", 0.5, 0.8), word(".", 0.8, 0.85)],
  };

  const transcript = normalizeTranscript(raw, "assets/source/b.mp4", "en", { createdAt: CREATED_AT });

  assert.equal(transcript.language, "en");
  assert.equal(transcript.text, "Hello world.");
  assert.deepEqual(transcript.segments, [
    { id: 0, start: 0, end: 0.85, text: "Hello world." },
  ]);
  assert.deepEqual(transcript.words.map((item) => item.id), ["w0", "w1", "w2"]);
});

test("normalizeTranscript accepts a raw word array", () => {
  const words = [word("Oi", 0, 0.4), word("tudo", 0.5, 0.8), word("bem", 0.9, 1.2)];
  const transcript = normalizeTranscript(words, "a.mp4", "pt-BR", { createdAt: CREATED_AT });

  assert.equal(transcript.source, "a.mp4");
  assert.equal(transcript.language, "pt-BR");
  assert.equal(transcript.text, "Oi tudo bem");
  assert.deepEqual(transcript.segments, [
    { id: 0, start: 0, end: 1.2, text: "Oi tudo bem" },
  ]);
  assert.deepEqual(
    transcript.words,
    words.map((item, index) => ({ id: `w${index}`, ...item }))
  );
});

test("normalizeTranscript maps segment ids and trims segment text", () => {
  const raw = {
    segments: [
      { start: 0, end: 1, text: " A " },
      { id: "second", start: 1.1, end: 2, text: " B " },
    ],
  };

  const transcript = normalizeTranscript(raw, "a.mp4", "en", { createdAt: CREATED_AT });

  assert.deepEqual(transcript.segments, [
    { id: 0, start: 0, end: 1, text: "A" },
    { id: "second", start: 1.1, end: 2, text: "B" },
  ]);
  assert.equal(transcript.text, "A B");
  assert.equal(transcript.words, undefined);
});

test("normalizeTranscript returns an empty document for empty input", () => {
  for (const raw of [null, undefined, {}]) {
    const transcript = normalizeTranscript(raw, "none", "pt", { createdAt: CREATED_AT });
    assert.equal(transcript.schema, TRANSCRIPT_SCHEMA);
    assert.equal(transcript.source, "none");
    assert.equal(transcript.language, "pt");
    assert.equal(transcript.text, "");
    assert.deepEqual(transcript.segments, []);
    assert.equal(transcript.words, undefined);
    assert.equal(transcript.createdAt, CREATED_AT);
  }
});

test("normalizeTranscript defaults createdAt to an ISO timestamp", () => {
  const transcript = normalizeTranscript({}, "none", "pt");
  assert.match(transcript.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
