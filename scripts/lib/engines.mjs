/**
 * Engine discovery for HyperFrames and Remotion.
 *
 * This module only inspects the filesystem. It never installs packages and
 * never shells out to `npx`: callers get a resolved binary path (or null) and
 * decide how to run it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HYPERFRAMES_BIN = path.join("bin", "hyperframes.mjs");

function fileExists(file) {
  if (!file) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function dirExists(dir) {
  if (!dir) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readJsonSafe(file) {
  if (!file) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolvePath(value) {
  if (!value) return null;
  try {
    return path.resolve(String(value));
  } catch {
    return null;
  }
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Find the package.json that owns a binary. Walks up a few directories so
 * both `<pkg>/bin/cli.mjs` and `<pkg>/cli.mjs` layouts work.
 */
function packageForBin(bin) {
  let dir = path.dirname(bin);
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(dir, "package.json");
    if (fileExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function compareVersionsDesc(a, b) {
  const parse = (value) =>
    String(value || "0")
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * npm cache roots for the current platform. Returned even when they do not
 * exist yet; callers filter with existsSync. `npm_config_cache` wins.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {string[]}
 */
export function npmCacheRoots(env = process.env, options = {}) {
  const source = env || {};
  options = options || {};
  const platform = options.platform || process.platform;
  const home = source.USERPROFILE || source.HOME || os.homedir();
  const roots = [];
  const add = (value) => {
    const resolved = resolvePath(value);
    if (resolved && !roots.includes(resolved)) roots.push(resolved);
  };

  add(source.npm_config_cache || source.NPM_CONFIG_CACHE);

  const localAppData = source.LOCALAPPDATA || (home ? path.join(home, "AppData", "Local") : null);
  const appData = source.APPDATA || (home ? path.join(home, "AppData", "Roaming") : null);

  if (platform === "win32" || source.LOCALAPPDATA) {
    add(localAppData ? path.join(localAppData, "npm-cache") : null);
  }
  if (platform === "win32" || source.APPDATA) {
    add(appData ? path.join(appData, "npm-cache") : null);
  }
  if (home) add(path.join(home, ".npm"));

  return roots;
}

/**
 * Resolve the HyperFrames binary from a package.json. Falls back to the
 * conventional `bin/hyperframes.mjs` when the manifest has no bin field.
 */
function binaryFromPackage(pkgPath) {
  const pkg = readJsonSafe(pkgPath);
  const packageDir = path.dirname(pkgPath);
  let relative = null;

  if (pkg && typeof pkg.bin === "string") {
    relative = pkg.bin;
  } else if (pkg && pkg.bin && typeof pkg.bin === "object") {
    relative =
      pkg.bin.hyperframes ||
      pkg.bin.hf ||
      Object.values(pkg.bin).find((value) => typeof value === "string") ||
      null;
  }

  if (!relative) relative = HYPERFRAMES_BIN;
  return path.resolve(packageDir, relative);
}

/**
 * All HyperFrames candidates in priority order.
 *
 * @param {{ workspace?: string, cwd?: string, home?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Array<{ bin: string, pkgPath: string|null, source: string }>}
 */
export function hyperFramesBinCandidates(options = {}) {
  options = options || {};
  const env = options.env || process.env;
  const candidates = [];
  const seen = new Set();

  const push = (bin, source, pkgPath = null) => {
    const resolved = resolvePath(bin);
    if (!resolved || seen.has(resolved) || !fileExists(resolved)) return;
    seen.add(resolved);
    candidates.push({
      bin: resolved,
      pkgPath: pkgPath && fileExists(pkgPath) ? path.resolve(pkgPath) : packageForBin(resolved),
      source,
    });
  };

  const envBin = env.ROOSTER_HYPERFRAMES_BIN;
  if (envBin) {
    const resolved = resolvePath(envBin);
    if (resolved && dirExists(resolved)) {
      push(
        path.join(resolved, HYPERFRAMES_BIN),
        "env",
        path.join(resolved, "package.json")
      );
    } else {
      push(resolved, "env");
    }
  }

  const workspace = resolvePath(options.workspace);
  if (workspace) {
    push(
      path.join(workspace, "cache", "tools", "node_modules", "hyperframes", HYPERFRAMES_BIN),
      "workspace-cache"
    );
  }

  const cwd = resolvePath(options.cwd || process.cwd());
  if (cwd) {
    push(path.join(cwd, "node_modules", "hyperframes", HYPERFRAMES_BIN), "cwd");
  }

  const home = resolvePath(options.home || os.homedir());
  if (home) {
    push(path.join(home, "tools", "node_modules", "hyperframes", HYPERFRAMES_BIN), "home");
  }

  // Last resort: npm's _npx cache. Read package.json only; never run npx.
  const npxCandidates = [];
  for (const root of npmCacheRoots(env)) {
    const npxDir = path.join(root, "_npx");
    for (const entry of readdirSafe(npxDir)) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(npxDir, entry.name, "node_modules", "hyperframes", "package.json");
      if (!fileExists(pkgPath)) continue;
      const bin = binaryFromPackage(pkgPath);
      if (!fileExists(bin)) continue;
      npxCandidates.push({
        bin,
        pkgPath,
        source: "npx-cache",
        version: hyperFramesVersion(pkgPath),
        name: entry.name,
      });
    }
  }

  npxCandidates
    .sort((left, right) => {
      const byVersion = compareVersionsDesc(left.version, right.version);
      if (byVersion !== 0) return byVersion;
      return left.bin.localeCompare(right.bin);
    })
    .forEach((candidate) => push(candidate.bin, candidate.source, candidate.pkgPath));

  return candidates;
}

/**
 * Locate a usable HyperFrames binary.
 *
 * Order: env override, workspace cache, cwd node_modules, home tools,
 * npm _npx cache. Returns null when nothing is available.
 *
 * @param {{ workspace?: string, cwd?: string, home?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ bin: string, pkgPath: string|null, source: string } | null}
 */
export function findHyperFrames(options = {}) {
  return hyperFramesBinCandidates(options || {})[0] || null;
}

/**
 * Read a HyperFrames package.json version. `pkgPath` may point at the directory.
 *
 * @param {string} pkgPath
 * @returns {string|null}
 */
export function hyperFramesVersion(pkgPath) {
  if (!pkgPath) return null;
  let file = String(pkgPath);
  if (dirExists(file)) {
    file = path.join(file, "package.json");
  } else if (path.basename(file) !== "package.json") {
    const owner = packageForBin(file);
    if (owner) file = owner;
  }
  const pkg = readJsonSafe(file);
  return pkg && typeof pkg.version === "string" && pkg.version.trim()
    ? pkg.version.trim()
    : null;
}

function binaryFromPackageBin(pkgPath, preferredName = "remotion") {
  const pkg = readJsonSafe(pkgPath);
  if (!pkg || !pkg.bin) return null;
  const packageDir = path.dirname(pkgPath);
  let relative = null;
  if (typeof pkg.bin === "string") {
    relative = pkg.bin;
  } else if (typeof pkg.bin === "object") {
    relative =
      pkg.bin[preferredName] ||
      Object.values(pkg.bin).find((value) => typeof value === "string") ||
      null;
  }
  if (!relative) return null;
  const candidate = path.resolve(packageDir, relative);
  return fileExists(candidate) ? candidate : null;
}

/**
 * Locate a project-local Remotion CLI.
 *
 * @param {{ projectDir?: string, platform?: NodeJS.Platform }} [options]
 * @returns {{ bin: string|null, pkgPath: string|null, version: string|null, source: string } | null}
 */
export function resolveRemotion(options = {}) {
  options = options || {};
  const projectDir = resolvePath(options.projectDir || process.cwd());
  if (!projectDir) return null;

  const platform = options.platform || process.platform;
  const binDir = path.join(projectDir, "node_modules", ".bin");
  const binNames =
    platform === "win32" ? ["remotion.cmd", "remotion.exe", "remotion"] : ["remotion"];

  let bin = null;
  let binSource = null;
  for (const name of binNames) {
    const candidate = path.join(binDir, name);
    if (fileExists(candidate)) {
      bin = candidate;
      binSource = "local-bin";
      break;
    }
  }

  let pkgPath = null;
  let version = null;
  for (const name of ["remotion", "@remotion/cli"]) {
    const candidate = path.join(projectDir, "node_modules", ...name.split("/"), "package.json");
    if (!fileExists(candidate)) continue;
    if (!pkgPath) pkgPath = candidate;
    const candidateVersion = hyperFramesVersion(candidate);
    if (!version) version = candidateVersion;
    if (!bin) {
      const packageBin = binaryFromPackageBin(candidate);
      if (packageBin) {
        bin = packageBin;
        binSource = "package-bin";
      }
    }
  }

  if (!bin && !pkgPath) return null;

  return {
    bin,
    pkgPath,
    version,
    source: bin ? binSource : "package",
  };
}

/**
 * Version/bin/source for an engine, without spawning anything.
 *
 * @param {string} engine
 * @param {{ workspace?: string, cwd?: string, home?: string, env?: NodeJS.ProcessEnv, projectDir?: string, platform?: NodeJS.Platform }} [options]
 * @returns {{ version: string|null, bin: string, source: string } | null}
 */
export function engineVersion(engine, options = {}) {
  options = options || {};
  const name = String(engine || "").toLowerCase();

  if (name === "hyperframes" || name === "hf") {
    const found = findHyperFrames(options);
    if (!found) return null;
    return {
      version: hyperFramesVersion(found.pkgPath),
      bin: found.bin,
      source: found.source,
    };
  }

  if (name === "remotion") {
    const found = resolveRemotion(options);
    if (!found || !found.bin) return null;
    return {
      version: found.version,
      bin: found.bin,
      source: found.source,
    };
  }

  return null;
}
