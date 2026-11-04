/**
 * Cached b-roll library index.
 *
 * The first scan delegates to `listMediaFiles` (the same extensions and skip
 * rules used by the b-roll feature). Later calls only stat the configured
 * roots; when their mtimes match the cached index, the file list is returned
 * without walking the library again.
 *
 * Directory mtimes only change when direct entries are added, removed, or
 * renamed. A file replaced inside a nested folder without touching its parent
 * metadata will not invalidate the cache; pass `refresh: true` for a full scan.
 */

import fs from "node:fs";
import path from "node:path";

import { listMediaFiles } from "../features/broll.mjs";

export const BROLL_INDEX_SCHEMA = "rooster.broll-index/v1";

let tempCounter = 0;

/**
 * Return a b-roll index, reusing the cached JSON when the roots are unchanged.
 *
 * Missing roots and unreadable directories are tolerated by the scanner. A
 * failed index write is reported in `warnings`/`writeError` instead of throwing.
 *
 * @param {{dirs?:string|string[],indexPath:string,refresh?:boolean}} options
 * @returns {object} Index object with `schema`, `roots`, `files`, `createdAt`,
 *   plus `indexPath`, `cached`, `stale`, `warnings`, and optional `writeError`.
 */
export function getBrollIndex({ dirs, indexPath, refresh = false } = {}) {
  if (typeof indexPath !== "string" || !indexPath.trim()) {
    throw new TypeError("getBrollIndex requires indexPath.");
  }

  const target = path.resolve(indexPath);
  const warnings = [];
  const cached = readIndex(target);
  const stale = Boolean(refresh) || indexIsStale(cached, dirs);

  if (!stale && cached) {
    return {
      ...cached,
      indexPath: target,
      cached: true,
      stale: false,
      warnings,
    };
  }

  const files = listMediaFiles(dirs);
  const index = {
    schema: BROLL_INDEX_SCHEMA,
    roots: rootState(dirs),
    files,
    createdAt: new Date().toISOString(),
  };

  let writeError = null;
  try {
    writeJsonAtomic(target, index);
  } catch (error) {
    writeError = error?.message || String(error);
    warnings.push(`Could not write b-roll index at ${target}: ${writeError}`);
  }

  return {
    ...index,
    indexPath: target,
    cached: false,
    stale: true,
    writeError,
    warnings,
  };
}

/**
 * Check whether a cached index no longer matches the configured roots.
 *
 * Order-independent; root paths are compared case-insensitively on Windows.
 *
 * @param {object|null|undefined} index Parsed index object.
 * @param {string|string[]} [dirs] Current roots.
 * @returns {boolean} True when the index is missing, corrupt, from another
 *   schema, or any root was added, removed, or had its mtime changed.
 */
export function indexIsStale(index, dirs) {
  if (!index || typeof index !== "object") return true;
  if (index.schema !== BROLL_INDEX_SCHEMA) return true;
  if (!Array.isArray(index.roots) || !Array.isArray(index.files)) return true;

  const current = rootState(dirs);
  if (current.length !== index.roots.length) return true;

  const currentByPath = new Map(current.map((root) => [pathKey(root.path), root.mtimeMs]));
  for (const root of index.roots) {
    if (!root || typeof root.path !== "string") return true;
    const key = pathKey(root.path);
    if (!currentByPath.has(key)) return true;
    if (!sameMtime(currentByPath.get(key), root.mtimeMs)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function rootState(dirs) {
  const list = Array.isArray(dirs) ? dirs : dirs == null ? [] : [dirs];
  const seen = new Set();
  const roots = [];

  for (const raw of list) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const resolved = path.resolve(raw);
    const key = pathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);

    let mtimeMs = null;
    try {
      const stat = fs.statSync(resolved);
      mtimeMs = Math.round(stat.mtimeMs * 1000) / 1000;
    } catch {
      mtimeMs = null;
    }

    roots.push({ path: resolved, mtimeMs });
  }

  return roots;
}

function sameMtime(a, b) {
  const left = a === null || a === undefined ? null : Number(a);
  const right = b === null || b === undefined ? null : Number(b);
  if (left === null || right === null) return left === right;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.001;
}

function pathKey(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readIndex(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
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
