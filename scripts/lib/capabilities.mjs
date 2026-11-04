/**
 * Capability detection for `doctor`.
 *
 * Probes run in parallel and never install anything. No `npx --yes` is used:
 * HyperFrames is resolved from disk by `engines.mjs`. Results can be cached by
 * an injected cache with a 6 hour TTL.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findHyperFrames, hyperFramesVersion } from "./engines.mjs";
import { findFilmCraft, filmCraftMcpRegistration, parseFilmCraftVersion } from "./filmcraft.mjs";

export const capabilityCacheTtlMs = 6 * 60 * 60 * 1000;

const CAPABILITIES_CACHE_KEY = "capabilities";
const CAPABILITIES_CACHE_SCHEMA = "rooster.capabilities/v2";
const DOCTOR_SCHEMA = "rooster.doctor/v1";
const SHALLOW_PARAKEET_REASON = "not checked (run doctor --deep)";
const WHISPER_CANDIDATES = [
  "whisper",
  "whisper-cli",
  "whisper-cpp",
  "faster-whisper",
  "mlx-whisper",
];
const TTS_KEYS = ["openai", "elevenlabs", "gemini", "edgeTts", "piper"];

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function toText(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function cliVersion() {
  const pkg = readJsonSafe(path.join(CLI_ROOT, "package.json"));
  return pkg && typeof pkg.version === "string" ? pkg.version : null;
}

function describeCache(cache, workspace, env) {
  const explicit = cache && (cache.dir || cache.root);
  let dir = null;
  if (explicit) {
    dir = path.resolve(String(explicit));
  } else if (env.ROOSTER_CACHE_DIR) {
    dir = path.resolve(String(env.ROOSTER_CACHE_DIR));
  } else if (workspace) {
    dir = path.join(workspace, "cache");
  }
  return {
    enabled: Boolean(cache),
    dir,
    hit: false,
    ageMs: null,
    error: null,
  };
}

function parseCacheEntry(entry) {
  if (typeof entry === "string") {
    try {
      return JSON.parse(entry);
    } catch {
      return null;
    }
  }
  return entry && typeof entry === "object" ? entry : null;
}

function isCacheEntryWarm(entry, { now, deep }) {
  const value = entry;
  if (!value || typeof value !== "object") return false;
  if (value.schema !== CAPABILITIES_CACHE_SCHEMA) return false;
  const savedAt = Number(value.savedAt);
  if (!Number.isFinite(savedAt)) return false;
  if (savedAt > now + 60_000) return false;
  if (now - savedAt > capabilityCacheTtlMs) return false;
  if (!value.data || typeof value.data !== "object") return false;
  if (deep && value.data.parakeet?.reason === SHALLOW_PARAKEET_REASON) return false;
  return true;
}

async function cacheRead(cache, key) {
  if (!cache) return { value: null, error: null };
  const fn = cache.read || cache.get || cache.load;
  if (typeof fn !== "function") return { value: null, error: "cache has no read method" };
  try {
    return { value: await fn.call(cache, key), error: null };
  } catch (error) {
    return { value: null, error: String(error?.message || error) };
  }
}

async function cacheWrite(cache, key, value) {
  if (!cache) return { ok: false, error: null };
  const fn = cache.write || cache.set || cache.save;
  if (typeof fn !== "function") return { ok: false, error: "cache has no write method" };
  try {
    await fn.call(cache, key, value);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * First non-empty, trimmed line of a version banner.
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function parseVersionOutput(text) {
  if (text == null) return null;
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Parse `hyperframes models list --json` into a Parakeet status.
 *
 * @param {string|object|null|undefined} json
 * @returns {{ installed: boolean, model: string|null, reason: string|null }}
 */
export function parseParakeetModels(json) {
  const unavailable = {
    installed: false,
    model: null,
    reason: "model list unavailable",
  };

  let data = json;
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) return unavailable;
    try {
      data = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return unavailable;
      try {
        data = JSON.parse(text.slice(start, end + 1));
      } catch {
        return unavailable;
      }
    }
  }

  if (!data || typeof data !== "object") return unavailable;
  const models = Array.isArray(data.models)
    ? data.models
    : Array.isArray(data)
      ? data
      : null;
  if (!models) return unavailable;

  const row = models.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (
      String(item.engine || "").toLowerCase().includes("parakeet") ||
      String(item.model || "").toLowerCase().includes("parakeet")
    );
  });
  if (!row) return { installed: false, model: null, reason: "parakeet not reported" };

  const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : null;
  if (row.installed) return { installed: true, model, reason: null };
  if (row.unsupported) return { installed: false, model, reason: String(row.unsupported) };
  if (row.reason) return { installed: false, model, reason: String(row.reason) };
  return {
    installed: false,
    model,
    reason: 'not installed (run "hyperframes models install parakeet")',
  };
}

function commandName(name) {
  if (process.platform !== "win32") return name;
  if (name === "npm" || name === "npx") return `${name}.cmd`;
  return name;
}

function quoteCmd(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

/**
 * Minimal async runner used when the caller does not inject `runAsync`.
 * The CLI normally passes `scripts/lib/exec.mjs`; this keeps the module
 * usable on its own without importing it.
 */
function defaultRunAsync(name, args = [], options = {}) {
  const timeout = Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 15000;
  const executable = commandName(String(name));
  let target = executable;
  let spawnArgs = args.map(String);

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    target = process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", [executable, ...spawnArgs].map(quoteCmd).join(" ")];
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timer = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ...result,
      });
    };

    const child = spawn(target, spawnArgs, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Process already gone.
      }
      finish({ ok: false, status: null, error: "timeout" });
    }, timeout);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 20 * 1024 * 1024) stdout += toText(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 20 * 1024 * 1024) stderr += toText(chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, status: null, error: String(error.message || error) });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, status: code, error: null });
    });
  });
}

function normalizeResult(result) {
  if (result == null) return { ok: false, stdout: "", stderr: "", error: null };
  if (typeof result === "string") {
    return { ok: Boolean(result.trim()), stdout: result, stderr: "", error: null };
  }
  const stdout = toText(result.stdout);
  const stderr = toText(result.stderr);
  let ok;
  if (typeof result.ok === "boolean") ok = result.ok;
  else if (typeof result.code === "number") ok = result.code === 0;
  else if (typeof result.status === "number") ok = result.status === 0;
  else ok = Boolean(stdout.trim() || stderr.trim());
  return {
    ok,
    stdout,
    stderr,
    error: result.error ? String(result.error) : null,
  };
}

async function runProbe(runAsync, name, args, { timeout, cwd }) {
  try {
    return normalizeResult(await runAsync(name, args, { timeout, cwd }));
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: String(error?.message || error),
    };
  }
}

function versionFrom(result) {
  if (!result || !result.ok) return null;
  return parseVersionOutput(result.stdout || result.stderr);
}

function envSummary(env) {
  return {
    roosterWorkspace: Boolean(env.ROOSTER_WORKSPACE),
    roosterHome: Boolean(env.ROOSTER_HOME),
    roosterProfile: env.ROOSTER_PROFILE || null,
    roosterEngine: env.ROOSTER_ENGINE || null,
  };
}

function localEngines(cwd) {
  const pkg = readJsonSafe(path.join(cwd, "package.json"));
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const has = (name) =>
    Boolean(deps[name]) || fs.existsSync(path.join(cwd, "node_modules", name));
  return {
    packageJson: Boolean(pkg),
    hyperframes:
      has("hyperframes") || fs.existsSync(path.join(cwd, "node_modules", ".bin", "hyperframes"))
        ? "detected"
        : "not-detected",
    remotion: has("remotion") ? "detected" : "not-detected",
    three: has("three") ? "detected" : "not-detected",
    remotionThree: has("@remotion/three") ? "detected" : "not-detected",
  };
}

function engineInvocation(bin, args) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) {
    return { name: process.execPath, args: [bin, ...args] };
  }
  return { name: bin, args };
}

async function probeParakeet({ hyperframes, runAsync, timeout, cwd, deep }) {
  if (!deep) {
    return { installed: false, model: null, reason: SHALLOW_PARAKEET_REASON };
  }
  if (!hyperframes.bin) {
    return { installed: false, model: null, reason: "hyperframes not found" };
  }

  const invocation = engineInvocation(hyperframes.bin, ["models", "list", "--json"]);
  const result = await runProbe(runAsync, invocation.name, invocation.args, {
    timeout: Math.max(timeout, 30000),
    cwd,
  });
  const text = result.stdout || result.stderr;
  if (!String(text || "").trim()) {
    return {
      installed: false,
      model: null,
      reason: result.error || "model list unavailable",
    };
  }

  const parsed = parseParakeetModels(text);
  if (!result.ok && !parsed.installed && parsed.reason === "model list unavailable") {
    return {
      ...parsed,
      reason: result.error || parseVersionOutput(result.stderr) || "model list unavailable",
    };
  }
  return parsed;
}

/**
 * Collect capabilities for `doctor`. Probes run concurrently; nothing is
 * installed or fetched. The returned object is backward compatible with
 * `rooster.doctor/v1` and adds `parakeet`, `hyperframes`, and `cache`.
 *
 * @param {{
 *   workspace?: string,
 *   cwd?: string,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   deep?: boolean,
 *   refresh?: boolean,
 *   runAsync?: (name: string, args?: string[], options?: object) => Promise<object>,
 *   cache?: { read?: Function, write?: Function, get?: Function, set?: Function, dir?: string },
 *   timeout?: number,
 *   now?: number,
 * }} [options]
 */
export async function detectCapabilities(options = {}) {
  options = options || {};
  const env = options.env || process.env;
  const cwd = path.resolve(options.cwd || process.cwd());
  const workspace = path.resolve(
    options.workspace || env.ROOSTER_WORKSPACE || path.join(cwd, "rooster")
  );
  const home = path.resolve(
    options.home || env.ROOSTER_HOME || path.join(os.homedir(), ".rooster")
  );
  const deep = Boolean(options.deep);
  const refresh = Boolean(options.refresh);
  const timeout =
    Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 15000;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const runAsync = typeof options.runAsync === "function" ? options.runAsync : defaultRunAsync;
  const cache = options.cache || null;
  const cacheInfo = describeCache(cache, workspace, env);
  let cacheReadError = null;

  if (cache && !refresh) {
    const read = await cacheRead(cache, CAPABILITIES_CACHE_KEY);
    cacheReadError = read.error;
    const entry = parseCacheEntry(read.value);
    if (isCacheEntryWarm(entry, { now, deep })) {
      const cached = entry;
      return {
        ...cached.data,
        schema: DOCTOR_SCHEMA,
        cwd,
        workspace,
        workspaceExists: fs.existsSync(workspace),
        roosterHome: home,
        env: envSummary(env),
        cache: {
          ...cacheInfo,
          hit: true,
          ageMs: Math.max(0, now - Number(cached.savedAt)),
          error: read.error || null,
        },
      };
    }
  }

  const tasks = [];
  const addTask = (key, command, args) => {
    tasks.push({ key, promise: runProbe(runAsync, command, args, { timeout, cwd }) });
  };

  addTask("npm", "npm", ["--version"]);
  addTask("python", "python", ["--version"]);
  addTask("python3", "python3", ["--version"]);
  addTask("git", "git", ["--version"]);
  addTask("ffmpeg", "ffmpeg", ["-version"]);
  addTask("ffprobe", "ffprobe", ["-version"]);
  addTask("ytdlp", "yt-dlp", ["--version"]);
  addTask("gpu", "nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
  addTask("edgeTts", "edge-tts", ["--version"]);
  addTask("piper", "piper", ["--version"]);
  for (const candidate of WHISPER_CANDIDATES) {
    addTask(`whisper:${candidate}`, candidate, ["--help"]);
  }
  const fasterWhisperCode =
    "import faster_whisper; print(getattr(faster_whisper, '__version__', 'detected'))";
  addTask("faster-whisper:python", "python", ["-c", fasterWhisperCode]);
  addTask("faster-whisper:python3", "python3", ["-c", fasterWhisperCode]);

  // FilmCraft is optional: the CLI may be installed without the desktop app
  // (macOS ships them separately) and vice versa. The version probe only runs
  // when a CLI is found.
  const systemHome = os.homedir();
  const filmcraft = findFilmCraft({
    env,
    platform: process.platform,
    home: systemHome,
    cwd,
  });
  if (filmcraft.cli) addTask("filmcraft", filmcraft.cli, ["--version"]);

  const found = findHyperFrames({ workspace, cwd, home, env });
  const hyperframes = {
    bin: found ? found.bin : null,
    version: found ? hyperFramesVersion(found.pkgPath) : null,
    source: found ? found.source : null,
  };

  // Start the deep model probe alongside the command probes.
  const parakeetPromise = probeParakeet({
    hyperframes,
    runAsync,
    timeout,
    cwd,
    deep,
  });

  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const results = new Map();
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") results.set(tasks[index].key, outcome.value);
  });

  const python = versionFrom(results.get("python")) ? results.get("python") : results.get("python3");
  const pythonVersion = versionFrom(python);

  let whisper = null;
  for (const candidate of WHISPER_CANDIDATES) {
    const result = results.get(`whisper:${candidate}`);
    if (result && (result.ok || result.stdout.trim() || result.stderr.trim())) {
      whisper = candidate;
      break;
    }
  }
  if (
    !whisper &&
    (results.get("faster-whisper:python")?.ok || results.get("faster-whisper:python3")?.ok)
  ) {
    whisper = "faster-whisper (python)";
  }

  const engines = localEngines(cwd);
  if (hyperframes.bin && engines.hyperframes === "not-detected") {
    engines.hyperframes =
      hyperframes.source === "npx-cache" ? "npx-cache" : "detected";
  }

  const parakeet = await parakeetPromise;

  const data = {
    schema: DOCTOR_SCHEMA,
    version: cliVersion(),
    os: process.platform,
    arch: process.arch,
    cwd,
    workspace,
    workspaceExists: fs.existsSync(workspace),
    roosterHome: home,
    node: process.version.replace(/^v/, ""),
    npm: versionFrom(results.get("npm")),
    python: pythonVersion,
    git: versionFrom(results.get("git")),
    ffmpeg: versionFrom(results.get("ffmpeg")),
    ffprobe: versionFrom(results.get("ffprobe")),
    ytdlp: versionFrom(results.get("ytdlp")),
    whisper,
    hyperframesCli: hyperframes.version || (hyperframes.bin ? "detected" : null),
    gpu: versionFrom(results.get("gpu")),
    engines,
    tts: {
      openai: Boolean(env.OPENAI_API_KEY),
      elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
      gemini: Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
      edgeTts: Boolean(versionFrom(results.get("edgeTts"))),
      piper: Boolean(versionFrom(results.get("piper"))),
    },
    browser: env.ROOSTER_BROWSER || "unknown",
    subagents: "unknown",
    env: envSummary(env),
    parakeet,
    hyperframes,
    filmcraft: {
      installed: Boolean(filmcraft.cli),
      cli: filmcraft.cli,
      app: filmcraft.app,
      source: filmcraft.source,
      version: (() => {
        const probe = results.get("filmcraft");
        if (!probe) return null;
        return parseFilmCraftVersion(probe.stdout || probe.stderr) || null;
      })(),
      mcp: filmCraftMcpRegistration({
        cwd,
        home: systemHome,
        env,
        platform: process.platform,
      }),
    },
    cache: {
      ...cacheInfo,
      hit: false,
      ageMs: null,
      error: cacheReadError || null,
    },
  };

  if (cache) {
    const entry = {
      schema: CAPABILITIES_CACHE_SCHEMA,
      savedAt: now,
      data: {
        ...data,
        cache: { ...data.cache, hit: false, ageMs: null, error: null },
      },
    };
    const write = await cacheWrite(cache, CAPABILITIES_CACHE_KEY, entry);
    if (write.error) data.cache.error = write.error;
    else if (cacheReadError) data.cache.error = cacheReadError;
  }

  return data;
}

function checklist(value) {
  return value ? "yes" : "no";
}

/**
 * Stable text or JSON rendering. Never emits ANSI escapes.
 *
 * @param {object} caps
 * @param {{ json?: boolean }} [options]
 * @returns {string}
 */
export function formatDoctor(caps, options = {}) {
  const data = caps && typeof caps === "object" ? caps : {};
  if (options.json) return JSON.stringify(data, null, 2);

  const engines = data.engines && typeof data.engines === "object" ? data.engines : {};
  const tts = data.tts && typeof data.tts === "object" ? data.tts : {};
  const cache = data.cache && typeof data.cache === "object" ? data.cache : {};
  const parakeet = data.parakeet && typeof data.parakeet === "object" ? data.parakeet : {};
  const hyperframes =
    data.hyperframes && typeof data.hyperframes === "object" ? data.hyperframes : {};
  const lines = [];

  lines.push("RoosterEdit doctor", "");
  lines.push(`  OS               ${data.os || "unknown"} ${data.arch || ""}`.trimEnd());
  lines.push(`  Node             ${data.node || "unknown"}`);
  lines.push(`  npm              ${data.npm || "not found"}`);
  lines.push(`  Python           ${data.python || "not found"}`);
  lines.push(`  Git              ${data.git || "not found"}`);
  lines.push(`  FFmpeg           ${data.ffmpeg || "not found"}`);
  lines.push(`  FFprobe          ${data.ffprobe || "not found"}`);
  lines.push(`  yt-dlp           ${data.ytdlp || "not found"}`);
  lines.push(`  Whisper          ${data.whisper || "not found"}`);
  lines.push(`  HyperFrames CLI  ${data.hyperframesCli || "not found"}`);
  lines.push(`  GPU              ${data.gpu || "not detected"}`);
  lines.push(
    `  Workspace        ${data.workspace ? `${data.workspace}${data.workspaceExists ? "" : " (not created)"}` : "unknown"}`
  );
  lines.push(`  Browser          ${data.browser || "unknown"}`);
  lines.push(`  Subagents        ${data.subagents || "unknown"}`);

  lines.push("", "Engines", "");
  lines.push(`  package.json     ${checklist(engines.packageJson)}`);
  lines.push(`  HyperFrames      ${engines.hyperframes || "not-detected"}`);
  lines.push(`  Remotion         ${engines.remotion || "not-detected"}`);
  lines.push(`  Three.js         ${engines.three || "not-detected"}`);
  lines.push(`  @remotion/three  ${engines.remotionThree || "not-detected"}`);
  lines.push(`  HyperFrames bin  ${hyperframes.bin || "not found"}`);
  lines.push(`  HyperFrames src  ${hyperframes.source || "unknown"}`);

  const filmcraft = data.filmcraft && typeof data.filmcraft === "object" ? data.filmcraft : {};
  lines.push("", "FilmCraft (optional timeline)", "");
  if (filmcraft.installed) {
    lines.push(`  CLI              ${filmcraft.cli || "found"}${filmcraft.version ? ` (${filmcraft.version})` : ""}`);
    if (filmcraft.app) lines.push(`  App              ${filmcraft.app}`);
    lines.push(`  Source           ${filmcraft.source || "unknown"}`);
    const mcp = filmcraft.mcp && typeof filmcraft.mcp === "object" ? filmcraft.mcp : {};
    if (mcp.registered === true) {
      lines.push(`  MCP              configured (${mcp.client || "client"}${mcp.path ? `: ${mcp.path}` : ""})`);
      lines.push("  Restart          restart the agent after connecting MCP");
    } else if (mcp.registered === false) {
      lines.push("  MCP              not configured (run: filmcraft setup)");
    } else {
      lines.push("  MCP              no client config found");
    }
  } else {
    lines.push("  Status           not installed");
    lines.push("  Timeline         HyperFrames/Remotion only");
  }

  lines.push("", "ASR", "");
  if (parakeet.installed) {
    lines.push(`  Parakeet         installed${parakeet.model ? ` (${parakeet.model})` : ""}`);
  } else {
    lines.push(`  Parakeet         ${parakeet.reason || "not installed"}`);
  }
  lines.push(`  Whisper          ${data.whisper || "not found"}`);

  lines.push("", "TTS", "");
  const ttsKeys = [
    ...TTS_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(tts, key)),
    ...Object.keys(tts).filter((key) => !TTS_KEYS.includes(key)).sort(),
  ];
  for (const key of ttsKeys) {
    lines.push(`  ${key.padEnd(16)} ${checklist(tts[key])}`);
  }

  lines.push("", "Cache", "");
  lines.push(`  Cache            ${cache.enabled ? "enabled" : "disabled"}`);
  if (cache.dir) lines.push(`  Dir              ${cache.dir}`);
  lines.push(`  Hit              ${checklist(cache.hit)}`);
  if (cache.ageMs != null) lines.push(`  Age              ${Math.round(Number(cache.ageMs) / 1000)}s`);
  if (cache.error) lines.push(`  Error            ${cache.error}`);

  const missing = [];
  if (!data.ffmpeg) missing.push("FFmpeg");
  if (!data.ffprobe) missing.push("FFprobe");
  if (!data.node) missing.push("Node");
  if (!data.ytdlp) missing.push("yt-dlp (only needed for video links)");
  if (missing.length) {
    lines.push("", `Missing: ${missing.join(", ")}`);
    lines.push("Read references/harness.md for the fallback path.");
  }

  return lines.join("\n");
}
