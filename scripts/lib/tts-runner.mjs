/**
 * TTS generation runner: content-addressed per-line keys, a project sidecar
 * cache, a bounded async pool, and retries with backoff.
 *
 * This module deliberately does not import `cache.mjs` or `exec.mjs`. Callers
 * inject a `run(command)` adapter and may inject `runPool(items, limit, fn)`,
 * which keeps the runner testable and avoids a module-load dependency on the
 * CLI infrastructure. No provider is called on import; generation only happens
 * through the injected runner.
 *
 * `run` receives a command descriptor:
 *   { command: string, args: string[], stdin: string|null, out: string, cwd: string }
 * and resolves to `{ ok, stdout, stderr, status }`. A rejected promise is
 * treated as a failed attempt.
 *
 * Sidecar cache entries are keyed by the project-relative audio path and store
 * the content key, byte size, measured duration, and provider options.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildTtsArgs } from "../features/tts.mjs";

export const TTS_CACHE_SCHEMA = "rooster.tts-cache/v1";

const KEY_SCHEMA = "rooster.tts-key/v1";
const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 250;
const DEFAULT_CONCURRENCY = 3;
const CACHE_DIRECTORY = path.join("edit");
const CACHE_FILENAME = "voiceover.cache.json";

let tempCounter = 0;

// ---------------------------------------------------------------------------
// Keys and sidecar cache
// ---------------------------------------------------------------------------

/**
 * Stable key for one TTS line.
 *
 * The key covers the text and every option that changes the rendered audio.
 * It is local-only (sha256); no file or network access.
 *
 * @param {{provider?:string,voice?:string,rate?:number|string,text?:string,ext?:string}} options
 * @returns {string} 64 lowercase hex characters.
 */
export function ttsLineKey({ provider, voice, rate, text, ext } = {}) {
  const canonical = JSON.stringify({
    schema: KEY_SCHEMA,
    provider: providerName(provider) || "auto",
    voice: normalizeText(voice),
    rate: normalizeRate(rate),
    text: normalizeText(text),
    ext: normalizeExt(ext) || "mp3",
  });

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Default sidecar cache path for a project.
 *
 * @param {string} projectDir Project root.
 * @returns {string} Absolute path to `edit/voiceover.cache.json`.
 */
export function ttsCachePath(projectDir) {
  return path.join(path.resolve(String(projectDir)), CACHE_DIRECTORY, CACHE_FILENAME);
}

/**
 * Read a sidecar cache. Missing or corrupt files return an empty cache so the
 * caller can regenerate safely.
 *
 * @param {string} file Cache path.
 * @returns {{schema:string,updatedAt:string|null,entries:object,corrupt?:boolean,error?:string}}
 */
export function readTtsCache(file) {
  const empty = { schema: TTS_CACHE_SCHEMA, updatedAt: null, entries: {} };

  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return empty;
    return { ...empty, corrupt: true, error: error?.message || String(error) };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.entries ||
      typeof parsed.entries !== "object" ||
      Array.isArray(parsed.entries)
    ) {
      return { ...empty, corrupt: true, error: "Invalid sidecar cache shape." };
    }

    return {
      schema: TTS_CACHE_SCHEMA,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      entries: parsed.entries,
    };
  } catch (error) {
    return { ...empty, corrupt: true, error: error?.message || String(error) };
  }
}

/**
 * Atomically write a sidecar cache.
 *
 * @param {string} file Cache path.
 * @param {{entries?:object}} cache Cache payload.
 * @returns {{schema:string,updatedAt:string,entries:object}} Written payload.
 */
export function writeTtsCache(file, cache) {
  const entries =
    cache?.entries && typeof cache.entries === "object" && !Array.isArray(cache.entries)
      ? cache.entries
      : {};
  const payload = {
    schema: TTS_CACHE_SCHEMA,
    updatedAt: new Date().toISOString(),
    entries,
  };
  writeJsonAtomic(file, payload);
  return payload;
}

// ---------------------------------------------------------------------------
// Job planning
// ---------------------------------------------------------------------------

/**
 * Plan per-line TTS jobs without running a provider.
 *
 * A line is skipped when its audio exists, is non-empty, and the sidecar entry
 * matches the current key (and recorded byte size). `refresh` forces every
 * line with text and an output path into `jobs`.
 *
 * @param {{manifest:object,projectDir:string,refresh?:boolean,cachePath?:string}} options
 * @returns {{jobs:Array<object>,skipped:Array<object>}} Jobs contain
 *   `{ line, out, rel, key, text, ext, config, command, commandError, attempts }`.
 */
export function planTtsJobs({ manifest, projectDir, refresh = false, cachePath = null } = {}) {
  const { jobs, skipped } = collectJobs(manifest, projectDir, refresh, cachePath);
  return { jobs, skipped };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate missing voiceover lines with a bounded pool and per-line caching.
 *
 * Timing (`duration`, `start`, `end`, `manifest.duration`) is updated only when
 * a `probe(out)` callback is provided; otherwise the caller keeps ownership of
 * timing. Cached durations from the sidecar are reused before probing.
 *
 * @param {object} options
 * @param {object} options.manifest `rooster.voiceover/v1` manifest (mutated).
 * @param {string} options.projectDir Project root.
 * @param {string} [options.provider] Provider override.
 * @param {string} [options.voice] Voice override.
 * @param {number|string} [options.rate] Rate override.
 * @param {string} [options.language] Language override.
 * @param {number} [options.concurrency=3] Maximum parallel provider calls.
 * @param {boolean} [options.refresh=false] Ignore cache hits.
 * @param {Function} options.run `run(command) => { ok, stdout, stderr, status }`.
 * @param {Function} [options.runPool] `runPool(items, limit, fn)`.
 * @param {Function} [options.probe] `probe(file) => { duration }`.
 * @param {Function} [options.onProgress] Progress callback.
 * @param {string} [options.cachePath] Sidecar override.
 * @param {number} [options.retryDelay=250] Base retry delay in ms.
 * @returns {Promise<object>} Summary with counts, errors, results, cache path,
 *   and the mutated manifest.
 */
export async function generateVoiceover({
  manifest,
  projectDir,
  provider,
  voice,
  rate,
  language,
  concurrency = DEFAULT_CONCURRENCY,
  refresh = false,
  run,
  runPool,
  probe = null,
  onProgress = null,
  cachePath = null,
  retryDelay = DEFAULT_RETRY_DELAY,
} = {}) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("generateVoiceover requires a voiceover manifest.");
  }
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new TypeError("generateVoiceover requires projectDir.");
  }
  if (typeof run !== "function") {
    throw new TypeError(
      "generateVoiceover requires run(command). Pass an adapter over exec.mjs or a test double."
    );
  }
  if (probe !== null && typeof probe !== "function") {
    throw new TypeError("probe must be a function when provided.");
  }

  const dir = path.resolve(projectDir);
  if (provider !== undefined) manifest.provider = provider;
  if (voice !== undefined) manifest.voice = voice;
  if (rate !== undefined) manifest.rate = rate;
  if (language !== undefined) manifest.language = language;

  const { jobs, skipped, cache, cachePath: cacheFile } = collectJobs(
    manifest,
    dir,
    refresh,
    cachePath
  );
  const lines = Array.isArray(manifest.lines) ? manifest.lines : [];
  const limit = clampConcurrency(concurrency);
  const pool = typeof runPool === "function" ? runPool : poolMap;
  const errors = [];
  const warnings = [];
  let generated = 0;

  jobs.forEach((job, index) => {
    job.index = index + 1;
  });

  for (const item of skipped) {
    notify(onProgress, {
      type: "skip",
      id: lineId(item.line),
      out: item.out,
      key: item.key,
      reason: item.reason,
    });
    if (typeof probe === "function" && item.reason === "cached") {
      const duration = finiteDuration(item.entry?.duration);
      if (duration > 0) applyDuration(item.line, duration);
    }
  }

  const runJob = async (job) => {
    const id = lineId(job.line);
    const base = { index: job.index, total: jobs.length, id, out: job.out, key: job.key };
    notify(onProgress, { type: "start", ...base });

    if (!job.command || !job.command.command) {
      const message =
        job.commandError ||
        `No shell command for provider "${providerName(job.config.provider) || "unknown"}".`;
      errors.push({ id, out: job.out, error: message, attempts: 0 });
      notify(onProgress, { type: "error", ...base, error: message });
      return { ok: false, job, attempts: 0, error: message };
    }

    try {
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
    } catch (error) {
      const message = `Could not create the audio directory for ${job.out}: ${error?.message || error}`;
      errors.push({ id, out: job.out, error: message, attempts: 0 });
      notify(onProgress, { type: "error", ...base, error: message });
      return { ok: false, job, attempts: 0, error: message };
    }

    let attempt = 0;
    let last = null;

    while (attempt <= MAX_RETRIES) {
      attempt += 1;
      let result;
      try {
        result = await run(job.command);
      } catch (error) {
        result = {
          ok: false,
          error: error?.message || String(error),
          transient: error?.transient,
        };
      }

      const bytes = fileSize(job.out);
      if (isOk(result) && bytes > 0) {
        let duration = null;
        if (typeof probe === "function") {
          duration = await probeDuration(probe, job.out);
          applyDuration(job.line, duration);
        }

        cache.entries[job.rel] = {
          key: job.key,
          file: job.rel,
          bytes,
          mtimeMs: fileMtime(job.out),
          duration,
          provider: providerName(job.config.provider) || null,
          voice: normalizeText(job.config.voice) || null,
          rate: normalizeRate(job.config.rate),
          ext: job.ext,
          chars: job.text.length,
          generatedAt: new Date().toISOString(),
          attempts: attempt,
        };
        generated += 1;
        notify(onProgress, {
          type: "ok",
          ...base,
          attempts: attempt,
          duration,
          bytes,
        });
        return { ok: true, job, attempts: attempt, duration, bytes };
      }

      last = result;
      const message = errorOf(result);

      if (attempt > MAX_RETRIES || !isTransient(result)) {
        errors.push({ id, out: job.out, error: message, attempts: attempt });
        notify(onProgress, {
          type: "error",
          ...base,
          attempts: attempt,
          error: message,
        });
        return { ok: false, job, attempts: attempt, error: message };
      }

      notify(onProgress, {
        type: "retry",
        ...base,
        attempts: attempt,
        error: message,
      });
      await delay(retryDelay * 2 ** (attempt - 1));
    }

    // Defensive: the loop always returns above.
    const message = errorOf(last);
    errors.push({ id, out: job.out, error: message, attempts: attempt });
    return { ok: false, job, attempts: attempt, error: message };
  };

  const results = jobs.length > 0 ? await pool(jobs, limit, runJob) : [];

  if (typeof probe === "function") {
    for (const item of skipped) {
      if (item.reason !== "cached") continue;
      if (finiteDuration(item.line.duration) > 0) continue;
      const duration = await probeDuration(probe, item.out);
      if (duration > 0) {
        applyDuration(item.line, duration);
        if (item.entry) item.entry.duration = duration;
      }
    }
  }

  let cacheWriteError = null;
  try {
    writeTtsCache(cacheFile, cache);
  } catch (error) {
    cacheWriteError = error?.message || String(error);
    warnings.push(`Could not write TTS cache at ${cacheFile}: ${cacheWriteError}`);
  }

  if (typeof probe === "function") applyTimings(manifest);
  updateManifestStatus(manifest, {
    generated,
    failed: errors.length,
    jobs: jobs.length,
    lines: lines.length,
  });

  return {
    ok: errors.length === 0,
    total: lines.length,
    jobs: jobs.length,
    generated,
    skipped: skipped.length,
    failed: errors.length,
    cachePath: cacheFile,
    cacheWriteError,
    warnings,
    errors,
    results,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function collectJobs(manifest, projectDir, refresh, cachePath) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("A voiceover manifest is required.");
  }
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new TypeError("projectDir is required.");
  }

  const dir = path.resolve(projectDir);
  const cacheFile = cachePath ? path.resolve(String(cachePath)) : ttsCachePath(dir);
  const cache = readTtsCache(cacheFile);
  const lines = Array.isArray(manifest.lines) ? manifest.lines : [];
  const config = {
    provider: manifest.provider ?? null,
    voice: manifest.voice ?? null,
    rate: manifest.rate ?? null,
    language: manifest.language ?? null,
  };
  const jobs = [];
  const skipped = [];

  for (const line of lines) {
    if (!line || typeof line !== "object") continue;

    const text = normalizeText(line.text);
    const out = outputPath(line, dir);
    const ext = normalizeExt(line.ext || manifest.ext || (out ? path.extname(out) : "")) || "mp3";

    if (!out) {
      skipped.push({ line, out: null, rel: null, key: null, text, ext, config, reason: "no-output" });
      continue;
    }
    if (!text) {
      skipped.push({ line, out, rel: relativeKey(dir, out), key: null, text, ext, config, reason: "empty-text" });
      continue;
    }

    const key = ttsLineKey({ ...config, text, ext });
    const rel = relativeKey(dir, out);
    const entry = cache.entries[rel] || null;
    const bytes = fileSize(out);
    const cached =
      !refresh &&
      entry &&
      entry.key === key &&
      bytes > 0 &&
      (entry.bytes === undefined || entry.bytes === null || Number(entry.bytes) === bytes);

    if (cached) {
      skipped.push({ line, out, rel, key, text, ext, config, entry, reason: "cached" });
      continue;
    }

    const { command, commandError } = buildCommand({ line, config, out, dir });
    jobs.push({
      line,
      out,
      rel,
      key,
      text,
      ext,
      config,
      command,
      commandError,
      attempts: 0,
    });
  }

  return { jobs, skipped, cache, cachePath: cacheFile };
}

function buildCommand({ line, config, out, dir }) {
  const existing = line.command;
  const canReuse = existing && existing.command && commandMatches(existing, config);

  if (canReuse) {
    return { command: commandWithOutput(existing, out, dir), commandError: null };
  }

  if (!config.provider) {
    if (existing && existing.command) {
      return { command: commandWithOutput(existing, out, dir), commandError: null };
    }
    return {
      command: null,
      commandError:
        "No TTS provider configured. Set manifest.provider or pass provider to generateVoiceover.",
    };
  }

  try {
    const descriptor = buildTtsArgs({
      provider: config.provider,
      text: line.text,
      voice: config.voice,
      out,
      rate: config.rate,
      language: config.language,
    });

    if (!descriptor.command) {
      return {
        command: null,
        commandError:
          `Provider "${providerName(config.provider)}" is an API provider and has no shell command. ` +
          "Use its SDK/REST API only after explicit user permission.",
      };
    }

    return {
      command: {
        ...descriptor,
        out,
        cwd: dir,
      },
      commandError: null,
    };
  } catch (error) {
    return { command: null, commandError: error?.message || String(error) };
  }
}

function commandMatches(command, config) {
  if (!command || typeof command !== "object") return false;
  if (providerName(command.provider) !== providerName(config.provider)) return false;
  if (normalizeText(command.voice) !== normalizeText(config.voice)) return false;
  if (normalizeRate(command.rate) !== normalizeRate(config.rate)) return false;
  return true;
}

function commandWithOutput(command, out, dir) {
  const previous = command.output ?? command.out ?? null;
  const args = Array.isArray(command.args)
    ? command.args.map((arg) =>
        previous !== null && typeof arg === "string" && arg === String(previous) ? out : arg
      )
    : [];

  return {
    ...command,
    args,
    out,
    output: out,
    cwd: dir,
  };
}

function outputPath(line, projectDir) {
  const raw = [line.audio, line.out, line.file, line.path].find(
    (value) => typeof value === "string" && value.trim()
  );
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectDir, raw);
}

function relativeKey(projectDir, file) {
  const relative = path.relative(projectDir, file);
  const outside =
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return outside ? toPosix(file) : toPosix(relative);
}

function applyDuration(line, duration) {
  const measured = finiteDuration(duration);
  line.duration = measured > 0 ? roundTime(measured) : null;
  line.measured = measured > 0;
  line.timing = measured > 0 ? "measured" : "unmeasured";
}

function applyTimings(manifest) {
  const lines = Array.isArray(manifest.lines) ? manifest.lines : [];
  let cursor = 0;
  let measured = 0;

  for (const line of lines) {
    const duration = finiteDuration(line.duration);
    line.start = roundTime(cursor);
    line.end = roundTime(cursor + duration);
    if (duration > 0) measured += 1;
    cursor += duration;
  }

  manifest.duration = roundTime(cursor);
  if (manifest.totals && typeof manifest.totals === "object") {
    manifest.totals.duration = manifest.duration;
    manifest.totals.measured = lines.length > 0 && measured === lines.length;
  }
  manifest.timing = {
    ...(manifest.timing && typeof manifest.timing === "object" ? manifest.timing : {}),
    status: lines.length > 0 && measured === lines.length ? "measured" : "partial",
    method: "ffprobe",
  };
}

function updateManifestStatus(manifest, { generated, failed, jobs, lines }) {
  manifest.generatedAt = new Date().toISOString();
  if (lines === 0) return;
  if (generated > 0) {
    manifest.status = failed > 0 ? "partial" : "generated";
  } else if (jobs > 0 && failed > 0) {
    manifest.status = "failed";
  } else if (jobs === 0) {
    manifest.status = "generated";
  }
}

async function probeDuration(probe, file) {
  try {
    const info = await probe(file);
    return finiteDuration(info?.duration);
  } catch {
    return 0;
  }
}

function notify(callback, event) {
  if (typeof callback !== "function") return;
  try {
    callback(event);
  } catch {
    // Progress reporting must never break generation.
  }
}

function errorOf(result) {
  if (!result || typeof result !== "object") return "TTS command returned no result.";

  const raw =
    result.error ||
    result.stderr ||
    result.stdout ||
    (result.status !== undefined && result.status !== null
      ? `TTS command exited with status ${result.status}.`
      : "TTS command failed.");

  if (raw && typeof raw === "object" && raw.message) return String(raw.message).trim();
  return String(raw).replace(/\s+/g, " ").trim().slice(0, 2000) || "TTS command failed.";
}

function isOk(result) {
  if (!result || typeof result !== "object") return false;
  if (result.ok === true) return true;
  if (result.ok === false) return false;
  return result.status === 0;
}

function isTransient(result) {
  if (!result || typeof result !== "object") return true;
  if (result.transient === false) return false;

  const code = result.code || result.error?.code;
  if (code === "ENOENT") return false;

  const message = String(result.error?.message || result.error || "");
  return !/\bENOENT\b/.test(message);
}

function clampConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.floor(number));
}

/** Deterministic async pool; preserves result order. */
async function poolMap(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), list.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= list.length) return;
        results[index] = await fn(list[index], index);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

function delay(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, value));
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function fileMtime(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs * 1000) / 1000;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${(tempCounter++).toString(36)}`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try {
      fs.renameSync(temp, file);
    } catch {
      // Windows does not replace an existing file with renameSync.
      try {
        fs.unlinkSync(file);
      } catch {
        // The target may not exist.
      }
      fs.renameSync(temp, file);
    }
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

function providerName(value) {
  if (value && typeof value === "object") {
    return normalizeName(value.id || value.provider || "custom") || "custom";
  }
  return normalizeName(value);
}

function normalizeRate(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim() || null;
}

function normalizeExt(value) {
  return String(value ?? "")
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function finiteDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundTime(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function lineId(line) {
  return String(line?.id || line?.lineId || (line?.audio ? path.basename(line.audio) : "line"));
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}
