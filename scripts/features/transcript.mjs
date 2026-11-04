/**
 * Transcript normalization for RoosterEdit.
 *
 * Pure helpers that turn ASR output (word lists, segments, or a mix) into the
 * `rooster.transcript/v1` document written by `rooster transcribe`. The schema
 * and field names are frozen: existing projects and `features/captions.mjs`
 * read them directly.
 *
 * Zero dependencies. No work happens at import time.
 */

export const TRANSCRIPT_SCHEMA = "rooster.transcript/v1";
export const DEFAULT_MAX_WORDS = 14;
export const DEFAULT_MAX_GAP = 0.8;

/**
 * Remove spaces before punctuation and trim the result.
 *
 * @param {unknown} value Text to clean.
 * @returns {string} Cleaned text.
 */
export function cleanTranscriptText(value) {
  return String(value ?? "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

/**
 * Group word timestamps into sentence-like segments.
 *
 * A segment is flushed when the gap before the next word is larger than
 * `maxGap`, when it already has `maxWords` words, or right after a word that
 * ends with `.`, `!`, or `?`. Behavior is intentionally identical to the
 * previous inline helper in `scripts/rooster.mjs`.
 *
 * @param {Array<{text?: string, start: number, end: number}>} words Words in time order.
 * @param {number} [maxWords] Maximum words per segment.
 * @param {number} [maxGap] Maximum silence between words, in seconds.
 * @returns {Array<{id: number, start: number, end: number, text: string}>} Segments.
 */
export function groupWordsIntoSegments(words, maxWords = DEFAULT_MAX_WORDS, maxGap = DEFAULT_MAX_GAP) {
  const list = Array.isArray(words) ? words : [];
  const segments = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const text = current
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    segments.push({
      id: segments.length,
      start: current[0].start,
      end: current[current.length - 1].end,
      text,
    });
    current = [];
  };

  for (const word of list) {
    if (current.length) {
      const previous = current[current.length - 1];
      if (word.start - previous.end > maxGap || current.length >= maxWords) flush();
    }
    current.push(word);
    if (/[.!?]$/.test(String(word.text || "").trim())) flush();
  }
  flush();
  return segments;
}

/**
 * Normalize raw ASR output into a `rooster.transcript/v1` document.
 *
 * Accepted shapes:
 * - an array of words;
 * - `{ text, language, words[], segments[] }`.
 *
 * Raw segments win when present; otherwise segments are grouped from words.
 * Word ids default to `w0`, `w1`, ... and are preserved when supplied. The
 * document is not mutated.
 *
 * @param {object|Array<object>} raw Raw ASR result.
 * @param {string} source Media path relative to the project.
 * @param {string} language Requested language, used when the raw result has none.
 * @param {{createdAt?: string, now?: string}} [options] Test hook for `createdAt`.
 * @returns {object} Transcript document.
 */
export function normalizeTranscript(raw, source, language, options = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const isWordArray = Array.isArray(data);
  const words = isWordArray ? data : Array.isArray(data.words) ? data.words : [];
  const rawSegments = !isWordArray && Array.isArray(data.segments) ? data.segments : [];

  const segments = rawSegments.length
    ? rawSegments.map((segment, index) => ({
        id: segment.id ?? index,
        start: segment.start,
        end: segment.end,
        text: (segment.text || "").trim(),
      }))
    : groupWordsIntoSegments(words);

  const text =
    (!isWordArray && data.text) ||
    words.map((word) => word.text).join(" ") ||
    segments.map((segment) => segment.text).join(" ");

  return {
    schema: TRANSCRIPT_SCHEMA,
    source,
    language: (!isWordArray && data.language) || language,
    text: cleanTranscriptText(text),
    segments,
    words: words.length
      ? words.map((word, index) => ({
          id: word.id ?? `w${index}`,
          text: word.text,
          start: word.start,
          end: word.end,
        }))
      : undefined,
    createdAt: options.createdAt || options.now || new Date().toISOString(),
  };
}
