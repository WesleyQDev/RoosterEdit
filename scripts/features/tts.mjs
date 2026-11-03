/**
 * TTS / voiceover planning helpers.
 *
 * These helpers only plan and build command descriptors. They never execute a
 * provider, write files, or make network calls. Generation requires explicit
 * user permission, and timings must be measured after the audio exists.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PROVIDERS_SCHEMA = "rooster.tts-providers/v1";
const COMMAND_SCHEMA = "rooster.tts-command/v1";
const VOICEOVER_SCHEMA = "rooster.voiceover/v1";

const PROVIDER_ENV = Object.freeze({
  openai: ["OPENAI_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
});

const EDGE_ALIASES = new Set(["edge", "edge-tts", "edgetts", "edge_tts"]);
const HYPERFRAMES_ALIASES = new Set(["hyperframes", "hyper-frames", "hf"]);
const API_PROVIDER_IDS = new Set(["openai", "elevenlabs", "gemini"]);

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_RE = /^\s*(?:[-*+\u2022]|\d+[.)])\s+/;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function slugify(value) {
  return (
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "line"
  );
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function countWords(text) {
  const value = String(text || "").trim();
  return value ? value.split(/\s+/u).length : 0;
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function uniqueId(base, used, fallback = "line") {
  const original = String(base || fallback).trim() || fallback;
  let id = original;
  let suffix = 2;
  while (used.has(id)) id = `${original}-${suffix++}`;
  used.add(id);
  return id;
}

function quoteArg(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function quoteCmdArg(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatCommand(command, args, stdin) {
  if (!command) {
    return stdin ? `stdin <<< ${JSON.stringify(stdin)}` : "";
  }
  const line = [command, ...args].map(quoteArg).join(" ");
  return stdin ? `${line} <<< ${JSON.stringify(stdin)}` : line;
}

function normalizeRate(rate) {
  if (rate === undefined || rate === null || rate === "") return null;

  if (typeof rate === "number") {
    if (!Number.isFinite(rate)) {
      throw new TypeError("rate must be a finite number or a percentage string");
    }
    return `${rate >= 0 ? "+" : ""}${round(rate)}%`;
  }

  const text = String(rate).trim();
  if (!text) return null;

  const multiplier = /^([0-9]*\.?[0-9]+)x$/i.exec(text);
  if (multiplier) {
    const percent = (Number(multiplier[1]) - 1) * 100;
    return `${percent >= 0 ? "+" : ""}${round(percent)}%`;
  }

  const percentMatch = /^([+-]?\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    return `${percent >= 0 ? "+" : ""}${round(percent)}%`;
  }

  throw new RangeError(
    `Invalid rate "${rate}". Use a percentage such as "+10%" or a multiplier such as "1.1x".`
  );
}

// ---------------------------------------------------------------------------
// Script splitting
// ---------------------------------------------------------------------------

/**
 * Remove Markdown syntax that should not be read aloud. Images are dropped,
 * links keep their label, emphasis markers are removed, and whitespace is
 * collapsed.
 */
function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/**
 * Pull an all-caps speaker label out of a line so TTS does not read it.
 * Structured input can also set `speaker` explicitly.
 */
function splitSpeaker(text) {
  const match = /^([A-Z\u00c0-\u00dd][A-Z\u00c0-\u00dd0-9 _.-]{1,30}):\s+(.+)$/u.exec(
    String(text || "").trim()
  );
  if (!match) return { text: String(text || "").trim(), speaker: null };
  return { text: match[2].trim(), speaker: match[1].trim() };
}

function shouldJoin(previous, current) {
  const prev = String(previous || "").trim();
  const cur = String(current || "").trim();
  if (!prev || !cur) return false;
  if (/[:;,\-\u2013\u2014]$/.test(prev)) return true;
  if (!/[.!?\u2026]["')\]]?$/.test(prev)) return true;
  if (/^[a-z\u00e0-\u00ff0-9]/u.test(cur)) return true;
  return false;
}

function splitByWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [String(text)];
}

function splitLongText(text, maxChars) {
  const value = String(text || "").trim();
  if (!value) return [];
  if (!maxChars || value.length <= maxChars) return [value];

  const sentences =
    value.match(/[^.!?\u2026]+[.!?\u2026]+["')\]]*|[^.!?\u2026]+$/g) || [value];
  const chunks = [];
  let current = "";

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (!current) {
      current = sentence;
    } else if ((current + " " + sentence).length <= maxChars) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap((chunk) =>
    chunk.length <= maxChars ? [chunk] : splitByWords(chunk, maxChars)
  );
}

function sceneIdFromTitle(title) {
  const cleaned = stripMarkdown(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ");
  return slugify(cleaned) || "scene";
}

function parseMarkdownScript(input, options) {
  const maxChars =
    Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
      ? Number(options.maxChars)
      : 280;
  const text = String(input)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split("\n");
  const entries = [];
  const usedSceneIds = new Set();

  let scene = { id: "script", title: "Script" };
  let lineNumber = 0;
  let block = [];
  let blockStart = 0;
  let inFence = false;

  const flush = () => {
    if (!block.length) return;
    const raw = block.join(" ");
    block = [];
    const cleaned = stripMarkdown(raw).replace(/\s+/g, " ").trim();
    if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return;

    const { text: speakable, speaker } = splitSpeaker(cleaned);
    if (!speakable) return;

    lineNumber += 1;
    const parts = splitLongText(speakable, maxChars);
    parts.forEach((part, index) => {
      entries.push({
        id:
          index === 0
            ? null
            : `${scene.id}-l${lineNumber}-p${index + 1}`,
        sceneId: scene.id,
        sceneTitle: scene.title,
        line: lineNumber,
        part: index + 1,
        speaker,
        sourceLine: blockStart,
        text: part,
      });
    });
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (FENCE_RE.test(line)) {
      if (!inFence) flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!trimmed) {
      flush();
      continue;
    }
    if (HR_RE.test(trimmed)) {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flush();
      let title = heading[2].replace(/\s+#+\s*$/, "").trim();
      let requestedId = null;
      const explicitId = /\s*\{#([^}]+)\}\s*$/.exec(title);
      if (explicitId) {
        requestedId = explicitId[1].trim();
        title = title.slice(0, explicitId.index).trim();
      }
      title = stripMarkdown(title) || "Scene";
      scene = {
        id: uniqueId(requestedId || sceneIdFromTitle(title), usedSceneIds, "scene"),
        title,
      };
      lineNumber = 0;
      continue;
    }

    let content = trimmed.replace(/^(?:>\s?)+/, "").trim();
    const isBullet = BULLET_RE.test(content);
    if (isBullet) {
      flush();
      content = content.replace(BULLET_RE, "").trim();
    }
    if (!content) continue;

    const startsSpeaker =
      /^[A-Z\u00c0-\u00dd][A-Z\u00c0-\u00dd0-9 _.-]{1,30}:\s+\S/u.test(content);
    if (startsSpeaker) flush();

    if (!block.length) {
      blockStart = index + 1;
      block.push(content);
      continue;
    }

    const previous = block[block.length - 1];
    if (shouldJoin(previous, content)) {
      block.push(content);
    } else {
      flush();
      blockStart = index + 1;
      block.push(content);
    }
  }

  flush();
  return entries;
}

function structuredEntries(input) {
  const root = Array.isArray(input)
    ? input
    : input && Array.isArray(input.scenes)
      ? input.scenes
      : input && Array.isArray(input.lines)
        ? input.lines
        : [input];
  const entries = [];
  const lineCounts = new Map();

  const push = (sceneId, sceneTitle, rawLine) => {
    const line = rawLine && typeof rawLine === "object" ? rawLine : { text: rawLine };
    const id = line.id || line.lineId || null;
    const explicitLine = Number(line.line);
    const lineNumber = Number.isFinite(explicitLine)
      ? Math.max(1, Math.trunc(explicitLine))
      : (lineCounts.get(sceneId) || 0) + 1;
    lineCounts.set(sceneId, Math.max(lineCounts.get(sceneId) || 0, lineNumber));

    entries.push({
      id: id ? String(id) : null,
      sceneId: String(line.sceneId || sceneId),
      sceneTitle: String(line.sceneTitle || sceneTitle),
      line: lineNumber,
      part: Number.isFinite(Number(line.part)) && Number(line.part) > 0
        ? Math.trunc(Number(line.part))
        : 1,
      speaker: line.speaker ? String(line.speaker) : null,
      sourceLine: Number.isFinite(Number(line.sourceLine))
        ? Number(line.sourceLine)
        : null,
      text: line.text ?? line.line ?? line.content ?? line.script ?? "",
    });
  };

  const hasSceneObjects = root.some(
    (item) => item && typeof item === "object" && Array.isArray(item.lines)
  );

  if (hasSceneObjects) {
    root.forEach((scene, index) => {
      if (typeof scene === "string") {
        push("script", "Script", { text: scene });
        return;
      }
      if (!scene || typeof scene !== "object") return;

      const title = scene.title || scene.sceneTitle || scene.name || `Scene ${index + 1}`;
      const sceneId = scene.sceneId || scene.id || sceneIdFromTitle(title);
      for (const line of scene.lines || []) {
        if (typeof line === "string") {
          push(sceneId, title, { text: line });
        } else {
          push(line.sceneId || sceneId, line.sceneTitle || title, line);
        }
      }
    });
  } else {
    root.forEach((line) => {
      if (typeof line === "string") {
        push("script", "Script", { text: line });
      } else if (line && typeof line === "object") {
        const sceneId = line.sceneId || input.sceneId || "script";
        const sceneTitle = line.sceneTitle || line.title || input.title || "Script";
        push(sceneId, sceneTitle, line);
      }
    });
  }

  return entries;
}

function parseStructuredScript(input, options) {
  const maxChars =
    Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
      ? Number(options.maxChars)
      : 280;
  const entries = [];

  for (const entry of structuredEntries(input)) {
    const cleaned = stripMarkdown(entry.text).replace(/\s+/g, " ").trim();
    if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) continue;

    const { text: speakable, speaker } = splitSpeaker(cleaned);
    if (!speakable) continue;

    const basePart = Number(entry.part) || 1;
    const parts = splitLongText(speakable, maxChars);
    parts.forEach((part, index) => {
      const partNumber = basePart + index;
      entries.push({
        id:
          entry.id && index > 0
            ? `${entry.id}-p${partNumber}`
            : entry.id,
        sceneId: entry.sceneId,
        sceneTitle: entry.sceneTitle,
        line: entry.line,
        part: partNumber,
        speaker: entry.speaker || speaker,
        sourceLine: entry.sourceLine,
        text: part,
      });
    });
  }

  return entries;
}

function finalizeEntries(entries) {
  const usedIds = new Set();
  return entries.map((entry, index) => {
    const sceneId = String(entry.sceneId || "script");
    const line = Number.isFinite(Number(entry.line)) && Number(entry.line) > 0
      ? Math.trunc(Number(entry.line))
      : index + 1;
    const part = Number.isFinite(Number(entry.part)) && Number(entry.part) > 0
      ? Math.trunc(Number(entry.part))
      : 1;
    const base =
      entry.id ||
      `${sceneId}-l${line}${part > 1 ? `-p${part}` : ""}`;
    const id = uniqueId(base, usedIds, "line");

    return {
      id,
      lineId: id,
      sceneId,
      sceneTitle: String(entry.sceneTitle || sceneId),
      line,
      part,
      speaker: entry.speaker || null,
      index,
      text: entry.text,
      chars: String(entry.text).length,
      words: countWords(entry.text),
      sourceLine: entry.sourceLine ?? null,
    };
  });
}

/**
 * Split a script into speakable blocks.
 *
 * A plain Markdown string is parsed by headings, blank lines, bullets, and soft
 * wraps. Scene ids come from headings (`## Hook {#hook}` keeps `hook`); line ids
 * are generated as `<scene>-l<n>`. A structured array/object with `scenes` or
 * `lines` is also accepted, and explicit `id`/`sceneId`/`line` values are kept.
 *
 * @param {string|object|Array<object|string>} input Script text or structured lines.
 * @param {{maxChars?: number}} [options] Split blocks longer than this. Default 280.
 * @returns {Array<{id:string,lineId:string,sceneId:string,sceneTitle:string,line:number,part:number,speaker:string|null,index:number,text:string,chars:number,words:number,sourceLine:number|null}>}
 */
export function splitScript(input, options = {}) {
  if (input === null || input === undefined) return [];
  const entries =
    typeof input === "string"
      ? parseMarkdownScript(input, options)
      : parseStructuredScript(input, options);
  return finalizeEntries(entries);
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function probeCli(command, args, { cwd, timeout }) {
  const isWindowsCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const spawnCommand = isWindowsCmd ? process.env.ComSpec || "cmd.exe" : command;
  const spawnArgs = isWindowsCmd
    ? ["/d", "/s", "/c", [command, ...args].map(quoteCmdArg).join(" ")]
    : args;

  let result;
  try {
    result = spawnSync(spawnCommand, spawnArgs, {
      cwd,
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    return {
      found: false,
      version: null,
      error: String(error?.message || error),
    };
  }

  const code = result.error?.code;
  if (result.error && ["ENOENT", "EACCES", "ENOTDIR"].includes(code)) {
    return {
      found: false,
      version: null,
      error: result.error.message || String(result.error),
    };
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const shellMiss =
    /(?:is not recognized|command not found|n[aã]o [eé] reconhecido|no se reconoce)/i.test(
      output
    );
  if (shellMiss || (isWindowsCmd && result.status !== 0 && !result.error)) {
    return {
      found: false,
      version: null,
      error: output || null,
    };
  }

  const version =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;

  return {
    found: true,
    version,
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function probeAny(command, argSets, options) {
  for (const args of argSets) {
    const result = probeCli(command, args, options);
    if (result.found) return result;
  }
  return { found: false, version: null, error: null };
}

function findHyperFrames(cwd) {
  const packagePath = path.join(cwd, "node_modules", "hyperframes", "package.json");
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version || null;
  } catch {
    // Not installed locally.
  }

  const names =
    process.platform === "win32"
      ? ["hyperframes.cmd", "hyperframes.exe", "hyperframes"]
      : ["hyperframes"];
  const bin = names
    .map((name) => path.join(cwd, "node_modules", ".bin", name))
    .find((candidate) => fs.existsSync(candidate));

  if (!bin && !version) return null;
  return { bin: bin || null, version };
}

function envAvailable(keys) {
  return keys.some((key) => Boolean(process.env[key]));
}

function providerIdOf(provider) {
  if (provider && typeof provider === "object") {
    return String(provider.id || provider.provider || "custom").trim() || "custom";
  }
  return provider ? String(provider).trim() || "edge-tts" : "edge-tts";
}

/**
 * Detect local TTS CLIs and environment-based providers without network calls.
 * The function may run `--version`/`--help` probes for installed CLIs; it never
 * synthesizes audio and never calls an API.
 *
 * @param {{cwd?: string, timeout?: number, probe?: boolean, preferred?: string}} [options]
 * @returns {object} Provider list, availability, command templates, and a default provider.
 */
export function detectTtsProviders(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const timeout = Number.isFinite(Number(options.timeout)) && Number(options.timeout) > 0
    ? Number(options.timeout)
    : 2500;
  const shouldProbe = options.probe !== false;

  const edge = shouldProbe
    ? probeCli("edge-tts", ["--version"], { cwd, timeout })
    : { found: false, version: null };

  const localHyperFrames = findHyperFrames(cwd);
  let hyperFrames = {
    found: Boolean(localHyperFrames),
    version: localHyperFrames?.version || null,
  };
  if (!hyperFrames.found && shouldProbe) {
    const candidates =
      process.platform === "win32"
        ? ["hyperframes", "hyperframes.cmd"]
        : ["hyperframes"];
    for (const candidate of candidates) {
      const result = probeCli(candidate, ["--version"], { cwd, timeout });
      if (result.found) {
        hyperFrames = result;
        break;
      }
    }
  }

  const piper = shouldProbe
    ? probeAny("piper", [["--version"], ["--help"]], { cwd, timeout })
    : { found: false, version: null };

  const providers = [
    {
      id: "hyperframes",
      label: "HyperFrames TTS",
      kind: "cli",
      available: Boolean(hyperFrames.found),
      version: hyperFrames.version || null,
      command: "npx",
      args: [
        "--no-install",
        "hyperframes",
        "tts",
        "--text",
        "{text}",
        "--voice",
        "{voice}",
        "--rate",
        "{rate}",
        "--out",
        "{out}",
      ],
      stdin: null,
      requiresNetwork: false,
      envKeys: [],
      permissionRequired: true,
      note: "Local Kokoro TTS when available. Verify flags with `npx --no-install hyperframes tts --help`; they can change between releases.",
    },
    {
      id: "edge-tts",
      label: "Edge TTS",
      kind: "cli",
      available: Boolean(edge.found),
      version: edge.version || null,
      command: "edge-tts",
      args: [
        "--text",
        "{text}",
        "--voice",
        "{voice}",
        "--rate",
        "{rate}",
        "--write-media",
        "{out}",
      ],
      stdin: null,
      requiresNetwork: true,
      envKeys: [],
      permissionRequired: true,
      note: "Free Microsoft Edge voices. The CLI needs a network connection for synthesis.",
    },
    {
      id: "piper",
      label: "Piper",
      kind: "cli",
      available: Boolean(piper.found),
      version: piper.version || null,
      command: "piper",
      args: ["--model", "{model}", "--output_file", "{out}"],
      stdin: "{text}",
      requiresNetwork: false,
      envKeys: [],
      permissionRequired: true,
      note: "Local Piper voice. Pass `model` to buildTtsArgs; the text is sent on stdin.",
    },
    {
      id: "openai",
      label: "OpenAI TTS",
      kind: "api",
      available: envAvailable(PROVIDER_ENV.openai),
      version: null,
      command: null,
      args: [],
      stdin: null,
      requiresNetwork: true,
      envKeys: [...PROVIDER_ENV.openai],
      permissionRequired: true,
      note: "API provider. Availability is based only on environment keys; no request is made here.",
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      kind: "api",
      available: envAvailable(PROVIDER_ENV.elevenlabs),
      version: null,
      command: null,
      args: [],
      stdin: null,
      requiresNetwork: true,
      envKeys: [...PROVIDER_ENV.elevenlabs],
      permissionRequired: true,
      note: "API provider. Availability is based only on environment keys; no request is made here.",
    },
    {
      id: "gemini",
      label: "Gemini TTS",
      kind: "api",
      available: envAvailable(PROVIDER_ENV.gemini),
      version: null,
      command: null,
      args: [],
      stdin: null,
      requiresNetwork: true,
      envKeys: [...PROVIDER_ENV.gemini],
      permissionRequired: true,
      note: "API provider. Availability is based only on environment keys; no request is made here.",
    },
  ];

  const available = providers.filter((provider) => provider.available).map((provider) => provider.id);
  const byId = Object.fromEntries(providers.map((provider) => [provider.id, provider]));
  const preferred = options.preferred || process.env.ROOSTER_TTS_PROVIDER || null;
  let defaultProvider = null;

  if (preferred) {
    const key = String(preferred).toLowerCase();
    const match = providers.find(
      (provider) => provider.available && provider.id.toLowerCase() === key
    );
    if (match) defaultProvider = match.id;
  }
  if (!defaultProvider) {
    defaultProvider =
      ["hyperframes", "edge-tts", "piper", "openai", "elevenlabs", "gemini"].find((id) =>
        available.includes(id)
      ) || null;
  }

  return {
    schema: PROVIDERS_SCHEMA,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    cwd,
    networkCalls: false,
    permissionRequired: true,
    preferred: preferred ? String(preferred) : null,
    defaultProvider,
    available,
    providers,
    byId,
  };
}

// ---------------------------------------------------------------------------
// Command building
// ---------------------------------------------------------------------------

function fillTemplate(value, values) {
  return String(value).replace(
    /\{(text|voice|out|rate|language|model)\}/g,
    (_, key) => values[key] ?? ""
  );
}

/**
 * Build a command descriptor for a TTS provider. Nothing is executed.
 *
 * `edge-tts` and `hyperframes` get provider-specific argument layouts. Any other
 * provider can pass a command template:
 *
 * `provider: { id: "my-tts", command: "my-tts", args: ["--text", "{text}", "--out", "{out}"] }`
 *
 * A plain unknown string is treated as an executable name with conventional
 * `--text/--voice/--out` flags, and a warning is included in `notes`. Known API
 * ids (`openai`, `elevenlabs`, `gemini`) return `command: null` instead, because
 * they are not shell tools.
 *
 * @param {{provider?: string|object, text: string, voice?: string, out: string, rate?: number|string, command?: string, args?: string[], stdin?: string, language?: string, model?: string}} options
 * @returns {object} A command/args descriptor with `executed: false`.
 */
export function buildTtsArgs({
  provider = "edge-tts",
  text,
  voice,
  out,
  rate,
  command,
  args,
  stdin,
  language,
  model,
} = {}) {
  const sourceText = String(text ?? "").trim();
  if (!sourceText) throw new TypeError("buildTtsArgs requires non-empty text");

  const output = String(out ?? "").trim();
  if (!output) throw new TypeError("buildTtsArgs requires an output path (out)");

  const rateArg = normalizeRate(rate);
  const providerObject = provider && typeof provider === "object" ? provider : null;
  const providerId = providerIdOf(provider);
  const key = providerId.toLowerCase();
  const notes = [];
  const values = {
    text: sourceText,
    voice: voice ? String(voice) : "",
    out: output,
    rate: rateArg || "",
    language: language ? String(language) : "",
    model: model ? String(model) : "",
  };

  let commandName;
  let commandArgs;
  let stdinText = null;
  let generic = false;
  const providerIsApi =
    (providerObject &&
      (providerObject.kind === "api" || providerObject.command === null)) ||
    (!providerObject && API_PROVIDER_IDS.has(key));
  const template =
    [providerObject?.args, providerObject?.argsTemplate, args].find(
      (value) => Array.isArray(value) && value.length > 0
    ) || null;
  const hasTemplate = Boolean(template);

  if (!providerObject && EDGE_ALIASES.has(key)) {
    if (!values.voice) {
      throw new TypeError("buildTtsArgs requires a voice for edge-tts");
    }
    commandName = command || "edge-tts";
    commandArgs = ["--text", sourceText, "--voice", values.voice];
    if (rateArg) commandArgs.push("--rate", rateArg);
    commandArgs.push("--write-media", output);
  } else if (!providerObject && HYPERFRAMES_ALIASES.has(key)) {
    commandName = command || "npx";
    commandArgs = ["--no-install", "hyperframes", "tts", "--text", sourceText];
    if (values.voice) commandArgs.push("--voice", values.voice);
    if (rateArg) commandArgs.push("--rate", rateArg);
    commandArgs.push("--out", output);
    notes.push(
      "Verify HyperFrames TTS flags with `npx --no-install hyperframes tts --help`; flags can change between releases."
    );
  } else if (
    providerIsApi &&
    !command &&
    !Array.isArray(args) &&
    !hasTemplate
  ) {
    generic = true;
    commandName = null;
    commandArgs = [];
    notes.push(
      `${providerId} is an API provider; no shell command is built. Use its SDK or REST API only after explicit user permission.`
    );
  } else {
    generic = true;
    commandName = command || providerObject?.command || providerId;

    if (template) {
      commandArgs = [];
      for (const entry of template) {
        const rawArg = String(entry);
        const filled = fillTemplate(rawArg, values);
        const optionalPlaceholder =
          /^\{(?:rate|voice|model|language)\}$/.test(rawArg.trim()) &&
          filled === "";
        if (optionalPlaceholder) {
          if (
            commandArgs.length &&
            /^[-/]/.test(String(commandArgs[commandArgs.length - 1]))
          ) {
            commandArgs.pop();
          }
          continue;
        }
        commandArgs.push(filled);
      }
      const stdinTemplate = providerObject?.stdin || stdin;
      stdinText = stdinTemplate ? fillTemplate(stdinTemplate, values) : null;
    } else {
      commandArgs = ["--text", sourceText];
      if (values.voice) commandArgs.push("--voice", values.voice);
      if (rateArg) commandArgs.push("--rate", rateArg);
      commandArgs.push("--out", output);
      notes.push(
        `Generic provider "${providerId}": these flags are a convention, not a provider contract. Verify them before running.`
      );
    }
  }

  return {
    schema: COMMAND_SCHEMA,
    provider: providerId,
    command: commandName,
    args: commandArgs,
    stdin: stdinText,
    output,
    voice: values.voice || null,
    rate: rateArg,
    generic,
    display: formatCommand(commandName, commandArgs, stdinText),
    executed: false,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Voiceover manifest
// ---------------------------------------------------------------------------

function uniqueFileId(base, used) {
  const original = base || "line";
  let id = original;
  let suffix = 2;
  while (used.has(id)) id = `${original}-${suffix++}`;
  used.add(id);
  return id;
}

/**
 * Build a voiceover manifest with deterministic audio paths and empty timing
 * placeholders. It does not create directories or audio files.
 *
 * @param {{lines?: string|Array<object|string>, outDir?: string, ext?: string, provider?: string|object, voice?: string, rate?: number|string, language?: string}} [options]
 * @returns {object} `rooster.voiceover/v1` manifest with null start/end/duration values.
 */
export function buildVoiceoverPlan({
  lines,
  outDir = "assets/generated/voice",
  ext = "mp3",
  provider = null,
  voice = null,
  rate = null,
  language = null,
} = {}) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : typeof lines === "string"
      ? splitScript(lines)
      : Array.isArray(lines?.lines)
        ? lines.lines
        : [];
  const directory = String(outDir || "assets/generated/voice");
  const extension =
    String(ext || "mp3")
      .replace(/^\./, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase() || "mp3";
  const usedFiles = new Set();
  const usedIds = new Set();
  const manifestLines = [];
  const providerName = provider ? providerIdOf(provider) : null;
  let totalWords = 0;
  let totalChars = 0;

  for (let index = 0; index < sourceLines.length; index++) {
    const raw = sourceLines[index];
    const rawText =
      raw && typeof raw === "object"
        ? raw.text ?? raw.line ?? raw.content ?? raw.script ?? ""
        : raw;
    const cleaned = stripMarkdown(rawText).replace(/\s+/g, " ").trim();
    if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) continue;

    const { text, speaker } = splitSpeaker(cleaned);
    if (!text) continue;

    const sceneId = String(raw?.sceneId || "script");
    const lineNumber =
      raw && Number.isFinite(Number(raw.line)) && Number(raw.line) > 0
        ? Math.trunc(Number(raw.line))
        : index + 1;
    const part =
      raw && Number.isFinite(Number(raw.part)) && Number(raw.part) > 0
        ? Math.trunc(Number(raw.part))
        : 1;
    const baseId = uniqueId(
      String(
        raw?.id ||
          raw?.lineId ||
          `${sceneId}-l${lineNumber}${part > 1 ? `-p${part}` : ""}`
      ),
      usedIds,
      "line"
    );
    const fileId = uniqueFileId(slugify(baseId), usedFiles);
    const audioPath = toPosix(path.join(directory, `${fileId}.${extension}`));
    const words = countWords(text);

    totalWords += words;
    totalChars += text.length;

    let command = null;
    if (providerName) {
      try {
        command = buildTtsArgs({
          provider,
          text,
          voice,
          out: audioPath,
          rate,
          language,
        });
      } catch {
        command = null;
      }
    }

    manifestLines.push({
      id: baseId,
      lineId: baseId,
      sceneId,
      sceneTitle: raw?.sceneTitle ? String(raw.sceneTitle) : null,
      line: lineNumber,
      part,
      speaker: raw?.speaker || speaker || null,
      index: manifestLines.length,
      text,
      chars: text.length,
      words,
      audio: audioPath,
      ext: extension,
      start: null,
      end: null,
      duration: null,
      measured: false,
      timing: "unmeasured",
      command,
    });
  }

  return {
    schema: VOICEOVER_SCHEMA,
    createdAt: new Date().toISOString(),
    status: manifestLines.length ? "planned" : "empty",
    outDir: toPosix(directory),
    ext: extension,
    provider: providerName,
    voice: voice ? String(voice) : null,
    rate: rate ?? null,
    language: language ? String(language) : null,
    lines: manifestLines,
    totals: {
      lines: manifestLines.length,
      words: totalWords,
      chars: totalChars,
      duration: null,
      measured: false,
    },
    timing: {
      status: "unmeasured",
      method: "ffprobe",
      note: "Generate the audio first, then measure each file and fill start, end, duration, and totals.duration.",
    },
    notes: [
      "TTS generation requires explicit user permission before running any provider command.",
      "start, end, duration, and totals.duration are placeholders until the generated audio is measured.",
    ],
  };
}
