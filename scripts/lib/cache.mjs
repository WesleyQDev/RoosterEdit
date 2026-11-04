/**
 * Content-addressed cache for RoosterEdit.
 *
 * Artifacts live under `ROOSTER_CACHE_DIR` when set, otherwise under
 * `<workspace>/cache`. Keys are derived from content and tool versions by the
 * caller; this module only stores and validates the result.
 *
 * Safety rules:
 * - writes are atomic (`.tmp-<pid>` then rename);
 * - an empty or invalid artifact is never cached;
 * - GC and clear only touch paths inside the cache root;
 * - symlinks are removed as links, never followed.
 *
 * The module is synchronous on purpose: `produce` must write the artifact
 * before returning. Use `runAsync`/`runPool` to prepare expensive inputs and
 * then call `withCache` with a synchronous writer.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CACHE_SCHEMA = "rooster.cache/v1";
export const CACHE_KEY_LENGTH = 32;

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const META_SUFFIX = ".meta.json";

let tmpCounter = 0;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function resolveRoot(workspaceOrOptions) {
  if (isObject(workspaceOrOptions)) {
    const dir = workspaceOrOptions.cacheDir || workspaceOrOptions.cache;
    if (typeof dir === "string" && dir.trim()) return path.resolve(dir);
    return cacheRoot(workspaceOrOptions.workspace);
  }
  return cacheRoot(workspaceOrOptions);
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`cache path escapes the cache root: ${target}`);
  }
}

function normalizeKind(kind) {
  if (typeof kind !== "string" || !kind.trim()) {
    throw new TypeError("cache kind must be a non-empty string");
  }
  const raw = kind.trim().replace(/\\/g, "/");
  if (path.posix.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error(`cache kind must be relative: ${kind}`);
  }
  const segments = raw.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length) throw new Error(`cache kind is empty: ${kind}`);
  for (const segment of segments) {
    if (segment === ".." || segment.includes("\0") || /[:*?"<>|]/.test(segment)) {
      throw new Error(`cache kind contains an unsafe segment: ${kind}`);
    }
  }
  return segments;
}

function kindLabel(segments) {
  return segments.join("/");
}

function normalizeKey(key) {
  const raw = String(key ?? "");
  if (!raw || raw === "." || raw === "..") {
    throw new TypeError("cache key must be a non-empty file name");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new Error(`cache key contains unsafe characters: ${raw}`);
  }
  return raw;
}

function normalizeExt(ext) {
  if (ext === undefined || ext === null || ext === "") return "";
  const raw = String(ext);
  if (raw.includes("\0") || /[\\/]/.test(raw) || raw === "." || raw === "..") {
    throw new Error(`cache extension is unsafe: ${raw}`);
  }
  if (raw.startsWith(".")) return raw;
  return `.${raw}`;
}

function safeLstat(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function replaceFile(source, target) {
  try {
    fs.renameSync(source, target);
    return;
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
  }
  fs.rmSync(target, { force: true, maxRetries: 3, retryDelay: 50 });
  fs.renameSync(source, target);
}

function removeFile(file) {
  try {
    fs.rmSync(file, { force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // A cache cleanup must never break the command that asked for it.
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${++tmpCounter}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    replaceFile(tmp, file);
  } catch (error) {
    removeFile(tmp);
    throw error;
  }
}

function readMeta(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function touchMeta(file) {
  const now = new Date();
  try {
    fs.utimesSync(file, now, now);
  } catch {
    // Touching for LRU is best effort.
  }
}

function validateArtifact(file, validate) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size <= 0) return false;
  if (!validate) return true;
  try {
    return validate(file) !== false;
  } catch {
    return false;
  }
}

function isValidEntry(file, validate, expected) {
  if (!validateArtifact(file, validate)) return false;
  const meta = readMeta(`${file}${META_SUFFIX}`);
  if (!meta || meta.schema !== CACHE_SCHEMA) return false;
  if (expected && meta.key !== expected.key) return false;
  if (expected && meta.kind !== expected.kind) return false;
  return true;
}

function walkFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  let rootStat;
  try {
    // Follow a symlinked cache root (users may point ROOSTER_CACHE_DIR at a
    // junction), but never follow symlinked directories inside the cache.
    rootStat = fs.statSync(root);
  } catch {
    return out;
  }
  if (!rootStat.isDirectory()) return out;

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Do not follow directory symlinks or NTFS junctions inside the cache.
        const stat = safeLstat(full);
        if (stat?.isDirectory() && !stat.isSymbolicLink()) stack.push(full);
        else out.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function measureTree(target) {
  const stat = safeLstat(target);
  if (!stat) return { files: 0, bytes: 0 };
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { files: 1, bytes: stat.size };
  }
  let files = 0;
  let bytes = 0;
  for (const file of walkFiles(target)) {
    files += 1;
    bytes += safeLstat(file)?.size || 0;
  }
  return { files, bytes };
}

function removeTree(target) {
  const stat = safeLstat(target);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    return;
  }
  fs.rmSync(target, { force: true, maxRetries: 3, retryDelay: 50 });
}

function pruneEmptyDirs(dir, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name), root);
  }
  if (path.resolve(dir) === path.resolve(root)) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Race with another process; leaving an empty folder is harmless.
  }
}

function buildUnits(files) {
  const byPath = new Map();
  for (const file of files) {
    const stat = safeLstat(file);
    if (!stat) continue;
    byPath.set(path.resolve(file), {
      files: [path.resolve(file)],
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      deleted: false,
    });
  }

  const units = [];
  const consumed = new Set();
  for (const [file, unit] of byPath) {
    if (consumed.has(file)) continue;

    const artifact = file.endsWith(META_SUFFIX)
      ? file.slice(0, -META_SUFFIX.length)
      : file;
    const meta = file.endsWith(META_SUFFIX)
      ? file
      : `${file}${META_SUFFIX}`;

    const artifactUnit = byPath.get(artifact);
    const metaUnit = byPath.get(meta);
    if (artifactUnit && metaUnit && !consumed.has(artifact) && !consumed.has(meta)) {
      consumed.add(artifact);
      consumed.add(meta);
      units.push({
        files: [artifact, meta],
        bytes: artifactUnit.bytes + metaUnit.bytes,
        mtimeMs: Math.max(artifactUnit.mtimeMs, metaUnit.mtimeMs),
        deleted: false,
      });
      continue;
    }

    consumed.add(file);
    units.push(unit);
  }
  return units;
}

/**
 * Resolve the cache directory for a workspace.
 *
 * `ROOSTER_CACHE_DIR` has priority so tests and power users can redirect the
 * cache without moving the project. A workspace argument should be passed by
 * callers; when it is missing we fall back to `ROOSTER_WORKSPACE` or the
 * current directory.
 *
 * @param {string} [workspace]
 * @returns {string} Absolute cache directory.
 */
export function cacheRoot(workspace) {
  const envDir = process.env.ROOSTER_CACHE_DIR;
  if (envDir && envDir.trim()) return path.resolve(envDir.trim());
  const base = workspace || process.env.ROOSTER_WORKSPACE || process.cwd();
  return path.join(path.resolve(base), "cache");
}

/**
 * Stable JSON with recursively sorted object keys.
 *
 * `undefined` is omitted from objects and becomes `null` inside arrays, which
 * matches JSON semantics and keeps optional fields from changing the hash.
 * Non-finite numbers become `null`, BigInt becomes a decimal string, and Date
 * values use their `toJSON` representation.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  const normalize = (input) => {
    if (input === null) return null;
    const type = typeof input;
    if (type === "string" || type === "boolean") return input;
    if (type === "number") return Number.isFinite(input) ? input : null;
    if (type === "bigint") return input.toString();
    if (type === "undefined" || type === "function" || type === "symbol") return undefined;
    if (Array.isArray(input)) {
      return input.map((item) => {
        const normalized = normalize(item);
        return normalized === undefined ? null : normalized;
      });
    }
    if (input instanceof Date) return input.toJSON();
    if (type === "object") {
      if (typeof input.toJSON === "function") return normalize(input.toJSON());
      const out = {};
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize(input[key]);
        if (normalized !== undefined) out[key] = normalized;
      }
      return out;
    }
    return undefined;
  };

  const normalized = normalize(value);
  return JSON.stringify(normalized === undefined ? null : normalized);
}

/**
 * Hash a list of parts into a short, stable cache key.
 *
 * Objects are serialized with `canonicalJson`; parts are separated by NUL so
 * `["ab"]` and `["a", "b"]` do not collide.
 *
 * @param {unknown[]|unknown} parts
 * @returns {string} 32 hex characters.
 */
export function cacheKey(parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  const hash = crypto.createHash("sha256");
  for (const part of list) {
    if (part === undefined) {
      hash.update("undefined:");
    } else if (isObject(part)) {
      hash.update("json:");
      hash.update(canonicalJson(part));
    } else if (typeof part === "string") {
      hash.update("string:");
      hash.update(part);
    } else {
      hash.update(`${typeof part}:`);
      hash.update(String(part));
    }
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, CACHE_KEY_LENGTH);
}

/**
 * Cheap invalidation fingerprint for a file.
 *
 * @param {string} file
 * @returns {{ size: number, mtimeMs: number, path: string }}
 */
export function statFingerprint(file) {
  const resolved = path.resolve(String(file));
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new Error(`statFingerprint: cannot stat ${resolved}: ${error.message}`);
  }
  return { size: stat.size, mtimeMs: stat.mtimeMs, path: resolved };
}

/**
 * Hash a file in fixed-size chunks without loading it into memory.
 *
 * @param {string} file
 * @param {{ algorithm?: string, chunkSize?: number }} [opts]
 * @returns {string} Hex digest.
 */
export function hashFile(file, opts = {}) {
  const { algorithm = "sha256", chunkSize = DEFAULT_CHUNK_SIZE } = opts || {};
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError("hashFile: chunkSize must be a positive integer");
  }
  const resolved = path.resolve(String(file));
  const hash = crypto.createHash(algorithm);
  const buffer = Buffer.allocUnsafe(chunkSize);
  const fd = fs.openSync(resolved, "r");
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Build the absolute path of a cached artifact.
 *
 * `kind` may contain subdirectories (`build/<key>`); `key` and `ext` must stay
 * on one path segment.
 *
 * @param {string} kind
 * @param {string} key
 * @param {string} ext
 * @param {string|{ workspace?: string, cacheDir?: string }} [workspaceOrOptions]
 * @returns {string}
 */
export function artifactPath(kind, key, ext, workspaceOrOptions) {
  const root = resolveRoot(workspaceOrOptions);
  const segments = normalizeKind(kind);
  const file = `${normalizeKey(key)}${normalizeExt(ext)}`;
  const target = path.resolve(root, ...segments, file);
  assertInside(root, target);
  return target;
}

/**
 * Return a cached artifact if it exists, is non-empty, and passes `validate`.
 *
 * @param {string} kind
 * @param {string} key
 * @param {string} ext
 * @param {(file: string) => boolean} [validate]
 * @param {string|{ workspace?: string, cacheDir?: string }} [workspaceOrOptions]
 * @returns {string|null}
 */
export function readCache(kind, key, ext, validate, workspaceOrOptions) {
  const target = artifactPath(kind, key, ext, workspaceOrOptions);
  if (!validateArtifact(target, validate)) return null;
  touchMeta(`${target}${META_SUFFIX}`);
  return target;
}

/**
 * Reuse a cached artifact or produce it atomically.
 *
 * A hit requires the artifact to be non-empty, to pass `validate`, and to have
 * a readable sidecar metadata file. On a miss `produce(tmp)` must synchronously
 * write the complete artifact to `tmp`; the file is validated again before it
 * is renamed into place. Empty or invalid output is deleted, never cached.
 *
 * `meta` may contain `toolVersions` and `inputs` (or any other JSON value).
 * Reserved fields (`schema`, `key`, `kind`, `createdAt`, `bytes`) are always
 * written by the cache.
 *
 * @param {object} options
 * @param {string} options.kind
 * @param {string} options.key
 * @param {string} options.ext
 * @param {(file: string) => boolean} [options.validate]
 * @param {(tmp: string) => void} options.produce
 * @param {object} [options.meta]
 * @param {boolean} [options.refresh]
 * @param {string} [options.workspace]
 * @param {string} [options.cacheDir] Cache root override.
 * @param {string} [options.cache] Alias for `cacheDir`.
 * @returns {string} Absolute artifact path.
 */
export function withCache({
  kind,
  key,
  ext,
  validate,
  produce,
  meta,
  refresh = false,
  workspace,
  cacheDir,
  cache,
} = {}) {
  if (typeof produce !== "function") {
    throw new TypeError("withCache: produce must be a function");
  }
  const segments = normalizeKind(kind);
  const expected = { key: normalizeKey(key), kind: kindLabel(segments) };
  const target = artifactPath(expected.kind, expected.key, ext, {
    workspace,
    cacheDir: cacheDir || cache,
  });

  if (!refresh && isValidEntry(target, validate, expected)) {
    touchMeta(`${target}${META_SUFFIX}`);
    return target;
  }

  ensureDir(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${++tmpCounter}`;
  removeFile(tmp);

  try {
    const result = produce(tmp);
    if (result && typeof result.then === "function") {
      throw new Error("withCache: produce must be synchronous");
    }
    const stat = safeLstat(tmp);
    if (!stat || !stat.isFile() || stat.size <= 0) {
      throw new Error(`withCache: produce did not create a non-empty artifact: ${target}`);
    }
    if (validate && !validateArtifact(tmp, validate)) {
      throw new Error(`withCache: artifact failed validation: ${target}`);
    }

    const metaDoc = {
      schema: CACHE_SCHEMA,
      key: expected.key,
      kind: expected.kind,
      createdAt: new Date().toISOString(),
      bytes: stat.size,
    };
    if (meta && typeof meta === "object") {
      for (const [field, value] of Object.entries(meta)) {
        if (["schema", "key", "kind", "createdAt", "bytes"].includes(field)) continue;
        if (value !== undefined) metaDoc[field] = value;
      }
    }

    replaceFile(tmp, target);
    try {
      writeJsonAtomic(`${target}${META_SUFFIX}`, metaDoc);
    } catch (error) {
      // Do not leave an artifact without the metadata that makes it a hit.
      removeFile(target);
      throw error;
    }
    return target;
  } catch (error) {
    removeFile(tmp);
    throw error;
  }
}

/**
 * Hard-link a file into place, falling back to a reflink copy and then a plain
 * copy when the filesystem or volume does not support links.
 *
 * @param {string} source
 * @param {string} target
 * @returns {string} The target path.
 */
export function linkOrCopy(source, target) {
  const src = path.resolve(String(source));
  const dst = path.resolve(String(target));

  let samePath = src === dst;
  if (!samePath) {
    try {
      const realSrc = fs.realpathSync(src);
      const realDir = fs.realpathSync(path.dirname(dst));
      const realDst = path.join(realDir, path.basename(dst));
      samePath =
        realSrc === realDst ||
        (process.platform === "win32" && realSrc.toLowerCase() === realDst.toLowerCase());
    } catch {
      // The source may be missing; the copy below will surface the real error.
    }
  }
  if (samePath) return dst;

  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) fs.rmSync(dst, { force: true, maxRetries: 3, retryDelay: 50 });

  try {
    fs.linkSync(src, dst);
    return dst;
  } catch {
    // Different volume, FAT, or a filesystem without hard links.
  }

  try {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
    return dst;
  } catch {
    // Reflink unsupported; fall back to a plain copy.
  }

  fs.copyFileSync(src, dst);
  return dst;
}

/**
 * Summarize cache usage by type.
 *
 * @param {string|{ workspace?: string, cacheDir?: string }} [workspaceOrOptions]
 * @returns {{
 *   root: string,
 *   exists: boolean,
 *   files: number,
 *   bytes: number,
 *   artifacts: number,
 *   byKind: Record<string, { files: number, bytes: number }>,
 *   oldestAt: string|null,
 *   newestAt: string|null
 * }}
 */
export function cacheInfo(workspaceOrOptions) {
  const root = resolveRoot(workspaceOrOptions);
  const info = {
    root,
    exists: false,
    files: 0,
    bytes: 0,
    artifacts: 0,
    byKind: {},
    oldestAt: null,
    newestAt: null,
  };

  const rootStat = safeStat(root);
  if (!rootStat || !rootStat.isDirectory()) return info;
  info.exists = true;

  let oldest = null;
  let newest = null;
  for (const file of walkFiles(root)) {
    const stat = safeLstat(file);
    if (!stat) continue;
    const relative = path.relative(root, file);
    const segments = relative.split(path.sep);
    const kind = segments.length > 1 ? segments[0] : "root";
    info.files += 1;
    info.bytes += stat.size;
    info.byKind[kind] ||= { files: 0, bytes: 0 };
    info.byKind[kind].files += 1;
    info.byKind[kind].bytes += stat.size;
    if (file.endsWith(META_SUFFIX)) info.artifacts += 1;
    if (oldest === null || stat.mtimeMs < oldest) oldest = stat.mtimeMs;
    if (newest === null || stat.mtimeMs > newest) newest = stat.mtimeMs;
  }

  info.oldestAt = oldest === null ? null : new Date(oldest).toISOString();
  info.newestAt = newest === null ? null : new Date(newest).toISOString();
  return info;
}

/**
 * Remove cached artifacts.
 *
 * With no `kind`, every entry inside the cache root is removed (the root is
 * kept). With a kind, only that folder (or nested folder) is removed.
 *
 * @param {string|{ workspace?: string, cacheDir?: string }} [workspaceOrOptions]
 * @param {string} [kind]
 * @returns {{ root: string, kind: string|null, removed: number, bytes: number, cleared: boolean }}
 */
export function cacheClear(workspaceOrOptions, kind) {
  const root = resolveRoot(workspaceOrOptions);
  const report = {
    root,
    kind: kind === undefined || kind === null || kind === "" ? null : String(kind),
    removed: 0,
    bytes: 0,
    cleared: false,
  };

  const rootStat = safeStat(root);
  if (!rootStat || !rootStat.isDirectory()) return report;
  report.cleared = true;

  let targets;
  if (report.kind === null) {
    targets = fs.readdirSync(root).map((name) => path.join(root, name));
  } else {
    const segments = normalizeKind(report.kind);
    targets = [path.resolve(root, ...segments)];
  }

  for (const target of targets) {
    assertInside(root, target);
    if (!safeLstat(target)) continue;
    const measured = measureTree(target);
    removeTree(target);
    report.removed += measured.files;
    report.bytes += measured.bytes;
  }

  pruneEmptyDirs(root, root);
  return report;
}

/**
 * Evict old or oversized cache entries.
 *
 * A sidecar metadata file and its artifact form one unit and are deleted
 * together. Access time is approximated by the newest mtime of the pair; a
 * cache hit touches the sidecar, so frequently reused artifacts survive GC.
 *
 * @param {string|{ workspace?: string, cacheDir?: string }} [workspaceOrOptions]
 * @param {{ maxBytes?: number, maxAgeMs?: number }} [options]
 * @returns {{
 *   root: string, removed: number, bytesFreed: number, bytesRemaining: number,
 *   scanned: number, maxBytes: number|null, maxAgeMs: number|null
 * }}
 */
export function cacheGc(workspaceOrOptions, options = {}) {
  const root = resolveRoot(workspaceOrOptions);
  const { maxBytes, maxAgeMs } = options || {};
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes < 0)) {
    throw new RangeError("cacheGc: maxBytes must be a non-negative number");
  }
  if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
    throw new RangeError("cacheGc: maxAgeMs must be a non-negative number");
  }

  const report = {
    root,
    removed: 0,
    bytesFreed: 0,
    bytesRemaining: 0,
    scanned: 0,
    maxBytes: maxBytes === undefined ? null : maxBytes,
    maxAgeMs: maxAgeMs === undefined ? null : maxAgeMs,
  };

  const rootStat = safeStat(root);
  if (!rootStat || !rootStat.isDirectory()) return report;

  const files = walkFiles(root);
  report.scanned = files.length;
  let units = buildUnits(files);

  const now = Date.now();
  const removed = new Set();

  const deleteUnit = (unit) => {
    if (unit.deleted) return;
    unit.deleted = true;
    removed.add(unit);
    for (const file of unit.files) removeFile(file);
  };

  if (maxAgeMs !== undefined) {
    for (const unit of units) {
      if (now - unit.mtimeMs >= maxAgeMs) deleteUnit(unit);
    }
  }

  if (maxBytes !== undefined) {
    const survivors = units
      .filter((unit) => !unit.deleted)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = survivors.reduce((sum, unit) => sum + unit.bytes, 0);
    for (const unit of survivors) {
      if (total <= maxBytes) break;
      deleteUnit(unit);
      total -= unit.bytes;
    }
  }

  for (const unit of removed) {
    report.removed += unit.files.length;
    report.bytesFreed += unit.bytes;
  }

  pruneEmptyDirs(root, root);
  report.bytesRemaining = walkFiles(root).reduce(
    (sum, file) => sum + (safeLstat(file)?.size || 0),
    0,
  );
  return report;
}
