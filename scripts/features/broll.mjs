/**
 * Local b-roll discovery, ranking, and placement suggestions.
 *
 * This is a deterministic keyword helper for files that are already on disk.
 * It does not search stock libraries, call an API, download media, inspect
 * pixels, or verify licenses. Treat its output as a draft for a human/agent to
 * review before adding it to `edit/plan.json`.
 *
 * No side effects on import. All functions are synchronous and dependency-free
 * beyond Node's `fs` and `path`.
 */

import fs from "node:fs";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".m2ts",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".hg", ".svn", "cache", ".opencode",
]);

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/gu;

// Multilingual stopwords plus generic media words that would otherwise match
// almost every filename. Tokens are accent-folded before lookup.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "did", "do",
  "does", "for", "from", "had", "has", "have", "he", "her", "here", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "me",
  "more", "most", "my", "no", "not", "of", "on", "or", "our", "out", "she",
  "so", "some", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "to", "too", "up", "us", "very", "was",
  "we", "were", "what", "when", "where", "which", "who", "why", "will",
  "with", "you", "your",
  "o", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos",
  "em", "na", "no", "nas", "nos", "por", "para", "com", "sem", "que", "se",
  "e", "ao", "aos", "ja", "nao", "sim", "eu", "voce", "ele", "ela", "eles",
  "elas", "meu", "minha", "seu", "sua", "isso", "isto", "aquilo", "muito",
  "pouco", "mais", "mas", "como", "quando", "onde", "porque", "sobre",
  "entre", "tambem", "ainda", "depois", "antes", "durante",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "del", "en", "con",
  "sin", "y", "es", "al", "su", "sus", "mas", "muy", "pero", "este", "esta",
  "esto", "estos", "estas", "yo", "tu", "nosotros", "ellos", "ellas",
  "video", "videos", "clip", "clips", "footage", "stock", "image", "images",
  "photo", "photos", "broll", "roll", "final", "raw", "render", "export",
  "copy", "hd", "uhd", "4k", "1080p", "720p", "assets", "source", "library",
  "media",
]);

/**
 * Recursively list local video and image files under one or more directories.
 *
 * Paths are returned absolute and sorted for deterministic plans. Missing
 * directories, permission errors, symlinks, and common non-media folders are
 * skipped instead of throwing.
 *
 * @param {string|string[]} dirs Directory or directories to scan. A media file
 *   path is also accepted.
 * @returns {string[]} Absolute paths with video/image extensions.
 */
export function listMediaFiles(dirs) {
  const roots = Array.isArray(dirs) ? dirs : dirs == null ? [] : [dirs];
  const found = new Map();
  const visited = new Set();

  const add = (file) => {
    const key = pathKey(file);
    if (!found.has(key)) found.set(key, file);
  };

  const walk = (directory) => {
    let real;
    try {
      real = fs.realpathSync(directory);
    } catch {
      return;
    }
    const visitKey = process.platform === "win32" ? real.toLowerCase() : real;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        walk(full);
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        add(full);
      }
    }
  };

  for (const raw of roots) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const root = path.resolve(raw);
    let stat;
    try {
      stat = fs.statSync(root);
    } catch {
      continue;
    }
    if (stat.isFile() && isMediaFile(root)) add(root);
    else if (stat.isDirectory()) walk(root);
  }

  return Array.from(found.values()).sort(compareStrings);
}

/**
 * Rank candidate files by keyword/tag overlap.
 *
 * Scoring is intentionally simple and local:
 * - a requested tag in the filename, folder, or file tags: +6;
 * - a multi-word requested tag found as a phrase: +4 extra;
 * - a filename/tag keyword present in the transcript: +3;
 * - a folder keyword present in the transcript: +1.
 *
 * Repeated words count once, so a transcript that says "office" ten times does
 * not dominate the ranking.
 *
 * @param {object} options
 * @param {Array<string|{path?:string,file?:string,src?:string,name?:string,tags?:string|string[]}>} options.files
 *   Paths from `listMediaFiles`, manifest-like objects, or rank results.
 * @param {string|object} [options.transcriptText] Full transcript text, a
 *   transcript object, or segment array.
 * @param {string|string[]} [options.tags] Extra target keywords or tags. A
 *   comma-separated string is accepted.
 * @returns {Array<{path:string,name:string,type:"video"|"image",score:number,matches:string[],src:string|null,tags:string[]}>}
 *   All valid media files, highest score first. Zero scores are included.
 */
export function rankBroll({ files, transcriptText = "", tags = [] } = {}) {
  const entries = indexFiles(files);
  if (!entries.length) return [];

  const text = transcriptTextOf(transcriptText);
  const transcriptTokens = new Set(tokenize(text));
  const tagList = toStringList(tags);
  const tagTokens = new Set(tokenize(tagList.join(" ")));
  const tagPhrases = Array.from(
    new Set(tagList.map(normalizePhrase).filter((phrase) => phrase.includes(" ")))
  ).sort(compareStrings);

  return entries
    .map((entry) => {
      const { score, matches } = scoreEntry(
        entry,
        transcriptTokens,
        tagTokens,
        tagPhrases
      );
      return {
        path: entry.path,
        name: entry.name,
        type: entry.type,
        score,
        matches,
        src: entry.src,
        tags: entry.tags.slice(),
      };
    })
    .sort((a, b) => b.score - a.score || compareStrings(a.path, b.path));
}

/**
 * Suggest plan-compatible b-roll elements using transcript segment timing.
 *
 * Files and transcript segments are matched by keyword. The function picks at
 * most `max` placements, never reuses the same file, and never returns
 * overlapping intervals. It does not read an existing plan, so merge the result
 * into `edit/plan.json` carefully.
 *
 * @param {object} options
 * @param {Array<string|object>} options.files Paths or objects accepted by
 *   `rankBroll`. Pass manifest objects with `tags` and `src` when available.
 * @param {object|Array} options.transcript Transcript object with `segments`,
 *   or a segment array.
 * @param {number} [options.max=3] Maximum number of suggestions.
 * @param {string} [options.baseDir] Project root used to make absolute file
 *   paths relative for plan `src` fields.
 * @param {string} [options.idPrefix="el"] Element id prefix.
 * @param {number} [options.startIndex=1] First numeric id suffix.
 * @param {number} [options.minDuration=2] Skip segments shorter than this.
 * @param {number} [options.maxDuration=6] Cap each suggestion to this length.
 * @returns {Array<{id:string,type:"broll",start:number,end:number,src:string,covers:string,intent:string,description:string}>}
 *   Suggestions sorted by start time, or an empty array when there is no
 *   usable transcript timing or keyword overlap.
 */
export function suggestBrollElements({
  files,
  transcript,
  max = 3,
  baseDir = null,
  idPrefix = "el",
  startIndex = 1,
  minDuration = 2,
  maxDuration = 6,
} = {}) {
  const entries = indexFiles(files);
  const segments = transcriptSegments(transcript);
  const limit = Math.max(0, Math.floor(numberOrDefault(max, 3)));
  if (!entries.length || !segments.length || limit === 0) return [];

  const shortest = Math.max(0.1, numberOrDefault(minDuration, 2));
  const longest = Math.max(shortest, numberOrDefault(maxDuration, 6));
  const prefix = safePrefix(idPrefix);
  const firstIndex = Math.max(0, Math.floor(numberOrDefault(startIndex, 1)));

  const candidates = [];
  for (const segment of segments) {
    const text = String(segment.text || "").replace(/\s+/g, " ").trim();
    const rawStart = Number(segment.start);
    const rawEnd = Number(segment.end);
    if (!text || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    if (rawStart < 0 || rawEnd <= rawStart) continue;
    if (rawEnd - rawStart < shortest) continue;

    const start = roundTime(rawStart);
    const end = roundTime(Math.min(rawEnd, rawStart + longest));
    if (end - start < shortest) continue;

    const tokens = new Set(tokenize(text));
    if (!tokens.size) continue;

    for (const entry of entries) {
      const { score, matches } = scoreSegment(entry, tokens);
      if (score > 0) {
        candidates.push({ entry, start, end, text, score, matches });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.start - b.start ||
      a.end - b.end ||
      compareStrings(a.entry.path, b.entry.path)
  );

  const selected = [];
  const usedFiles = new Set();
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const key = pathKey(candidate.entry.path);
    if (usedFiles.has(key)) continue;
    if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) {
      continue;
    }
    usedFiles.add(key);
    selected.push(candidate);
  }

  selected.sort((a, b) => a.start - b.start || a.end - b.end);

  return selected.map((candidate, index) => ({
    id: `${prefix}-${String(firstIndex + index).padStart(3, "0")}`,
    type: "broll",
    start: candidate.start,
    end: candidate.end,
    src: planSource(candidate.entry, baseDir),
    covers: candidate.text,
    intent: "evidence",
    description: describe(candidate.entry, candidate.text, candidate.matches),
  }));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * @private
 */
function indexFiles(files) {
  const list = Array.isArray(files) ? files : files == null ? [] : [files];
  const seen = new Set();
  const entries = [];

  for (const file of list) {
    const entry = indexFile(file);
    if (!entry) continue;
    const key = pathKey(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  return entries;
}

/**
 * @private
 */
function indexFile(file) {
  let filePath;
  let name;
  let src = null;
  let tags = [];

  if (typeof file === "string") {
    filePath = file;
  } else if (file && typeof file === "object") {
    filePath = [file.path, file.file, file.src].find(
      (value) => typeof value === "string" && value.trim()
    );
    if (!filePath) return null;
    name = typeof file.name === "string" ? file.name : null;
    src = typeof file.src === "string" && file.src.trim() ? file.src : null;
    tags = toStringList(file.tags);
  } else {
    return null;
  }

  filePath = filePath.trim();
  if (!filePath) return null;

  const extension = path.extname(filePath).toLowerCase();
  const type = VIDEO_EXTENSIONS.has(extension)
    ? "video"
    : IMAGE_EXTENSIONS.has(extension)
      ? "image"
      : null;
  if (!type) return null;

  const displayName = name && name.trim() ? name.trim() : path.basename(filePath);
  const stem = path.basename(displayName, path.extname(displayName));
  const nameTokens = new Set(tokenize(stem));
  const folderParts = path
    .dirname(filePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-2);
  const dirTokens = new Set(tokenize(folderParts.join(" ")));
  const tagTokens = new Set(tokenize(tags.join(" ")));

  return {
    path: filePath,
    name: displayName,
    type,
    src,
    tags,
    nameTokens,
    dirTokens,
    tagTokens,
    haystack: normalizePhrase([stem, tags.join(" "), folderParts.join(" ")].join(" ")),
  };
}

/**
 * @private
 */
function scoreEntry(entry, transcriptTokens, tagTokens, tagPhrases) {
  let score = 0;
  const matches = new Set();

  for (const token of tagTokens) {
    if (
      entry.nameTokens.has(token) ||
      entry.tagTokens.has(token) ||
      entry.dirTokens.has(token)
    ) {
      score += 6;
      matches.add(token);
    }
  }

  for (const phrase of tagPhrases) {
    if (phrase && entry.haystack.includes(phrase)) {
      score += 4;
      matches.add(phrase);
    }
  }

  for (const token of entry.nameTokens) {
    if (transcriptTokens.has(token)) {
      score += 3;
      matches.add(token);
    }
  }

  for (const token of entry.tagTokens) {
    if (transcriptTokens.has(token)) {
      score += 3;
      matches.add(token);
    }
  }

  for (const token of entry.dirTokens) {
    if (transcriptTokens.has(token)) {
      score += 1;
      matches.add(token);
    }
  }

  return { score, matches: Array.from(matches).sort(compareStrings) };
}

/**
 * @private
 */
function scoreSegment(entry, segmentTokens) {
  let score = 0;
  const matches = new Set();

  for (const token of entry.nameTokens) {
    if (segmentTokens.has(token)) {
      score += 3;
      matches.add(token);
    }
  }

  for (const token of entry.tagTokens) {
    if (segmentTokens.has(token)) {
      score += 4;
      matches.add(token);
    }
  }

  for (const token of entry.dirTokens) {
    if (segmentTokens.has(token)) {
      score += 1;
      matches.add(token);
    }
  }

  return { score, matches: Array.from(matches).sort(compareStrings) };
}

/**
 * @private
 */
function transcriptSegments(transcript) {
  if (Array.isArray(transcript)) return transcript;
  if (transcript && typeof transcript === "object" && Array.isArray(transcript.segments)) {
    return transcript.segments;
  }
  return [];
}

/**
 * @private
 */
function transcriptTextOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(segmentText).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const parts = [];
    if (typeof value.text === "string") parts.push(value.text);
    if (Array.isArray(value.segments)) {
      parts.push(...value.segments.map(segmentText).filter(Boolean));
    }
    return parts.join(" ");
  }
  return "";
}

/**
 * @private
 */
function segmentText(segment) {
  return segment && typeof segment === "object" ? String(segment.text || "").trim() : "";
}

/**
 * @private
 */
function describe(entry, text, matches) {
  const clean = String(text).replace(/\s+/g, " ").replace(/"/g, "'").trim();
  const snippet = clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}...` : clean;
  const keywords = matches.slice(0, 3).join(", ");
  const suffix = keywords ? ` (matches: ${keywords})` : "";
  return `B-roll ${entry.name} over "${snippet}"${suffix}`;
}

/**
 * @private
 */
function planSource(entry, baseDir) {
  if (entry.src) return toPosix(entry.src);

  if (typeof baseDir === "string" && baseDir.trim()) {
    const base = path.resolve(baseDir);
    const absolute = path.isAbsolute(entry.path)
      ? entry.path
      : path.resolve(base, entry.path);
    const relative = path.relative(base, absolute);
    if (relative) return toPosix(relative);
  }

  return toPosix(entry.path);
}

/**
 * @private
 */
function isMediaFile(file) {
  const extension = path.extname(String(file)).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension);
}

/**
 * @private
 */
function toStringList(value) {
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * @private
 */
function normalizeText(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * @private
 */
function tokenize(value) {
  return normalizeText(value)
    .split(TOKEN_SPLIT)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/**
 * @private
 */
function normalizePhrase(value) {
  return normalizeText(value)
    .replace(TOKEN_SPLIT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @private
 */
function pathKey(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * @private
 */
function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

/**
 * @private
 */
function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @private
 */
function numberOrDefault(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @private
 */
function safePrefix(value) {
  const prefix = String(value || "el")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return prefix || "el";
}

/**
 * @private
 */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
