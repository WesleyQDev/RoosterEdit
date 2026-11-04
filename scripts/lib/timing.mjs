/**
 * Lightweight, dependency-free timing for RoosterEdit.
 *
 * Timers are kept in memory so a command can record stages and write a single
 * report at the end (`work/logs/timings.json`). Set `ROOSTER_TIMING=1` to also
 * print each stage to stderr; stdout stays clean for `--json`.
 *
 * Stages have a stable shape: `{ label, ms, startedAt, status }`.
 */

import fs from "node:fs";
import path from "node:path";

export const TIMINGS_SCHEMA = "rooster.timings/v1";

const stages = [];
let tmpCounter = 0;

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function timingEnabled() {
  const value = process.env.ROOSTER_TIMING;
  return value === "1" || value === "true";
}

function emit(stage, opts) {
  if (opts && opts.silent) return;
  if (typeof opts?.log === "function") {
    opts.log(stage);
    return;
  }
  if (!timingEnabled()) return;
  console.error(`[timing] ${stage.label} ${stage.ms.toFixed(1)}ms ${stage.status}`);
}

/**
 * Start a named timer.
 *
 * The returned object is the stage itself and also has a `stop(status)` method.
 * Calling `stop` twice is safe; the first call wins.
 *
 * @param {string} label
 * @param {{ silent?: boolean, log?: (stage: object) => void }} [opts]
 * @returns {{ label: string, ms: number, startedAt: string, status: string, stop: (status?: string) => object }}
 */
export function startTimer(label, opts = {}) {
  const stage = {
    label: String(label || "stage"),
    ms: 0,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  const started = process.hrtime.bigint();
  let stopped = false;

  const stop = (status = "ok") => {
    if (stopped) return stage;
    stopped = true;
    stage.ms = roundMs(Number(process.hrtime.bigint() - started) / 1e6);
    stage.status = status || "ok";
    emit(stage, opts);
    return stage;
  };

  stage.stop = stop;
  stages.push(stage);
  return stage;
}

/**
 * Time a synchronous function.
 *
 * @template T
 * @param {string} label
 * @param {() => T} fn
 * @param {{ silent?: boolean, log?: (stage: object) => void }} [opts]
 * @returns {T}
 */
export function timeSync(label, fn, opts = {}) {
  if (typeof fn !== "function") throw new TypeError("timeSync: fn must be a function");
  const timer = startTimer(label, opts);
  try {
    const value = fn();
    timer.stop("ok");
    return value;
  } catch (error) {
    timer.stop("error");
    throw error;
  }
}

/**
 * Time an asynchronous function.
 *
 * @template T
 * @param {string} label
 * @param {() => Promise<T>|T} fn
 * @param {{ silent?: boolean, log?: (stage: object) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function timeAsync(label, fn, opts = {}) {
  if (typeof fn !== "function") throw new TypeError("timeAsync: fn must be a function");
  const timer = startTimer(label, opts);
  try {
    const value = await fn();
    timer.stop("ok");
    return value;
  } catch (error) {
    timer.stop("error");
    throw error;
  }
}

/**
 * Build a serializable report of every stage recorded in this process.
 *
 * @returns {{
 *   schema: string,
 *   generatedAt: string,
 *   totalMs: number,
 *   stages: Array<{ label: string, ms: number, startedAt: string, status: string }>
 * }}
 */
export function timingReport() {
  const copy = stages.map((stage) => ({
    label: stage.label,
    ms: stage.ms,
    startedAt: stage.startedAt,
    status: stage.status,
  }));
  const totalMs = roundMs(
    copy.reduce((sum, stage) => sum + (Number.isFinite(stage.ms) ? stage.ms : 0), 0),
  );
  return {
    schema: TIMINGS_SCHEMA,
    generatedAt: new Date().toISOString(),
    totalMs,
    stages: copy,
  };
}

/**
 * Remove all recorded stages. Intended for tests and long-lived processes.
 */
export function resetTimings() {
  stages.length = 0;
}

/**
 * Write a timing report atomically.
 *
 * @param {string} file
 * @param {object} [report] Defaults to `timingReport()`.
 * @returns {string} The written path.
 */
export function writeTimings(file, report = timingReport()) {
  const target = path.resolve(String(file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${++tmpCounter}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
    try {
      fs.renameSync(tmp, target);
    } catch (error) {
      if (error.code === "ENOENT") throw error;
      if (
        process.platform !== "win32" &&
        error.code !== "EPERM" &&
        error.code !== "EEXIST" &&
        error.code !== "ENOTEMPTY" &&
        error.code !== "EACCES" &&
        error.code !== "EBUSY"
      ) {
        throw error;
      }
      fs.rmSync(target, { force: true, maxRetries: 3, retryDelay: 50 });
      fs.renameSync(tmp, target);
    }
    return target;
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing else to do; the original error is more useful.
    }
    throw error;
  }
}
