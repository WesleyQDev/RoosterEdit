/**
 * Rule-based tightening for talking-head footage.
 *
 * The rules decide where the sound actually stops; the agent decides what the
 * pause means. This module is pure: no FFmpeg, no filesystem, no clock.
 *
 * One standard, no presets. Every number below is the editorial default:
 * a pause shorter than `minPause` is not worth a jump cut, the cut keeps
 * `keepBeat` seconds of room tone after the outgoing line and `leadIn`
 * seconds before the incoming line.
 */

export const TIGHTEN_STANDARD = Object.freeze({
  minPause: 0.8,
  keepBeat: 0.4,
  leadIn: 0.1,
  minCut: 0.35,
  noiseDb: -35,
  audioMinSilence: 0.4,
});

/** Default padding for the legacy transcript-only `silence` command. */
export const DEFAULT_PAD = 0.1;

/** Conservative list: only sounds that carry no meaning on their own. */
export const FILLER_WORDS = Object.freeze([
  "um",
  "uh",
  "uhm",
  "umm",
  "uhh",
  "er",
  "erm",
  "ah",
  "ahn",
  "hmm",
  "hum",
  "eh",
]);

const RETAKE_CUE =
  /\b(deixa eu (repetir|falar de novo)|vou (repetir|começar de novo|recomeçar)|mais uma vez|let me (say|try) (that|this) again|start over|take two|scratch that)\b/i;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Number(Number(value).toFixed(3));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWord(value) {
  return normalizeText(value).replace(/^'+|'+$/g, "");
}

function validSpan(span) {
  return (
    span &&
    Number.isFinite(Number(span.start)) &&
    Number.isFinite(Number(span.end)) &&
    Number(span.end) > Number(span.start)
  );
}

/**
 * Merge overlapping or near-adjacent intervals.
 *
 * @param {Array<{start:number,end:number}>} intervals
 * @param {number} [gap]
 * @returns {Array<{start:number,end:number}>}
 */
export function mergeIntervals(intervals, gap = 0.02) {
  const sorted = (intervals || [])
    .filter(validSpan)
    .map((span) => ({ ...span, start: Number(span.start), end: Number(span.end) }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + gap) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Parse FFmpeg `silencedetect` output from stderr. The filter prints
 * `silence_start: <s>` and `silence_end: <s> | silence_duration: <s>`.
 * A trailing open interval is closed with `duration` when it is known.
 *
 * @param {string} stderr
 * @param {{duration?:number}} [options]
 * @returns {Array<{start:number,end:number}>}
 */
export function parseSilencedetect(stderr, options = {}) {
  const duration = toNumber(options.duration, 0);
  const spans = [];
  let open = null;
  for (const line of String(stderr || "").split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (end && open !== null) {
      const value = Number(end[1]);
      const capped = duration > 0 ? Math.min(value, duration) : value;
      if (Number.isFinite(capped) && capped > open) {
        spans.push({ start: round3(open), end: round3(capped) });
      }
      open = null;
    }
  }
  if (open !== null && duration > open) {
    spans.push({ start: round3(open), end: round3(duration) });
  }
  return mergeIntervals(spans);
}

/**
 * Speech spans, word-level when the transcript has words.
 *
 * @param {object} transcript
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function speechSpans(transcript) {
  const words = Array.isArray(transcript?.words) ? transcript.words : [];
  const source = words.length ? words : Array.isArray(transcript?.segments) ? transcript.segments : [];
  return source
    .filter(validSpan)
    .map((span) => ({
      start: Number(span.start),
      end: Number(span.end),
      text: String(span.text || span.word || ""),
    }))
    .sort((a, b) => a.start - b.start);
}

function previousSpan(spans, time, tolerance = 0.2) {
  let low = 0;
  let high = spans.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (spans[mid].end <= time + tolerance) {
      found = spans[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function nextSpan(spans, time, tolerance = 0.2) {
  let low = 0;
  let high = spans.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (spans[mid].start >= time - tolerance) {
      found = spans[mid];
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

/**
 * Snapshot of a silence interval as a cut that keeps a natural beat.
 * Returns null when the cut would be shorter than `minCut` or would not
 * fit inside the detected silence.
 *
 * @param {{start:number,end:number}} silence
 * @param {Array<{start:number,end:number,text:string}>} spans
 * @param {{keepBeat:number,leadIn:number,minCut:number}} options
 * @returns {{start:number,end:number}|null}
 */
export function snapCut(silence, spans, options = {}) {
  const keepBeat = toNumber(options.keepBeat, TIGHTEN_STANDARD.keepBeat);
  const leadIn = toNumber(options.leadIn, TIGHTEN_STANDARD.leadIn);
  const minCut = toNumber(options.minCut, TIGHTEN_STANDARD.minCut);
  if (!validSpan(silence)) return null;
  const before = previousSpan(spans, Number(silence.start));
  const after = nextSpan(spans, Number(silence.end));
  const rawStart = before ? before.end + keepBeat : Number(silence.start);
  const rawEnd = after ? after.start - leadIn : Number(silence.end);
  const start = round3(Math.max(Number(silence.start), Math.min(rawStart, Number(silence.end))));
  const end = round3(Math.min(Number(silence.end), Math.max(rawEnd, Number(silence.start))));
  if (end - start < minCut) return null;
  return { start, end };
}

/**
 * Subtract protected spans from a candidate interval.
 *
 * @param {{start:number,end:number}} range
 * @param {Array<{start:number,end:number}>} protect
 * @returns {Array<{start:number,end:number}>}
 */
export function subtractProtected(range, protect = []) {
  if (!validSpan(range)) return [];
  let pieces = [{ start: Number(range.start), end: Number(range.end) }];
  for (const span of mergeIntervals(protect)) {
    const next = [];
    for (const piece of pieces) {
      if (span.end <= piece.start || span.start >= piece.end) {
        next.push(piece);
        continue;
      }
      if (span.start > piece.start) {
        next.push({ start: piece.start, end: Math.min(span.start, piece.end) });
      }
      if (span.end < piece.end) {
        next.push({ start: Math.max(span.end, piece.start), end: piece.end });
      }
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece.end - piece.start > 0.001);
}

/**
 * Gaps between speech spans, used when audio analysis is unavailable.
 *
 * @param {object} transcript
 * @param {number} duration
 * @param {number} [minPause]
 * @returns {Array<{start:number,end:number}>}
 */
export function transcriptGaps(transcript, duration, minPause = TIGHTEN_STANDARD.minPause) {
  const spans = speechSpans(transcript);
  if (!spans.length) return [];
  const gaps = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start - cursor >= minPause) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  const total = toNumber(duration, 0);
  if (total > cursor && total - cursor >= minPause) gaps.push({ start: cursor, end: total });
  return mergeIntervals(gaps);
}

/**
 * Propose long-pause cuts from audio silences, with a kept beat, a lead-in,
 * and protected spans removed. When `silences` is empty the transcript gaps
 * are used as a weaker fallback.
 *
 * @param {{transcript:object,silences?:Array<{start:number,end:number}>,duration?:number,protect?:Array<object>,options?:object}} input
 * @returns {Array<{id:string,start:number,end:number,reason:string,note:string,confidence:number}>}
 */
export function tightenCuts(input = {}) {
  const settings = {
    minPause: toNumber(input.options?.minPause, TIGHTEN_STANDARD.minPause),
    keepBeat: toNumber(input.options?.keepBeat, TIGHTEN_STANDARD.keepBeat),
    leadIn: toNumber(input.options?.leadIn, TIGHTEN_STANDARD.leadIn),
    minCut: toNumber(input.options?.minCut, TIGHTEN_STANDARD.minCut),
  };
  const duration = toNumber(input.duration, 0);
  const protect = normalizeProtect(input.protect || []);
  const detected = mergeIntervals(
    (input.silences || []).filter((span) => span.end - span.start >= settings.minPause)
  );
  const gaps = detected.length
    ? detected
    : input.fallback === false
      ? []
      : transcriptGaps(input.transcript, duration, settings.minPause);
  const spans = speechSpans(input.transcript);
  const cuts = [];
  for (const sourceGap of gaps) {
    const gap =
      duration > 0
        ? { start: Math.max(0, sourceGap.start), end: Math.min(sourceGap.end, duration) }
        : sourceGap;
    if (gap.end <= gap.start) continue;
    const snapped = snapCut(gap, spans, settings);
    if (!snapped) continue;
    for (const piece of subtractProtected(snapped, protect)) {
      if (piece.end - piece.start < settings.minCut) continue;
      cuts.push({
        id: `tighten-${String(cuts.length + 1).padStart(3, "0")}`,
        start: round3(piece.start),
        end: round3(piece.end),
        reason: "long-pause",
        note: `pause ${round3(gap.end - gap.start)}s; beat ${settings.keepBeat}s`,
        confidence: 0.9,
      });
    }
  }
  return mergeCuts(cuts, settings.minCut);
}

function mergeCuts(cuts, minCut) {
  const merged = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end + 0.02) {
      last.end = Math.max(last.end, cut.end);
      if (last.reason !== cut.reason) last.reason = "mixed";
      last.note = [last.note, cut.note].filter(Boolean).join("; ");
    } else {
      merged.push({ ...cut });
    }
  }
  return merged
    .filter((cut) => cut.end - cut.start >= minCut)
    .map((cut, index) => ({ ...cut, id: `tighten-${String(index + 1).padStart(3, "0")}` }));
}

/**
 * Cut standalone filler words. A word is only removed when at least one side
 * has a small gap, so the neighbouring word is never clipped. "mm hmm" as
 * agreement stays.
 *
 * @param {object} transcript
 * @param {{protect?:Array<object>,extraFillers?:string[]}} [options]
 * @returns {Array<{id:string,start:number,end:number,reason:string,note:string,confidence:number}>}
 */
export function fillerCuts(transcript, options = {}) {
  const words = (Array.isArray(transcript?.words) ? transcript.words : []).filter(validSpan);
  if (!words.length) return [];
  const fillers = new Set([
    ...FILLER_WORDS,
    ...(options.extraFillers || []).map(normalizeWord).filter(Boolean),
  ]);
  const protect = normalizeProtect(options.protect || []);
  const cuts = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const text = normalizeWord(word.text || word.word);
    if (!fillers.has(text)) continue;
    const previous = words[index - 1];
    const next = words[index + 1];
    const before = word.start - (previous ? previous.end : word.start);
    const after = (next ? next.start : word.end) - word.end;
    if (Math.max(before, after) < 0.06) continue;
    const neighbor = [previous, next].map((item) => normalizeWord(item?.text || item?.word));
    if (neighbor.some((value) => value === "mm" || value === "hmm" || value === "hum")) continue;
    const range = { start: Math.max(0, word.start - 0.02), end: word.end + 0.02 };
    for (const piece of subtractProtected(range, protect)) {
      if (piece.end - piece.start < 0.03) continue;
      cuts.push({
        id: `filler-${String(cuts.length + 1).padStart(3, "0")}`,
        start: round3(piece.start),
        end: round3(piece.end),
        reason: "filler",
        note: `"${String(word.text || word.word).trim()}"`,
        confidence: 0.8,
      });
    }
  }
  return cuts;
}

/**
 * Dice similarity between two token lists, 0..1.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
export function tokenSimilarity(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (!left.length || !right.length) return 0;
  const counts = new Map();
  for (const token of left) counts.set(token, (counts.get(token) || 0) + 1);
  let shared = 0;
  for (const token of right) {
    const remaining = counts.get(token) || 0;
    if (remaining > 0) {
      shared += 1;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/**
 * Warn when a cleanup pass removes too much to be a cleanup.
 *
 * Audio-driven cuts are trusted up to 75% of the source (a raw recording can
 * carry a lot of dead air). The transcript-gap fallback is approximate, so its
 * limit is 35%. Above the limit the caller should refuse to write without
 * `--force`.
 *
 * @param {number} ratio Removed seconds / source seconds.
 * @param {{usedAudio?: boolean}} [options]
 * @returns {string|null}
 */
export function overcutWarning(ratio, options = {}) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return null;
  const limit = options.usedAudio === false ? 0.35 : 0.75;
  if (value <= limit) return null;
  const percent = Math.round(value * 100);
  return (
    `${percent}% of the source would be removed, which is a highlight edit, not cleanup. ` +
    (options.usedAudio === false
      ? "The transcript-gap fallback is approximate because the audio was not analyzed. "
      : "") +
    "Review the cut list; pass --force to write it anyway."
  );
}

/**
 * Keep every cut out of the middle of a word.
 *
 * Whisper word timestamps are the best boundary signal available. When a cut
 * starts or ends inside a word, expand it to the word edges; a cut that would
 * swallow a word is expanded, never split. Cuts outside any word are untouched.
 *
 * @param {Array<{start:number,end:number}>} cuts
 * @param {object} transcript
 * @returns {Array<object>} New cuts, sorted by start.
 */
export function clampCutsToWords(cuts, transcript) {
  const words = (Array.isArray(transcript?.words) ? transcript.words : [])
    .filter(validSpan)
    .map((word) => ({ start: Number(word.start), end: Number(word.end) }))
    .sort((a, b) => a.start - b.start);
  const list = (Array.isArray(cuts) ? cuts : []).filter(validSpan);
  if (!words.length) return list.map((cut) => ({ ...cut }));

  const clamped = [];
  for (const cut of list) {
    let start = Number(cut.start);
    let end = Number(cut.end);
    for (const word of words) {
      if (word.end <= start || word.start >= end) continue;
      if (word.start < start && word.end > start) start = word.start;
      if (word.start < end && word.end > end) end = word.end;
    }
    if (end - start <= 0.001) continue;
    clamped.push({ ...cut, start: round3(start), end: round3(end) });
  }
  return clamped.sort((a, b) => a.start - b.start);
}

/**
 * Retake report. Only a short segment that is itself a retake cue is cut
 * automatically; repeated takes are listed for the agent or the user to
 * decide. The last take is the one that stays.
 *
 * Two takes are compared by their first eight words with a fuzzy score, so a
 * mis-transcribed word in the second take does not hide the retake. The report
 * is a review list: nothing here is cut unless the caller asks for `--retakes`.
 *
 * @param {object} transcript
 * @param {{within?:number, threshold?:number}} [options]
 * @returns {{cueCuts:Array<object>,possibleRetakes:Array<object>}}
 */
export function retakeReport(transcript, options = {}) {
  const within = toNumber(options.within, 90);
  const segments = (Array.isArray(transcript?.segments) ? transcript.segments : [])
    .filter(validSpan)
    .map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || "").trim(),
    }))
    .sort((a, b) => a.start - b.start);
  const cueCuts = [];
  const possibleRetakes = [];
  for (const segment of segments) {
    const words = normalizeText(segment.text).split(" ").filter(Boolean);
    if (!RETAKE_CUE.test(segment.text)) continue;
    if (words.length <= 8) {
      cueCuts.push({
        id: `retake-${String(cueCuts.length + 1).padStart(3, "0")}`,
        start: round3(segment.start),
        end: round3(segment.end),
        reason: "retake",
        note: "retake cue",
        confidence: 0.85,
      });
    } else {
      possibleRetakes.push({
        kind: "cue",
        start: round3(segment.start),
        end: round3(segment.end),
        text: segment.text,
        reason: "The cue is inside a longer line; cut it by hand if the retake is real.",
      });
    }
  }
  const seen = new Set();
  const threshold = Math.min(1, Math.max(0.4, toNumber(options.threshold, 0.75)));
  for (let index = 0; index < segments.length; index += 1) {
    const first = normalizeText(segments[index].text).split(" ").filter(Boolean).slice(0, 8);
    if (first.length < 4) continue;
    for (let other = index + 1; other < segments.length; other += 1) {
      const candidate = segments[other];
      if (candidate.start - segments[index].end > within) break;
      const second = normalizeText(candidate.text).split(" ").filter(Boolean).slice(0, 8);
      const score = tokenSimilarity(first, second);
      if (score < threshold) continue;
      const key = `${round3(segments[index].start)}-${round3(candidate.start)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      possibleRetakes.push({
        kind: "repeat",
        score: Number(score.toFixed(2)),
        cut: { start: round3(segments[index].start), end: round3(segments[index].end) },
        keep: { start: round3(candidate.start), end: round3(candidate.end) },
        text: segments[index].text.slice(0, 120),
        keepText: candidate.text.slice(0, 120),
        reason:
          "Two takes open almost the same way; a mis-transcribed word no longer hides the retake. Keep the stronger one; nothing is cut automatically.",
      });
    }
  }
  return { cueCuts, possibleRetakes };
}

/**
 * Normalize a protect list: valid spans only, clamped to zero, merged.
 *
 * @param {Array<{start:number,end:number,reason?:string}>} spans
 * @returns {Array<{start:number,end:number,reason?:string}>}
 */
export function normalizeProtect(spans) {
  const clean = (spans || [])
    .filter(validSpan)
    .map((span) => ({
      start: Number(span.start),
      end: Number(span.end),
      ...(span.reason ? { reason: String(span.reason) } : {}),
    }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const span of clean) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 0.02) {
      last.end = Math.max(last.end, span.end);
      if (!last.reason && span.reason) last.reason = span.reason;
    } else {
      merged.push({ ...span });
    }
  }
  return merged.map((span) => ({
    start: round3(span.start),
    end: round3(span.end),
    ...(span.reason ? { reason: span.reason } : {}),
  }));
}

function parseClock(value) {
  const text = String(value || "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const match = text.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Parse `--protect 12.4-18,1:02-1:05` into spans.
 *
 * @param {string|string[]} value
 * @returns {Array<{start:number,end:number,reason:string}>}
 */
export function parseProtect(value) {
  const items = Array.isArray(value) ? value : [value];
  const spans = [];
  for (const item of items) {
    if (!item || item === true) continue;
    for (const part of String(item).split(",")) {
      const match = part.match(/^\s*([\d:.]+)\s*-\s*([\d:.]+)\s*$/);
      if (!match) continue;
      const start = parseClock(match[1]);
      const end = parseClock(match[2]);
      if (start === null || end === null || end <= start) continue;
      spans.push({ start, end, reason: "cli" });
    }
  }
  return spans;
}
