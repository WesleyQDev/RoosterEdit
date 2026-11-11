/**
 * OCR result normalization and provider selection.
 *
 * Pure: parsing only. The CLI extracts the frame and runs the provider.
 *
 * The schema keeps word boxes in image pixels so a callout can be placed
 * exactly where the text is, which is the only reason to OCR a video frame.
 */

export const OCR_SCHEMA = "rooster.ocr/v1";
export const OCR_PROVIDERS = Object.freeze(["winrt", "vision", "tesseract", "wasm"]);

const TESSERACT_LANGUAGES = Object.freeze({
  en: "eng",
  "en-us": "eng",
  "en-gb": "eng",
  pt: "por",
  "pt-br": "por",
  "pt-pt": "por",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  nl: "nld",
  ja: "jpn",
  ko: "kor",
  zh: "chi_sim",
  ru: "rus",
  ar: "ara",
  hi: "hin",
});

const VISION_LANGUAGES = Object.freeze({
  en: "en-US",
  pt: "pt-BR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-Hans",
  ru: "ru-RU",
});

/**
 * Map a project language to each provider's code.
 * @param {string} language
 * @returns {{base:string,tesseract:string,winrt:string,vision:string}}
 */
export function languageCodes(language) {
  const raw = String(language || "en").trim();
  const lower = raw.toLowerCase();
  const base = lower.split(/[-_]/)[0] || "en";
  return {
    base,
    tesseract: TESSERACT_LANGUAGES[lower] || TESSERACT_LANGUAGES[base] || "eng",
    winrt: /^[a-z]{2}(-[a-z]{2})?$/i.test(raw) ? raw : VISION_LANGUAGES[base] || "en-US",
    vision: VISION_LANGUAGES[base] || "en-US",
  };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWord(word, index) {
  const text = String(word?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const x = finite(word.x ?? word.left ?? word.x0);
  const y = finite(word.y ?? word.top ?? word.y0);
  const width = finite(word.width ?? word.w ?? (word.x1 != null ? finite(word.x1) - x : 0));
  const height = finite(word.height ?? word.h ?? (word.y1 != null ? finite(word.y1) - y : 0));
  if (width <= 0 || height <= 0) return null;
  const confidence = word.confidence ?? word.conf;
  return {
    id: `w${index + 1}`,
    text,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    confidence: Number.isFinite(Number(confidence)) ? Math.round(Number(confidence) * 1000) / 1000 : null,
  };
}

/**
 * Build the frozen result object.
 * @param {object} input
 * @returns {object}
 */
export function normalizeOcrResult(input = {}) {
  const words = (Array.isArray(input.words) ? input.words : [])
    .map((word, index) => normalizeWord(word, index))
    .filter(Boolean);
  const text = String(input.text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  return {
    schema: OCR_SCHEMA,
    provider: String(input.provider || "unknown"),
    source: input.source ? String(input.source) : null,
    time: Number.isFinite(Number(input.time)) ? Number(input.time) : null,
    language: input.language ? String(input.language) : null,
    width: Math.round(finite(input.width)) || null,
    height: Math.round(finite(input.height)) || null,
    text,
    words,
    wordCount: words.length,
    measuredAt: input.measuredAt || new Date().toISOString(),
  };
}

/**
 * Parse Tesseract TSV (the default `tesseract image stdout tsv` output).
 * Columns: level page block par line word left top width height conf text
 * @param {string} tsv
 * @returns {{text:string,words:Array<object>}}
 */
export function parseTesseractTsv(tsv) {
  const lines = String(tsv || "").split(/\r?\n/).filter(Boolean);
  const words = [];
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    if (Number(columns[0]) !== 5) continue;
    const text = columns.slice(11).join(" ").trim();
    if (!text) continue;
    const confidence = Number(columns[10]);
    words.push({
      text,
      x: Number(columns[6]),
      y: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : null,
    });
  }
  return {
    text: words.map((word) => word.text).join(" "),
    words,
  };
}

/**
 * Parse the JSON written by the Windows WinRT adapter.
 * Expected shape: { text, width, height, words: [{ text, x, y, width, height }] }
 * @param {object|string} payload
 * @returns {{text:string,width:number|null,height:number|null,words:Array<object>}}
 */
export function parseWinRtPayload(payload) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  const words = (Array.isArray(data?.words) ? data.words : [])
    .map((word) => ({
      text: word?.text,
      x: word?.x,
      y: word?.y,
      width: word?.width ?? word?.w,
      height: word?.height ?? word?.h,
    }))
    .filter((word) => String(word.text || "").trim());
  return {
    text: String(data?.text || words.map((word) => word.text).join(" ")).trim(),
    width: data?.width ?? null,
    height: data?.height ?? null,
    words,
  };
}

/**
 * Pick the cheapest available provider.
 *
 * Native OS OCR is preferred because it needs no download. The WASM provider
 * is last because it is the only one that is installed on demand.
 *
 * @param {object} input
 * @param {string} [input.requested]
 * @param {string} [input.platform] process.platform
 * @param {boolean} [input.hasWinRt]
 * @param {boolean} [input.hasVision]
 * @param {boolean} [input.hasTesseract]
 * @param {boolean} [input.hasWasm]
 * @returns {{provider:string|null,reason:string}}
 */
export function chooseOcrProvider(input = {}) {
  const requested = input.requested ? String(input.requested).toLowerCase() : null;
  if (requested) {
    if (!OCR_PROVIDERS.includes(requested)) {
      return { provider: null, reason: `unknown provider "${requested}"` };
    }
    const available = {
      winrt: Boolean(input.hasWinRt),
      vision: Boolean(input.hasVision),
      tesseract: Boolean(input.hasTesseract),
      wasm: Boolean(input.hasWasm),
    };
    return available[requested]
      ? { provider: requested, reason: "requested provider is available" }
      : { provider: null, reason: `requested provider "${requested}" is not available` };
  }

  const platform = input.platform || process.platform;
  if (platform === "win32" && input.hasWinRt) return { provider: "winrt", reason: "Windows native OCR" };
  if (platform === "darwin" && input.hasVision) return { provider: "vision", reason: "macOS Vision OCR" };
  if (input.hasTesseract) return { provider: "tesseract", reason: "Tesseract binary is installed" };
  if (input.hasWasm) return { provider: "wasm", reason: "tesseract.js is installed" };
  return {
    provider: null,
    reason:
      "No OCR provider available. Install Tesseract, or run `rooster tools install ocr-wasm --approve`.",
  };
}

/**
 * Short one-line summary for the CLI.
 * @param {object} result
 * @returns {string}
 */
export function ocrSummary(result) {
  const words = Number(result?.wordCount) || 0;
  const first = String(result?.text || "").replace(/\s+/g, " ").slice(0, 120);
  return `${result?.provider || "ocr"}: ${words} word${words === 1 ? "" : "s"}${first ? ` — ${first}` : ""}`;
}
