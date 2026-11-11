import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chooseOcrProvider,
  languageCodes,
  normalizeOcrResult,
  parseTesseractTsv,
  parseWinRtPayload,
} from "../lib/ocr.mjs";

test("languageCodes maps project languages to each provider", () => {
  assert.deepEqual(languageCodes("pt-BR"), {
    base: "pt",
    tesseract: "por",
    winrt: "pt-BR",
    vision: "pt-BR",
  });
  assert.equal(languageCodes("en").tesseract, "eng");
  assert.equal(languageCodes("zh-Hans").tesseract, "chi_sim");
  assert.equal(languageCodes("xx").tesseract, "eng");
});

test("parseTesseractTsv keeps word rows and ignores structure rows", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t900\t300\t-1\t",
    "5\t1\t1\t1\t1\t1\t34\t121\t288\t40\t96.5\tRoosterEdit",
    "5\t1\t1\t1\t1\t2\t341\t120\t120\t42\t91.0\tOCR",
  ].join("\n");
  const parsed = parseTesseractTsv(tsv);
  assert.equal(parsed.words.length, 2);
  assert.equal(parsed.words[0].text, "RoosterEdit");
  assert.equal(parsed.words[0].confidence, 0.965);
  assert.equal(parsed.text, "RoosterEdit OCR");
});

test("parseWinRtPayload reads the adapter JSON", () => {
  const parsed = parseWinRtPayload({
    text: "RoosterEdit OCR",
    width: 900,
    height: 300,
    words: [{ text: "RoosterEdit", x: 34, y: 110, width: 288, height: 48 }],
  });
  assert.equal(parsed.text, "RoosterEdit OCR");
  assert.equal(parsed.words[0].width, 288);
});

test("normalizeOcrResult freezes the schema and rounds boxes", () => {
  const result = normalizeOcrResult({
    provider: "winrt",
    source: "renders/draft.mp4",
    time: 12.5,
    language: "pt-BR",
    width: 1920,
    height: 1080,
    text: "  Olá  mundo  ",
    words: [{ text: "Olá", x: 10.123, y: 20.987, width: 30, height: 12 }],
  });
  assert.equal(result.schema, "rooster.ocr/v1");
  assert.equal(result.text, "Olá  mundo");
  assert.equal(result.words[0].x, 10.12);
  assert.equal(result.words[0].y, 20.99);
  assert.equal(result.wordCount, 1);
});

test("chooseOcrProvider prefers native providers and rejects unknown ones", () => {
  assert.equal(
    chooseOcrProvider({ platform: "win32", hasWinRt: true, hasWasm: true }).provider,
    "winrt"
  );
  assert.equal(
    chooseOcrProvider({ platform: "darwin", hasVision: true, hasTesseract: true }).provider,
    "vision"
  );
  assert.equal(chooseOcrProvider({ platform: "linux", hasTesseract: true }).provider, "tesseract");
  assert.equal(chooseOcrProvider({ platform: "linux", hasWasm: true }).provider, "wasm");
  assert.equal(chooseOcrProvider({ platform: "linux" }).provider, null);
  assert.equal(chooseOcrProvider({ requested: "nope" }).provider, null);
  assert.equal(
    chooseOcrProvider({ requested: "wasm", hasWasm: false }).provider,
    null
  );
});
