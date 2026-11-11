/**
 * Live project watcher: a tiny local HTTP server with SSE hot reload.
 *
 * `rooster watch <slug>` serves one HTML page with the current stage, the plan
 * summary, generated media, renders, and the log tail. The page updates over
 * Server-Sent Events; there is no build step and no browser dependency.
 *
 * The server binds 127.0.0.1 only. Files are served from inside the project
 * directory, never outside it.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const WATCH_SCHEMA = "rooster.watch/v1";
export const WATCH_STATE_SCHEMA = "rooster.watch-state/v1";
export const WATCH_FILE = "work/watch.json";
export const WATCH_STATE_FILE = "work/watch-state.json";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const HTML_EXT = /\.html?$/i;
const CODE_EXT = /\.(tsx|ts|jsx|js|mjs|css|json|srt|vtt|md)$/i;
const MAX_IMAGES = 30;
const MAX_VIDEOS = 12;
const MAX_HTML = 24;
const MAX_CODE = 30;
const MAX_LOGS = 12;
const SKIP_DIRS = new Set(["node_modules", ".git", "cache", "dist", ".next"]);

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function stat(file) {
  try {
    const value = fs.statSync(file);
    return value.isFile() ? { size: value.size, mtime: value.mtimeMs } : null;
  } catch {
    return null;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const MANIFEST_NAMES = ["component.json", "meta.json"];
const TEXT_PROP = /^(title|text|label|heading|headline|name|kicker|tag|caption|subtitle|description|message|quote|author)$/i;
const NUMBER_PROP = /^(count|index|value|number|total|progress|percent|step|size|duration|amount)$/i;
const LIST_PROP = /^(items|rows|nodes|data|list|layers|series|points|values|options|entries)$/i;
const COLOR_PROP = /^(color|colour|accent|bg|background|fg|foreground|tint)$/i;

/**
 * Read a component manifest (`component.json` or `meta.json`) from a folder.
 *
 * The manifest may carry `description` and a `props` object used as the
 * default fixture.
 *
 * @param {string} dir
 * @returns {{file:string, description:string, props:object|null}|null}
 */
export function readComponentManifest(dir) {
  for (const name of MANIFEST_NAMES) {
    const file = path.join(dir, name);
    if (!exists(file)) continue;
    const value = readJson(file, null);
    if (value && typeof value === "object") {
      return {
        file,
        description: typeof value.description === "string" ? value.description : "",
        props: value.props && typeof value.props === "object" ? value.props : null,
      };
    }
  }
  return null;
}

/**
 * Prop names from the first destructured parameter of a component.
 *
 * Handles `function Hero({ title, count = 3 })` and
 * `const Hero = ({ title }: Props) => …`. Nested destructuring is ignored on
 * purpose: the preview stays a hint, not a type checker.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function inferPropNames(source) {
  const text = String(source || "");
  const match =
    text.match(/function\s+[A-Za-z0-9_$]*\s*\(\s*\{([^}]*)\}/) ||
    text.match(/=\s*\(\s*\{([^}]*)\}\s*\)\s*=>/);
  if (!match) return [];
  const names = [];
  for (const part of match[1].split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const name = piece.split(/[:=]/)[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return Array.from(new Set(names));
}

/**
 * Values for inferred props: text uses the manifest description, numbers a
 * small value, lists an empty array, booleans false, colors the accent.
 * Unknown props are left out so the component's own defaults apply.
 *
 * @param {string[]} names
 * @param {string} description
 * @returns {object}
 */
export function inferDefaultProps(names, description = "") {
  const text = String(description || "").trim();
  const props = {};
  for (const name of Array.isArray(names) ? names : []) {
    if (TEXT_PROP.test(name)) props[name] = text || "Preview";
    else if (NUMBER_PROP.test(name)) props[name] = 3;
    else if (LIST_PROP.test(name)) props[name] = [];
    else if (COLOR_PROP.test(name)) props[name] = "#22d3ee";
    else if (/^(active|selected|visible|open|enabled|disabled|loading|dark)$/i.test(name)) {
      props[name] = false;
    }
  }
  return props;
}

/**
 * Decide how a component gets its preview props.
 *
 * Order: an explicit `preview.*` fixture, then the manifest `props`, then
 * props inferred from the destructured parameter names.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {{fixture:string|null, props:object|null, source:"file"|"manifest"|"inferred"|null, manifest:string|null}}
 */
export function resolveComponentFixture(dir, file) {
  const fixture = findPreviewFixture(dir, file);
  if (fixture) return { fixture, props: null, source: "file", manifest: null };

  const manifest = readComponentManifest(dir);
  if (manifest?.props) {
    return { fixture: null, props: manifest.props, source: "manifest", manifest: manifest.file };
  }
  const inferred = inferDefaultProps(inferPropNames(readText(file)), manifest?.description || "");
  if (Object.keys(inferred).length) {
    return { fixture: null, props: inferred, source: "inferred", manifest: manifest?.file || null };
  }
  return { fixture: null, props: null, source: null, manifest: manifest?.file || null };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function listFiles(dir, pattern, limit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const info = stat(full);
    if (info) files.push({ name: entry.name, path: full, ...info });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return limit ? files.slice(0, limit) : files;
}

function countDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Collect files under the given roots, newest first.
 *
 * `roots` are `{dir, depth, group}` relative to the project. Directories that
 * never hold artifacts (node_modules, caches) are skipped, and every walk is
 * bounded by `depth` and the final `limit`.
 *
 * @param {string} projectDir
 * @param {Array<{dir:string, depth:number, group:string}>} roots
 * @param {RegExp} pattern
 * @param {number} limit
 * @returns {Array<object>}
 */
function collectFiles(projectDir, roots, pattern, limit) {
  const found = [];
  const walk = (base, relative, depth) => {
    if (depth < 0 || found.length > limit * 8) return;
    let entries;
    try {
      entries = fs.readdirSync(path.join(base, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(base, next, depth - 1);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        const info = stat(path.join(base, next));
        if (info) found.push({ relative: next.split(path.sep).join("/"), ...info });
      }
    }
  };
  for (const root of roots) walk(projectDir, root.dir, root.depth);
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((file) => ({
      name: path.basename(file.relative),
      relative: file.relative,
      size: file.size,
      mtime: new Date(file.mtime).toISOString(),
    }));
}

function artifactFiles(projectDir) {
  return {
    videos: collectFiles(
      projectDir,
      [
        { dir: "renders", depth: 1, group: "render" },
        { dir: "assets/generated", depth: 2, group: "generated" },
        { dir: "assets/source", depth: 2, group: "source" },
        { dir: "assets/licensed", depth: 2, group: "licensed" },
        { dir: "engine/filmcraft/elements", depth: 1, group: "element" },
      ],
      VIDEO_EXT,
      MAX_VIDEOS
    ),
    images: collectFiles(
      projectDir,
      [
        { dir: "style/proof", depth: 2, group: "proof" },
        { dir: "qa/frames", depth: 2, group: "qa" },
        { dir: "storyboard/frames", depth: 2, group: "storyboard" },
        { dir: "assets/generated", depth: 2, group: "generated" },
        { dir: "assets/licensed", depth: 2, group: "licensed" },
        { dir: "renders", depth: 1, group: "render" },
      ],
      IMAGE_EXT,
      MAX_IMAGES
    ),
    html: collectFiles(
      projectDir,
      [
        { dir: "edit", depth: 1, group: "plan" },
        { dir: "preview", depth: 1, group: "preview" },
        { dir: "style", depth: 4, group: "style" },
        { dir: "engine", depth: 5, group: "engine" },
      ],
      HTML_EXT,
      MAX_HTML
    ),
    code: collectFiles(
      projectDir,
      [
        { dir: "style/components", depth: 3, group: "component" },
        { dir: "engine", depth: 5, group: "engine" },
      ],
      CODE_EXT,
      MAX_CODE
    ),
  };
}

function cfg(projectDir, ...parts) {
  return path.join(projectDir, ...parts);
}

/**
 * The eight stages from `SKILL.md`, expressed as files that prove the stage ran.
 *
 * @returns {Array<{id:string,label:string,files:string[],done:(projectDir:string)=>boolean}>}
 */
export function stageDefinitions() {
  return [
    {
      id: "workspace",
      label: "Environment and workspace",
      files: ["project.json", "brief.md"],
      done: (dir) => exists(cfg(dir, "project.json")),
    },
    {
      id: "brief",
      label: "Brief and intake",
      files: ["brief.md", "script.md", "style.md"],
      done: (dir) => exists(cfg(dir, "brief.md")) && exists(cfg(dir, "script.md")),
    },
    {
      id: "assets",
      label: "Assets and transcript",
      files: ["assets/manifest.json", "edit/transcript.json", "edit/analysis.json"],
      done: (dir) => {
        const manifest = readJson(cfg(dir, "assets", "manifest.json"), {});
        const listed = Array.isArray(manifest.assets) ? manifest.assets.length : 0;
        return listed > 0 || exists(cfg(dir, "edit", "transcript.json"));
      },
    },
    {
      id: "plan",
      label: "Edit plan",
      files: ["edit/plan.json", "edit/plan.html", "qa/plan-review.md"],
      done: (dir) => exists(cfg(dir, "edit", "plan.json")),
    },
    {
      id: "timeline",
      label: "Storyboard and timeline",
      files: ["storyboard/storyboard.json", "edit/timeline.json", "edit/edl.json"],
      done: (dir) => {
        const storyboard = readJson(cfg(dir, "storyboard", "storyboard.json"), {});
        const timeline = readJson(cfg(dir, "edit", "timeline.json"), {});
        const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes.length : 0;
        const clips = Array.isArray(timeline.tracks)
          ? timeline.tracks.reduce((sum, track) => sum + (track.clips?.length || 0), 0)
          : 0;
        return scenes > 0 || clips > 0;
      },
    },
    {
      id: "build",
      label: "Engine choice and build",
      files: ["work/build-state.json", "work/filmcraft.json"],
      done: (dir) =>
        exists(cfg(dir, "work", "build-state.json")) || exists(cfg(dir, "work", "filmcraft.json")),
    },
    {
      id: "preview",
      label: "Preview and QA",
      files: ["preview/index.html", "qa/report.md", "qa/text-review.md"],
      done: (dir) =>
        (exists(cfg(dir, "preview", "index.html")) && exists(cfg(dir, "qa", "report.md"))) ||
        exists(cfg(dir, "qa", "text-review.md")),
    },
    {
      id: "render",
      label: "Render and delivery",
      files: ["renders/final.mp4", "renders/draft.mp4", "renders/metadata.json"],
      done: (dir) => exists(cfg(dir, "renders", "final.mp4")),
    },
  ];
}

function lastLogLine(projectDir) {
  const dir = cfg(projectDir, "work", "logs");
  const logs = listFiles(dir, /\.log$/i, 1);
  if (!logs.length) return null;
  const file = logs[0].path;
  try {
    const data = fs.readFileSync(file, "utf8");
    const lines = data.split(/\r?\n/).filter(Boolean);
    return { name: logs[0].name, lines: lines.slice(-MAX_LOGS) };
  } catch {
    return null;
  }
}

/**
 * Everything the live page shows, as plain JSON.
 *
 * @param {string} projectDir
 * @param {{now?: number, state?: object|null}} [options]
 * @returns {object}
 */
export function buildSnapshot(projectDir, options = {}) {
  const now = Number(options.now) || Date.now();
  const state = options.state || readWatchState(projectDir) || {};
  const project = readJson(cfg(projectDir, "project.json"), {});
  const plan = readJson(cfg(projectDir, "edit", "plan.json"), null);
  const transcript = readJson(cfg(projectDir, "edit", "transcript.json"), null);
  const manifest = readJson(cfg(projectDir, "assets", "manifest.json"), {});

  const seen = new Set();
  const stages = [];
  let activeFound = false;
  for (const definition of stageDefinitions()) {
    const done = Boolean(definition.done(projectDir));
    const saved = state?.stages?.[definition.id] || {};
    const files = definition.files
      .map((relative) => ({ relative, info: stat(cfg(projectDir, relative)) }))
      .filter((item) => item.info);
    const lastChange = files.reduce((max, item) => Math.max(max, item.info.mtime), 0);

    if (done) seen.add(definition.id);
    let status;
    if (done) status = "done";
    else if (!activeFound) {
      status = "active";
      activeFound = true;
    } else status = "pending";

    const startedAt = saved.firstSeen || lastChange || null;
    const finishedAt = done ? saved.doneAt || lastChange || null : null;
    const end = finishedAt || (status === "active" ? now : null);
    stages.push({
      id: definition.id,
      label: definition.label,
      status,
      files: files.map((item) => item.relative),
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      finishedAt: finishedAt ? new Date(finishedAt).toISOString() : null,
      durationMs: startedAt && end ? Math.max(0, end - startedAt) : null,
    });
  }

  const artifacts = artifactFiles(projectDir);
  const bundler = Boolean(findBundler(projectDir));
  artifacts.code = artifacts.code.map((file) => {
    const renderable =
      bundler && /\.(tsx|jsx|ts)$/i.test(file.name) && !/\.d\.ts$/i.test(file.name);
    let fixture = null;
    let fixtureSource = null;
    if (renderable) {
      const full = path.join(projectDir, file.relative);
      const found = findPreviewFixture(path.dirname(full), full);
      if (found) {
        fixture = path.relative(projectDir, found).split(path.sep).join("/");
        fixtureSource = "file";
      } else {
        const manifest = readComponentManifest(path.dirname(full));
        if (manifest?.props) fixtureSource = "manifest";
        else if (manifest?.description) fixtureSource = "inferred";
      }
    }
    return { ...file, fixture, fixtureSource, renderable };
  });
  const images = artifacts.images;
  const renders = artifacts.videos.filter((file) => file.relative.startsWith("renders/"));

  const cuts = Array.isArray(plan?.cuts) ? plan.cuts.length : 0;
  const elements = Array.isArray(plan?.elements) ? plan.elements.length : 0;
  const segments = Array.isArray(transcript?.segments) ? transcript.segments.length : 0;

  return {
    schema: WATCH_SCHEMA,
    project: project.slug || path.basename(projectDir),
    name: project.name || project.slug || path.basename(projectDir),
    channel: project.channel || null,
    engine: project.engine || null,
    timeline: project.timeline || "none",
    createdAt: project.createdAt || null,
    updatedAt: new Date(now).toISOString(),
    stages,
    current: stages.find((stage) => stage.status === "active") || null,
    progress: {
      done: stages.filter((stage) => stage.status === "done").length,
      total: stages.length,
    },
    plan: plan
      ? {
          editMode: plan.editMode || "cleanup",
          duration: Number(plan.duration) || null,
          cuts,
          elements,
          segments,
          source: plan.source || null,
        }
      : null,
    assets: {
      listed: Array.isArray(manifest.assets) ? manifest.assets.length : 0,
      source: countDir(cfg(projectDir, "assets", "source")),
      generated: countDir(cfg(projectDir, "assets", "generated")),
      licensed: countDir(cfg(projectDir, "assets", "licensed")),
    },
    images,
    renders,
    files: artifacts,
    preview: { bundler },
    log: lastLogLine(projectDir),
    watch: readWatch(projectDir),
  };
}

/**
 * Merge the snapshot into the persisted timings (`work/watch-state.json`).
 *
 * @param {object|null} previous
 * @param {object} snapshot
 * @param {number} now
 * @returns {object}
 */
export function updateWatchState(previous, snapshot, now = Date.now()) {
  const state = {
    schema: WATCH_STATE_SCHEMA,
    project: snapshot.project,
    firstSeen: previous?.firstSeen || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    stages: { ...(previous?.stages || {}) },
  };
  for (const stage of snapshot.stages) {
    const current = state.stages[stage.id] || {};
    const firstSeen = current.firstSeen || stage.startedAt || new Date(now).toISOString();
    const doneAt =
      stage.status === "done" ? current.doneAt || stage.finishedAt || new Date(now).toISOString() : null;
    state.stages[stage.id] = { firstSeen, doneAt };
  }
  return state;
}

export function readWatchState(projectDir) {
  const state = readJson(cfg(projectDir, WATCH_STATE_FILE), null);
  return state && state.schema === WATCH_STATE_SCHEMA ? state : null;
}

export function writeWatchState(projectDir, state) {
  writeJson(cfg(projectDir, WATCH_STATE_FILE), state);
}

export function readWatch(projectDir) {
  const state = readJson(cfg(projectDir, WATCH_FILE), null);
  return state && state.schema === WATCH_SCHEMA ? state : null;
}

export function writeWatch(projectDir, value) {
  writeJson(cfg(projectDir, WATCH_FILE), { schema: WATCH_SCHEMA, ...value });
}

export function clearWatch(projectDir) {
  try {
    fs.rmSync(cfg(projectDir, WATCH_FILE), { force: true });
  } catch {
    // A stale file is harmless; the pid check covers it.
  }
}

export function isWatchAlive(status) {
  if (!status || !Number.isFinite(Number(status.pid))) return false;
  try {
    process.kill(Number(status.pid), 0);
    return true;
  } catch {
    return false;
  }
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function safeFile(projectDir, relative) {
  const clean = String(relative || "").replace(/^\/+/, "");
  const full = path.resolve(projectDir, clean);
  const base = path.resolve(projectDir);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) return null;
  return exists(full) ? full : null;
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

/**
 * Prepare an HTML artifact for the iframe.
 *
 * HyperFrames compositions keep their markup and styles inside `<template>`,
 * which is inert until the runtime clones it; opened raw, they render blank.
 * The harness clones every template and installs a no-op GSAP stub so the
 * static first frame is visible. A bare fragment is wrapped in a dark document;
 * a complete document is returned untouched.
 *
 * @param {string} text
 * @returns {string}
 */
export function previewDocument(text) {
  const source = String(text || "");
  const hasHtml = /<html[\s>]/i.test(source);
  const hasTemplate = /<template[\s>]/i.test(source);
  const harness = `<style>html,body{background:#0b0d12;}</style><script>
(function () {
  if (!window.__timelines) window.__timelines = {};
  var timeline = function () {
    var api = { duration: function () { return 0; } };
    ["seek","fromTo","to","from","set","add","pause","play","time","eventCallback","progress","stagger"].forEach(function (name) {
      api[name] = function () { return api; };
    });
    return api;
  };
  if (!window.gsap) window.gsap = { timeline: timeline, fromTo: timeline, to: timeline, from: timeline, set: timeline };
  document.querySelectorAll("template").forEach(function (node) {
    var host = document.createElement("div");
    host.style.cssText = "position:absolute;inset:0";
    host.appendChild(node.content.cloneNode(true));
    document.body.appendChild(host);
    node.remove();
  });
})();
</script>`;
  if (hasHtml) {
    if (!hasTemplate) return source;
    return source.replace(/<\/body>/i, `${harness}</body>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />${harness}</head><body>${source}</body></html>`;
}

/**
 * Serve one video poster, generating it with FFmpeg on first request.
 *
 * @param {string} projectDir
 * @param {string} relative
 * @param {string} file
 * @returns {{ok:true, file:string}|{ok:false}}
 */
export function ensurePoster(projectDir, relative, file) {
  const info = stat(file);
  if (!info) return { ok: false };
  const dir = path.join(projectDir, "work", "watch", "posters");
  const key = crypto
    .createHash("sha1")
    .update(`${relative}|${info.mtime}|${info.size}`)
    .digest("hex")
    .slice(0, 16);
  const out = path.join(dir, `${key}.jpg`);
  if (exists(out)) return { ok: true, file: out };
  fs.mkdirSync(dir, { recursive: true });
  const bin = process.env.ROOSTER_FFMPEG || "ffmpeg";
  const result = runProcess(
    bin,
    ["-y", "-ss", "0.5", "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", out],
    { timeout: 15000 }
  );
  return result.status === 0 && exists(out) ? { ok: true, file: out } : { ok: false };
}

function runProcess(command, args, options = {}) {
  try {
    const child = spawnSync(command, args, {
      timeout: options.timeout || 15000,
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: child.status, stdout: child.stdout || "", stderr: child.stderr || "" };
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error.message || error) };
  }
}

/**
 * Minimal page shell. Inline CSS/JS so the page needs no build and no CDN.
 *
 * @returns {string}
 */
export function watchHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RoosterEdit — live</title>
<style>
  :root { color-scheme: dark; --bg:#0b0d12; --panel:#12151d; --line:#232838; --fg:#e8eaf0; --muted:#8b93a7; --accent:#22d3ee; --ok:#34d399; --wait:#fbbf24; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  h1 { font-size:18px; font-weight:600; margin:0; letter-spacing:-0.01em; }
  h1 span { color:var(--muted); font-weight:400; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); margin-right:6px; vertical-align:middle; }
  .dot.off { background:var(--wait); }
  .elapsed { font-variant-numeric: tabular-nums; color:var(--muted); }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin-bottom:14px; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 12px; font-weight:600; }
  ol.stages { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
  ol.stages li { display:flex; align-items:center; gap:10px; padding:5px 0; }
  .num { width:20px; height:20px; border-radius:50%; border:1px solid var(--line); display:grid; place-items:center; font-size:10px; color:var(--muted); flex:none; }
  .done .num { border-color:var(--ok); color:var(--ok); }
  .active .num { border-color:var(--accent); color:var(--accent); }
  .label { flex:1; }
  .done .label { color:var(--muted); }
  .dur { font-variant-numeric: tabular-nums; color:var(--muted); font-size:12px; }
  .active .dur { color:var(--accent); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; color:var(--muted); }
  .chip b { color:var(--fg); font-weight:600; font-variant-numeric: tabular-nums; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; }
  .grid a { display:block; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#0e1117; }
  .grid img { display:block; width:100%; height:78px; object-fit:cover; }
  .grid span { display:block; padding:4px 6px; font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .videos { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px; }
  .videos figure { margin:0; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#0e1117; }
  .videos video { display:block; width:100%; max-height:150px; background:#000; }
  .videos figcaption { padding:5px 7px; font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  details { border:1px solid var(--line); border-radius:8px; padding:6px 9px; margin-bottom:6px; background:#0e1117; }
  details summary { cursor:pointer; font-size:12px; color:var(--fg); }
  details summary .muted { font-size:11px; }
  details iframe { width:100%; height:360px; border:1px solid var(--line); border-radius:6px; background:#0b0d12; margin-top:8px; }
  pre.code { max-height:280px; margin-top:8px; }
  .links { display:flex; flex-direction:column; gap:4px; }
  pre { margin:0; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--muted); white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; }
  .muted { color:var(--muted); }
  .row { display:flex; gap:16px; flex-wrap:wrap; }
  .row > div { flex:1 1 200px; }
</style>
</head>
<body>
<main>
  <header>
    <h1><span class="dot" id="dot"></span><span id="name">RoosterEdit</span> <span id="slug"></span></h1>
    <div class="elapsed"><span id="progress">0/8</span> · <span id="elapsed">—</span> · <span id="engine"></span></div>
  </header>

  <section>
    <h2>Stages</h2>
    <ol class="stages" id="stages"></ol>
  </section>

  <section>
    <h2>Plan</h2>
    <div class="chips" id="plan"><span class="muted">No plan yet</span></div>
  </section>

  <section>
    <h2>Videos</h2>
    <div class="videos" id="videos"><span class="muted">No video yet</span></div>
  </section>

  <section>
    <h2>Images</h2>
    <div class="grid" id="media"><span class="muted">Nothing generated yet</span></div>
  </section>

  <section>
    <h2>HTML artifacts</h2>
    <div class="links" id="html"><span class="muted">No HTML yet</span></div>
  </section>

  <section>
    <h2>Components and code</h2>
    <div class="links" id="code"><span class="muted">No component yet</span></div>
  </section>

  <section>
    <h2>Log</h2>
    <pre id="log">No log yet</pre>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const dur = (ms) => {
    if (ms == null) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + pad(s % 60) + "s";
  };
  const bytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";

  function render(state) {
    $("name").textContent = state.name || state.project;
    $("slug").textContent = state.channel ? "· " + state.channel : "";
    $("progress").textContent = state.progress.done + "/" + state.progress.total;
    $("engine").textContent = [state.engine, state.timeline !== "none" ? state.timeline : null].filter(Boolean).join(" + ");
    const total = state.stages.reduce((sum, s) => sum + (s.durationMs || 0), 0);
    $("elapsed").textContent = total ? dur(total) : "—";

    $("stages").innerHTML = state.stages.map((s, i) => {
      const cls = s.status === "done" ? "done" : s.status === "active" ? "active" : "";
      return '<li class="' + cls + '"><span class="num">' + (i + 1) + '</span><span class="label">' +
        s.label + '</span><span class="dur">' + (s.durationMs != null ? dur(s.durationMs) : "") + '</span></li>';
    }).join("");

    const p = state.plan;
    $("plan").innerHTML = p
      ? '<span class="chip">mode <b>' + p.editMode + '</b></span>' +
        '<span class="chip">cuts <b>' + p.cuts + '</b></span>' +
        '<span class="chip">elements <b>' + p.elements + '</b></span>' +
        '<span class="chip">segments <b>' + p.segments + '</b></span>' +
        '<span class="chip">duration <b>' + (p.duration ? Math.round(p.duration) + "s" : "—") + '</b></span>'
      : '<span class="muted">No plan yet</span>';

    const files = state.files || { videos: [], images: [], html: [], code: [] };

    updateList("media", files.images || state.images, imageNode, (img) => img.name,
      "Nothing generated yet");
    updateList("videos", files.videos, videoNode, (v) => v.name + " · " + bytes(v.size),
      "No video yet");
    updateList("html", files.html, htmlNode, (h) => "· " + bytes(h.size), "No HTML yet");
    updateList("code", files.code, codeNode, (c) =>
      "· " + bytes(c.size) + (c.renderable ? " · react" : "") +
      (c.fixtureSource === "file" || c.fixtureSource === "manifest"
        ? " · with props"
        : c.fixtureSource === "inferred"
          ? " · auto props"
          : ""), "No component yet");

    $("log").textContent = state.log && state.log.lines.length
      ? state.log.lines.join("\\n")
      : "No log yet";
  }

  const fileUrl = (relative) => "/file/" + String(relative).split("/").map(encodeURIComponent).join("/");
  const posterUrl = (relative) => "/poster/" + String(relative).split("/").map(encodeURIComponent).join("/");

  const listNodes = {};
  function updateList(id, items, create, meta, emptyText) {
    const container = $(id);
    const map = listNodes[id] || (listNodes[id] = new Map());
    const keep = new Set(items.map((item) => item.relative));
    for (const [key, node] of map) {
      if (!keep.has(key)) { node.remove(); map.delete(key); }
    }
    items.forEach((item, index) => {
      let node = map.get(item.relative);
      if (!node) {
        node = create(item);
        node.dataset.key = item.relative;
        map.set(item.relative, node);
        container.insertBefore(node, container.children[index] || null);
      }
      const slot = node.querySelector("[data-meta]");
      if (slot) slot.textContent = meta(item);
    });
    const placeholder = container.querySelector("[data-empty]");
    if (items.length) {
      if (placeholder) placeholder.remove();
    } else if (!placeholder) {
      const span = document.createElement("span");
      span.className = "muted";
      span.dataset.empty = "";
      span.textContent = emptyText;
      container.appendChild(span);
    }
  }

  function imageNode(img) {
    const link = document.createElement("a");
    link.href = fileUrl(img.relative);
    link.target = "_blank";
    const image = document.createElement("img");
    image.loading = "lazy";
    image.src = fileUrl(img.relative);
    image.alt = img.name;
    const label = document.createElement("span");
    label.dataset.meta = "";
    link.appendChild(image);
    link.appendChild(label);
    return link;
  }

  function videoNode(video) {
    const figure = document.createElement("figure");
    const player = document.createElement("video");
    player.controls = true;
    player.preload = "metadata";
    player.poster = posterUrl(video.relative);
    player.src = fileUrl(video.relative) + "#t=0.1";
    const label = document.createElement("figcaption");
    label.dataset.meta = "";
    figure.appendChild(player);
    figure.appendChild(label);
    return figure;
  }

  function htmlNode(file) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.appendChild(document.createTextNode(file.relative + " "));
    const label = document.createElement("span");
    label.className = "muted";
    label.dataset.meta = "";
    summary.appendChild(label);
    const frame = document.createElement("iframe");
    frame.loading = "lazy";
    frame.src = fileUrl(file.relative);
    frame.title = file.name;
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.style.marginTop = "6px";
    const link = document.createElement("a");
    link.className = "chip";
    link.href = fileUrl(file.relative);
    link.target = "_blank";
    link.textContent = "open in a new tab";
    chips.appendChild(link);
    details.appendChild(summary);
    details.appendChild(frame);
    details.appendChild(chips);
    return details;
  }

  function codeNode(file) {
    const details = document.createElement("details");
    details.dataset.src = fileUrl(file.relative);
    const summary = document.createElement("summary");
    summary.appendChild(document.createTextNode(file.relative + " "));
    const label = document.createElement("span");
    label.className = "muted";
    label.dataset.meta = "";
    summary.appendChild(label);
    details.appendChild(summary);
    if (file.renderable) {
      const frame = document.createElement("iframe");
      frame.loading = "lazy";
      frame.src = "/component/" + encodeURIComponent(file.relative);
      frame.title = file.name;
      details.appendChild(frame);
    }
    const pre = document.createElement("pre");
    pre.className = "code muted";
    pre.textContent = "Open to load the file.";
    details.appendChild(pre);
    return details;
  }

  $("code").addEventListener("toggle", (event) => {
    const node = event.target;
    if (!node || node.tagName !== "DETAILS" || !node.open || node.dataset.loaded) return;
    const pre = node.querySelector("pre");
    if (!pre) return;
    node.dataset.loaded = "1";
    fetch(node.dataset.src)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("http"))))
      .then((text) => { pre.textContent = text.length > 200000 ? text.slice(0, 200000) + "\\n…" : text; })
      .catch(() => { pre.textContent = "Could not load this file."; });
  }, true);

  const source = new EventSource("/events");
  source.onopen = () => $("dot").classList.remove("off");
  source.onerror = () => $("dot").classList.add("off");
  source.onmessage = (event) => {
    try { render(JSON.parse(event.data)); } catch {}
  };
</script>
</body>
</html>`;
}

/**
 * Start the watcher. Resolves with the bound port; the server keeps running.
 *
 * @param {{projectDir:string, host?:string, port?:number, intervalMs?:number}} options
 * @returns {Promise<{port:number, url:string, close:()=>Promise<void>}>}
 */
export async function startWatchServer(options) {
  const projectDir = path.resolve(options.projectDir);
  const host = options.host || "127.0.0.1";
  const intervalMs = Math.max(400, Number(options.intervalMs) || 1000);
  const clients = new Set();
  let state = readWatchState(projectDir);
  let lastHash = null;

  const snapshot = () => {
    const now = Date.now();
    const value = buildSnapshot(projectDir, { now, state });
    const next = updateWatchState(state, value, now);
    if (JSON.stringify(next.stages) !== JSON.stringify(state?.stages || {})) {
      state = next;
      writeWatchState(projectDir, state);
    }
    return value;
  };

  const push = () => {
    if (!clients.size) return;
    const value = snapshot();
    const key = hash(JSON.stringify(value));
    if (key === lastHash) {
      for (const res of clients) res.write(": ping\n\n");
      return;
    }
    lastHash = key;
    const payload = `data: ${JSON.stringify(value)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = watchHtml();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (url.pathname === "/api/state") {
      const body = JSON.stringify(snapshot(), null, 2);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (url.pathname === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, project: path.basename(projectDir) }));
      return;
    }
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      clients.add(res);
      const value = snapshot();
      lastHash = hash(JSON.stringify(value));
      res.write(`data: ${JSON.stringify(value)}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith("/component-bundle/")) {
      const relative = decodeURIComponent(url.pathname.slice("/component-bundle/".length));
      const file = safeFile(projectDir, relative);
      const result = file ? ensureComponentBundle(projectDir, relative, file) : { ok: false };
      if (!result.ok) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(result.error || "Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      fs.createReadStream(result.file).pipe(res);
      return;
    }
    if (url.pathname.startsWith("/component/")) {
      const relative = decodeURIComponent(url.pathname.slice("/component/".length));
      const file = safeFile(projectDir, relative);
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const result = ensureComponentBundle(projectDir, relative, file);
      const body = result.ok
        ? componentShell({
            title: relative,
            bundleUrl: `/component-bundle/${encodeURIComponent(relative)}?v=${result.version}`,
          })
        : componentShell({ title: relative, error: result.error });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (url.pathname.startsWith("/poster/")) {
      const relative = decodeURIComponent(url.pathname.slice("/poster/".length));
      const file = safeFile(projectDir, relative);
      const poster = file ? ensurePoster(projectDir, relative, file) : { ok: false };
      if (!poster.ok) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("No poster");
        return;
      }
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=60" });
      fs.createReadStream(poster.file).pipe(res);
      return;
    }
    if (url.pathname.startsWith("/file/")) {
      const relative = decodeURIComponent(url.pathname.slice("/file/".length));
      const file = safeFile(projectDir, relative);
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
      if (type.startsWith("text/html")) {
        const info = stat(file);
        const text = info && info.size < 4 * 1024 * 1024 ? fs.readFileSync(file, "utf8") : null;
        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        res.end(text === null ? fs.readFileSync(file) : previewDocument(text));
        return;
      }
      const info = stat(file);
      const range = req.headers.range;
      if (info && typeof range === "string" && /^bytes=/.test(range)) {
        const [startRaw, endRaw] = range.replace(/^bytes=/, "").split("-");
        const start = Math.max(0, Number(startRaw) || 0);
        const end = endRaw ? Math.min(Number(endRaw) || 0, info.size - 1) : info.size - 1;
        if (start >= info.size || end < start) {
          res.writeHead(416, { "content-range": `bytes */${info.size}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          "content-type": type,
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${info.size}`,
          "accept-ranges": "bytes",
          "cache-control": "no-store",
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "content-type": type,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const timer = setInterval(push, intervalMs);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(options.port) || 0, host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : Number(options.port) || 0;
  const url = `http://${host}:${port}/`;

  return {
    port,
    url,
    close: async () => {
      clearInterval(timer);
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // The client is already gone.
        }
      }
      clients.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Start the watcher as a detached process and wait for its `work/watch.json`.
 *
 * @param {{roosterScript:string, slug:string, cwd:string, port?:number, env?:object, timeoutMs?:number}} options
 * @returns {Promise<{url:string, port:number, pid:number}>}
 */
export async function spawnWatch(options) {
  const projectDir = options.projectDir;
  const args = [options.roosterScript, "watch", options.slug, "--serve", "--port", String(options.port || 0)];
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}), ROOSTER_WATCH_CHILD: "1" },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + (Number(options.timeoutMs) || 4000);
  while (Date.now() < deadline) {
    const status = readWatch(projectDir);
    if (status && status.pid === child.pid) return status;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`The live server did not start. Run it in the foreground: watch ${options.slug} --serve`);
}

export function openInBrowser(url, options = {}) {
  if (options.print) return url;
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
  return url;
}

// ---------------------------------------------------------------------------
// React component preview
// ---------------------------------------------------------------------------

const COMPONENT_ENTRY = `import * as React from "react";
import { createRoot } from "react-dom/client";
import * as mod from __COMPONENT__;
__FIXTURE__
const Component = mod.default || Object.values(mod).find((value) => typeof value === "function");
const node = document.getElementById("root");
const fixture = __PROPS__;
let view = null;
if (React.isValidElement(fixture)) view = fixture;
else if (typeof fixture === "function") view = React.createElement(fixture);
else if (Component) view = React.createElement(Component, fixture || {});
if (!view) {
  node.textContent = "No React component export was found in this file.";
} else {
  try {
    createRoot(node).render(view);
  } catch (error) {
    node.textContent = String((error && error.message) || error);
  }
}
`;

const BUNDLER_SCRIPT = `const esbuild = require(__ESBUILD__);
try {
  esbuild.buildSync({
    entryPoints: [process.argv[2]],
    outfile: process.argv[3],
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    absWorkingDir: __WORKDIR__,
    nodePaths: [__NODEPATH__],
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".jsx": "jsx",
      ".css": "empty",
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".gif": "dataurl",
      ".webp": "dataurl",
      ".svg": "dataurl",
    },
    define: { "process.env.NODE_ENV": "\\"development\\"" },
    logLevel: "silent",
  });
} catch (error) {
  console.error(String((error && error.message) || error));
  process.exit(1);
}
`;

/**
 * Find the preview fixture for a component.
 *
 * Order: `<name>.preview.tsx|jsx|ts|json`, `<name>.props.json`, then
 * `preview.tsx|jsx|ts|json` in the same folder. A fixture is either a JSON
 * props object, a module exporting `props`, or a module whose default export is
 * a component that renders the real one.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {string|null}
 */
export function findPreviewFixture(dir, file) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  const candidates = [
    `${base}.preview.tsx`,
    `${base}.preview.jsx`,
    `${base}.preview.ts`,
    `${base}.preview.json`,
    `${base}.props.json`,
    "preview.tsx",
    "preview.jsx",
    "preview.ts",
    "preview.json",
  ];
  for (const name of candidates) {
    const full = path.join(dir, name);
    if (path.resolve(full) !== path.resolve(file) && exists(full)) return full;
  }
  return null;
}

/**
 * Build the browser entry for one component, optionally with fixture props.
 *
 * @param {{component:string, fixture?:string|null}} options
 * @returns {string}
 */
export function buildComponentEntry(options = {}) {
  const fixture = options.fixture || null;
  const propsObject = options.props && typeof options.props === "object" ? options.props : null;
  let fixtureCode = "";
  let props = "null";
  if (fixture) {
    if (/\.json$/i.test(fixture)) {
      fixtureCode = `const fixtureProps = ${JSON.stringify(readJson(fixture, {}))};`;
      props = "fixtureProps";
    } else {
      fixtureCode =
        `import * as fixtureModule from ${JSON.stringify(fixture)};\n` +
        "const fixtureProps = fixtureModule.props !== undefined ? fixtureModule.props : fixtureModule.default;";
      props = "fixtureProps";
    }
  } else if (propsObject) {
    fixtureCode = `const fixtureProps = ${JSON.stringify(propsObject)};`;
    props = "fixtureProps";
  }
  return COMPONENT_ENTRY.replace("__COMPONENT__", JSON.stringify(options.component || ""))
    .replace("__FIXTURE__", fixtureCode)
    .replace("__PROPS__", props);
}

/**
 * Locate an esbuild installation the project already has (Remotion ships one).
 *
 * @param {string} projectDir
 * @returns {{cwd:string, esbuild:string, nodePath:string}|null}
 */
export function findBundler(projectDir) {
  const candidates = [
    projectDir,
    path.join(projectDir, "engine", "remotion"),
    path.join(projectDir, "engine", "filmcraft", "remotion"),
  ];
  for (const cwd of candidates) {
    const nodeModules = path.join(cwd, "node_modules");
    const esbuild = path.join(nodeModules, "esbuild");
    if (exists(path.join(esbuild, "package.json"))) {
      return { cwd, esbuild, nodePath: nodeModules };
    }
  }
  return null;
}

const bundleCache = new Map();

/**
 * Bundle a React component into one browser script, cached by mtime and size.
 *
 * @param {string} projectDir
 * @param {string} relative
 * @param {string} file
 * @returns {{ok:true, file:string, version:string}|{ok:false, error:string}}
 */
export function ensureComponentBundle(projectDir, relative, file) {
  const bundler = findBundler(projectDir);
  if (!bundler) {
    return {
      ok: false,
      error:
        "No esbuild found. Install Remotion in this project (or esbuild at the project root) to preview React components.",
    };
  }
  const info = stat(file);
  if (!info) return { ok: false, error: `Not a file: ${relative}` };
  const resolved = resolveComponentFixture(path.dirname(file), file);
  const fixture = resolved.fixture;
  const fixtureInfo = fixture ? stat(fixture) : null;
  const manifestInfo = resolved.manifest ? stat(resolved.manifest) : null;
  const version = [
    `${info.mtime}-${info.size}`,
    fixtureInfo ? `${fixtureInfo.mtime}-${fixtureInfo.size}` : "nofix",
    manifestInfo ? `${manifestInfo.mtime}-${manifestInfo.size}` : "noman",
    resolved.source || "none",
  ].join("|");
  const cached = bundleCache.get(relative);
  if (cached && cached.version === version) return cached.result;

  const dir = path.join(projectDir, "work", "watch");
  fs.mkdirSync(dir, { recursive: true });
  const safeName = relative.replace(/[^a-z0-9._-]+/gi, "-").slice(-60);
  const entry = path.join(dir, `entry-${safeName}.jsx`);
  const out = path.join(dir, `bundle-${safeName}.js`);
  const builder = path.join(dir, "esbuild.cjs");

  fs.writeFileSync(
    entry,
    buildComponentEntry({ component: file, fixture, props: resolved.props })
  );
  fs.writeFileSync(
    builder,
    BUNDLER_SCRIPT.replace("__ESBUILD__", JSON.stringify(bundler.esbuild))
      .replace("__WORKDIR__", JSON.stringify(bundler.cwd))
      .replace("__NODEPATH__", JSON.stringify(bundler.nodePath))
  );

  const result = runNode([builder, entry, out], { cwd: bundler.cwd, timeout: 45000 });
  let value;
  if (result.status === 0 && exists(out)) {
    value = { ok: true, file: out, version };
  } else {
    const message = String(result.stderr || result.stdout || "").split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
    value = {
      ok: false,
      error: message || "The component did not compile. Check its imports and syntax.",
    };
  }
  bundleCache.set(relative, { version, result: value });
  return value;
}

function runNode(args, options = {}) {
  try {
    const child = spawnSync(process.execPath, args, {
      cwd: options.cwd,
      timeout: options.timeout || 30000,
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: child.status, stdout: child.stdout || "", stderr: child.stderr || "" };
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error.message || error) };
  }
}

/**
 * The iframe document for one component: a root node plus the bundle, or the error.
 *
 * @param {{title?:string, bundleUrl?:string, error?:string}} options
 * @returns {string}
 */
export function componentShell(options = {}) {
  const title = String(options.title || "Component").replace(/[<>&"]/g, "");
  const body = options.error
    ? `<pre class="error">${String(options.error).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c])}</pre>`
    : `<div id="root"></div><script src="${String(options.bundleUrl || "").replace(/"/g, "%22")}"></script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin:0; height:100%; background:#0b0d12; color:#e8eaf0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  body { display:grid; place-items:center; padding:16px; }
  #root { width:100%; }
  .error { color:#fbbf24; font:12px/1.5 ui-monospace,monospace; white-space:pre-wrap; text-align:left; }
</style>
</head>
<body>${body}</body>
</html>`;
}