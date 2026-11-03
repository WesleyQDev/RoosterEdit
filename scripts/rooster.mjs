#!/usr/bin/env node
/**
 * RoosterEdit CLI
 *
 * Zero-dependency Node.js CLI for workspace, project, asset, and validation
 * operations. Engine-specific work is delegated to HyperFrames, Remotion, or
 * FFmpeg; this CLI keeps the editorial structure consistent.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const VERSION = "0.1.0";

const CWD = process.cwd();
const WORKSPACE = process.env.ROOSTER_WORKSPACE
  ? path.resolve(process.env.ROOSTER_WORKSPACE)
  : path.resolve(CWD, "rooster");
const ROOSTER_HOME = process.env.ROOSTER_HOME
  ? path.resolve(process.env.ROOSTER_HOME)
  : path.join(os.homedir(), ".rooster");

const ENGINE_IDS = ["auto", "hyperframes", "remotion", "ffmpeg"];
const SOURCE_IDS = ["live", "generated", "hybrid"];
const VOICE_IDS = ["user", "tts", "none"];
const STYLE_IDS = ["user", "profile", "ai", "reference"];
const AUTONOMY_IDS = ["auto", "guided", "manual"];
const STATUS_IDS = ["intake", "planning", "assets", "building", "preview", "qa", "rendering", "done", "blocked"];

const ASPECTS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
  return fs.existsSync(p);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value.replace(/\r\n/g, "\n"), "utf8");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "project";
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        out[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
      continue;
    }
    out._.push(arg);
  }
  return out;
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

function run(name, args = [], options = {}) {
  const executable = commandName(name);
  let spawnTarget = executable;
  let spawnArgs = args;

  // On Windows, .cmd files cannot be spawned directly; route them through cmd.exe.
  if (process.platform === "win32" && executable.toLowerCase().endsWith(".cmd")) {
    spawnTarget = process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", [executable, ...args].map(quoteCmd).join(" ")];
  }

  const result = spawnSync(spawnTarget, spawnArgs, {
    cwd: options.cwd || CWD,
    encoding: "utf8",
    timeout: options.timeout || 30000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function versionOf(name, args = ["--version"], options = {}) {
  const result = run(name, args, { timeout: options.timeout || 15000 });
  if (!result.ok) return null;
  return result.stdout.split(/\r?\n/)[0] || "detected";
}

function findProject(slug) {
  const raw = String(slug || "");
  const parts = raw.split("/").filter(Boolean);
  const hasChannel = parts.length === 2;
  const channelId = hasChannel ? slugify(parts[0]) : null;
  const projectSlug = slugify(hasChannel ? parts[1] : raw);

  if (channelId) {
    const dir = path.join(channelsDir(), channelId, "projects", projectSlug);
    return {
      dir,
      channel: channelId,
      slug: projectSlug,
      configPath: path.join(dir, "project.json"),
      config: readJson(path.join(dir, "project.json")),
    };
  }

  const matches = [];
  for (const id of listChannelIds()) {
    const dir = path.join(channelsDir(), id, "projects", projectSlug);
    if (exists(dir) || exists(path.join(dir, "project.json"))) {
      matches.push({
        dir,
        channel: id,
        slug: projectSlug,
        configPath: path.join(dir, "project.json"),
        config: readJson(path.join(dir, "project.json")),
      });
    }
  }

  const legacyDir = path.join(WORKSPACE, "projects", projectSlug);
  if (exists(legacyDir) || exists(path.join(legacyDir, "project.json"))) {
    matches.push({
      dir: legacyDir,
      channel: null,
      slug: projectSlug,
      configPath: path.join(legacyDir, "project.json"),
      config: readJson(path.join(legacyDir, "project.json")),
    });
  }

  if (matches.length > 1) {
    fail(
      `Project "${projectSlug}" exists in multiple channels:\n` +
        matches.map((match) => `  ${match.channel ? `${match.channel}/` : "standalone/"}${projectSlug}`).join("\n") +
        "\nUse <channel>/<slug> to select one."
    );
  }

  if (matches.length === 1) return matches[0];

  const fallbackDir = path.join(WORKSPACE, "projects", projectSlug);
  return {
    dir: fallbackDir,
    channel: null,
    slug: projectSlug,
    configPath: path.join(fallbackDir, "project.json"),
    config: readJson(path.join(fallbackDir, "project.json")),
  };
}

function projectSlugFromArg(args) {
  const slug = args._[0];
  if (!slug) {
    fail("Missing project slug. Usage: node scripts/rooster.mjs <command> <slug|channel/slug>");
  }
  return String(slug);
}

function fail(message, code = 1) {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
}

function heading(title) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

function checklist(value) {
  return value ? "✓" : "✗";
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

function detectLocalPackage() {
  const pkgPath = path.join(CWD, "package.json");
  const pkg = readJson(pkgPath, null);
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const has = (name) => Boolean(deps[name] || exists(path.join(CWD, "node_modules", name)));
  return {
    packageJson: Boolean(pkg),
    hyperframes: has("hyperframes") || exists(path.join(CWD, "node_modules", ".bin", "hyperframes")) ? "detected" : "not-detected",
    remotion: has("remotion") ? "detected" : "not-detected",
    three: has("three") ? "detected" : "not-detected",
    remotionThree: has("@remotion/three") ? "detected" : "not-detected",
  };
}

function detectTts() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    edgeTts: Boolean(versionOf("edge-tts", ["--version"])),
    piper: Boolean(versionOf("piper", ["--version"])),
  };
}

function detectWhisper() {
  const candidates = [
    ["whisper", ["--help"]],
    ["whisper-cli", ["--help"]],
    ["whisper-cpp", ["--help"]],
    ["faster-whisper", ["--help"]],
    ["mlx-whisper", ["--help"]],
  ];
  for (const [name, args] of candidates) {
    const result = run(name, args, { timeout: 15000 });
    if (result.ok || result.stdout || result.stderr) return name;
  }
  const py = run("python", ["-c", "import faster_whisper; print(getattr(faster_whisper, '__version__', 'detected'))"], { timeout: 15000 });
  if (py.ok) return "faster-whisper (python)";
  return null;
}

function doctor() {
  const engines = detectLocalPackage();
  const data = {
    schema: "rooster.doctor/v1",
    version: VERSION,
    os: process.platform,
    arch: process.arch,
    cwd: CWD,
    workspace: WORKSPACE,
    workspaceExists: exists(WORKSPACE),
    roosterHome: ROOSTER_HOME,
    node: process.version.replace(/^v/, ""),
    npm: versionOf("npm", ["--version"]),
    python: versionOf("python", ["--version"]) || versionOf("python3", ["--version"]),
    git: versionOf("git", ["--version"]),
    ffmpeg: versionOf("ffmpeg", ["-version"]),
    ffprobe: versionOf("ffprobe", ["-version"]),
    ytdlp: versionOf("yt-dlp", ["--version"]),
    whisper: detectWhisper(),
    hyperframesCli: versionOf("npx", ["--yes", "hyperframes", "--version"], { timeout: 60000 }),
    gpu: versionOf("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]),
    engines,
    tts: detectTts(),
    browser: process.env.ROOSTER_BROWSER || "unknown",
    subagents: "unknown",
    env: {
      roosterWorkspace: Boolean(process.env.ROOSTER_WORKSPACE),
      roosterHome: Boolean(process.env.ROOSTER_HOME),
      roosterProfile: process.env.ROOSTER_PROFILE || null,
      roosterEngine: process.env.ROOSTER_ENGINE || null,
    },
  };

  if (data.hyperframesCli && data.engines.hyperframes === "not-detected") {
    data.engines.hyperframes = `npx ${data.hyperframesCli}`;
  }

  return data;
}

function printDoctor(data) {
  heading("RoosterEdit doctor");
  console.log(`  OS              ${data.os} ${data.arch}`);
  console.log(`  Node            ${data.node}`);
  console.log(`  npm             ${data.npm || "not found"}`);
  console.log(`  Python          ${data.python || "not found"}`);
  console.log(`  Git             ${data.git || "not found"}`);
  console.log(`  FFmpeg          ${data.ffmpeg || "not found"}`);
  console.log(`  FFprobe         ${data.ffprobe || "not found"}`);
  console.log(`  yt-dlp          ${data.ytdlp || "not found"}`);
  console.log(`  Whisper         ${data.whisper || "not found"}`);
  console.log(`  HyperFrames CLI ${data.hyperframesCli || "not found"}`);
  console.log(`  GPU             ${data.gpu || "not detected"}`);
  console.log(`  Workspace       ${data.workspaceExists ? data.workspace : "not created"}`);
  console.log(`  Browser         ${data.browser}`);
  console.log(`  Subagents       ${data.subagents}`);

  heading("Engines");
  console.log(`  package.json    ${checklist(data.engines.packageJson)}`);
  console.log(`  HyperFrames     ${data.engines.hyperframes}`);
  console.log(`  Remotion        ${data.engines.remotion}`);
  console.log(`  Three.js        ${data.engines.three}`);
  console.log(`  @remotion/three ${data.engines.remotionThree}`);

  heading("TTS");
  for (const [name, available] of Object.entries(data.tts)) {
    console.log(`  ${name.padEnd(15)} ${checklist(available)}`);
  }

  const missing = [];
  if (!data.ffmpeg) missing.push("FFmpeg");
  if (!data.ffprobe) missing.push("FFprobe");
  if (!data.node) missing.push("Node");
  if (!data.ytdlp) missing.push("yt-dlp (only needed for video links)");
  if (missing.length) {
    console.log(`\nMissing: ${missing.join(", ")}`);
    console.log("Read references/harness.md for the fallback path.");
  }
}

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

function channelsDir() {
  return path.join(WORKSPACE, "channels");
}

function listChannelIds() {
  const dir = channelsDir();
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(path.join(dir, entry.name, "channel.json")))
    .map((entry) => entry.name)
    .sort();
}

function readChannel(id) {
  return readJson(path.join(channelsDir(), id, "channel.json"), null);
}

function getDefaultChannelId() {
  const workspace = readJson(path.join(WORKSPACE, "workspace.json"), {});
  if (workspace.defaultChannel && exists(path.join(channelsDir(), workspace.defaultChannel, "channel.json"))) {
    return workspace.defaultChannel;
  }
  const ids = listChannelIds();
  return ids.includes("default") ? "default" : ids[0] || null;
}

function boolArg(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

function buildChannel(id, args, workspaceDefaults = {}, config = {}) {
  return {
    schema: "rooster.channel/v1",
    id,
    name: typeof args.name === "string" ? args.name : id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    language: typeof args.language === "string" ? args.language : workspaceDefaults.language || "pt-BR",
    format: typeof args.format === "string" ? args.format : "16:9",
    profile: typeof args.profile === "string" ? args.profile : workspaceDefaults.profile || "minimal",
    category: typeof args.category === "string" ? args.category : "custom",
    voice: VOICE_IDS.includes(args.voice) ? args.voice : "none",
    engine: ENGINE_IDS.includes(args.engine) ? args.engine : workspaceDefaults.engine || "auto",
    autonomy: AUTONOMY_IDS.includes(args.autonomy) ? args.autonomy : workspaceDefaults.autonomy || "guided",
    assets: {
      strategy: typeof args.assets === "string" ? args.assets : config.assets?.strategy || "mixed",
      allowDownload: boolArg(args["allow-download"], config.assets?.allowDownload ?? true),
      allowGenerate: boolArg(args["allow-generate"], config.assets?.allowGenerate ?? false),
      licensePolicy: typeof args["license-policy"] === "string" ? args["license-policy"] : config.assets?.licensePolicy || "strict",
    },
    audio: {
      loudnessLufs: workspaceDefaults.loudnessLufs || -14,
      music: true,
    },
    captions: {
      enabled: true,
      mode: "burned",
    },
    brand: {
      logo: null,
      fonts: [],
      colors: [],
    },
    createdAt: now(),
  };
}

function channelCommand(args) {
  if (!exists(WORKSPACE)) fail(`No workspace at ${WORKSPACE}. Run "init" first.`);
  const action = args._[0] || "list";

  if (action === "list") {
    const ids = listChannelIds();
    heading("Channels");
    if (!ids.length) {
      console.log("  (none)");
      return;
    }
    for (const id of ids) {
      const channel = readChannel(id) || {};
      console.log(
        `  ${id.padEnd(24)} ${String(channel.language || "?").padEnd(7)} ${String(channel.format || "?").padEnd(5)} ${String(channel.profile || "?").padEnd(14)} ${String(channel.category || "?").padEnd(20)} ${channel.engine || "auto"}`
      );
    }
    return;
  }

  if (action === "show") {
    const id = args._[1];
    if (!id) fail("Usage: channel show <id>");
    const channel = readChannel(slugify(id));
    if (!channel) fail(`Channel not found: ${id}`);
    console.log(path.join(channelsDir(), slugify(id), "channel.json"));
    console.log(JSON.stringify(channel, null, 2));
    return;
  }

  if (action === "new") {
    const id = slugify(args._[1] || args.name || "");
    if (!id || id === "project") fail("Usage: channel new <id> [options]");
    const channelPath = path.join(channelsDir(), id, "channel.json");
    if (exists(channelPath) && !args.force) fail(`Channel already exists: ${id}`);
    const workspaceMeta = readJson(path.join(WORKSPACE, "workspace.json"), {});
    const config = readJson(path.join(WORKSPACE, "config.json"), {});
    const channel = buildChannel(id, args, workspaceMeta.defaults || {}, config);
    ensureDir(path.join(channelsDir(), id, "projects"));
    ensureDir(path.join(channelsDir(), id, "profiles"));
    ensureDir(path.join(channelsDir(), id, "categories"));
    ensureDir(path.join(channelsDir(), id, "assets"));
    ensureDir(path.join(channelsDir(), id, "library"));
    writeJson(channelPath, channel);
    heading("Channel created");
    console.log(`  ${path.join(channelsDir(), id)}`);
    console.log(`  language ${channel.language} · ${channel.format} · ${channel.profile} · ${channel.category}`);
    return;
  }

  if (action === "set") {
    const id = slugify(args._[1] || "");
    const key = args._[2];
    const rawValue = args._[3];
    if (!id || !key || rawValue === undefined) {
      fail("Usage: channel set <id> <key> <value>");
    }
    const channelPath = path.join(channelsDir(), id, "channel.json");
    const channel = readJson(channelPath, null);
    if (!channel) fail(`Channel not found: ${id}`);
    setNested(channel, key, coerceValue(rawValue));
    writeJson(channelPath, channel);
    console.log(`Set ${id}.${key} = ${JSON.stringify(coerceValue(rawValue))}`);
    return;
  }

  if (action === "use") {
    const id = slugify(args._[1] || "");
    if (!id || !readChannel(id)) fail(`Channel not found: ${id}`);
    const workspacePath = path.join(WORKSPACE, "workspace.json");
    const workspace = readJson(workspacePath, { schema: "rooster.workspace/v1", defaults: {} });
    workspace.defaultChannel = id;
    writeJson(workspacePath, workspace);
    console.log(`Default channel: ${id}`);
    return;
  }

  fail("Usage: channel list | show <id> | new <id> [options] | set <id> <key> <value> | use <id>");
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function initWorkspace(args) {
  const target = args.dir ? path.resolve(CWD, args.dir) : WORKSPACE;
  if (exists(path.join(target, "workspace.json")) && !args.force) {
    fail(`Workspace already exists at ${target}. Use --force to overwrite the metadata.`);
  }

  const dirs = [
    "channels",
    "profiles",
    "categories",
    "library/music",
    "library/sfx",
    "library/fonts",
    "library/overlays",
    "library/luts",
    "library/broll",
    "library/images",
    "cache",
  ];
  for (const dir of dirs) ensureDir(path.join(target, dir));

  const workspace = {
    schema: "rooster.workspace/v1",
    version: VERSION,
    createdAt: now(),
    defaultChannel: "default",
    defaults: {
      profile: process.env.ROOSTER_PROFILE || "minimal",
      category: "custom",
      engine: process.env.ROOSTER_ENGINE || "auto",
      aspect: "16:9",
      fps: 30,
      loudnessLufs: -14,
      language: "pt-BR",
      autonomy: "guided",
      assets: "mixed"
    },
  };

  const config = {
    schema: "rooster.config/v1",
    assets: {
      strategy: "mixed",
      allowDownload: true,
      allowGenerate: false,
      licensePolicy: "strict"
    },
    tts: {
      provider: process.env.ROOSTER_TTS_PROVIDER || "auto",
      voice: null,
      language: "pt-BR",
    },
    render: {
      draftScale: 0.5,
      draftCrf: 28,
      finalCrf: 18,
    },
    browser: {
      openPreview: true,
    },
  };

  writeJson(path.join(target, "workspace.json"), workspace);
  writeJson(path.join(target, "config.json"), config);

  const defaultChannel = buildChannel(
    "default",
    { name: "Default", format: "auto" },
    workspace.defaults,
    config
  );
  writeJson(path.join(target, "channels", "default", "channel.json"), defaultChannel);
  for (const dir of ["projects", "profiles", "categories", "assets", "library"]) {
    ensureDir(path.join(target, "channels", "default", dir));
  }

  writeText(
    path.join(target, "README.md"),
    `# RoosterEdit workspace

Este é o workspace local do RoosterEdit.

## Estrutura

- \`channels/\` — canais com idioma, formato, perfil, assets e projetos.
- \`profiles/\` — identidades visuais/sonoras compartilhadas.
- \`categories/\` — receitas de conteúdo compartilhadas.
- \`library/\` — música, SFX, fontes, overlays, LUTs, b-roll e imagens.
- \`cache/\` — transcrições, proxies e artefatos temporários.

## Começar

\`\`\`bash
node <skill>/scripts/rooster.mjs channel new meu-canal --language pt-BR --format 16:9 --profile minimal
node <skill>/scripts/rooster.mjs new meu-video --channel meu-canal --category faceless-explainer
\`\`\`

A skill fica na raiz do repositório RoosterEdit. Este workspace pertence ao projeto de vídeo, não à skill.
`
  );

  // Copy built-in profiles/categories if the skill ships them.
  const builtinProfiles = path.join(SKILL_ROOT, "templates", "profiles");
  const builtinCategories = path.join(SKILL_ROOT, "templates", "categories");
  if (exists(builtinProfiles)) {
    for (const entry of fs.readdirSync(builtinProfiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(builtinProfiles, entry.name);
      const dest = path.join(target, "profiles", entry.name);
      if (!exists(dest)) copyDir(src, dest);
    }
  }
  if (exists(builtinCategories)) {
    for (const entry of fs.readdirSync(builtinCategories, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(builtinCategories, entry.name);
      const dest = path.join(target, "categories", entry.name);
      if (!exists(dest)) copyDir(src, dest);
    }
  }

  heading("Workspace created");
  console.log(`  ${target}`);
  console.log("\nNext:");
  const cli = path.join(SKILL_ROOT, "scripts", "rooster.mjs");
  console.log(`  node "${cli}" channel new meu-canal --language pt-BR --format 16:9 --profile minimal`);
  console.log(`  node "${cli}" new meu-video --channel meu-canal --category faceless-explainer`);
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// ---------------------------------------------------------------------------
// new project
// ---------------------------------------------------------------------------

function resolveFormat(aspect, width, height) {
  const base = ASPECTS[aspect] || ASPECTS["16:9"];
  return {
    aspect: ASPECTS[aspect] ? aspect : "16:9",
    width: Number(width) || base.width,
    height: Number(height) || base.height,
    fps: 30,
    duration: 60,
  };
}

function loadCategoryDefaults(id) {
  const candidates = [
    path.join(WORKSPACE, "categories", id, "category.json"),
    path.join(ROOSTER_HOME, "categories", id, "category.json"),
    path.join(SKILL_ROOT, "templates", "categories", id, "category.json"),
  ];
  for (const candidate of candidates) {
    const data = readJson(candidate, null);
    if (data && data.defaults) return data;
  }
  return null;
}

function newProject(args) {
  const slug = slugify(args._[0] || (typeof args.name === "string" ? args.name : "meu-video"));
  if (!exists(WORKSPACE)) {
    fail(`No workspace at ${WORKSPACE}. Run "node scripts/rooster.mjs init" first.`);
  }

  const workspaceMeta = readJson(path.join(WORKSPACE, "workspace.json"), {});
  const workspaceDefaults = workspaceMeta.defaults || {};
  const workspaceConfig = readJson(path.join(WORKSPACE, "config.json"), {});

  const channelId = typeof args.channel === "string" ? slugify(args.channel) : getDefaultChannelId();
  if (!channelId) {
    fail("No channel found. Create one with: channel new <id> [options]");
  }
  const channel = readChannel(channelId);
  if (!channel) {
    fail(`Channel not found: ${channelId}. Run "channel list" or "channel new ${channelId}".`);
  }

  const projectDir = path.join(channelsDir(), channelId, "projects", slug);
  if (exists(projectDir) && !args.force) {
    fail(`Project already exists at ${projectDir}. Use --force to overwrite.`);
  }

  const category =
    typeof args.category === "string" ? args.category : channel.category || workspaceDefaults.category || "custom";
  const categoryData = loadCategoryDefaults(category);
  const defaults = categoryData?.defaults || {};

  const aspect =
    typeof args.format === "string"
      ? args.format
      : channel.format && channel.format !== "auto"
        ? channel.format
        : defaults.aspect || workspaceDefaults.aspect || "16:9";
  const format = resolveFormat(aspect);
  if (args.duration) {
    format.duration = Number(args.duration) || format.duration;
  } else if (channel.duration) {
    format.duration = Number(channel.duration) || format.duration;
  } else if (Array.isArray(defaults.duration) && defaults.duration.length === 2) {
    const [min, max] = defaults.duration.map(Number);
    format.duration = Math.round((min + max) / 2);
  }

  const profile =
    typeof args.profile === "string"
      ? args.profile
      : channel.profile || workspaceDefaults.profile || process.env.ROOSTER_PROFILE || "minimal";
  const engine = ENGINE_IDS.includes(args.engine)
    ? args.engine
    : channel.engine || defaults.engine || workspaceDefaults.engine || process.env.ROOSTER_ENGINE || "auto";
  const source = SOURCE_IDS.includes(args.source) ? args.source : channel.source || defaults.source || "hybrid";
  const voice = VOICE_IDS.includes(args.voice) ? args.voice : channel.voice || defaults.voice || "none";
  const style = STYLE_IDS.includes(args.style)
    ? args.style
    : typeof args.profile === "string" || channel.profile
      ? "profile"
      : "ai";
  const autonomy = AUTONOMY_IDS.includes(args.autonomy)
    ? args.autonomy
    : channel.autonomy || workspaceDefaults.autonomy || "guided";
  const language =
    typeof args.language === "string" ? args.language : channel.language || workspaceDefaults.language || "pt-BR";
  const music =
    channel.audio?.music !== undefined
      ? Boolean(channel.audio.music)
      : defaults.music !== undefined
        ? Boolean(defaults.music)
        : true;
  const captionsMode = channel.captions?.mode || defaults.captions || "burned";
  const assetsStrategy =
    typeof args.assets === "string"
      ? args.assets
      : channel.assets?.strategy || workspaceConfig.assets?.strategy || workspaceDefaults.assets || "mixed";
  const allowDownload =
    channel.assets?.allowDownload !== undefined
      ? Boolean(channel.assets.allowDownload)
      : workspaceConfig.assets?.allowDownload !== undefined
        ? Boolean(workspaceConfig.assets.allowDownload)
        : true;
  const allowGenerate =
    channel.assets?.allowGenerate !== undefined
      ? Boolean(channel.assets.allowGenerate)
      : workspaceConfig.assets?.allowGenerate !== undefined
        ? Boolean(workspaceConfig.assets.allowGenerate)
        : false;
  const licensePolicy =
    channel.assets?.licensePolicy || workspaceConfig.assets?.licensePolicy || "strict";

  const overrides = ["category", "profile", "format", "duration", "source", "voice", "style", "autonomy", "engine", "assets", "language"].filter(
    (key) => args[key] !== undefined
  );

  const dirs = [
    "storyboard/frames",
    "assets/source",
    "assets/generated",
    "assets/licensed",
    "edit/captions",
    "edit/audio",
    "engine",
    "preview",
    "renders",
    "qa",
  ];
  for (const dir of dirs) ensureDir(path.join(projectDir, dir));

  const project = {
    schema: "rooster.project/v1",
    slug,
    name: typeof args.name === "string" ? args.name : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    channel: channelId,
    category,
    profile,
    engine,
    mode: { source, voice, style, autonomy },
    format,
    language,
    assets: {
      strategy: assetsStrategy,
      allowDownload,
      allowGenerate,
      licensePolicy,
      sources: []
    },
    overrides,
    audio: { loudnessLufs: channel.audio?.loudnessLufs || -14, music },
    captions: { enabled: captionsMode !== "none", mode: captionsMode },
    status: "intake",
    pipeline: [],
    createdAt: now(),
    updatedAt: now(),
  };

  writeJson(path.join(projectDir, "project.json"), project);

  writeText(
    path.join(projectDir, "brief.md"),
    `# ${project.name}

## Goal

## Audience

Channel: \`${channelId}\`

## Platform and format

${format.aspect} — ${format.width}x${format.height} — ${format.fps} fps — ${format.duration}s

## Tone

## Key message

## Call to action

## References

## Constraints

## Success criteria
`
  );

  writeText(
    path.join(projectDir, "script.md"),
    `# Script — ${project.name}

## Hook (0–3s)

## Setup

## Body

## Payoff

## CTA
`
  );

  writeText(
    path.join(projectDir, "style.md"),
    `# Style — ${project.name}

Channel: \`${channelId}\`
Profile: \`${profile}\`
Category: \`${category}\`

## Palette

## Typography

## Motion

## Captions

## Audio

## Avoid
`
  );

  writeJson(path.join(projectDir, "storyboard", "storyboard.json"), {
    schema: "rooster.storyboard/v1",
    project: slug,
    scenes: [],
  });

  writeJson(path.join(projectDir, "edit", "timeline.json"), {
    schema: "rooster.timeline/v1",
    project: slug,
    format: {
      width: format.width,
      height: format.height,
      fps: format.fps,
      duration: format.duration,
    },
    tracks: [
      { id: "v1", kind: "video", clips: [] },
      { id: "ov1", kind: "overlay", clips: [] },
      { id: "cap1", kind: "captions", clips: [] },
      { id: "a1", kind: "voice", clips: [] },
      { id: "m1", kind: "music", clips: [] },
      { id: "s1", kind: "sfx", clips: [] },
    ],
    scenes: [],
    markers: [],
  });

  writeJson(path.join(projectDir, "edit", "edl.json"), {
    schema: "rooster.edl/v1",
    project: slug,
    clips: [],
  });

  writeJson(path.join(projectDir, "assets", "manifest.json"), {
    schema: "rooster.manifest/v1",
    assets: [],
  });

  writeText(
    path.join(projectDir, "review.md"),
    `# Review — ${project.name}

## Decisions

## Feedback

## Lessons
`
  );

  writeText(
    path.join(projectDir, "qa", "report.md"),
    `# QA Report — ${project.name}

## Summary

- Status: pending
- Duration:
- Resolution:
- FPS:
- Loudness:
- Captions:

## Blocking issues

## Warnings

## Editorial notes
`
  );

  heading("Project created");
  console.log(`  ${projectDir}`);
  console.log(`  channel: ${channelId}`);
  console.log("\nNext:");
  console.log(`  1. Fill brief.md and script.md`);
  console.log(`  2. Add assets to assets/source or run ingest`);
  console.log(`  3. Build storyboard and timeline`);
  console.log(`  4. Choose an engine and implement`);
  console.log(`  5. Preview, QA, render`);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function listWorkspace(args) {
  if (!exists(WORKSPACE)) {
    fail(`No workspace at ${WORKSPACE}. Run "node scripts/rooster.mjs init" first.`);
  }

  const projects = [];
  for (const channelId of listChannelIds()) {
    const projectsDir = path.join(channelsDir(), channelId, "projects");
    if (!exists(projectsDir)) continue;
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const config = readJson(path.join(projectsDir, entry.name, "project.json"), {});
      projects.push({
        channel: channelId,
        slug: entry.name,
        name: config.name || entry.name,
        category: config.category || "?",
        profile: config.profile || "?",
        engine: config.engine || "?",
        status: config.status || "?",
        updatedAt: config.updatedAt || null,
      });
    }
  }

  const legacyDir = path.join(WORKSPACE, "projects");
  if (exists(legacyDir)) {
    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const config = readJson(path.join(legacyDir, entry.name, "project.json"), {});
      projects.push({
        channel: "standalone",
        slug: entry.name,
        name: config.name || entry.name,
        category: config.category || "?",
        profile: config.profile || "?",
        engine: config.engine || "?",
        status: config.status || "?",
        updatedAt: config.updatedAt || null,
      });
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        { workspace: WORKSPACE, channels: listChannelIds(), projects },
        null,
        2
      )
    );
    return;
  }

  heading(`Projects in ${WORKSPACE}`);
  if (!projects.length) {
    console.log("  (none)");
  } else {
    for (const project of projects) {
      console.log(
        `  ${`${project.channel}/${project.slug}`.padEnd(36)} ${String(project.status).padEnd(10)} ${String(project.category).padEnd(20)} ${String(project.profile).padEnd(16)} ${project.engine}`
      );
    }
  }

  const channels = listChannelIds();
  const profiles = listDirNames(path.join(WORKSPACE, "profiles"));
  const categories = listDirNames(path.join(WORKSPACE, "categories"));
  console.log(`\n  Channels:   ${channels.length ? channels.join(", ") : "(none)"}`);
  console.log(`  Profiles:   ${profiles.length ? profiles.join(", ") : "(none)"}`);
  console.log(`  Categories: ${categories.length ? categories.join(", ") : "(none)"}`);
}

function listDirNames(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (String(value).trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function getNested(target, key) {
  return key.split(".").reduce((current, part) => (current == null ? undefined : current[part]), target);
}

function setNested(target, key, value) {
  const parts = key.split(".");
  let current = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function configCommand(args) {
  if (!exists(WORKSPACE)) fail(`No workspace at ${WORKSPACE}. Run "init" first.`);

  const configPath = path.join(WORKSPACE, "config.json");
  const workspacePath = path.join(WORKSPACE, "workspace.json");
  const config = readJson(configPath, { schema: "rooster.config/v1" });
  const workspace = readJson(workspacePath, { schema: "rooster.workspace/v1", defaults: {} });
  workspace.defaults = {
    language: "pt-BR",
    autonomy: "guided",
    assets: "mixed",
    ...(workspace.defaults || {}),
  };
  config.assets = {
    strategy: "mixed",
    allowDownload: true,
    allowGenerate: false,
    licensePolicy: "strict",
    ...(config.assets || {}),
  };
  config.tts = {
    provider: "auto",
    voice: null,
    language: "pt-BR",
    ...(config.tts || {}),
  };

  const action = args._[0] || "show";
  if (action === "show") {
    console.log(JSON.stringify({ config, defaults: workspace.defaults }, null, 2));
    return;
  }
  if (action === "path") {
    console.log(configPath);
    console.log(workspacePath);
    return;
  }
  if (action === "get") {
    const key = args._[1];
    if (!key) fail("Usage: config get <key>");
    const target = key.startsWith("defaults.") ? workspace.defaults : config;
    const value = getNested(target, key);
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (action === "set") {
    const key = args._[1];
    const rawValue = args._[2];
    if (!key || rawValue === undefined) fail("Usage: config set <key> <value>");
    const value = coerceValue(rawValue);
    if (key.startsWith("defaults.")) setNested(workspace, key, value);
    else setNested(config, key, value);
    writeJson(configPath, config);
    writeJson(workspacePath, workspace);
    console.log(`Set ${key} = ${JSON.stringify(value)}`);
    if (key === "assets.strategy") {
      console.log("Asset strategy updated. Read references/assets.md for the allowed modes.");
    }
    return;
  }

  fail("Usage: config show | path | get <key> | set <key> <value>");
}

// ---------------------------------------------------------------------------
// digest
// ---------------------------------------------------------------------------

function digestCommand(args) {
  const project = resolveProject(args._[0]);
  const transcriptPath = path.join(project.dir, "edit", "transcript.json");
  if (!exists(transcriptPath)) {
    fail(`No transcript at ${transcriptPath}. Run "transcribe" first.`);
  }

  const transcript = readJson(transcriptPath, null);
  if (!transcript) fail("transcript.json is invalid");

  const from = Number(args.from) || 0;
  const to = args.to !== undefined ? Number(args.to) : Number.POSITIVE_INFINITY;
  const segments = (transcript.segments || []).filter(
    (segment) => Number(segment.end) > from && Number(segment.start) < to
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          project: project.slug,
          source: transcript.source,
          language: transcript.language,
          duration: transcript.duration || segments[segments.length - 1]?.end || null,
          from,
          to: Number.isFinite(to) ? to : null,
          segments,
        },
        null,
        2
      )
    );
    return;
  }

  heading(`Transcript digest — ${project.slug}`);
  console.log(`  ${segments.length} segment(s) · ${formatClock(from)} to ${Number.isFinite(to) ? formatClock(to) : "end"}`);
  for (const segment of segments) {
    console.log(`  ${formatClock(segment.start)}–${formatClock(segment.end)}  ${segment.text}`);
  }
  console.log("\n  Tip: use --from/--to to read only the section you are planning.");
}

// ---------------------------------------------------------------------------
// profiles and categories
// ---------------------------------------------------------------------------

function catalogKind(kind) {
  if (kind === "profile") return { dirName: "profiles", fileName: "profile.json" };
  if (kind === "category") return { dirName: "categories", fileName: "category.json" };
  fail(`Unknown catalog kind: ${kind}`);
}

function resolveCatalogEntry(kind, id) {
  const { dirName, fileName } = catalogKind(kind);
  const candidates = [
    { scope: "workspace", dir: path.join(WORKSPACE, dirName, id) },
    { scope: "global", dir: path.join(ROOSTER_HOME, dirName, id) },
    { scope: "builtin", dir: path.join(SKILL_ROOT, "templates", dirName, id) },
  ];
  for (const candidate of candidates) {
    if (exists(path.join(candidate.dir, fileName))) return candidate;
  }
  return null;
}

function listCatalog(kind) {
  const { dirName, fileName } = catalogKind(kind);
  const sources = [
    { scope: "workspace", dir: path.join(WORKSPACE, dirName) },
    { scope: "global", dir: path.join(ROOSTER_HOME, dirName) },
    { scope: "builtin", dir: path.join(SKILL_ROOT, "templates", dirName) },
  ];
  const seen = new Map();
  for (const source of sources) {
    if (!exists(source.dir)) continue;
    for (const entry of fs.readdirSync(source.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(source.dir, entry.name, fileName);
      if (!exists(configPath)) continue;
      if (seen.has(entry.name)) continue;
      const data = readJson(configPath, {});
      seen.set(entry.name, {
        id: entry.name,
        name: data.name || entry.name,
        scope: source.scope,
        path: configPath,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function catalogCommand(kind, args) {
  const { dirName, fileName } = catalogKind(kind);
  const action = args._[0] || "list";

  if (action === "list") {
    const entries = listCatalog(kind);
    heading(`${kind === "profile" ? "Profiles" : "Categories"}`);
    if (!entries.length) {
      console.log("  (none)");
      return;
    }
    for (const entry of entries) {
      console.log(`  ${entry.id.padEnd(24)} ${entry.scope.padEnd(10)} ${entry.name}`);
    }
    return;
  }

  if (action === "show") {
    const id = args._[1];
    if (!id) fail(`Usage: ${kind} show <id>`);
    const entry = resolveCatalogEntry(kind, id);
    if (!entry) fail(`${kind} not found: ${id}`);
    const configPath = path.join(entry.dir, fileName);
    console.log(`# ${kind}: ${id} (${entry.scope})`);
    console.log(configPath);
    console.log(JSON.stringify(readJson(configPath, {}), null, 2));
    return;
  }

  if (action === "fork") {
    const id = args._[1];
    const target = typeof args.as === "string" ? slugify(args.as) : null;
    if (!id || !target) fail(`Usage: ${kind} fork <id> --as <new-id>`);
    const entry = resolveCatalogEntry(kind, id);
    if (!entry) fail(`${kind} not found: ${id}`);

    const destination = path.join(WORKSPACE, dirName, target);
    if (exists(destination) && !args.force) {
      fail(`${kind} already exists at ${destination}. Use --force to overwrite.`);
    }
    if (exists(destination)) removeDirRobust(destination);
    copyDir(entry.dir, destination);

    const configPath = path.join(destination, fileName);
    const data = readJson(configPath, {});
    data.id = target;
    data.name = typeof args.name === "string" ? args.name : `${data.name || target} (fork)`;
    data.scope = "workspace";
    writeJson(configPath, data);

    heading(`${kind} forked`);
    console.log(`  ${destination}`);
    console.log(`  edit ${configPath} to customize it.`);
    return;
  }

  fail(`Usage: ${kind} list | ${kind} show <id> | ${kind} fork <id> --as <new-id>`);
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function checkProject(args) {
  const slug = projectSlugFromArg(args);
  const { dir, config } = findProject(slug);
  const errors = [];
  const warnings = [];

  if (!exists(dir)) errors.push(`Project directory not found: ${dir}`);
  if (!config) errors.push(`project.json missing or invalid`);

  if (config) {
    if (!config.schema) errors.push("project.json: missing schema");
    if (!config.slug) errors.push("project.json: missing slug");
    if (!config.category) errors.push("project.json: missing category");
    if (!config.profile) errors.push("project.json: missing profile");
    if (!config.format || !(config.format.duration > 0)) errors.push("project.json: invalid format.duration");
    if (config.engine && !ENGINE_IDS.includes(config.engine)) errors.push(`project.json: unknown engine "${config.engine}"`);
    if (config.status && !STATUS_IDS.includes(config.status)) warnings.push(`project.json: unknown status "${config.status}"`);
  }

  const timelinePath = path.join(dir, "edit", "timeline.json");
  const timeline = readJson(timelinePath, null);
  if (!timeline) {
    errors.push("edit/timeline.json missing or invalid");
  } else {
    if (!timeline.format || !(timeline.format.duration > 0)) errors.push("timeline: invalid format.duration");
    if (!Array.isArray(timeline.tracks)) errors.push("timeline: tracks must be an array");
    const trackIds = new Set();
    for (const track of timeline.tracks || []) {
      if (!track.id) errors.push("timeline: track missing id");
      if (trackIds.has(track.id)) errors.push(`timeline: duplicate track id "${track.id}"`);
      trackIds.add(track.id);
      if (!Array.isArray(track.clips)) errors.push(`timeline: track "${track.id}" clips must be an array`);
      for (const clip of track.clips || []) {
        if (!clip.id) errors.push(`timeline: clip in "${track.id}" missing id`);
        if (typeof clip.start !== "number" || typeof clip.end !== "number") {
          errors.push(`timeline: clip "${clip.id || "?"}" needs numeric start/end`);
        } else if (clip.start >= clip.end) {
          errors.push(`timeline: clip "${clip.id || "?"}" has start >= end`);
        }
        if (clip.src && !String(clip.src).startsWith("http") && !exists(path.join(dir, clip.src))) {
          if (!clip.scene) errors.push(`timeline: missing media "${clip.src}" for clip "${clip.id || "?"}"`);
        }
        if (typeof clip.in === "number" && typeof clip.out === "number" && clip.in >= clip.out) {
          errors.push(`timeline: clip "${clip.id || "?"}" has in >= out`);
        }
      }
    }
  }

  const planPath = path.join(dir, "edit", "plan.json");
  if (exists(planPath)) {
    const result = validatePlan(readJson(planPath, null), dir);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  } else {
    warnings.push("edit/plan.json not found");
  }

  const manifestPath = path.join(dir, "assets", "manifest.json");
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    warnings.push("assets/manifest.json missing");
  } else {
    for (const asset of manifest.assets || []) {
      if (!asset.id) errors.push("manifest: asset missing id");
      if (!asset.path) errors.push("manifest: asset missing path");
      else if (!exists(path.join(dir, asset.path))) warnings.push(`manifest: asset file missing "${asset.path}"`);
      if (!asset.license) warnings.push(`manifest: asset "${asset.id || "?"}" missing license`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ project: slug, dir, errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  heading(`Check — ${slug}`);
  if (!errors.length && !warnings.length) {
    console.log("  ✓ No issues found.");
  }
  for (const error of errors) console.log(`  ✗ ${error}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// transcribe, plan, and classic root check
// ---------------------------------------------------------------------------

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|flac|ogg)$/i;

function resolveProject(slug) {
  if (!slug) {
    const config = readJson(path.join(WORKSPACE, "project.json"), null) || {
      schema: "rooster.project/v1",
      slug: "root",
      name: "Active video",
      category: "custom",
      profile: "default",
      engine: "auto",
      mode: { source: "hybrid", voice: "none", style: "ai", autonomy: "guided" },
      format: { aspect: "16:9", width: 1920, height: 1080, fps: 30, duration: 60 },
      status: "intake",
    };
    return { dir: WORKSPACE, config, slug: "root", channel: null };
  }

  const found = findProject(slug);
  const projectSlug = found.slug || slugify(slug);
  const config = found.config || {
    schema: "rooster.project/v1",
    slug: projectSlug,
    name: projectSlug,
    category: "custom",
    profile: "default",
    engine: "auto",
    mode: { source: "hybrid", voice: "none", style: "ai", autonomy: "guided" },
    format: { aspect: "16:9", width: 1920, height: 1080, fps: 30, duration: 60 },
    status: "intake",
  };
  return { dir: found.dir, config, slug: projectSlug, channel: found.channel || null };
}

function findFirstMedia(dir) {
  const roots = [path.join(dir, "assets", "source"), path.join(dir, "bruto")];
  for (const root of roots) {
    if (!exists(root)) continue;
    const stack = [root];
    while (stack.length) {
      const current = stack.shift();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(candidate);
        else if (MEDIA_EXT.test(entry.name)) return candidate;
      }
    }
  }
  return null;
}

function validateTimeline(timeline, dir) {
  const errors = [];
  const warnings = [];
  if (!timeline) {
    errors.push("edit/timeline.json missing or invalid");
    return { errors, warnings };
  }
  if (!timeline.format || !(timeline.format.duration > 0)) errors.push("timeline: invalid format.duration");
  if (!Array.isArray(timeline.tracks)) errors.push("timeline: tracks must be an array");
  const trackIds = new Set();
  for (const track of timeline.tracks || []) {
    if (!track.id) errors.push("timeline: track missing id");
    if (trackIds.has(track.id)) errors.push(`timeline: duplicate track id "${track.id}"`);
    trackIds.add(track.id);
    if (!Array.isArray(track.clips)) errors.push(`timeline: track "${track.id}" clips must be an array`);
    for (const clip of track.clips || []) {
      if (!clip.id) errors.push(`timeline: clip in "${track.id}" missing id`);
      if (typeof clip.start !== "number" || typeof clip.end !== "number") {
        errors.push(`timeline: clip "${clip.id || "?"}" needs numeric start/end`);
      } else if (clip.start >= clip.end) {
        errors.push(`timeline: clip "${clip.id || "?"}" has start >= end`);
      }
      if (clip.src && !String(clip.src).startsWith("http") && !exists(path.join(dir, clip.src))) {
        if (!clip.scene) errors.push(`timeline: missing media "${clip.src}" for clip "${clip.id || "?"}"`);
      }
      if (typeof clip.in === "number" && typeof clip.out === "number" && clip.in >= clip.out) {
        errors.push(`timeline: clip "${clip.id || "?"}" has in >= out`);
      }
    }
  }
  return { errors, warnings };
}

function validatePlan(plan, dir) {
  const errors = [];
  const warnings = [];
  if (!plan) {
    errors.push("edit/plan.json missing or invalid");
    return { errors, warnings };
  }
  if (plan.schema !== "rooster.plan/v1") errors.push("plan: schema must be rooster.plan/v1");
  if (!plan.source) errors.push("plan: missing source");
  else if (!exists(path.join(dir, plan.source))) warnings.push(`plan: source not found "${plan.source}"`);
  if (!plan.style) warnings.push("plan: missing style");
  else if (!exists(path.join(dir, plan.style))) warnings.push(`plan: style not found "${plan.style}"`);

  const ids = new Set();
  const checkId = (id, kind) => {
    if (!id) errors.push(`plan: ${kind} missing id`);
    else if (ids.has(id)) errors.push(`plan: duplicate id "${id}"`);
    else ids.add(id);
  };

  for (const cut of plan.cuts || []) {
    checkId(cut.id, "cut");
    if (typeof cut.start !== "number" || typeof cut.end !== "number") {
      errors.push(`plan: cut "${cut.id || "?"}" needs numeric start/end`);
    } else if (cut.start >= cut.end) {
      errors.push(`plan: cut "${cut.id || "?"}" has start >= end`);
    }
    if (!cut.reason) errors.push(`plan: cut "${cut.id || "?"}" missing reason`);
  }

  const sourceDuration =
    Array.isArray(plan.keeps) && plan.keeps.length
      ? Math.max(...plan.keeps.map((keep) => Number(keep.end) || 0))
      : Number(plan.duration) || 0;

  for (const element of plan.elements || []) {
    checkId(element.id, "element");
    if (typeof element.start !== "number" || typeof element.end !== "number") {
      errors.push(`plan: element "${element.id || "?"}" needs numeric start/end`);
    } else if (element.start >= element.end) {
      errors.push(`plan: element "${element.id || "?"}" has start >= end`);
    }
    if (!element.type) errors.push(`plan: element "${element.id || "?"}" missing type`);
    if (!element.description) errors.push(`plan: element "${element.id || "?"}" missing description`);
    if (sourceDuration && typeof element.end === "number" && element.end > sourceDuration + 0.5) {
      warnings.push(`plan: element "${element.id || "?"}" ends after the source duration`);
    }
  }

  let lastChapter = -1;
  for (const chapter of plan.chapters || []) {
    if (typeof chapter.start !== "number") errors.push("plan: chapter missing numeric start");
    else if (chapter.start < lastChapter) errors.push("plan: chapters are not sorted by start time");
    else lastChapter = chapter.start;
    if (!chapter.title) errors.push("plan: chapter missing title");
  }

  return { errors, warnings };
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function printPlanSummary(plan) {
  heading(`Edit plan — ${plan.source || "(no source)"}`);
  if (plan.duration) console.log(`  Duration: ${formatClock(plan.duration)}`);
  if (plan.style) console.log(`  Style:    ${plan.style}`);
  if (plan.summary) console.log(`  Summary:  ${plan.summary}`);

  heading(`Cuts (${(plan.cuts || []).length})`);
  for (const cut of plan.cuts || []) {
    console.log(`  ${formatClock(cut.start)}–${formatClock(cut.end)}  ${cut.reason || "?"}${cut.note ? ` — ${cut.note}` : ""}`);
  }

  if ((plan.keeps || []).length) {
    heading(`Keeps (${plan.keeps.length})`);
    for (const keep of plan.keeps) {
      console.log(`  ${formatClock(keep.start)}–${formatClock(keep.end)}  ${keep.reason || ""}`);
    }
  }

  heading(`Elements (${(plan.elements || []).length})`);
  for (const element of plan.elements || []) {
    const text = element.text ? ` "${element.text}"` : "";
    console.log(`  ${formatClock(element.start)}–${formatClock(element.end)}  ${element.type || "?"}${text} — ${element.description || ""}`);
  }

  if ((plan.chapters || []).length) {
    heading("Chapters");
    for (const chapter of plan.chapters || []) {
      console.log(`  ${formatClock(chapter.start)}  ${chapter.title}`);
    }
  }
}

let hyperframesAvailable = null;

function hasHyperFrames() {
  if (hyperframesAvailable !== null) return hyperframesAvailable;
  const result = run("npx", ["--yes", "hyperframes", "--version"], { timeout: 2 * 60 * 1000 });
  hyperframesAvailable = result.ok && /\d+\.\d+\.\d+/.test(result.stdout);
  return hyperframesAvailable;
}

function hasFasterWhisper() {
  return run("python", ["-c", "import faster_whisper"], { timeout: 30000 }).ok;
}

function groupWordsIntoSegments(words, maxWords = 14, maxGap = 0.8) {
  const segments = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const text = current
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
    segments.push({
      id: segments.length,
      start: current[0].start,
      end: current[current.length - 1].end,
      text,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length) {
      const previous = current[current.length - 1];
      if (word.start - previous.end > maxGap || current.length >= maxWords) flush();
    }
    current.push(word);
    if (/[.!?]$/.test(String(word.text || "").trim())) flush();
  }
  flush();
  return segments;
}

function normalizeTranscript(raw, source, language) {
  const words = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.words)
      ? raw.words
      : [];

  const rawSegments = !Array.isArray(raw) && Array.isArray(raw.segments) ? raw.segments : [];
  const segments = rawSegments.length
    ? rawSegments.map((segment, index) => ({
        id: segment.id ?? index,
        start: segment.start,
        end: segment.end,
        text: (segment.text || "").trim(),
      }))
    : groupWordsIntoSegments(words);

  const text =
    (!Array.isArray(raw) && raw.text) ||
    words.map((word) => word.text).join(" ") ||
    segments.map((segment) => segment.text).join(" ");

  return {
    schema: "rooster.transcript/v1",
    source,
    language: (!Array.isArray(raw) && raw.language) || language,
    text: String(text).replace(/\s+([,.!?;:])/g, "$1").trim(),
    segments,
    words: words.length
      ? words.map((word, index) => ({
          id: word.id ?? `w${index}`,
          text: word.text,
          start: word.start,
          end: word.end,
        }))
      : undefined,
    createdAt: now(),
  };
}

function transcribeCommand(args) {
  const project = resolveProject(args._[0]);
  if (!exists(project.dir)) fail(`Project directory not found: ${project.dir}`);

  const input = typeof args.input === "string" ? path.resolve(CWD, args.input) : findFirstMedia(project.dir);
  if (!input || !exists(input)) {
    fail("No media found. Put a file in assets/source/ or pass --input <path>.");
  }

  const outDir = path.join(project.dir, "edit");
  ensureDir(outDir);
  ensureDir(path.join(outDir, "captions"));

  const model = typeof args.model === "string" ? args.model : "small";
  const language = typeof args.language === "string" ? args.language : "pt";
  const requestedEngine = typeof args.engine === "string" ? args.engine : "auto";

  heading(`Transcribing ${path.basename(input)}`);
  console.log(`  Model: ${model}`);
  console.log(`  Language: ${language}`);

  let raw = null;
  let used = null;
  const errors = [];

  // Prefer HyperFrames when available. It can use Parakeet (English) or
  // whisper.cpp (other languages) and writes a word-level transcript.
  if (requestedEngine !== "whisper" && requestedEngine !== "faster-whisper" && hasHyperFrames()) {
    const workDir = path.join(outDir, ".transcribe");
    ensureDir(workDir);
    const hfResult = run(
      "npx",
      [
        "--yes", "hyperframes", "transcribe", input,
        "--dir", workDir,
        "--engine", "auto",
        "--language", language,
        "--model", model,
        "--json",
        "--to", "srt",
        "-o", path.join(workDir, "transcript.srt"),
      ],
      { cwd: workDir, timeout: 2 * 60 * 60 * 1000 }
    );

    const transcriptPath = path.join(workDir, "transcript.json");
    let hfRaw = exists(transcriptPath) ? readJson(transcriptPath, null) : null;

    // HyperFrames also prints word-level JSON lines to stdout. Use them if
    // the transcript file was not written for any reason.
    if (!hfRaw && hfResult.stdout) {
      for (const line of hfResult.stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "words" && Array.isArray(parsed.words)) hfRaw = parsed.words;
        } catch {
          // Ignore non-JSON progress lines.
        }
      }
    }

    if (hfResult.ok && hfRaw) {
      raw = hfRaw;
      used = "hyperframes";
      const srt = path.join(workDir, "transcript.srt");
      if (exists(srt)) fs.copyFileSync(srt, path.join(outDir, "captions", "transcript.srt"));
    } else {
      errors.push(hfResult.stderr || hfResult.stdout || "hyperframes transcribe failed");
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can keep the directory handle briefly; it is safe to leave it.
    }
  }

  // Prefer faster-whisper when available. It is lighter than the OpenAI
  // whisper CLI and handles Portuguese accents better with the base model.
  if (!raw && (requestedEngine === "auto" || requestedEngine === "faster-whisper") && hasFasterWhisper()) {
    const scriptPath = path.join(SKILL_ROOT, "scripts", "transcribe_faster.py");
    const fasterOut = path.join(outDir, "transcript.json");
    const result = run(
      "python",
      [
        scriptPath,
        "--input", input,
        "--output", fasterOut,
        "--language", language,
        "--model", model,
        ...(args.verbose ? ["--verbose"] : []),
      ],
      { cwd: project.dir, timeout: 2 * 60 * 60 * 1000 }
    );
    if (result.ok) {
      const parsed = readJson(fasterOut, null);
      if (parsed) {
        raw = parsed;
        used = "faster-whisper";
      } else {
        errors.push("faster-whisper finished but transcript.json is invalid");
      }
    } else {
      errors.push(result.stderr || result.stdout || "faster-whisper failed");
    }
  }

  // Fallback to the OpenAI whisper CLI when HyperFrames is unavailable or
  // explicitly disabled.
  if (!raw && requestedEngine !== "hyperframes" && requestedEngine !== "faster-whisper") {
    const whisper = detectWhisper();
    if (whisper === "whisper") {
      const result = run(
        "whisper",
        [
          input,
          "--model", model,
          "--language", language,
          "--output_format", "all",
          "--output_dir", outDir,
          "--verbose", "False",
        ],
        { cwd: project.dir, timeout: 2 * 60 * 60 * 1000 }
      );
      if (result.ok) {
        const base = path.parse(input).name;
        const candidates = [
          path.join(outDir, `${base}.json`),
          ...fs.readdirSync(outDir)
            .filter((file) => file.endsWith(".json") && !["plan.json", "transcript.json"].includes(file))
            .map((file) => path.join(outDir, file)),
        ];
        const jsonPath = candidates.find((file) => exists(file));
        if (jsonPath) {
          raw = readJson(jsonPath, null);
          used = "whisper";
          const srt = path.join(outDir, `${base}.srt`);
          if (exists(srt)) fs.copyFileSync(srt, path.join(outDir, "captions", "transcript.srt"));
        } else {
          errors.push("whisper finished but no JSON output was found");
        }
      } else {
        errors.push(result.stderr || result.stdout || "whisper failed");
      }
    } else if (whisper && whisper !== "faster-whisper (python)") {
      errors.push(`Detected "${whisper}", but the fallback wraps the OpenAI whisper CLI.`);
    }
  }

  if (!raw) {
    fail(
      "Transcription failed.\n" +
        (errors.length ? errors.join("\n") + "\n" : "") +
        "Install HyperFrames (npx hyperframes), faster-whisper (python -m pip install --user -U faster-whisper), or Whisper (python -m pip install --user -U openai-whisper)."
    );
  }

  const transcript = normalizeTranscript(raw, path.relative(project.dir, input).replace(/\\/g, "/"), language);
  writeJson(path.join(outDir, "transcript.json"), transcript);

  heading("Transcript ready");
  console.log(`  ${path.join(outDir, "transcript.json")}`);
  console.log(`  Engine: ${used}`);
  console.log(`  ${transcript.segments.length} segments`);
  console.log("\nNext: read the transcript and style.md, write edit/plan.json, and show the plan for approval.");
}

function planCommand(args) {
  const project = resolveProject(args._[0]);
  const planPath = path.join(project.dir, "edit", "plan.json");
  if (!exists(planPath)) {
    fail(`Plan not found at ${planPath}.\nRead references/edit-plan.md and write the plan before building.`);
  }

  const plan = readJson(planPath, null);
  const { errors, warnings } = validatePlan(plan, project.dir);

  if (args.json) {
    console.log(JSON.stringify({ project: project.slug, plan: planPath, errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  if (!args.check) printPlanSummary(plan);

  heading("Validation");
  if (!errors.length && !warnings.length) console.log("  ✓ No issues found.");
  for (const error of errors) console.log(`  ✗ ${error}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  console.log("\n  The plan must be approved before building.");
  process.exit(errors.length ? 1 : 0);
}

function checkRoot(args) {
  const dir = WORKSPACE;
  const errors = [];
  const warnings = [];

  if (!exists(dir)) errors.push(`Workspace not found: ${dir}`);

  const stylePath = path.join(dir, "style.md");
  if (!exists(stylePath)) warnings.push("style.md not found");
  if (!exists(path.join(dir, "assets", "source"))) warnings.push("assets/source/ not found");

  const planPath = path.join(dir, "edit", "plan.json");
  if (exists(planPath)) {
    const result = validatePlan(readJson(planPath, null), dir);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  } else {
    warnings.push("edit/plan.json not found (create it before building)");
  }

  const timelinePath = path.join(dir, "edit", "timeline.json");
  if (exists(timelinePath)) {
    const result = validateTimeline(readJson(timelinePath, null), dir);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  } else {
    warnings.push("edit/timeline.json not found");
  }

  if (args.json) {
    console.log(JSON.stringify({ project: "root", dir, errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  heading("Check — root project");
  if (!errors.length && !warnings.length) console.log("  ✓ No issues found.");
  for (const error of errors) console.log(`  ✗ ${error}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function resolveProfile(profileId) {
  const id = profileId || "minimal";
  const candidates = [
    path.join(WORKSPACE, "profiles", id, "profile.json"),
    path.join(ROOSTER_HOME, "profiles", id, "profile.json"),
    path.join(SKILL_ROOT, "templates", "profiles", id, "profile.json"),
    path.join(SKILL_ROOT, "templates", "profiles", "minimal", "profile.json"),
  ];
  for (const candidate of candidates) {
    const data = readJson(candidate, null);
    if (data) return data;
  }
  return null;
}

function themeFromProfile(profile) {
  const colors = profile?.tokens?.colors || {};
  const typography = profile?.tokens?.typography || {};
  return {
    bg: colors.bg || "#0b0f19",
    fg: colors.fg || "#f8fafc",
    muted: colors.muted || "#94a3b8",
    accent: colors.accent || "#22d3ee",
    accent2: colors.accent2 || "#f472b6",
    display: typography.display?.family || "Inter",
    body: typography.body?.family || "Inter",
  };
}

function sortedCuts(plan) {
  return (plan.cuts || [])
    .filter((cut) => typeof cut.start === "number" && typeof cut.end === "number" && cut.end > cut.start)
    .sort((a, b) => a.start - b.start);
}

function keepsFromPlan(plan) {
  const duration = Number(plan.duration) || 0;
  if (Array.isArray(plan.keeps) && plan.keeps.length) {
    return plan.keeps
      .filter((keep) => typeof keep.start === "number" && typeof keep.end === "number" && keep.end > keep.start)
      .sort((a, b) => a.start - b.start);
  }

  const cuts = sortedCuts(plan);
  if (!cuts.length) return [{ start: 0, end: duration }];

  const keeps = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) keeps.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration });
  return keeps;
}

function remapTimeWithKeeps(time, keeps) {
  let elapsed = 0;
  for (const keep of keeps) {
    if (time < keep.start) break;
    if (time <= keep.end) return elapsed + (time - keep.start);
    elapsed += keep.end - keep.start;
  }
  return elapsed;
}

function remapPlan(plan) {
  const cuts = sortedCuts(plan);
  const keeps = keepsFromPlan(plan);
  const hasTrims = cuts.length > 0 || (Array.isArray(plan.keeps) && plan.keeps.length > 0);
  if (!hasTrims) {
    return { plan, cuts, keeps, duration: Number(plan.duration) || 0 };
  }

  const duration = keeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0);
  const remapped = {
    ...plan,
    duration,
    cuts: [],
    keeps: [],
    elements: (plan.elements || []).map((element) => ({
      ...element,
      start: remapTimeWithKeeps(Number(element.start) || 0, keeps),
      end: remapTimeWithKeeps(Number(element.end) || 0, keeps),
    })),
    chapters: (plan.chapters || []).map((chapter) => ({
      ...chapter,
      start: remapTimeWithKeeps(Number(chapter.start) || 0, keeps),
    })),
    originalCuts: cuts,
  };

  return { plan: remapped, cuts, keeps, duration };
}

function planForBuild(plan, args) {
  if (args["no-cuts"]) {
    const duration = Number(plan.duration) || 0;
    return { plan, cuts: [], keeps: [{ start: 0, end: duration }], duration };
  }
  return remapPlan(plan);
}

function linkOrCopy(source, target) {
  ensureDir(path.dirname(target));
  try {
    if (exists(target)) fs.rmSync(target, { force: true });
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function removeDirRobust(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // On Windows a previous browser/check process can hold a handle briefly.
    // Rename the directory out of the way and retry the delete.
    const trash = `${dir}.old-${Date.now()}`;
    try {
      fs.renameSync(dir, trash);
      fs.rmSync(trash, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      throw error;
    }
  }
}

function copyElementAssets(projectDir, plan, assetsDir, prefix) {
  for (const element of plan.elements || []) {
    const asset = element.src || element.asset;
    if (!asset) continue;
    const source = path.resolve(projectDir, asset);
    if (!exists(source)) continue;
    const target = path.join(assetsDir, path.basename(source));
    linkOrCopy(source, target);
    element.src = `${prefix}${path.basename(source)}`;
    delete element.asset;
  }
}

function buildBaseMedia(project, plan, keeps, engineDir, args, assetsSubdir = "assets") {
  const source = path.resolve(project.dir, plan.source);
  if (!exists(source)) fail(`Plan source not found: ${source}`);

  const probe = probeMedia(source);
  if (!probe || probe.error) fail(`Could not probe the plan source: ${probe?.error || "unknown error"}`);

  const assetsDir = path.join(engineDir, assetsSubdir);
  ensureDir(assetsDir);
  const sourceExt = path.extname(source).toLowerCase();
  const image = /\.(png|jpe?g|webp|gif|svg)$/i.test(sourceExt);
  const hasVideo = Boolean(probe.width) && !image;
  const hasAudio = Boolean(probe.audio);
  const kind = image ? "image" : hasVideo ? "video" : "audio";

  const needsCut =
    !args["no-cuts"] &&
    !image &&
    keeps.length > 0 &&
    !(keeps.length === 1 && keeps[0].start <= 0.001 && keeps[0].end >= (Number(plan.duration) || 0) - 0.001);

  if (!needsCut) {
    const target = path.join(assetsDir, `base${hasVideo ? ".mp4" : hasAudio ? ".m4a" : sourceExt || ".png"}`);

    // Even without cuts, normalize the audio to the delivery target. Copying
    // the video stream keeps this fast (audio-only re-encode).
    if (hasAudio && !image && versionOf("ffmpeg", ["-version"])) {
      const ffArgs = [
        "-y", "-i", source,
        ...(hasVideo ? ["-map", "0:v:0"] : []),
        "-map", "0:a:0",
        ...(hasVideo ? ["-c:v", "copy"] : []),
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "192k",
        target,
      ];
      const result = run("ffmpeg", ffArgs, { timeout: 30 * 60 * 1000 });
      if (result.ok) {
        return {
          path: `assets/${path.basename(target)}`,
          duration: Number(plan.duration) || 0,
          hasVideo,
          hasAudio,
          kind,
        };
      }
    }

    linkOrCopy(source, target);
    return {
      path: `assets/${path.basename(target)}`,
      duration: Number(plan.duration) || 0,
      hasVideo,
      hasAudio,
      kind,
    };
  }

  if (!versionOf("ffmpeg", ["-version"])) {
    fail("FFmpeg is required to apply the plan's cuts. Install FFmpeg or run build with --no-cuts.");
  }

  const filters = [];
  keeps.forEach((keep, index) => {
    if (hasVideo) filters.push(`[0:v]trim=start=${keep.start}:end=${keep.end},setpts=PTS-STARTPTS[v${index}]`);
    if (hasAudio) filters.push(`[0:a]atrim=start=${keep.start}:end=${keep.end},asetpts=PTS-STARTPTS[a${index}]`);
  });

  let concatFilter = "";
  let maps = [];
  if (hasVideo && hasAudio) {
    const inputs = keeps.map((_, index) => `[v${index}][a${index}]`).join("");
    concatFilter = `${inputs}concat=n=${keeps.length}:v=1:a=1[v][a];[a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
    maps = ["-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"];
  } else if (hasVideo) {
    const inputs = keeps.map((_, index) => `[v${index}]`).join("");
    concatFilter = `${inputs}concat=n=${keeps.length}:v=1:a=0[v]`;
    maps = ["-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
  } else {
    const inputs = keeps.map((_, index) => `[a${index}]`).join("");
    concatFilter = `${inputs}concat=n=${keeps.length}:v=0:a=1[a];[a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
    maps = ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"];
  }

  const target = path.join(assetsDir, `base${hasVideo ? ".mp4" : ".m4a"}`);
  const result = run(
    "ffmpeg",
    ["-y", "-i", source, "-filter_complex", [...filters, concatFilter].join(";"), ...maps, target],
    { timeout: 30 * 60 * 1000 }
  );
  if (!result.ok) {
    fail(`FFmpeg failed to apply the plan's cuts:\n${result.stderr || result.stdout || "unknown error"}`);
  }

  return {
    path: `assets/${path.basename(target)}`,
    duration: keeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0),
    hasVideo,
    hasAudio,
    kind: hasVideo ? "video" : "audio",
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHyperFramesElement(element, index) {
  const start = Number(element.start) || 0;
  const end = Number(element.end) || start + 1;
  if (end <= start) return "";
  const text = element.text || element.description || "";
  const common = (classes) =>
    `id="el-${index}" class="clip ${classes}" data-start="${start.toFixed(3)}" data-duration="${(end - start).toFixed(3)}" data-track-index="${index + 2}"`;

  switch (element.type) {
    case "letreiro":
      return `<div ${common("title")} data-description="${htmlEscape(element.description || "")}">${htmlEscape(text)}</div>`;
    case "caption-emphasis":
      return `<div ${common("caption")} data-description="${htmlEscape(element.description || "")}">${htmlEscape(text)}</div>`;
    case "grafico":
    case "lista":
      return `<div ${common("card")}><span class="card-kicker">${element.type === "lista" ? "Lista" : "Grafico"}</span><strong>${htmlEscape(text)}</strong><p>${htmlEscape(element.description || "")}</p></div>`;
    case "lower-third":
      return `<div ${common("lower-third")}><strong>${htmlEscape(text)}</strong><span>${htmlEscape(element.description || "")}</span></div>`;
    case "end-card":
      return `<div ${common("end-card")} data-description="${htmlEscape(element.description || "")}">${htmlEscape(text)}</div>`;
    case "broll": {
      const asset = element.src || element.asset;
      if (asset) {
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(asset)) {
          return `<img ${common("broll")} src="${htmlEscape(asset)}" alt="" />`;
        }
        if (/\.(mp4|webm|mov|m4v)$/i.test(asset)) {
          return `<video ${common("broll")} src="${htmlEscape(asset)}" muted></video>`;
        }
      }
      return `<div ${common("card")}><span class="card-kicker">B-roll</span><p>${htmlEscape(element.description || "")}</p></div>`;
    }
    case "zoom":
    case "transition":
      return "";
    default:
      return `<div ${common("card")}><span class="card-kicker">${htmlEscape(element.type || "Elemento")}</span><p>${htmlEscape(text)}</p></div>`;
  }
}

function renderHyperFramesHtml(project, plan, theme, base) {
  const width = plan.format?.width || 1920;
  const height = plan.format?.height || 1080;
  const fps = plan.format?.fps || 30;
  const duration = Number(plan.duration) || 10;
  const lang = String(plan.language || "").toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  const projectName = project.config.name || project.slug;
  const panel = plan.layout?.type === "speaker-left-panel";
  const panelBox = plan.layout?.panel || { x: 700, y: 40, width: 1160, height: 1000 };
  const panelCss = panel
    ? `
      #panel {
        position: absolute;
        left: ${panelBox.x}px;
        top: ${panelBox.y}px;
        width: ${panelBox.width}px;
        height: ${panelBox.height}px;
        z-index: 1;
        background: #060913;
        border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
        border-radius: 24px;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
      }
      #brand { left: ${panelBox.x + 80}px; top: ${panelBox.y + 30}px; }
      .title { left: ${panelBox.x + 80}px; top: 50%; transform: translateY(-50%); width: ${panelBox.width - 160}px; font-size: 96px; }
      .caption { left: ${panelBox.x + 80}px; top: 50%; bottom: auto; transform: translateY(-50%); width: ${panelBox.width - 160}px; font-size: 54px; }
      .card { left: ${panelBox.x + 60}px; right: ${1920 - (panelBox.x + panelBox.width) + 60}px; top: ${panelBox.y + 240}px; }
      .lower-third { left: ${panelBox.x + 80}px; bottom: ${1080 - (panelBox.y + panelBox.height) + 150}px; }
      .lower-third span { font-size: 28px; }
      .end-card { left: ${panelBox.x}px; right: ${1920 - (panelBox.x + panelBox.width)}px; top: ${panelBox.y}px; bottom: auto; height: ${panelBox.height}px; font-family: var(--display); font-size: 72px; font-weight: 700; }
    `
    : "";
  const panelHtml = panel ? '<div id="panel"></div>' : "";

  const elements = (plan.elements || [])
    .map((element, index) => ({ element, index, html: renderHyperFramesElement(element, index) }))
    .filter((entry) => entry.html);

  const elementHtml = elements.map((entry) => entry.html).join("\n      ");
  const timeline = elements
    .map(({ element, index }) => {
      const start = Number(element.start) || 0;
      const end = Math.max(start + 0.5, Number(element.end) || start + 1);
      return `
      tl.fromTo("#el-${index}", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, ${start.toFixed(3)});
      tl.to("#el-${index}", { opacity: 0, duration: 0.25, ease: "power2.in" }, ${Math.max(start + 0.5, end - 0.25).toFixed(3)});`;
    })
    .join("");

  let baseHtml = "";
  if (base.kind === "image") {
    baseHtml = `<img id="base" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" src="${base.path}" alt="" />`;
  } else if (base.kind === "video") {
    baseHtml = `<video id="base" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" data-has-audio="${base.hasAudio}" src="${base.path}"${base.hasAudio ? "" : " muted"}></video>`;
  } else {
    baseHtml = `<audio id="voice" src="${base.path}" data-start="0" data-duration="${duration.toFixed(3)}"></audio>`;
  }

  const baseTween =
    base.kind === "image" || base.kind === "video"
      ? `tl.to("#base", { scale: 1.035, duration: ${duration.toFixed(3)}, ease: "none" }, 0);`
      : "";

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {
        --bg: ${theme.bg};
        --fg: ${theme.fg};
        --muted: ${theme.muted};
        --accent: ${theme.accent};
        --accent2: ${theme.accent2};
        --display: "${theme.display}", sans-serif;
        --body: "${theme.body}", sans-serif;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${width}px; height: ${height}px;
        overflow: hidden;
        background: var(--bg);
        font-family: var(--body);
      }
      #root {
        position: relative;
        width: 100%; height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at 70% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 45%),
          radial-gradient(circle at 20% 80%, color-mix(in srgb, var(--accent2) 12%, transparent), transparent 40%),
          var(--bg);
      }
      #base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
      #brand, .title, .caption, .card, .lower-third, .end-card { z-index: 2; position: absolute; }
      #brand {
        position: absolute; left: 96px; top: 72px;
        color: var(--accent); font-family: var(--display);
        font-size: 28px; font-weight: 700; letter-spacing: 0.18em;
        text-transform: uppercase;
        background: rgba(6, 9, 19, 0.78);
        padding: 10px 16px;
        border-radius: 8px;
      }
      .title {
        position: absolute; left: 96px; top: 240px; width: 1600px;
        color: var(--fg); font-family: var(--display);
        font-size: 104px; font-weight: 700; line-height: 1.02;
        letter-spacing: -0.04em;
      }
      .title::after {
        content: attr(data-description);
        display: block;
        margin-top: 18px;
        color: var(--muted);
        font-family: var(--body);
        font-size: 28px;
        font-weight: 500;
        line-height: 1.35;
        letter-spacing: 0;
      }
      .caption {
        position: absolute; left: 96px; bottom: 170px; width: 1500px;
        color: var(--fg); font-family: var(--display);
        font-size: 68px; font-weight: 700; line-height: 1.08;
        letter-spacing: -0.03em;
      }
      .caption::before {
        content: attr(data-description);
        display: block;
        margin-bottom: 18px;
        color: var(--accent);
        font-family: var(--body);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .card {
        position: absolute; left: 200px; right: 200px; top: 300px;
        padding: 48px; border: 1px solid var(--accent); border-radius: 18px;
        background: rgba(0, 0, 0, 0.28); color: var(--fg);
      }
      .card-kicker {
        display: block; color: var(--accent); font-size: 22px;
        letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 18px;
      }
      .card strong { display: block; font-family: var(--display); font-size: 56px; line-height: 1.05; }
      .card p { margin-top: 18px; color: var(--muted); font-size: 28px; line-height: 1.35; }
      .lower-third {
        position: absolute; left: 96px; bottom: 96px;
        padding: 18px 24px; border-left: 6px solid var(--accent); color: var(--fg);
        background: rgba(6, 9, 19, 0.84);
        border-radius: 0 12px 12px 0;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      .lower-third strong { display: block; font-family: var(--display); font-size: 34px; }
      .lower-third span { display: block; margin-top: 6px; color: var(--muted); font-size: 28px; }
      .end-card {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; text-align: center; color: var(--fg);
      }
      .end-card::after {
        content: attr(data-description);
        display: block;
        margin-top: 24px;
        color: var(--muted);
        font-size: 28px;
        font-weight: 500;
      }
      .broll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      ${panelCss}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration.toFixed(3)}"
      data-fps="${fps}"
      data-width="${width}"
      data-height="${height}"
    >
      <div id="brand" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" data-track-index="0">${htmlEscape(projectName)}</div>
      ${baseHtml}
      ${panelHtml}
      ${elementHtml}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.seek(0);
      ${baseTween}
      ${timeline}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

function buildHyperFrames(project, plan, args) {
  const engineDir = path.join(project.dir, "engine", "hyperframes");
  if (exists(engineDir) && !args.force) {
    fail(`HyperFrames project already exists at ${engineDir}. Use --force to rebuild it.`);
  }
  if (exists(engineDir)) removeDirRobust(engineDir);
  ensureDir(engineDir);

  const remapped = planForBuild(plan, args);
  const base = buildBaseMedia(project, plan, remapped.keeps, engineDir, args);
  const finalPlan = { ...remapped.plan, duration: base.duration };
  copyElementAssets(project.dir, finalPlan, path.join(engineDir, "assets"), "assets/");
  const theme = themeFromProfile(resolveProfile(project.config.profile));

  writeText(path.join(engineDir, "index.html"), renderHyperFramesHtml(project, finalPlan, theme, base));
  writeJson(path.join(engineDir, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  });
  writeJson(path.join(engineDir, "package.json"), {
    name: `${project.slug}-hyperframes`,
    private: true,
    type: "module",
    scripts: {
      dev: "npx --yes hyperframes preview",
      check: "npx --yes hyperframes check",
      render: "npx --yes hyperframes render",
    },
  });
  writeJson(path.join(engineDir, "meta.json"), {
    id: `${project.slug}-hyperframes`,
    name: project.config.name || project.slug,
    createdAt: now(),
  });
  writeText(
    path.join(engineDir, "README.md"),
    `# ${project.config.name || project.slug} - HyperFrames\n\nGenerated by RoosterEdit from \`edit/plan.json\`.\n\n\`\`\`bash\nnpx hyperframes check\nnpx hyperframes preview\nnpx hyperframes render --quality draft -o ../../renders/draft.mp4\nnpx hyperframes render --quality delivery -o ../../renders/final.mp4\n\`\`\`\n`
  );

  return { engineDir, base, duration: base.duration };
}

function renderRemotionTsx(project, plan, theme, base) {
  const projectName = JSON.stringify(project.config.name || project.slug);
  return `import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { plan, theme, base } from "./data/plan";

const fps = plan.format?.fps ?? 30;
const projectName = ${projectName};

const fade = (frame: number, start: number, end: number) => {
  const a = Math.max(0, start) * fps;
  const b = Math.max(a + 1, (start + 0.35) * fps);
  const c = Math.max(b + 1, (end - 0.25) * fps);
  const d = Math.max(c + 1, end * fps);
  return interpolate(frame, [a, b, c, d], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

const textOf = (element: any) => element.text ?? element.description ?? "";

const Element = ({ element, frame }: { element: any; frame: number }) => {
  const opacity = fade(frame, element.start, element.end);
  if (opacity <= 0.001) return null;
  const text = textOf(element);
  const common = { position: "absolute" as const, opacity };

  switch (element.type) {
    case "letreiro":
      return <div style={{ ...common, left: 96, top: 240, width: 1600, fontSize: 104, fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.04em" }}>{text}</div>;
    case "caption-emphasis":
      return <div style={{ ...common, left: 96, bottom: 170, width: 1500, fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em" }}>{text}</div>;
    case "grafico":
    case "lista":
      return (
        <div style={{ ...common, left: 200, right: 200, top: 300, padding: 48, border: \`1px solid \${theme.accent}\`, borderRadius: 18, background: "rgba(0,0,0,0.28)" }}>
          <div style={{ color: theme.accent, fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 18 }}>{element.type}</div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.05 }}>{text}</div>
          <div style={{ marginTop: 18, color: theme.muted, fontSize: 28, lineHeight: 1.35 }}>{element.description ?? ""}</div>
        </div>
      );
    case "lower-third":
      return (
        <div style={{ ...common, left: 96, bottom: 96, paddingLeft: 24, borderLeft: \`6px solid \${theme.accent}\` }}>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{text}</div>
          <div style={{ marginTop: 6, color: theme.muted, fontSize: 24 }}>{element.description ?? ""}</div>
        </div>
      );
    case "end-card":
      return (
        <div style={{ ...common, inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <div style={{ fontSize: 88, fontWeight: 700 }}>{text}</div>
          <div style={{ marginTop: 24, color: theme.muted, fontSize: 28 }}>{element.description ?? ""}</div>
        </div>
      );
    case "broll": {
      const src = element.src || element.asset;
      if (!src) return null;
      if (/\\.(png|jpe?g|webp|gif|svg)$/i.test(src)) {
        return <Img src={staticFile(src)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity }} />;
      }
      if (/\\.(mp4|webm|mov|m4v)$/i.test(src)) {
        return <OffthreadVideo src={staticFile(src)} muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity }} />;
      }
      return null;
    }
    default:
      return null;
  }
};

export const RoosterVideo = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, color: theme.fg, fontFamily: theme.body + ', "Segoe UI", sans-serif', overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: \`radial-gradient(circle at 70% 30%, \${theme.accent}22, transparent 45%), radial-gradient(circle at 20% 80%, \${theme.accent2}18, transparent 40%), \${theme.bg}\` }} />
      {base.kind === "image" ? <Img src={staticFile(base.path)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      {base.kind === "video" ? <OffthreadVideo src={staticFile(base.path)} muted={!base.hasAudio} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      {base.kind === "audio" ? <Audio src={staticFile(base.path)} /> : null}
      <div style={{ position: "absolute", left: 96, top: 72, color: theme.accent, fontSize: 28, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>{projectName}</div>
      {(plan.elements ?? []).map((element: any, index: number) => (
        <Element key={index} element={element} frame={frame} />
      ))}
    </AbsoluteFill>
  );
};
`;
}

function buildRemotion(project, plan, args) {
  const engineDir = path.join(project.dir, "engine", "remotion");
  if (exists(engineDir) && !args.force) {
    fail(`Remotion project already exists at ${engineDir}. Use --force to rebuild it.`);
  }
  if (exists(engineDir)) removeDirRobust(engineDir);
  ensureDir(engineDir);

  const assetsDir = path.join(engineDir, "public", "assets");
  const remapped = planForBuild(plan, args);
  const base = buildBaseMedia(project, plan, remapped.keeps, engineDir, args, "public/assets");
  const finalPlan = { ...remapped.plan, duration: base.duration };
  copyElementAssets(project.dir, finalPlan, assetsDir, "assets/");
  const theme = themeFromProfile(resolveProfile(project.config.profile));

  writeText(
    path.join(engineDir, "src", "data", "plan.ts"),
    `export const plan = ${JSON.stringify(finalPlan, null, 2)};\nexport const theme = ${JSON.stringify(theme, null, 2)};\nexport const base = ${JSON.stringify(base, null, 2)};\n`
  );
  writeText(path.join(engineDir, "src", "Video.tsx"), renderRemotionTsx(project, finalPlan, theme, base));
  writeText(
    path.join(engineDir, "src", "Root.tsx"),
    `import { Composition } from "remotion";
import { RoosterVideo } from "./Video";
import { plan } from "./data/plan";

const fps = plan.format?.fps ?? 30;
const duration = plan.duration ?? 10;

export const RemotionRoot = () => (
  <Composition
    id="RoosterVideo"
    component={RoosterVideo}
    durationInFrames={Math.max(1, Math.ceil(duration * fps))}
    fps={fps}
    width={plan.format?.width ?? 1920}
    height={plan.format?.height ?? 1080}
  />
);
`
  );
  writeText(
    path.join(engineDir, "src", "index.ts"),
    `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\n\nregisterRoot(RemotionRoot);\n`
  );
  writeText(
    path.join(engineDir, "remotion.config.ts"),
    `import { Config } from "@remotion/cli/config";\n\nConfig.setVideoImageFormat("jpeg");\nConfig.setOverwriteOutput(true);\n`
  );
  writeText(
    path.join(engineDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: false,
          skipLibCheck: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
        include: ["src"],
      },
      null,
      2
    )
  );
  writeJson(path.join(engineDir, "package.json"), {
    name: `${project.slug}-remotion`,
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "remotion studio",
      render: "remotion render src/index.ts RoosterVideo out/final.mp4",
    },
    dependencies: {
      "@remotion/cli": "^4.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      remotion: "^4.0.0",
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      typescript: "^5.9.0",
    },
  });
  writeText(
    path.join(engineDir, "README.md"),
    `# ${project.config.name || project.slug} - Remotion\n\nGenerated by RoosterEdit from \`edit/plan.json\`.\n\n\`\`\`bash\nnpm install\nnpx remotion studio\nnpx remotion render src/index.ts RoosterVideo out/final.mp4\n\`\`\`\n`
  );

  return { engineDir, base, duration: base.duration };
}

function buildCommand(args) {
  const project = resolveProject(args._[0]);
  if (!exists(project.dir)) fail(`Project directory not found: ${project.dir}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  if (!exists(planPath)) {
    fail(`No edit/plan.json found at ${planPath}. Run transcribe and write the plan first.`);
  }

  const plan = readJson(planPath, null);
  const { errors } = validatePlan(plan, project.dir);
  if (errors.length) {
    fail(`The plan has ${errors.length} error(s):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  let engine = typeof args.engine === "string" ? args.engine : project.config.engine || "auto";
  if (engine === "auto") {
    const category = project.config.category || "";
    const has3d = (plan.elements || []).some((element) => /3d/i.test(String(element.type || "")));
    engine = category === "3d-cartoon" || has3d ? "remotion" : "hyperframes";
  }
  if (!["hyperframes", "remotion"].includes(engine)) {
    fail(`Engine "${engine}" is not a creative build target. Use hyperframes or remotion (FFmpeg is a media utility).`);
  }

  const result = engine === "hyperframes" ? buildHyperFrames(project, plan, args) : buildRemotion(project, plan, args);

  const updated = {
    ...project.config,
    engine,
    status: "preview",
    updatedAt: now(),
    pipeline: Array.from(new Set([...(project.config.pipeline || []), "plan", engine])),
  };
  writeJson(path.join(project.dir, "project.json"), updated);

  heading(`Built ${engine} project`);
  console.log(`  ${result.engineDir}`);
  console.log(`  Media: ${result.base.kind} · ${result.duration.toFixed(2)}s`);
  console.log("\nNext:");
  if (engine === "hyperframes") {
    console.log(`  cd "${result.engineDir}"`);
    console.log("  npx hyperframes check");
    console.log("  npx hyperframes preview");
    console.log("  npx hyperframes render --quality draft -o ../../renders/draft.mp4");
  } else {
    console.log(`  cd "${result.engineDir}"`);
    console.log("  npm install");
    console.log("  npx remotion studio");
    console.log("  npx remotion render src/index.ts RoosterVideo ../../renders/final.mp4");
  }
}

// ---------------------------------------------------------------------------
// ingest
// ---------------------------------------------------------------------------

function probeMedia(file) {
  const result = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size,bit_rate,format_name",
    "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate",
    "-of", "json",
    file,
  ]);
  if (!result.ok) return { error: result.stderr || "ffprobe failed" };
  try {
    const data = JSON.parse(result.stdout);
    const video = (data.streams || []).find((s) => s.codec_type === "video") || {};
    const audio = (data.streams || []).find((s) => s.codec_type === "audio") || {};
    const [num, den] = String(video.r_frame_rate || "0/1").split("/").map(Number);
    return {
      duration: Number(data.format?.duration) || null,
      bytes: Number(data.format?.size) || null,
      bitRate: Number(data.format?.bit_rate) || null,
      format: data.format?.format_name || null,
      width: video.width || null,
      height: video.height || null,
      fps: den ? Number((num / den).toFixed(3)) : null,
      codec: video.codec_name || null,
      audio: Boolean(audio.codec_name),
      channels: audio.channels || null,
      sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
    };
  } catch (error) {
    return { error: `Could not parse ffprobe output: ${error.message}` };
  }
}

function addManifestAsset(projectDir, asset) {
  const manifestPath = path.join(projectDir, "assets", "manifest.json");
  const manifest = readJson(manifestPath, { schema: "rooster.manifest/v1", assets: [] });
  if (!Array.isArray(manifest.assets)) manifest.assets = [];
  manifest.assets.push(asset);
  writeJson(manifestPath, manifest);
}

function ingest(args) {
  const slug = projectSlugFromArg(args);
  const { dir, config } = findProject(slug);
  if (!exists(dir) || !config) fail(`Project "${slug}" not found. Run "new ${slug}" first.`);

  const url = typeof args.url === "string" ? args.url : null;
  const file = typeof args.file === "string" ? args.file : typeof args._[1] === "string" ? args._[1] : null;

  if (!url && !file) {
    fail("Provide --url <url> or --file <path>. For links, add --confirm-rights.");
  }

  if (url) {
    if (!args["confirm-rights"]) {
      fail(
        "Refusing to download a link without confirmation.\n" +
          "Only download content you own or have permission to use. Re-run with --confirm-rights if that is the case."
      );
    }

    const workspaceConfig = readJson(path.join(WORKSPACE, "config.json"), {});
    if (workspaceConfig.assets?.allowDownload === false && !args.force) {
      fail(
        "Downloads are disabled in config. Run \"config set assets.allowDownload true\" or pass --force."
      );
    }

    if (!versionOf("yt-dlp", ["--version"])) {
      fail(
        "yt-dlp is not installed.\n" +
          "Install it with one of:\n" +
          "  winget install yt-dlp\n" +
          "  pipx install yt-dlp\n" +
          "  python -m pip install --user -U yt-dlp"
      );
    }

    const name = slugify(args.name || `link-${shortHash(url)}`);
    const outDir = path.join(dir, "assets", "source", name);
    ensureDir(outDir);
    const outputTemplate = path.join(outDir, "video.%(ext)s");

    heading(`Downloading ${url}`);
    const cookieArgs = [];
    if (typeof args["cookies-from-browser"] === "string") {
      cookieArgs.push("--cookies-from-browser", args["cookies-from-browser"]);
    }
    if (typeof args.cookies === "string") {
      cookieArgs.push("--cookies", args.cookies);
    }

    const result = run(
      "yt-dlp",
      [
        "--no-playlist",
        ...cookieArgs,
        "--format", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--write-info-json",
        "--write-thumbnail",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "pt.*,en.*",
        "--sub-format", "srt",
        "--write-description",
        "--output", outputTemplate,
        url,
      ],
      { cwd: dir, timeout: 30 * 60 * 1000 }
    );

    if (!result.ok) {
      console.error(result.stderr || result.stdout || "yt-dlp failed");
      fail("Download failed. See references/link-ingest.md for troubleshooting.");
    }

    const files = fs.readdirSync(outDir);
    const videoFile = files.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f));
    if (!videoFile) fail("yt-dlp finished but no video file was found.");

    const videoPath = path.join(outDir, videoFile);
    const infoPath = path.join(outDir, "video.info.json");
    const info = readJson(infoPath, null);
    const probe = probeMedia(videoPath);

    const asset = {
      id: `asset-${shortHash(videoPath)}`,
      path: path.relative(dir, videoPath).replace(/\\/g, "/"),
      type: "video",
      source: "url",
      origin: "url",
      url,
      author: info?.uploader || info?.channel || null,
      title: info?.title || null,
      license: "unknown",
      attribution: info?.uploader || "",
      downloadedAt: now(),
      probe,
      tags: ["link"],
      files: files.map((f) => path.relative(dir, path.join(outDir, f)).replace(/\\/g, "/")),
    };
    addManifestAsset(dir, asset);

    heading("Downloaded");
    console.log(`  ${videoPath}`);
    console.log(`  Manifest: assets/manifest.json`);
    console.log("\nNext: review the rights, transcribe the audio, and plan the cut.");
    return;
  }

  if (file) {
    const source = path.resolve(CWD, file);
    if (!exists(source)) fail(`File not found: ${source}`);
    const base = path.basename(source);
    const destDir = path.join(dir, "assets", "source", slugify(path.parse(base).name));
    ensureDir(destDir);
    const dest = path.join(destDir, base);
    linkOrCopy(source, dest);
    const probe = probeMedia(dest);
    const license = args.license || "unknown";
    const workspaceConfig = readJson(path.join(WORKSPACE, "config.json"), {});
    if (license === "unknown" && workspaceConfig.assets?.licensePolicy === "strict") {
      console.warn("! License is unknown. Record it before publishing (config: assets.licensePolicy).");
    }
    const asset = {
      id: `asset-${shortHash(dest)}`,
      path: path.relative(dir, dest).replace(/\\/g, "/"),
      type: probe.width ? (/\.(png|jpe?g|webp|gif|svg)$/i.test(base) ? "image" : "video") : "audio",
      source: "user",
      origin: "file",
      license,
      attribution: "",
      addedAt: now(),
      probe,
      tags: [],
    };
    addManifestAsset(dir, asset);
    heading("Ingested");
    console.log(`  ${dest}`);
    console.log(`  Manifest: assets/manifest.json`);
  }
}

// ---------------------------------------------------------------------------
// preview / render stubs
// ---------------------------------------------------------------------------

function preview(args) {
  const slug = projectSlugFromArg(args);
  const { dir, config } = findProject(slug);
  if (!exists(dir) || !config) fail(`Project "${slug}" not found.`);

  const engineDir = path.join(dir, "engine");
  const hyperframes = path.join(engineDir, "hyperframes");
  const remotion = path.join(engineDir, "remotion");
  const ffmpeg = path.join(engineDir, "ffmpeg");

  heading(`Preview — ${slug}`);
  if (exists(hyperframes)) {
    console.log("  HyperFrames project found. Run:");
    console.log(`    cd "${hyperframes}" && npx hyperframes preview`);
  } else if (exists(remotion)) {
    console.log("  Remotion project found. Run:");
    console.log(`    cd "${remotion}" && npx remotion studio`);
  } else if (exists(ffmpeg)) {
    console.log("  FFmpeg project found. Render a draft and open it:");
    console.log(`    node "${path.join(SKILL_ROOT, "scripts", "rooster.mjs")}" render ${slug} --draft`);
  } else {
    console.log("  No engine project yet. Build the storyboard and timeline first.");
    console.log(`  Timeline: ${path.join(dir, "edit", "timeline.json")}`);
  }
  console.log("\n  Unified review page is planned for the next phase.");
}

function render(args) {
  const slug = projectSlugFromArg(args);
  const { dir, config } = findProject(slug);
  if (!exists(dir) || !config) fail(`Project "${slug}" not found.`);

  const quality = args.final ? "final" : "draft";
  heading(`Render ${quality} — ${slug}`);
  const engineDir = path.join(dir, "engine", config.engine === "auto" ? "" : config.engine);
  console.log("  Rendering is delegated to the engine. Use:");
  if (exists(path.join(engineDir, "hyperframes")) || config.engine === "hyperframes") {
    console.log(`    cd "${path.join(dir, "engine", "hyperframes")}" && npx hyperframes render --quality ${quality === "final" ? "delivery" : "draft"} -o ../../renders/${quality}.mp4`);
  } else if (exists(path.join(engineDir, "remotion")) || config.engine === "remotion") {
    console.log(`    cd "${path.join(dir, "engine", "remotion")}" && npx remotion render <composition-id> ../../renders/${quality}.mp4`);
  } else if (exists(path.join(engineDir, "ffmpeg")) || config.engine === "ffmpeg") {
    console.log(`    cd "${path.join(dir, "engine", "ffmpeg")}" && bash build.sh`);
  } else {
    console.log("  No engine project found. Build one first.");
  }
  console.log("\n  The automated render wrapper is planned for the next phase.");
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

function help() {
  console.log(`
RoosterEdit ${VERSION}

Usage:
  node scripts/rooster.mjs <command> [options]

Commands:
  doctor [--json]                 Detect tools, engines, TTS, and workspace
  init [--dir <path>] [--force]   Create a workspace
  new <slug> [options]            Create a project inside a channel
  list [--json]                   List channels, projects, profiles, categories
  channel list|show|new|set|use   Manage channels and their defaults
  check <slug> [--json]           Validate project and timeline
  check [--json]                  Validate the root project (no slug)
  config [show|path|get|set]      Workspace defaults and asset/TTS policy
  profile list|show|fork         Reusable visual identities
  category list|show|fork        Reusable content recipes
  digest <slug> [--from/--to]     Compact transcript summary
  transcribe [slug] [options]     Transcribe assets/source with Whisper
  plan [slug] [--check|--show]    Validate and show edit/plan.json
  build <slug> [options]          Build a HyperFrames or Remotion project from the plan
  ingest <slug> --url <url>       Download a link with yt-dlp
  ingest <slug> --file <path>     Copy a local media file
  preview <slug>                  Show the preview path for the engine
  render <slug> [--draft|--final] Show the render command for the engine

Ingest options:
  --confirm-rights                Required for --url; confirms you have rights
  --cookies-from-browser <name>   Pass browser cookies to yt-dlp
  --cookies <path>                Pass a cookies.txt file to yt-dlp
  --license <id>                  License for local files (default: unknown)
  --force                         Override a disabled download policy

Transcribe options:
  --input <path>                  Override the media file
  --engine <id>                   auto | hyperframes | whisper | faster-whisper (default: auto)
  --model <name>                  Whisper model (default: small)
  --language <code>               Language (default: pt)
  --verbose                       Print every transcript segment

Plan options:
  --check                         Validate only
  --show                          Show the plan summary (default)
  --json                          Machine-readable output

Build options:
  --engine <id>                   hyperframes | remotion (default: auto)
  --force                         Rebuild an existing engine project
  --no-cuts                       Ignore plan cuts and use the original source

New project options:
  --channel <id>                  Channel (default: workspace default)
  --name <name>                   Display name
  --category <id>                 Category (default: channel/category)
  --profile <id>                  Profile (default: channel profile)
  --engine <id>                   auto | hyperframes | remotion | ffmpeg
  --format <aspect>               16:9 | 9:16 | 1:1 | 4:5 (default: channel)
  --duration <seconds>            Target duration
  --language <code>               Language (default: channel language)
  --source <id>                   live | generated | hybrid
  --voice <id>                    user | tts | none
  --style <id>                    user | profile | ai | reference
  --autonomy <id>                 auto | guided | manual
  --assets <id>                   user | link | library | generated | none | mixed
  --force                         Overwrite an existing project

Channel options:
  --language <code>               Default language
  --format <aspect>               Default format (or auto)
  --profile <id>                  Default profile
  --category <id>                 Default category
  --voice <id>                    user | tts | none
  --engine <id>                   auto | hyperframes | remotion
  --autonomy <id>                 auto | guided | manual
  --assets <id>                   user | link | library | generated | none | mixed
  --allow-download <bool>         Allow authorized downloads
  --allow-generate <bool>         Allow generated media
  --license-policy <id>           strict | permissive

Environment:
  ROOSTER_WORKSPACE               Workspace path (default: ./rooster)
  ROOSTER_HOME                    Global library (default: ~/.rooster)
  ROOSTER_PROFILE                 Default profile
  ROOSTER_ENGINE                  Default engine
  ROOSTER_TTS_PROVIDER            Default TTS provider
  ROOSTER_BROWSER                 available | unavailable | unknown

Examples:
  node scripts/rooster.mjs init
  node scripts/rooster.mjs init
  node scripts/rooster.mjs channel new en-tech --language en --format 16:9 --profile tech-neon --category faceless-explainer
  node scripts/rooster.mjs new video-x --channel en-tech --duration 60
  node scripts/rooster.mjs config set assets.strategy user
  node scripts/rooster.mjs profile fork minimal --as my-brand
  node scripts/rooster.mjs category fork faceless-explainer --as my-explainer
  node scripts/rooster.mjs digest en-tech/video-x --from 0 --to 60
  node scripts/rooster.mjs check en-tech/video-x
  node scripts/rooster.mjs ingest meu-video --url "https://youtu.be/..." --confirm-rights
  node scripts/rooster.mjs transcribe meu-video --model small --language pt
  node scripts/rooster.mjs plan meu-video --show
  node scripts/rooster.mjs build meu-video --engine hyperframes
  node scripts/rooster.mjs check meu-video
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();

  if (!command || command === "help" || args.help) {
    help();
    return;
  }

  if (command === "version" || args.version) {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case "doctor": {
      const data = doctor();
      if (args.json) console.log(JSON.stringify(data, null, 2));
      else printDoctor(data);
      return;
    }
    case "init":
      initWorkspace(args);
      return;
    case "channel":
      channelCommand(args);
      return;
    case "new":
      newProject(args);
      return;
    case "list":
      listWorkspace(args);
      return;
    case "config":
      configCommand(args);
      return;
    case "profile":
      catalogCommand("profile", args);
      return;
    case "category":
      catalogCommand("category", args);
      return;
    case "digest":
      digestCommand(args);
      return;
    case "check":
      if (args._[0]) checkProject(args);
      else checkRoot(args);
      return;
    case "transcribe":
      transcribeCommand(args);
      return;
    case "plan":
      planCommand(args);
      return;
    case "build":
      buildCommand(args);
      return;
    case "ingest":
      ingest(args);
      return;
    case "preview":
      preview(args);
      return;
    case "render":
      render(args);
      return;
    default:
      fail(`Unknown command "${command}". Run with --help for usage.`);
  }
}

try {
  main();
} catch (error) {
  fail(error?.stack || String(error));
}
