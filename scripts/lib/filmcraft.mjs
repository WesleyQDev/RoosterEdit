/**
 * FilmCraft discovery and headless CLI integration.
 *
 * FilmCraft is an optional, open-source NLE (MIT OR Apache-2.0) whose
 * `filmcraft-cli` can run headless. This module only inspects the filesystem
 * and invokes the CLI when the caller asks for it: it never installs anything,
 * never calls the network and never touches a user project on its own.
 *
 * Time in FilmCraft is integer ticks: 254016000000 per second.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { quoteCmd } from "./exec.mjs";

export const FILMCRAFT_ENV = "ROOSTER_FILMCRAFT_CLI";
export const FILMCRAFT_MCP_NAME = "filmcraft";
export const FILMCRAFT_TICKS_PER_SECOND = 254016000000;

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;
const CLI_NAME = "filmcraft-cli";
const APP_NAME = "filmcraft";

// ---------------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------------

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

function resolvePath(value, base = process.cwd()) {
  if (!value) return null;
  try {
    return path.resolve(base, String(value));
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function envValue(env, ...names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function platformHome(options, env, platform) {
  if (options.home) return resolvePath(options.home);
  const value =
    platform === "win32"
      ? envValue(env, "USERPROFILE", "HOME")
      : envValue(env, "HOME", "USERPROFILE");
  return resolvePath(value || os.homedir());
}

function normalizeClient(client) {
  return String(client || "opencode").toLowerCase() === "claude" ? "claude" : "opencode";
}

function defaultCli(cli) {
  return cli ? String(cli) : CLI_NAME;
}

const MCP_BRIDGE_HOST = "127.0.0.1";

/**
 * Normalize `--bridge`: a bare port becomes `127.0.0.1:<port>`; `host:port` passes through.
 *
 * The bridge is what makes the MCP talk to the running app
 * (`filmcraft --control <port>`) instead of a headless copy of the project, which
 * is what live co-editing needs.
 *
 * @param {string|number|null|undefined} value
 * @returns {string|null}
 */
export function normalizeFilmCraftBridge(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const port = Number(text);
    if (port < 1 || port > 65535) {
      throw new Error(`Invalid bridge port "${text}": use a port between 1 and 65535.`);
    }
    return `${MCP_BRIDGE_HOST}:${port}`;
  }
  if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(text)) {
    throw new Error(`Invalid bridge "${text}": use a port (8790) or host:port (127.0.0.1:8790).`);
  }
  return text;
}

function mcpArgs(bridge) {
  const target = normalizeFilmCraftBridge(bridge);
  return target ? ["mcp", "--bridge", target] : ["mcp"];
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Convert seconds to FilmCraft ticks.
 *
 * @param {number} seconds
 * @returns {number}
 */
export function secondsToTicks(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * FILMCRAFT_TICKS_PER_SECOND);
}

/**
 * Convert FilmCraft ticks to seconds.
 *
 * @param {number} ticks
 * @returns {number}
 */
export function ticksToSeconds(ticks) {
  const value = Number(ticks);
  if (!Number.isFinite(value)) return 0;
  return value / FILMCRAFT_TICKS_PER_SECOND;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function pushCandidate(candidates, seen, platform, file, source, kind) {
  const resolved = resolvePath(file);
  if (!resolved || !fileExists(resolved)) return;
  const key = platform === "win32" ? resolved.toLowerCase() : resolved;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ path: resolved, source, kind });
}

function pathExtensions(env) {
  const raw = envValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD";
  const extensions = new Set([".EXE"]);
  for (const part of raw.split(";")) {
    const ext = part.trim();
    if (!ext) continue;
    extensions.add(ext.startsWith(".") ? ext : `.${ext}`);
  }
  return [...extensions];
}

function pathCandidates(candidates, seen, env, platform) {
  const raw = envValue(env, "PATH", "Path", "path");
  if (!raw) return;
  const dirs = raw
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const names =
    platform === "win32"
      ? [CLI_NAME, ...pathExtensions(env).map((ext) => `${CLI_NAME}${ext.toLowerCase()}`)]
      : [CLI_NAME];

  for (const dir of dirs) {
    for (const name of names) {
      pushCandidate(candidates, seen, platform, path.join(dir, name), "path", "cli");
    }
  }
}

function envCandidates(candidates, seen, env, platform, cwd) {
  const raw = envValue(env, FILMCRAFT_ENV);
  if (!raw) return;
  const resolved = resolvePath(raw, cwd);
  if (!resolved) return;

  if (dirExists(resolved)) {
    const names =
      platform === "win32"
        ? [`${CLI_NAME}.exe`, `${CLI_NAME}.cmd`, `${CLI_NAME}.bat`, CLI_NAME]
        : [CLI_NAME];
    for (const name of names) {
      const candidate = path.join(resolved, name);
      if (fileExists(candidate)) {
        pushCandidate(candidates, seen, platform, candidate, "env", "cli");
        return;
      }
    }
    return;
  }

  if (fileExists(resolved)) {
    pushCandidate(candidates, seen, platform, resolved, "env", "cli");
  }
}

function windowsCandidates(candidates, seen, platform, options, env, home) {
  const localAppData =
    options.localAppData ||
    envValue(env, "LOCALAPPDATA") ||
    (home ? path.join(home, "AppData", "Local") : null);
  const programFiles = options.programFiles || envValue(env, "ProgramFiles", "PROGRAMFILES");
  const programFilesX86 =
    options.programFilesX86 || envValue(env, "ProgramFiles(x86)", "PROGRAMFILES(X86)");

  const roots = [
    [localAppData && path.join(localAppData, "Programs", "ArtCraft", "FilmCraft"), "localappdata"],
    [programFiles && path.join(programFiles, "ArtCraft", "FilmCraft"), "program-files"],
    [programFilesX86 && path.join(programFilesX86, "ArtCraft", "FilmCraft"), "program-files-x86"],
  ];

  for (const [root, source] of roots) {
    if (!root) continue;
    pushCandidate(candidates, seen, platform, path.join(root, `${CLI_NAME}.exe`), source, "cli");
    pushCandidate(candidates, seen, platform, path.join(root, `${APP_NAME}.exe`), source, "app");
  }
}

function macCandidates(candidates, seen, platform, home) {
  pushCandidate(
    candidates,
    seen,
    platform,
    "/Applications/FilmCraft.app/Contents/MacOS/filmcraft",
    "macos-app",
    "app"
  );
  pushCandidate(candidates, seen, platform, "/usr/local/bin/filmcraft-cli", "usr-local-bin", "cli");
  pushCandidate(candidates, seen, platform, "/opt/homebrew/bin/filmcraft-cli", "usr-local-bin", "cli");
  if (home) {
    pushCandidate(candidates, seen, platform, path.join(home, "bin", "filmcraft-cli"), "home-local-bin", "cli");
    pushCandidate(
      candidates,
      seen,
      platform,
      path.join(home, ".local", "bin", "filmcraft-cli"),
      "home-local-bin",
      "cli"
    );
  }
}

function linuxCandidates(candidates, seen, platform, home) {
  pushCandidate(candidates, seen, platform, "/usr/bin/filmcraft-cli", "usr-bin", "cli");
  pushCandidate(candidates, seen, platform, "/usr/local/bin/filmcraft-cli", "usr-local-bin", "cli");
  if (home) {
    pushCandidate(
      candidates,
      seen,
      platform,
      path.join(home, ".local", "bin", "filmcraft-cli"),
      "home-local-bin",
      "cli"
    );
  }
}

/**
 * All FilmCraft candidates in priority order, filtered to files that exist.
 *
 * Discovery is filesystem-only and never spawns a process.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   cwd?: string,
 *   localAppData?: string,
 *   programFiles?: string,
 *   programFilesX86?: string
 * }} [options]
 * @returns {Array<{ path: string, source: string, kind: "cli"|"app" }>}
 */
export function filmCraftCandidates(options = {}) {
  options = options || {};
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const cwd = resolvePath(options.cwd || process.cwd());
  const home = platformHome(options, env, platform);
  const candidates = [];
  const seen = new Set();

  envCandidates(candidates, seen, env, platform, cwd);
  pathCandidates(candidates, seen, env, platform);

  if (platform === "win32") {
    windowsCandidates(candidates, seen, platform, options, env, home);
  } else if (platform === "darwin") {
    macCandidates(candidates, seen, platform, home);
  } else if (platform === "linux") {
    linuxCandidates(candidates, seen, platform, home);
  }

  return candidates;
}

/**
 * Locate FilmCraft without spawning anything.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   cwd?: string,
 *   localAppData?: string,
 *   programFiles?: string,
 *   programFilesX86?: string
 * }} [options]
 * @returns {{ cli: string|null, app: string|null, source: string|null, installed: boolean }}
 */
export function findFilmCraft(options = {}) {
  const candidates = filmCraftCandidates(options || {});
  const cli = candidates.find((candidate) => candidate.kind === "cli") || null;
  const app = candidates.find((candidate) => candidate.kind === "app") || null;
  return {
    cli: cli ? cli.path : null,
    app: app ? app.path : null,
    source: cli ? cli.source : app ? app.source : null,
    installed: Boolean(cli || app),
  };
}

/**
 * Parse the version from `filmcraft-cli --version` output.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseFilmCraftVersion(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Process execution
// ---------------------------------------------------------------------------

function failure(error, command = CLI_NAME, args = []) {
  return {
    ok: false,
    status: null,
    stdout: "",
    stderr: "",
    error,
    command,
    args,
  };
}

function spawnErrorMessage(error) {
  const code = error && error.code;
  if (code === "ENOENT") return "filmcraft-cli not found";
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "ENOBUFS") return "maxBuffer exceeded";
  return String((error && error.message) || error);
}

/**
 * Run `filmcraft-cli` synchronously.
 *
 * A missing CLI is reported, never thrown. On Windows, `.cmd` and `.bat`
 * shims are routed through `cmd.exe` with the same quoting strategy as
 * `scripts/lib/exec.mjs`.
 *
 * @param {string} cli
 * @param {string[]} [args]
 * @param {{ cwd?: string, timeout?: number, maxBuffer?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: boolean, status: number|null, stdout: string, stderr: string, error: string|null, command: string, args: string[] }}
 */
export function runFilmCraft(cli, args = [], options = {}) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (!cli) return failure("filmcraft-cli not found");

  options = options || {};
  const cwd = options.cwd || process.cwd();
  const timeout = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_TIMEOUT;
  const maxBuffer =
    Number.isInteger(options.maxBuffer) && options.maxBuffer > 0
      ? options.maxBuffer
      : DEFAULT_MAX_BUFFER;
  const env = options.env || process.env;

  let command = String(cli);
  let spawnArgs = list;
  let windowsVerbatimArguments = false;

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...spawnArgs].map(quoteCmd).join(" ");
    command = env.ComSpec || process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", `"${line}"`];
    windowsVerbatimArguments = true;
  }

  let result;
  try {
    result = spawnSync(command, spawnArgs, {
      cwd,
      env,
      timeout,
      maxBuffer,
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments,
    });
  } catch (error) {
    return failure(spawnErrorMessage(error), command, spawnArgs);
  }

  if (!result) return failure("filmcraft-cli not found", command, spawnArgs);

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const status = typeof result.status === "number" ? result.status : null;
  let error = result.error ? spawnErrorMessage(result.error) : null;
  if (error === "filmcraft-cli not found" && !dirExists(cwd)) {
    error = `cwd not found: ${cwd}`;
  }

  return {
    ok: !error && status === 0,
    status,
    stdout,
    stderr,
    error,
    command,
    args: spawnArgs,
  };
}

/**
 * Spawn `filmcraft-cli --version` and parse the version. Returns null on any
 * failure.
 *
 * @param {string} cli
 * @param {{ cwd?: string, timeout?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string|null}
 */
export function filmCraftVersion(cli, options = {}) {
  if (!cli) return null;
  const result = runFilmCraft(cli, ["--version"], {
    timeout: 15000,
    ...(options || {}),
  });
  if (!result.ok) return null;
  return parseFilmCraftVersion(result.stdout) || parseFilmCraftVersion(result.stderr);
}

function parseJsonLines(stdout) {
  const results = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      results.push(JSON.parse(text));
    } catch {
      // Non-JSON progress or diagnostics on stdout are ignored.
    }
  }
  return results;
}

function firstFailure(results) {
  for (let index = 0; index < results.length; index += 1) {
    const entry = results[index];
    if (!isObject(entry)) continue;
    const nested = isObject(entry.result) ? entry.result : null;
    if (entry.ok === false || (nested && nested.ok === false)) {
      return {
        line: Number.isInteger(entry.line) ? entry.line : index + 1,
        id: entry.id === undefined ? null : entry.id,
        error:
          (typeof entry.error === "string" && entry.error) ||
          (nested && typeof nested.error === "string" && nested.error) ||
          "command failed",
      };
    }
  }
  return null;
}

/**
 * Run a JSONL command script through `filmcraft-cli run`.
 *
 * The temp script is written under `os.tmpdir()` and always removed.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {Array<{ id: string, params?: object }>} commands
 * @param {{ save?: boolean, saveAs?: string|null, cwd?: string, timeout?: number, keepGoing?: boolean }} [options]
 * @returns {{ ok: boolean, results: object[], failed: { line: number, id: string|null, error: string }|null, stdout: string, stderr: string, error: string|null }}
 */
export function filmCraftRun(cli, projectFile, commands, options = {}) {
  const list = Array.isArray(commands) ? commands : [];
  if (list.length === 0) {
    return { ok: true, results: [], failed: null, stdout: "", stderr: "", error: null };
  }

  options = options || {};
  if (!options.saveAs && !projectFile) {
    return {
      ok: false,
      results: [],
      failed: null,
      stdout: "",
      stderr: "",
      error: "project file is required",
    };
  }

  const args = [];
  if (options.saveAs) {
    args.push("--save-as", String(options.saveAs));
  } else {
    args.push("--project", String(projectFile));
    if (options.save) args.push("--save");
  }
  if (options.keepGoing) args.push("--keep-going");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-filmcraft-"));
  const script = path.join(dir, "commands.jsonl");

  try {
    const lines = list.map((command) => JSON.stringify(command));
    fs.writeFileSync(script, `${lines.join("\n")}\n`, "utf8");
    args.push("run", script);

    const processResult = runFilmCraft(cli, args, options);
    const results = parseJsonLines(processResult.stdout);
    const failed = firstFailure(results);
    let error = processResult.error;
    if (!error && failed) error = failed.error;
    if (!error && !processResult.ok && processResult.stderr) error = processResult.stderr;
    if (!error && !processResult.ok) {
      error = `filmcraft-cli exited with status ${processResult.status}`;
    }

    return {
      ok: processResult.ok && !failed,
      results,
      failed,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      error,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // A leftover temp directory is harmless; never mask the CLI result.
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

function firstCommandResult(run) {
  if (run.failed) return { ok: false, error: run.failed.error };
  const entry = run.results[0];
  if (!entry) return { ok: false, error: run.error || "filmcraft-cli returned no result" };
  if (entry.ok === false) return { ok: false, error: entry.error || "command failed" };
  const value = Object.prototype.hasOwnProperty.call(entry, "result") ? entry.result : entry;
  if (value === null || value === undefined) return { ok: true };
  if (typeof value === "object") return value;
  return { ok: true, result: value };
}

/**
 * Inspect the project, the active sequence or both.
 *
 * FilmCraft 0.17.0 spells the "both" mode `all` on the CLI; the public wrapper
 * keeps the friendlier `both` name and maps it.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {"project"|"sequence"|"both"} [what]
 * @param {object} [options]
 * @returns {object}
 */
export function inspect(cli, projectFile, what = "both", options = {}) {
  if (!projectFile) return { ok: false, error: "project file is required" };
  const target = what === "project" || what === "sequence" ? what : "all";
  const result = runFilmCraft(cli, ["--project", String(projectFile), "inspect", target], options);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || result.stderr || "filmcraft-cli inspect failed",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      ok: false,
      error: "filmcraft-cli inspect did not return JSON",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

/**
 * Import media files into the project.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {string|string[]} files
 * @param {object} [options]
 * @returns {{ items: number[], errors: string[] }}
 */
export function importMedia(cli, projectFile, files, options = {}) {
  const paths = Array.isArray(files) ? files.map(String) : files ? [String(files)] : [];
  if (paths.length === 0) return { items: [], errors: [] };

  const { bin, imageSequence, ...runOptions } = options || {};
  const params = { paths };
  if (bin !== undefined) params.bin = bin;
  if (imageSequence !== undefined) params.imageSequence = imageSequence;

  const run = filmCraftRun(cli, projectFile, [{ id: "file.import", params }], runOptions);
  if (run.failed) return { items: [], errors: [run.failed.error] };

  const entry = run.results[0];
  if (!entry || entry.ok === false) {
    return { items: [], errors: [entry?.error || run.error || "filmcraft-cli import failed"] };
  }

  const result = isObject(entry.result) ? entry.result : {};
  const items = Array.isArray(result.items)
    ? result.items.map(Number).filter((value) => Number.isInteger(value) && value >= 0)
    : [];
  const errors = Array.isArray(result.errors) ? result.errors.map(String) : [];
  if (!run.ok && errors.length === 0) errors.push(run.error || "filmcraft-cli import failed");
  return { items, errors };
}

/**
 * Place a project item on the active sequence.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {object} params
 * @param {object} [options]
 * @returns {object}
 */
export function place(cli, projectFile, params, options = {}) {
  const run = filmCraftRun(
    cli,
    projectFile,
    [{ id: "timeline.place", params: isObject(params) ? params : {} }],
    options
  );
  return firstCommandResult(run);
}

/**
 * Replace clips with a project item (FilmCraft's Replace With Clip).
 *
 * Defaults to `clip.replaceFromBin`; pass `params.command` to use another
 * variant such as `clip.replaceFromSource`.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {object} params
 * @param {object} [options]
 * @returns {object}
 */
export function replace(cli, projectFile, params, options = {}) {
  const input = isObject(params) ? { ...params } : {};
  const command = typeof input.command === "string" ? input.command : "clip.replaceFromBin";
  delete input.command;
  const run = filmCraftRun(cli, projectFile, [{ id: command, params: input }], options);
  return firstCommandResult(run);
}

/**
 * Add one program marker per entry.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {Array<{ time: number, label?: string, comment?: string, color?: string }>} markers
 * @param {object} [options]
 * @returns {{ ok: boolean, results: object[], failed: object|null, error: string|null }}
 */
export function markers(cli, projectFile, markers, options = {}) {
  const list = (Array.isArray(markers) ? markers : []).filter((marker) => isObject(marker));
  if (list.length === 0) {
    return { ok: true, results: [], failed: null, error: null };
  }

  const commands = list.map((marker) => ({
    id: "markers.add",
    params: {
      target: "program",
      time: secondsToTicks(marker.time),
      name: marker.label,
      comment: marker.comment,
      color: marker.color,
    },
  }));

  const run = filmCraftRun(cli, projectFile, commands, options);
  return {
    ok: run.ok,
    results: run.results.map((entry) => (entry && entry.result !== undefined ? entry.result : entry)),
    failed: run.failed,
    error: run.error,
  };
}

/**
 * Export the active sequence.
 *
 * Uses `file.exportMedia` through the JSONL runner. The defaults mirror
 * `filmcraft-cli export <out> --format h264 --range entire`.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {string} out
 * @param {{
 *   format?: string,
 *   preset?: string,
 *   range?: string,
 *   scale?: number,
 *   quality?: number,
 *   audio?: boolean,
 *   startSeconds?: number,
 *   endSeconds?: number,
 *   wait?: boolean,
 *   [key: string]: unknown
 * }} [options]
 * @returns {object}
 */
export function exportMedia(cli, projectFile, out, options = {}) {
  const {
    format,
    preset,
    range,
    scale,
    quality,
    audio,
    startSeconds,
    endSeconds,
    wait,
    ...runOptions
  } = options || {};

  const hasBounds = startSeconds !== undefined || endSeconds !== undefined;
  const params = {
    path: String(out),
    range: range !== undefined ? range : hasBounds ? "custom" : "entire",
    wait: wait === false ? false : true,
  };
  if (format !== undefined) params.format = format;
  else if (preset === undefined) params.format = "h264";
  if (preset !== undefined) params.preset = preset;
  if (scale !== undefined) params.scale = scale;
  if (quality !== undefined) params.quality = quality;
  if (audio !== undefined) params.audio = audio;
  if (startSeconds !== undefined) params.startSeconds = startSeconds;
  if (endSeconds !== undefined) params.endSeconds = endSeconds;

  const run = filmCraftRun(
    cli,
    projectFile,
    [{ id: "file.exportMedia", params }],
    runOptions
  );
  return firstCommandResult(run);
}

/**
 * Render one program frame to a PNG.
 *
 * FilmCraft exposes this as the `render` CLI subcommand, not as an engine
 * command, so it cannot go through the JSONL runner.
 *
 * @param {string} cli
 * @param {string} projectFile
 * @param {number} seconds
 * @param {string} out
 * @param {{ scale?: number, allowOffline?: boolean, save?: boolean, saveAs?: string, cwd?: string, timeout?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {object}
 */
export function renderFrame(cli, projectFile, seconds, out, options = {}) {
  const opts = options || {};
  const args = [];
  if (opts.saveAs) args.push("--save-as", String(opts.saveAs));
  else if (projectFile) args.push("--project", String(projectFile));
  if (opts.save) args.push("--save");
  args.push("render", "--seconds", String(seconds ?? 0), "--out", String(out || "frame.png"));
  if (opts.scale !== undefined) args.push("--scale", String(opts.scale));
  if (opts.allowOffline) args.push("--allow-offline");

  const result = runFilmCraft(cli, args, opts);
  return {
    ok: result.ok,
    path: out || "frame.png",
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// MCP configuration
// ---------------------------------------------------------------------------

/**
 * The object to merge into an MCP client's config file.
 *
 * @param {{ client?: "opencode"|"claude", cli?: string, bridge?: string|number|null }} [options]
 * @returns {object}
 */
export function filmCraftMcpConfig(options = {}) {
  options = options || {};
  const { client = "opencode", cli, bridge } = options;
  const command = defaultCli(cli);
  const args = mcpArgs(bridge);
  if (normalizeClient(client) === "claude") {
    return {
      mcpServers: {
        [FILMCRAFT_MCP_NAME]: {
          command,
          args,
        },
      },
    };
  }
  return {
    mcp: {
      [FILMCRAFT_MCP_NAME]: {
        type: "local",
        command: [command, ...args],
        enabled: true,
      },
    },
  };
}

/**
 * Pretty JSON plus the restart warning shown to the user.
 *
 * @param {{ client?: "opencode"|"claude", cli?: string, bridge?: string|number|null }} [options]
 * @returns {string}
 */
export function filmCraftMcpSnippet(options = {}) {
  options = options || {};
  const { client = "opencode", cli, bridge } = options;
  const config = filmCraftMcpConfig({ client, cli, bridge });
  const mode = normalizeFilmCraftBridge(bridge)
    ? "Bridge mode: the MCP talks to the running FilmCraft app. Start it with `filmcraft --control <port>` before the agent."
    : "Headless mode: the MCP opens a copy of the project, not the app you have open.";
  return `${JSON.stringify(config, null, 2)}\n\n${mode}\n\nRestart the agent after saving this config so it can connect to the FilmCraft MCP server.`;
}

/**
 * Candidate config files, in priority order.
 *
 * @param {{ cwd?: string, home?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {Array<{ client: "opencode"|"claude", path: string, scope: "project"|"global" }>}
 */
export function filmCraftMcpConfigFiles(options = {}) {
  options = options || {};
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const cwd = resolvePath(options.cwd || process.cwd());
  const home = platformHome(options, env, platform);
  const files = [];

  const add = (client, file, scope) => {
    const resolved = resolvePath(file);
    if (resolved) files.push({ client, path: resolved, scope });
  };

  add("opencode", path.join(cwd, "opencode.json"), "project");
  add("opencode", path.join(cwd, "opencode.jsonc"), "project");
  add("opencode", path.join(home, ".config", "opencode", "opencode.json"), "global");
  add("opencode", path.join(home, ".config", "opencode", "opencode.jsonc"), "global");
  add("claude", path.join(cwd, ".mcp.json"), "project");
  add("claude", path.join(home, ".claude.json"), "global");

  return files;
}

function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }

    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      out += " ";
      continue;
    }

    out += char;
  }

  return out;
}

function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }

    out += char;
  }

  return out;
}

function readJsonConfig(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const source = file.toLowerCase().endsWith(".jsonc")
    ? stripTrailingCommas(stripJsonComments(text))
    : text;
  return JSON.parse(source);
}

function configHasFilmCraft(config, client) {
  if (!isObject(config)) return false;
  const container = client === "claude" ? config.mcpServers : config.mcp;
  return isObject(container) && Object.prototype.hasOwnProperty.call(container, FILMCRAFT_MCP_NAME);
}

/**
 * Report whether a FilmCraft entry is registered in any known config file.
 *
 * `.jsonc` files are read with comments (and trailing commas) stripped for
 * detection only; this function never writes anything.
 *
 * @param {{ cwd?: string, home?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {{ registered: boolean|null, client: string|null, path: string|null, error: string|null }}
 */
export function filmCraftMcpRegistration(options = {}) {
  const files = filmCraftMcpConfigFiles(options || {});
  let anyFile = false;
  let firstError = null;

  for (const file of files) {
    if (!fileExists(file.path)) continue;
    anyFile = true;

    let config;
    try {
      config = readJsonConfig(file.path);
    } catch (error) {
      if (!firstError) firstError = `${file.path}: ${String(error.message || error)}`;
      continue;
    }

    if (configHasFilmCraft(config, file.client)) {
      return {
        registered: true,
        client: file.client,
        path: file.path,
        error: null,
      };
    }
  }

  if (!anyFile) {
    return { registered: null, client: null, path: null, error: null };
  }
  return { registered: false, client: null, path: null, error: firstError };
}

function sameArgs(current, expected) {
  return (
    Array.isArray(current) &&
    current.length === expected.length &&
    current.every((value, index) => value === expected[index])
  );
}

function sameClaudeEntry(current, command, args) {
  return isObject(current) && current.command === command && sameArgs(current.args, args);
}

function sameOpenCodeEntry(current, command, args) {
  return isObject(current) && sameArgs(current.command, [command, ...args]);
}

/**
 * Pure merge of a FilmCraft MCP entry into an existing config object.
 *
 * All other keys and entries are preserved. An entry with the same command is
 * left untouched (`changed: false`); a different command is replaced.
 *
 * @param {object} existing
 * @param {{ client?: "opencode"|"claude", cli?: string, bridge?: string|number|null }} [options]
 * @returns {{ config: object|null, changed: boolean, error: string|null }}
 */
export function mergeFilmCraftMcpConfig(existing, options = {}) {
  if (!isObject(existing)) {
    return { config: null, changed: false, error: "config must be a JSON object" };
  }

  options = options || {};
  const { client = "opencode", cli, bridge } = options;
  const command = defaultCli(cli);
  const args = mcpArgs(bridge);
  const normalized = normalizeClient(client);

  if (normalized === "claude") {
    const config = { ...existing };
    const servers = isObject(config.mcpServers) ? { ...config.mcpServers } : {};
    const current = servers[FILMCRAFT_MCP_NAME];
    const same = sameClaudeEntry(current, command, args);
    if (!same) {
      servers[FILMCRAFT_MCP_NAME] = { command, args };
    }
    config.mcpServers = servers;
    return { config, changed: !same, error: null };
  }

  const config = { ...existing };
  const mcp = isObject(config.mcp) ? { ...config.mcp } : {};
  const current = mcp[FILMCRAFT_MCP_NAME];
  const same = sameOpenCodeEntry(current, command, args);
  if (!same) {
    mcp[FILMCRAFT_MCP_NAME] = {
      type: "local",
      command: [command, ...args],
      enabled: true,
    };
  }
  config.mcp = mcp;
  return { config, changed: !same, error: null };
}

function projectConfigPath(client, cwd, home) {
  const files = filmCraftMcpConfigFiles({ client, cwd, home });
  const project = files.find(
    (file) =>
      file.client === client &&
      file.scope === "project" &&
      !file.path.toLowerCase().endsWith(".jsonc")
  );
  return project ? project.path : null;
}

/**
 * Merge (and optionally write) the FilmCraft MCP entry in the project config.
 *
 * `write` defaults to false. A `.bak` copy is made before an existing file is
 * changed, and a file that is not valid JSON is never overwritten.
 *
 * @param {{
 *   client?: "opencode"|"claude",
 *   cli?: string,
 *   bridge?: string|number|null,
 *   write?: boolean,
 *   cwd?: string,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform
 * }} [options]
 * @returns {{ ok: boolean, path: string, changed: boolean, error: string|null, config: object|null }}
 */
export function setupFilmCraftMcp(options = {}) {
  options = options || {};
  const client = normalizeClient(options.client);
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const cwd = resolvePath(options.cwd || process.cwd());
  const home = platformHome(options, env, platform);
  const configPath = projectConfigPath(client, cwd, home);

  if (!configPath) {
    return {
      ok: false,
      path: "",
      changed: false,
      error: "could not resolve an MCP config path",
      config: null,
    };
  }

  const exists = fileExists(configPath);
  let existing = {};
  if (exists) {
    try {
      existing = readJsonConfig(configPath);
    } catch (error) {
      return {
        ok: false,
        path: configPath,
        changed: false,
        error: `${configPath}: invalid JSON (${String(error.message || error)})`,
        config: null,
      };
    }
  }

  const merged = mergeFilmCraftMcpConfig(existing, { client, cli: options.cli, bridge: options.bridge });
  if (merged.error) {
    return {
      ok: false,
      path: configPath,
      changed: false,
      error: merged.error,
      config: merged.config,
    };
  }

  if (!options.write || !merged.changed) {
    return {
      ok: true,
      path: configPath,
      changed: merged.changed,
      error: null,
      config: merged.config,
    };
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (exists) {
      fs.copyFileSync(configPath, `${configPath}.bak`);
    }
    fs.writeFileSync(configPath, `${JSON.stringify(merged.config, null, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      path: configPath,
      changed: false,
      error: String(error.message || error),
      config: merged.config,
    };
  }

  return {
    ok: true,
    path: configPath,
    changed: true,
    error: null,
    config: merged.config,
  };
}

/**
 * Aggregate FilmCraft status for `doctor`.
 *
 * @param {object} [options]
 * @returns {{
 *   installed: boolean,
 *   cli: string|null,
 *   app: string|null,
 *   source: string|null,
 *   version: string|null,
 *   mcp: { registered: boolean|null, client: string|null, path: string|null, error: string|null },
 *   mcpConfig: { opencode: string, claude: string }
 * }}
 */
export function filmCraftStatus(options = {}) {
  options = options || {};
  const found = findFilmCraft(options);
  const cli = found.cli || "filmcraft-cli";
  return {
    installed: found.installed,
    cli: found.cli,
    app: found.app,
    source: found.source,
    version: found.cli ? filmCraftVersion(found.cli, options) : null,
    mcp: filmCraftMcpRegistration(options),
    mcpConfig: {
      opencode: filmCraftMcpSnippet({ client: "opencode", cli }),
      claude: filmCraftMcpSnippet({ client: "claude", cli }),
    },
  };
}

/**
 * Onboarding question for the optional FilmCraft timeline target.
 *
 * The CLI never prompts by itself: it returns the question and the options so
 * an agent can ask in the user's language and only write config after an
 * explicit yes.
 *
 * @param {{installed?: boolean, cli?: string|null, mcp?: {registered?: boolean|null}}} status
 * @returns {{kind: string, question: string, questionPt: string, options: string[], optionsPt: string[]}}
 */
export function filmCraftOnboardingPrompt(status = {}) {
  const value = status && typeof status === "object" ? status : {};
  if (!value.installed) {
    return {
      kind: "install",
      question:
        "FilmCraft was not found on this PC. Continue with HyperFrames/Remotion, or install FilmCraft and connect its MCP?",
      questionPt:
        "Não encontrei o FilmCraft no seu PC. Quer continuar via HyperFrames/Remotion ou instalar o FilmCraft + conectar o MCP?",
      options: ["Continue with HyperFrames/Remotion", "Install FilmCraft + connect MCP"],
      optionsPt: ["Continuar via HyperFrames/Remotion", "Instalar FilmCraft + conectar MCP"],
    };
  }
  if (!value.cli) {
    return {
      kind: "install-cli",
      question:
        "FilmCraft is installed, but filmcraft-cli was not found. Install the CLI (or set ROOSTER_FILMCRAFT_CLI), then connect the MCP.",
      questionPt:
        "O FilmCraft está instalado, mas o filmcraft-cli não foi encontrado. Instale o CLI (ou defina ROOSTER_FILMCRAFT_CLI) e conecte o MCP.",
      options: ["Continue with HyperFrames/Remotion", "Install the FilmCraft CLI"],
      optionsPt: ["Continuar via HyperFrames/Remotion", "Instalar o CLI do FilmCraft"],
    };
  }
  if (value.mcp && value.mcp.registered === true) {
    return {
      kind: "ready",
      question:
        "FilmCraft was found and the MCP is configured. If the tools are not visible yet, restart the agent.",
      questionPt:
        "FilmCraft encontrado e MCP configurado. Se as tools ainda não apareceram, reinicie o agente.",
      options: [],
      optionsPt: [],
    };
  }
  return {
    kind: "connect-mcp",
    question:
      "FilmCraft was found on this PC. Connect its MCP now? After connecting, you must restart the program/agent so it can see the tools.",
    questionPt:
      "Encontrei o FilmCraft no seu PC. Deseja conectar o MCP agora? Depois de conectar, você precisará reiniciar o programa/agente para ele enxergar as tools.",
    options: ["Connect MCP", "Not now"],
    optionsPt: ["Conectar o MCP", "Agora não"],
  };
}
