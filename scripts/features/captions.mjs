/**
 * Caption generation for RoosterEdit.
 *
 * Turns a `rooster.transcript/v1` object into readable cues, SRT/VTT sidecars,
 * and an FFmpeg burn-in command. This module is a separate layer: the current
 * `build` command does not burn captions automatically.
 *
 * Zero dependencies. No work happens at import time.
 */

import fs from "node:fs";
import path from "node:path";

export const TRANSCRIPT_SCHEMA = "rooster.transcript/v1";
export const CAPTIONS_SCHEMA = "rooster.captions/v1";
export const MAX_LINE_CHARS = 42;
export const MAX_LINES = 2;

const POSITION_ALIGNMENT = {
  bottom: 2,
  "bottom-center": 2,
  middle: 5,
  center: 5,
  "middle-center": 5,
  top: 8,
  "top-center": 8,
};

/**
 * Normalize and validate a transcript object or JSON string.
 * A missing `schema` is tolerated; a different schema is rejected.
 *
 * @param {object|string} input Transcript object or JSON text.
 * @returns {object} The transcript object.
 */
export function parseTranscript(input) {
  let data = input;

  if (typeof input === "string") {
    const text = input.replace(/^\uFEFF/, "").trim();
    if (!text) throw new TypeError("Transcript is empty.");
    if (!text.startsWith("{") && !text.startsWith("[")) {
      throw new TypeError("parseTranscript expects an object or JSON text. Use loadTranscript(file) for a path.");
    }
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new SyntaxError(`Transcript JSON is invalid: ${error.message}`);
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(`Transcript must be a ${TRANSCRIPT_SCHEMA} object.`);
  }
  if (data.schema && data.schema !== TRANSCRIPT_SCHEMA) {
    throw new TypeError(`Unsupported transcript schema "${data.schema}". Expected ${TRANSCRIPT_SCHEMA}.`);
  }
  if (!Array.isArray(data.segments)) {
    throw new TypeError("Transcript.segments must be an array.");
  }

  return data;
}

/**
 * Read and parse a transcript file from disk.
 *
 * @param {string} transcriptPath Path to `edit/transcript.json`.
 * @returns {object} The transcript object.
 */
export function loadTranscript(transcriptPath) {
  if (!transcriptPath) throw new TypeError("transcriptPath is required.");
  const resolved = path.resolve(String(transcriptPath));
  let text;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (error) {
    throw new Error(`Could not read transcript ${resolved}: ${error.message}`);
  }
  return parseTranscript(text.replace(/^\uFEFF/, ""));
}

/**
 * Build caption cues from a transcript. Long segments are split at punctuation
 * or word boundaries, wrapped to `maxLines` lines of `maxLineChars`, and timed
 * proportionally to the number of visible characters in each cue.
 *
 * @param {object|string} transcript Transcript object or JSON text.
 * @param {{maxLineChars?: number, maxLines?: number}} [options] Cue layout.
 * @returns {Array<{id: number, start: number, end: number, text: string, lines: string[]}>} Cues.
 */
export function buildCues(transcript, options = {}) {
  const { maxLineChars, maxLines } = resolveOptions(options);
  const segments = normalizeSegments(transcript);
  const cues = [];

  for (const segment of segments) {
    const chunks = splitIntoCues(segment.text, maxLineChars, maxLines);
    if (!chunks.length) continue;

    const weights = chunks.map((chunk) => chunk.replace(/\s/g, "").length || 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const startMs = Math.round(segment.start * 1000);
    const endMs = Math.max(startMs + 1, Math.round(segment.end * 1000));

    let previousMs = startMs;
    let seenWeight = 0;

    for (let index = 0; index < chunks.length; index++) {
      seenWeight += weights[index];
      let cueEndMs =
        index === chunks.length - 1
          ? endMs
          : Math.round(startMs + ((endMs - startMs) * seenWeight) / totalWeight);

      cueEndMs = Math.min(endMs, Math.max(previousMs + 1, cueEndMs));
      if (cueEndMs <= previousMs) cueEndMs = previousMs + 1;

      cues.push({
        id: cues.length + 1,
        start: previousMs / 1000,
        end: cueEndMs / 1000,
        text: chunks[index],
        lines: wrapWords(chunks[index].split(/\s+/).filter(Boolean), maxLineChars),
      });
      previousMs = cueEndMs;
    }
  }

  return cues;
}

/**
 * Format seconds as an SRT/VTT timestamp. Hours are always included.
 *
 * @param {number} seconds Time in seconds.
 * @param {{separator?: string}} [options] `,` for SRT, `.` for VTT.
 * @returns {string} `HH:MM:SS,mmm` or `HH:MM:SS.mmm`.
 */
export function formatTimestamp(seconds, { separator = "," } = {}) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) throw new TypeError("Timestamp must be a finite number.");
  const totalMs = Math.max(0, Math.round(value * 1000));
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")}${separator}` +
    String(milliseconds).padStart(3, "0")
  );
}

/**
 * Greedy word wrap. Long unbreakable words stay on one line.
 *
 * @param {string} text Cue text.
 * @param {number} [maxChars] Maximum characters per line.
 * @returns {string[]} Lines.
 */
export function wrapLines(text, maxChars = MAX_LINE_CHARS) {
  return wrapWords(String(text || "").split(/\s+/).filter(Boolean), maxChars);
}

/**
 * Serialize cues as SubRip (SRT).
 *
 * @param {Array<{start: number, end: number, text?: string, lines?: string[]}>} cues Cues.
 * @returns {string} UTF-8 SRT text with LF line endings.
 */
export function toSrt(cues) {
  const list = normalizeCues(cues);
  return list
    .map((cue, index) => {
      const lines = linesForCue(cue);
      return `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${lines.join("\n")}`;
    })
    .join("\n\n") + (list.length ? "\n" : "");
}

/**
 * Serialize cues as WebVTT.
 *
 * @param {Array<{start: number, end: number, text?: string, lines?: string[]}>} cues Cues.
 * @returns {string} UTF-8 WebVTT text with LF line endings.
 */
export function toVtt(cues) {
  const list = normalizeCues(cues);
  if (!list.length) return "WEBVTT\n";
  const blocks = list.map((cue) => {
    const lines = linesForCue(cue);
    return `${formatTimestamp(cue.start, { separator: "." })} --> ${formatTimestamp(cue.end, { separator: "." })}\n${lines.join("\n")}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/**
 * Read a transcript and write `captions.srt`, `captions.vtt`, and `captions.json`.
 *
 * @param {{transcriptPath: string, outDir?: string, maxLineChars?: number, maxLines?: number}} options Paths and layout.
 * @returns {{outDir: string, files: {srt: string, vtt: string, json: string}, count: number, cues: object[], document: object}} Result.
 */
export function writeCaptions({ transcriptPath, outDir, ...options } = {}) {
  if (!transcriptPath) throw new TypeError("writeCaptions requires transcriptPath.");

  const transcript = loadTranscript(transcriptPath);
  const resolvedOptions = resolveOptions(options);
  const cues = buildCues(transcript, resolvedOptions);
  const targetDir = path.resolve(outDir || path.dirname(path.resolve(String(transcriptPath))));
  fs.mkdirSync(targetDir, { recursive: true });

  const files = {
    srt: path.join(targetDir, "captions.srt"),
    vtt: path.join(targetDir, "captions.vtt"),
    json: path.join(targetDir, "captions.json"),
  };

  writeTextFile(files.srt, toSrt(cues));
  writeTextFile(files.vtt, toVtt(cues));

  const document = {
    schema: CAPTIONS_SCHEMA,
    source: transcript.source || null,
    language: transcript.language || null,
    transcript: path.resolve(String(transcriptPath)),
    generatedAt: new Date().toISOString(),
    duration: Number(transcript.duration) > 0 ? Number(transcript.duration) : cues.length ? cues[cues.length - 1].end : null,
    options: resolvedOptions,
    count: cues.length,
    cues,
  };
  writeTextFile(files.json, JSON.stringify(document, null, 2) + "\n");

  return { outDir: targetDir, files, count: cues.length, cues, document };
}

/**
 * Build FFmpeg args to burn an SRT into a video. No process is executed.
 *
 * `style` accepts profile caption fields (`font`, `size`, `color`, `stroke`,
 * `position`) or ASS-like fields (`fontName`, `fontSize`, `primaryColor`,
 * `outlineColor`, `alignment`, `marginV`, `outline`, `shadow`, `bold`).
 * A string is treated as a raw ASS `force_style` value.
 *
 * @param {{video: string, srt: string, out: string, style?: object|string, crf?: number, preset?: string, audio?: string|false}} options Paths and encoding.
 * @returns {{args: string[], command: string, filter: string}} Args and printable command.
 */
export function burnArgs({ video, srt, out, style, crf = 18, preset = "medium", audio = "copy" } = {}) {
  if (!video) throw new TypeError("burnArgs requires video.");
  if (!srt) throw new TypeError("burnArgs requires srt.");
  if (!out) throw new TypeError("burnArgs requires out.");

  const filterParts = [`filename='${escapeFilterPath(srt)}'`];
  const forceStyle = buildForceStyle(style);
  if (forceStyle) filterParts.push(`force_style='${forceStyle}'`);

  const filter = `subtitles=${filterParts.join(":")}`;
  const args = [
    "-y",
    "-i", String(video),
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", String(preset),
    "-crf", String(crf),
  ];

  if (audio === false || audio === "none") {
    args.push("-an");
  } else if (audio) {
    args.push("-c:a", String(audio));
  }
  if (/\.(mp4|mov|m4v)$/i.test(String(out))) {
    args.push("-movflags", "+faststart");
  }
  args.push(String(out));

  return { args, command: toCommand(args), filter };
}

/**
 * Return the printable FFmpeg burn-in command.
 *
 * @param {Parameters<typeof burnArgs>[0]} options Same options as `burnArgs`.
 * @returns {string} Printable command. The caller still executes it.
 */
export function burnCommand(options) {
  return burnArgs(options).command;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveOptions(options = {}) {
  const lineChars = Number(options.maxLineChars ?? options.maxCharsPerLine);
  const lines = Number(options.maxLines);
  return {
    maxLineChars: Number.isFinite(lineChars)
      ? Math.min(120, Math.max(10, Math.round(lineChars)))
      : MAX_LINE_CHARS,
    maxLines: Number.isFinite(lines) ? Math.min(4, Math.max(1, Math.round(lines))) : MAX_LINES,
  };
}

function normalizeSegments(transcript) {
  const data = parseTranscript(transcript);
  const ordered = data.segments
    .map((segment, index) => {
      if (!segment || typeof segment !== "object") {
        throw new TypeError(`Segment ${index} must be an object.`);
      }
      const rawStart = Number(segment.start);
      const rawEnd = Number(segment.end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
        throw new TypeError(`Segment ${index} needs numeric start and end.`);
      }
      return {
        start: Math.max(0, rawStart),
        end: Math.max(0, rawEnd),
        text: normalizeText(segment.text),
        index,
      };
    })
    .filter((segment) => segment.text && segment.end > segment.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);

  const segments = [];
  let lastEnd = 0;
  for (const segment of ordered) {
    const start = Math.max(segment.start, lastEnd);
    if (segment.end - start < 0.001) continue;
    segments.push({ start, end: segment.end, text: segment.text });
    lastEnd = segment.end;
  }
  return segments;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitClauses(text) {
  const pieces = normalizeText(text).split(/(?<=[.!?…,;:—–])\s+/);
  return pieces
    .filter(Boolean)
    .map((piece) => ({
      text: piece,
      hard: /[.!?…]["')\]]*$/.test(piece),
    }));
}

function splitIntoCues(text, maxChars, maxLines) {
  const clauses = splitClauses(text);
  const cues = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      cues.push(current.join(" "));
      current = [];
    }
  };
  const fits = (words) => wrapWords(words, maxChars).length <= maxLines;

  for (const clause of clauses) {
    const words = clause.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    if (current.length && !fits([...current, ...words])) flush();

    if (!fits(words)) {
      for (const word of words) {
        if (current.length && !fits([...current, word])) flush();
        current.push(word);
      }
    } else {
      current.push(...words);
    }

    // Prefer a clean break after a sentence when the cue is already substantial.
    if (clause.hard && current.length && current.join(" ").length >= maxChars) flush();
  }

  flush();
  return cues;
}

function wrapWords(words, maxChars) {
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function normalizeCues(cues) {
  if (!Array.isArray(cues)) throw new TypeError("cues must be an array.");

  return cues.map((cue, index) => {
    if (!cue || typeof cue !== "object") throw new TypeError(`Cue ${index} must be an object.`);
    const start = Number(cue.start);
    const end = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new TypeError(`Cue ${index} needs numeric start and end.`);
    }
    if (end <= start) throw new RangeError(`Cue ${index} has end <= start.`);

    const text = String(cue.text ?? "").trim();
    const lines = Array.isArray(cue.lines)
      ? cue.lines.map((line) => String(line).trim()).filter(Boolean)
      : [];
    if (!text && !lines.length) throw new TypeError(`Cue ${index} has no text.`);

    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(0, end);
    if (safeEnd <= safeStart) throw new RangeError(`Cue ${index} has end <= start.`);

    return {
      start: safeStart,
      end: safeEnd,
      text,
      lines,
    };
  });
}

function linesForCue(cue) {
  if (cue.lines.length) return cue.lines;
  return wrapWords(cue.text.split(/\s+/).filter(Boolean), MAX_LINE_CHARS);
}

function writeTextFile(file, content) {
  fs.writeFileSync(file, String(content).replace(/\r\n/g, "\n"), "utf8");
}

function escapeFilterPath(file) {
  return String(file)
    .replace(/\\/g, "/")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildForceStyle(style) {
  if (!style) return "";
  if (typeof style === "string") return style.trim().replace(/'/g, "\\'");

  const entries = [];
  const add = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    entries.push(`${key}=${forceValue(value)}`);
  };
  const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

  add("FontName", pick(style.fontName, style.font));
  add("FontSize", pick(style.fontSize, style.size));

  const primary = toAssColor(pick(style.primaryColor, style.color));
  if (primary) add("PrimaryColour", primary);
  const outlineColor = toAssColor(pick(style.outlineColor, style.stroke));
  if (outlineColor) add("OutlineColour", outlineColor);
  const backColor = toAssColor(style.backColor);
  if (backColor) add("BackColour", backColor);

  const position = pick(style.alignment, style.position);
  if (position !== undefined) {
    const alignment = POSITION_ALIGNMENT[String(position).toLowerCase()] || Number(position);
    if (Number.isInteger(alignment) && alignment >= 1 && alignment <= 9) add("Alignment", alignment);
  }

  if (style.bold !== undefined) add("Bold", style.bold ? -1 : 0);
  else if (Number(style.weight) >= 600) add("Bold", -1);
  if (style.italic !== undefined) add("Italic", style.italic ? -1 : 0);

  add("Outline", pick(style.outline, style.stroke ? 2 : undefined));
  add("Shadow", style.shadow);
  add("BorderStyle", style.borderStyle);
  add("MarginV", style.marginV);
  add("MarginL", style.marginL);
  add("MarginR", style.marginR);
  add("Spacing", style.spacing);

  if (style.forceStyle) entries.push(String(style.forceStyle).replace(/^,+|,+$/g, ""));
  return entries.join(",");
}

function forceValue(value) {
  return String(value).replace(/'/g, "\\'").replace(/,/g, " ");
}

function toAssColor(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^&H[0-9a-f]{8}$/i.test(raw)) return raw.toUpperCase();
  const hex = raw.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
}

function toCommand(args) {
  return ["ffmpeg", ...args].map(quoteArg).join(" ");
}

function quoteArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
