import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ASR_BACKENDS,
  PARAKEET_LANGUAGES,
  fasterWhisperArgs,
  hyperFramesTranscribeArgs,
  languageCoveredByParakeet,
  normalizeLanguage,
  pickAsrBackend,
  shouldUseWords,
  transcriptKey,
  transcriptMeta,
} from "../lib/asr.mjs";

const HEX32 = /^[0-9a-f]{32}$/;

test("Parakeet language coverage and normalization", () => {
  assert.equal(PARAKEET_LANGUAGES.size, 25);
  for (const code of ["en", "es", "fr", "de", "pt", "ru", "uk"]) {
    assert.ok(PARAKEET_LANGUAGES.has(code), `${code} should be covered`);
  }
  assert.equal(PARAKEET_LANGUAGES.has("ja"), false);
  assert.equal(PARAKEET_LANGUAGES.has("zh"), false);

  assert.equal(normalizeLanguage("pt-BR"), "pt");
  assert.equal(normalizeLanguage(" PT "), "pt");
  assert.equal(normalizeLanguage("en_US"), "en");
  assert.equal(normalizeLanguage(""), "");
  assert.equal(normalizeLanguage(null), "");

  assert.equal(languageCoveredByParakeet("pt-BR"), true);
  assert.equal(languageCoveredByParakeet("JA"), false);
  assert.equal(languageCoveredByParakeet(""), false);
});

test("explicit backend wins over capabilities", () => {
  const all = {
    parakeet: { installed: true },
    fasterWhisper: true,
    hyperframes: { bin: "hyperframes" },
    whisper: "whisper",
  };

  assert.deepEqual(
    pickAsrBackend({ requested: "faster-whisper", language: "pt", capabilities: all }),
    { backend: "faster-whisper", reason: "requested faster-whisper" }
  );
  assert.equal(pickAsrBackend({ requested: "whisper.cpp", language: "pt", capabilities: all }).backend, "whisper");
  assert.equal(pickAsrBackend({ requested: "openai-whisper", language: "pt", capabilities: all }).backend, "openai-whisper");
  assert.equal(pickAsrBackend({ requested: "hyperframes", language: "pt", capabilities: all }).backend, "hyperframes");

  const parakeet = pickAsrBackend({ requested: "parakeet", language: "ja", capabilities: all });
  assert.equal(parakeet.backend, "parakeet");
  assert.match(parakeet.reason, /requested parakeet/);
});

test("auto prefers Parakeet only when installed and language is covered", () => {
  const caps = {
    parakeet: { installed: true },
    fasterWhisper: true,
    hyperframes: { bin: "hyperframes" },
    whisper: "whisper",
  };

  assert.equal(pickAsrBackend({ language: "pt-BR", capabilities: caps }).backend, "parakeet");
  assert.equal(pickAsrBackend({ language: "ja", capabilities: caps }).backend, "faster-whisper");
  assert.equal(
    pickAsrBackend({ language: "pt", capabilities: { ...caps, parakeet: { installed: false } } }).backend,
    "faster-whisper"
  );
});

test("auto falls back in the documented order", () => {
  assert.equal(
    pickAsrBackend({ language: "ja", capabilities: { hyperframes: { bin: "hf" } } }).backend,
    "hyperframes"
  );
  assert.equal(
    pickAsrBackend({ language: "ja", capabilities: { whisper: "whisper" } }).backend,
    "whisper"
  );
  assert.equal(
    pickAsrBackend({ language: "ja", capabilities: { whisper: "faster-whisper (python)" } }).backend,
    "faster-whisper"
  );
  assert.equal(pickAsrBackend({ language: "ja", capabilities: {} }).backend, "openai-whisper");

  const fallback = pickAsrBackend({ language: "pt", capabilities: {} });
  assert.equal(fallback.backend, "openai-whisper");
  assert.match(fallback.reason, /fallback/);
});

test("auto accepts loose capability shapes", () => {
  assert.equal(pickAsrBackend({ language: "pt", capabilities: { parakeet: true } }).backend, "parakeet");
  assert.equal(pickAsrBackend({ language: "pt", capabilities: { parakeet: { available: true } } }).backend, "parakeet");
  assert.equal(
    pickAsrBackend({ language: "pt", capabilities: { parakeet: { installed: false, model: "x" } } }).backend,
    "openai-whisper"
  );
  assert.equal(pickAsrBackend({ language: "pt", capabilities: { hyperframesCli: "0.9.9" } }).backend, "hyperframes");
});

test("unknown requested backend falls back to auto with a reason", () => {
  const picked = pickAsrBackend({ requested: "telepathy", language: "pt", capabilities: { fasterWhisper: true } });
  assert.equal(picked.backend, "faster-whisper");
  assert.match(picked.reason, /unrecognized requested backend/);
});

test("ASR_BACKENDS lists every canonical backend", () => {
  assert.deepEqual([...ASR_BACKENDS], [
    "parakeet",
    "hyperframes",
    "faster-whisper",
    "whisper",
    "openai-whisper",
  ]);
});

test("HyperFrames transcribe args match the CLI contract", () => {
  const args = hyperFramesTranscribeArgs({
    input: "assets/source/a.mp4",
    dir: "work/transcribe",
    engine: "parakeet",
    language: "pt-BR",
    model: "small",
    words: true,
    toSrt: "work/transcribe/a.srt",
  });

  assert.deepEqual(args, [
    "transcribe",
    "assets/source/a.mp4",
    "--dir",
    "work/transcribe",
    "--engine",
    "parakeet",
    "--language",
    "pt",
    "--model",
    "small",
    "--json",
    "--to",
    "srt",
    "-o",
    "work/transcribe/a.srt",
  ]);
  assert.equal(args.includes("--words"), false);
});

test("HyperFrames transcribe args omit optional flags", () => {
  const args = hyperFramesTranscribeArgs({ input: "a.mp4", language: "en", words: false });
  assert.deepEqual(args, ["transcribe", "a.mp4", "--engine", "auto", "--language", "en", "--json"]);

  const booleanExport = hyperFramesTranscribeArgs({ input: "a.mp4", language: "pt", toSrt: true });
  assert.deepEqual(booleanExport.slice(-2), ["--to", "srt"]);

  assert.throws(() => hyperFramesTranscribeArgs({ language: "pt" }), /requires input/);
});

test("faster-whisper args use fast defaults and make them explicit", () => {
  const args = fasterWhisperArgs({
    script: "scripts/transcribe_faster.py",
    input: "a.mp4",
    output: "edit/transcript.json",
    language: "pt-BR",
  });

  assert.deepEqual(args, [
    "scripts/transcribe_faster.py",
    "--input",
    "a.mp4",
    "--output",
    "edit/transcript.json",
    "--language",
    "pt",
    "--model",
    "base",
    "--beam-size",
    "1",
    "--no-words",
  ]);

  assert.throws(
    () => fasterWhisperArgs({ input: "a.mp4", output: "out.json" }),
    /requires script/
  );
  assert.throws(
    () => fasterWhisperArgs({ script: "s.py", output: "out.json" }),
    /requires input/
  );
});

test("faster-whisper args include only options that change the script defaults", () => {
  const args = fasterWhisperArgs({
    script: "s.py",
    input: "in.mp4",
    output: "out.json",
    language: "en",
    model: "small",
    beam: 3,
    words: true,
    device: "cpu",
    computeType: "int8",
    vad: false,
    vadMinSilenceMs: 250,
    maxAudioMinutes: 10,
    verbose: true,
  });

  assert.deepEqual(args, [
    "s.py",
    "--input", "in.mp4",
    "--output", "out.json",
    "--language", "en",
    "--model", "small",
    "--beam-size", "3",
    "--words",
    "--device", "cpu",
    "--compute-type", "int8",
    "--no-vad",
    "--vad-min-silence-ms", "250",
    "--max-audio-minutes", "10",
    "--verbose",
  ]);

  // The Python script already defaults to beam 5 and words on.
  const slowDefaults = fasterWhisperArgs({
    script: "s.py",
    input: "a",
    output: "b",
    language: "pt",
    beam: 5,
    words: true,
  });
  assert.equal(slowDefaults.includes("--beam-size"), false);
  assert.ok(slowDefaults.includes("--words"));

  assert.throws(
    () => fasterWhisperArgs({ script: "s.py", input: "a", output: "b", beam: "wide" }),
    /beam must be a number/
  );
});

test("transcriptKey is stable and invalidates on every output-affecting option", () => {
  const base = {
    sourceHash: "abc123",
    backend: "faster-whisper",
    model: "base",
    language: "pt-BR",
    beam: 1,
    vad: true,
    words: false,
    backendVersion: "1.2.1",
  };

  const key = transcriptKey(base);
  assert.match(key, HEX32);
  assert.equal(
    key,
    transcriptKey({
      backendVersion: "1.2.1",
      words: false,
      vad: true,
      beam: 1,
      language: "pt",
      model: "base",
      backend: "faster_whisper",
      sourceHash: "abc123",
    })
  );

  const variants = [
    { sourceHash: "other" },
    { backend: "parakeet" },
    { model: "small" },
    { language: "en" },
    { beam: 5 },
    { vad: false },
    { words: true },
    { backendVersion: "1.2.2" },
  ];
  for (const variant of variants) {
    assert.notEqual(key, transcriptKey({ ...base, ...variant }), JSON.stringify(variant));
  }

  assert.throws(() => transcriptKey({}), /sourceHash/);
  assert.throws(() => transcriptKey({ sourceHash: "   " }), /sourceHash/);
});

test("transcriptMeta returns a plain normalized metadata object", () => {
  const meta = transcriptMeta({
    backend: "faster_whisper",
    model: "base",
    language: "pt-BR",
    beam: 1,
    vad: true,
    words: false,
    backendVersion: "1.2.1",
    cacheKey: "abc",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(meta, {
    backend: "faster-whisper",
    model: "base",
    language: "pt",
    beam: 1,
    vad: true,
    words: false,
    backendVersion: "1.2.1",
    cacheKey: "abc",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const generated = transcriptMeta({});
  assert.match(generated.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("shouldUseWords follows captions, explicit requests and force", () => {
  assert.equal(shouldUseWords({ project: {} }), false);
  assert.equal(shouldUseWords({ project: { captions: { enabled: true } } }), true);
  assert.equal(shouldUseWords({ project: { captions: { enabled: false } } }), false);
  assert.equal(shouldUseWords({ project: { mode: { captions: true } } }), true);
  assert.equal(shouldUseWords({ project: { mode: { captions: "burn" } } }), true);
  assert.equal(shouldUseWords({ project: { mode: { captions: "none" } } }), false);
  assert.equal(shouldUseWords({ project: { plan: { captions: { enabled: true } } } }), true);
  assert.equal(shouldUseWords({ project: {}, plan: { captions: { enabled: true } } }), true);

  assert.equal(shouldUseWords({ project: {}, requested: "always" }), true);
  assert.equal(shouldUseWords({ project: { captions: { enabled: true } }, requested: "never" }), false);
  assert.equal(shouldUseWords({ project: {}, force: true }), true);
  assert.equal(shouldUseWords({ project: { captions: { enabled: true } } }), true);
  assert.equal(shouldUseWords({ project: null }), false);
});
