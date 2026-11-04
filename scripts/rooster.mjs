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
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeCaptions, burnArgs } from "./features/captions.mjs";
import { buildMetadata, createThumbnail } from "./features/delivery.mjs";
import { reframeArgs, targetDimensions } from "./features/reframe.mjs";
import { rankBroll, suggestBrollElements } from "./features/broll.mjs";
import { mixAudioArgs } from "./features/audio.mjs";
import { colorArgs, buildStabilizePasses } from "./features/color.mjs";
import { hyperframesTransition, hyperframesZoom, remotionZoomValues, remotionTransitionValues } from "./features/motion.mjs";
import { renderChartSvg, validateChart, chartSummary } from "./features/charts.mjs";
import { splitScript, detectTtsProviders, buildTtsArgs, buildVoiceoverPlan } from "./features/tts.mjs";
import { buildMulticamPlan, speedFilter, jlCutOffsets } from "./features/multicam.mjs";
import { cacheClear, cacheGc, cacheInfo, cacheRoot, readCache, withCache } from "./lib/cache.mjs";
import { runAsync, runPool } from "./lib/exec.mjs";
import { detectCapabilities } from "./lib/capabilities.mjs";
import { engineVersion } from "./lib/engines.mjs";
import { buildProbeArgs, parseProbeJson, probeKey, sourceFingerprint } from "./lib/media.mjs";
import {
  hyperFramesRenderArgs,
  parseRenderProgress,
  readRenderMeta,
  remotionRenderArgs,
  renderKey,
  runRender,
  validateRenderProbe,
  writeRenderMeta,
} from "./lib/render.mjs";
import { cutKey, elementKey, hashKey, htmlKey, musicKey, readBuildState, roundKeeps, voiceKey, writeBuildState } from "./lib/build-cache.mjs";
import { buildBaseMediaArgs, preserveEngineCaches, restoreEngineCaches } from "./lib/build-media.mjs";
import {
  exportMedia as filmCraftExport,
  filmCraftMcpSnippet,
  filmCraftOnboardingPrompt,
  filmCraftRun,
  filmCraftStatus,
  filmCraftVersion,
  findFilmCraft,
  secondsToTicks,
  setupFilmCraftMcp,
  ticksToSeconds,
} from "./lib/filmcraft.mjs";
import { elementSpecs, summarizeTimeline, timelineFromPlan, timelineMarkers } from "./features/timeline.mjs";
import { getBrollIndex } from "./lib/broll-index.mjs";
import { contactSheetArgs, extractFramesArgs } from "./lib/qa-frames.mjs";
import { generateVoiceover } from "./lib/tts-runner.mjs";
import {
  fasterWhisperArgs,
  hyperFramesTranscribeArgs,
  normalizeLanguage,
  pickAsrBackend,
  shouldUseWords,
  transcriptKey,
  transcriptMeta,
} from "./lib/asr.mjs";
import { normalizeTranscript } from "./features/transcript.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const VERSION = "0.1.0";
const REMOTION_VERSION = "4.0.540";

const CWD = process.cwd();
const WORKSPACE = process.env.ROOSTER_WORKSPACE
  ? path.resolve(process.env.ROOSTER_WORKSPACE)
  : path.resolve(CWD, "rooster");
const ROOSTER_HOME = process.env.ROOSTER_HOME
  ? path.resolve(process.env.ROOSTER_HOME)
  : path.join(os.homedir(), ".rooster");

const ENGINE_IDS = ["auto", "hyperframes", "remotion", "ffmpeg"];
const TARGET_IDS = ["auto", "hyperframes", "remotion", "filmcraft"];
const TIMELINE_IDS = ["none", "filmcraft"];
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
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
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

function parseByteSize(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)?$/);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2] || "b";
  const factors = {
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
  };
  return Math.round(amount * (factors[unit] || 1));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
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

async function doctor(args = {}) {
  const cacheDir = cacheRoot(WORKSPACE);
  const capabilityCache = {
    dir: cacheDir,
    read: () => readJson(path.join(cacheDir, "capabilities.json"), null),
    write: (_key, value) => writeJson(path.join(cacheDir, "capabilities.json"), value),
  };
  return detectCapabilities({
    workspace: WORKSPACE,
    cwd: CWD,
    home: ROOSTER_HOME,
    deep: Boolean(args.deep),
    refresh: Boolean(args.refresh),
    runAsync: (name, commandArgs, options) => runAsync(name, commandArgs, options),
    cache: capabilityCache,
  });
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
  if (data.filmcraft) {
    const fc = data.filmcraft;
    console.log(
      `  FilmCraft CLI   ${
        fc.installed
          ? fc.cli
            ? `${fc.cli}${fc.version ? ` (${fc.version})` : ""}`
            : `app found, CLI missing${fc.app ? ` (${fc.app})` : ""}`
          : "not found"
      }`
    );
    if (fc.installed) {
      const mcp = fc.mcp || {};
      console.log(
        `  FilmCraft MCP   ${
          mcp.registered === true
            ? `configured${mcp.client ? ` (${mcp.client})` : ""}`
            : mcp.registered === false
              ? "not configured"
              : "no client config"
        }`
      );
    }
  }
  if (data.parakeet) {
    console.log(
      `  Parakeet        ${
        data.parakeet.installed
          ? data.parakeet.model || "installed"
          : data.parakeet.reason || "not installed"
      }`
    );
  }
  if (data.cache) {
    console.log(`  Cache           ${data.cache.enabled ? data.cache.dir : "off"}${data.cache.hit ? " (hit)" : ""}`);
  }
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
    content: typeof args.content === "string" ? args.content : "",
    language: typeof args.language === "string" ? args.language : workspaceDefaults.language || "pt-BR",
    format: typeof args.format === "string" ? args.format : "16:9",
    profile: typeof args.profile === "string" ? args.profile : workspaceDefaults.profile || "minimal",
    source: SOURCE_IDS.includes(args.source) ? args.source : "hybrid",
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
  if (args.category !== undefined) {
    fail('Category was removed. Use --content to describe what the channel produces, then create the project with its own brief and plan.');
  }
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
        `  ${id.padEnd(24)} ${String(channel.language || "?").padEnd(7)} ${String(channel.format || "?").padEnd(5)} ${String(channel.profile || "?").padEnd(14)} ${channel.engine || "auto"}`
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
    if (args.duration !== undefined) {
      fail('Duration belongs to the project. Create the project with: new <slug> --duration <seconds>');
    }
    const channelPath = path.join(channelsDir(), id, "channel.json");
    if (exists(channelPath) && !args.force) fail(`Channel already exists: ${id}`);
    const workspaceMeta = readJson(path.join(WORKSPACE, "workspace.json"), {});
    const config = readJson(path.join(WORKSPACE, "config.json"), {});
    const channel = buildChannel(id, args, workspaceMeta.defaults || {}, config);
    ensureDir(path.join(channelsDir(), id, "projects"));
    ensureDir(path.join(channelsDir(), id, "profiles"));
    ensureDir(path.join(channelsDir(), id, "assets"));
    ensureDir(path.join(channelsDir(), id, "library"));
    writeJson(channelPath, channel);
    heading("Channel created");
    console.log(`  ${path.join(channelsDir(), id)}`);
    console.log(`  language ${channel.language} · ${channel.format} · ${channel.profile} · ${channel.engine}`);
    return;
  }

  if (action === "set") {
    const id = slugify(args._[1] || "");
    const key = args._[2];
    const rawValue = args._[3];
    if (!id || !key || rawValue === undefined) {
      fail("Usage: channel set <id> <key> <value>");
    }
    if (key === "category" || key.startsWith("category.")) {
      fail("Category was removed. Use \"content\" to describe what the channel produces.");
    }
    if (key === "duration" || key.startsWith("duration.")) {
      fail("Duration belongs to the project. Use: new <slug> --duration <seconds>");
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
  for (const dir of ["projects", "profiles", "assets", "library"]) {
    ensureDir(path.join(target, "channels", "default", dir));
  }

  writeText(
    path.join(target, "README.md"),
    `# RoosterEdit workspace

Este é o workspace local do RoosterEdit.

## Estrutura

- \`channels/\` — canais com idioma, formato, perfil, assets e projetos.
- \`profiles/\` — identidades visuais/sonoras compartilhadas.
- \`library/\` — música, SFX, fontes, overlays, LUTs, b-roll e imagens.
- \`cache/\` — transcrições, proxies e artefatos temporários.

## Começar

\`\`\`bash
node <skill>/scripts/rooster.mjs channel new meu-canal --language pt-BR --format 16:9 --profile minimal
node <skill>/scripts/rooster.mjs new meu-video --channel meu-canal
\`\`\`

A skill fica na raiz do repositório RoosterEdit. Este workspace pertence ao projeto de vídeo, não à skill.
`
  );

  // Copy built-in profiles if the skill ships them.
  const builtinProfiles = path.join(SKILL_ROOT, "templates", "profiles");
  if (exists(builtinProfiles)) {
    for (const entry of fs.readdirSync(builtinProfiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = path.join(builtinProfiles, entry.name);
      const dest = path.join(target, "profiles", entry.name);
      if (!exists(dest)) copyDir(src, dest);
    }
  }

  heading("Workspace created");
  console.log(`  ${target}`);
  console.log("\nNext:");
  const cli = path.join(SKILL_ROOT, "scripts", "rooster.mjs");
  console.log(`  node "${cli}" channel new meu-canal --language pt-BR --format 16:9 --profile minimal`);
  console.log(`  node "${cli}" new meu-video --channel meu-canal`);
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

function newProject(args) {
  if (args.category !== undefined) {
    fail('Category was removed. Use --channel and the project overrides; describe the content in brief.md and script.md.');
  }
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

  const aspect =
    typeof args.format === "string"
      ? args.format
      : channel.format && channel.format !== "auto"
        ? channel.format
        : workspaceDefaults.aspect || "16:9";
  const format = resolveFormat(aspect);
  if (args.duration) {
    format.duration = Number(args.duration) || format.duration;
  }

  const profile =
    typeof args.profile === "string"
      ? args.profile
      : channel.profile || workspaceDefaults.profile || process.env.ROOSTER_PROFILE || "minimal";
  const target = TARGET_IDS.includes(args.target) ? args.target : null;
  let engine = ENGINE_IDS.includes(args.engine)
    ? args.engine
    : channel.engine || workspaceDefaults.engine || process.env.ROOSTER_ENGINE || "auto";
  const timeline = target === "filmcraft" ? "filmcraft" : "none";
  if (target && target !== "auto" && target !== "filmcraft") engine = target;
  const source = SOURCE_IDS.includes(args.source) ? args.source : channel.source || "hybrid";
  const voice = VOICE_IDS.includes(args.voice) ? args.voice : channel.voice || "none";
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
      : true;
  const captionsMode = channel.captions?.mode || "burned";
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

  const overrides = ["profile", "format", "source", "voice", "style", "autonomy", "engine", "target", "assets", "language"].filter(
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
    "work/handoffs",
    "work/logs",
    "work/scratch",
    "work/notes",
  ];
  for (const dir of dirs) ensureDir(path.join(projectDir, dir));

  const project = {
    schema: "rooster.project/v1",
    slug,
    name: typeof args.name === "string" ? args.name : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    channel: channelId,
    profile,
    engine,
    timeline,
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
  console.log(`  source: ${path.join(projectDir, "assets", "source")}`);
  console.log("\nNext:");
  console.log(`  1. Fill brief.md and script.md`);
  console.log(`  2. Add assets to assets/source, run ingest, or run "open ${slug}"`);
  console.log(`  3. Build storyboard and timeline`);
  console.log(`  4. Choose an engine and implement`);
  console.log(`  5. Preview, QA, render`);
}

function openProject(args) {
  if (!exists(WORKSPACE)) {
    fail(`No workspace at ${WORKSPACE}. Run "node scripts/rooster.mjs init" first.`);
  }
  const slug = args._[0];
  if (!slug) fail("Usage: open <slug> [--project] [--print]");
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const target = args.project ? project.dir : path.join(project.dir, "assets", "source");
  ensureDir(target);
  openPath(target, { print: args.print });
}

function openPath(target, options = {}) {
  console.log(target);
  if (options.print) return;
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const result = spawnSync(command, [target], { stdio: "ignore" });
  if (result.error) {
    console.log(`Could not open automatically. Open this path manually: ${target}`);
  }
}

// ---------------------------------------------------------------------------
// paths and list
// ---------------------------------------------------------------------------

function pathsCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);
  const paths = {
    project: project.dir,
    source: path.join(project.dir, "assets", "source"),
    style: path.join(project.dir, "style.md"),
    work: [path.join(project.dir, "edit"), path.join(project.dir, "work")],
    final: path.join(project.dir, "renders"),
  };
  if (args.json) {
    console.log(JSON.stringify(paths, null, 2));
    return;
  }
  heading(`Paths — ${project.slug}`);
  console.log(`  bruto    ${paths.source}`);
  console.log(`  estilo   ${paths.style}`);
  console.log(`  trabalho ${paths.work.join(" + ")}`);
  console.log(`  final    ${paths.final}`);
  console.log(`  projeto  ${paths.project}`);
}


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
        `  ${`${project.channel}/${project.slug}`.padEnd(36)} ${String(project.status).padEnd(10)} ${String(project.profile).padEnd(16)} ${project.engine}`
      );
    }
  }

  const channels = listChannelIds();
  const profiles = listDirNames(path.join(WORKSPACE, "profiles"));
  console.log(`\n  Channels:   ${channels.length ? channels.join(", ") : "(none)"}`);
  console.log(`  Profiles:   ${profiles.length ? profiles.join(", ") : "(none)"}`);
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
// profiles
// ---------------------------------------------------------------------------

const PROFILE_FILE = "profile.json";

function resolveProfileEntry(id) {
  const candidates = [
    { scope: "workspace", dir: path.join(WORKSPACE, "profiles", id) },
    { scope: "global", dir: path.join(ROOSTER_HOME, "profiles", id) },
    { scope: "builtin", dir: path.join(SKILL_ROOT, "templates", "profiles", id) },
  ];
  for (const candidate of candidates) {
    if (exists(path.join(candidate.dir, PROFILE_FILE))) return candidate;
  }
  return null;
}

function listProfiles() {
  const sources = [
    { scope: "workspace", dir: path.join(WORKSPACE, "profiles") },
    { scope: "global", dir: path.join(ROOSTER_HOME, "profiles") },
    { scope: "builtin", dir: path.join(SKILL_ROOT, "templates", "profiles") },
  ];
  const seen = new Map();
  for (const source of sources) {
    if (!exists(source.dir)) continue;
    for (const entry of fs.readdirSync(source.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(source.dir, entry.name, PROFILE_FILE);
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

function profileCommand(args) {
  const action = args._[0] || "list";

  if (action === "list") {
    const entries = listProfiles();
    heading("Profiles");
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
    if (!id) fail("Usage: profile show <id>");
    const entry = resolveProfileEntry(id);
    if (!entry) fail(`profile not found: ${id}`);
    const configPath = path.join(entry.dir, PROFILE_FILE);
    console.log(`# profile: ${id} (${entry.scope})`);
    console.log(configPath);
    console.log(JSON.stringify(readJson(configPath, {}), null, 2));
    return;
  }

  if (action === "fork") {
    const id = args._[1];
    const target = typeof args.as === "string" ? slugify(args.as) : null;
    if (!id || !target) fail("Usage: profile fork <id> --as <new-id>");
    const entry = resolveProfileEntry(id);
    if (!entry) fail(`profile not found: ${id}`);

    const destination = path.join(WORKSPACE, "profiles", target);
    if (exists(destination) && !args.force) {
      fail(`profile already exists at ${destination}. Use --force to overwrite.`);
    }
    if (exists(destination)) removeDirRobust(destination);
    copyDir(entry.dir, destination);

    const configPath = path.join(destination, PROFILE_FILE);
    const data = readJson(configPath, {});
    data.id = target;
    data.name = typeof args.name === "string" ? args.name : `${data.name || target} (fork)`;
    data.scope = "workspace";
    writeJson(configPath, data);

    heading("Profile forked");
    console.log(`  ${destination}`);
    console.log(`  edit ${configPath} to customize it.`);
    return;
  }

  fail("Usage: profile list | profile show <id> | profile fork <id> --as <new-id>");
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
    if (!config.channel) warnings.push("project.json: missing channel (legacy project)");
    else if (!exists(path.join(channelsDir(), config.channel, "channel.json"))) {
      errors.push(`project.json: channel not found "${config.channel}"`);
    }
    if (!config.profile) errors.push("project.json: missing profile");
    if (!config.format || !(config.format.duration > 0)) errors.push("project.json: invalid format.duration");
    if (config.engine && !ENGINE_IDS.includes(config.engine)) errors.push(`project.json: unknown engine "${config.engine}"`);
    if (config.timeline && !TIMELINE_IDS.includes(config.timeline)) {
      errors.push(`project.json: unknown timeline "${config.timeline}"`);
    }
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

function cutBoundaryWarnings(plan, dir) {
  const transcript = readJson(path.join(dir, "edit", "transcript.json"), null);
  const words = Array.isArray(transcript?.words) ? transcript.words : [];
  if (!words.length) return [];
  const tolerance = 0.03;
  const warnings = [];
  const ordered = words
    .filter(
      (word) =>
        typeof word.start === "number" &&
        typeof word.end === "number" &&
        word.end > word.start
    )
    .map((word) => ({ ...word, start: Number(word.start), end: Number(word.end) }))
    .sort((a, b) => a.start - b.start);
  if (!ordered.length) return [];
  const starts = ordered.map((word) => word.start);
  const wordAt = (time) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= time) low = mid + 1;
      else high = mid;
    }
    const center = Math.max(0, low - 1);
    for (let index = Math.max(0, center - 2); index <= Math.min(ordered.length - 1, center + 2); index += 1) {
      const word = ordered[index];
      if (word.start + tolerance < time && time < word.end - tolerance) return word;
    }
    return undefined;
  };
  for (const cut of plan.cuts || []) {
    if (typeof cut.start !== "number" || typeof cut.end !== "number") continue;
    for (const [label, time] of [["start", cut.start], ["end", cut.end]]) {
      const word = wordAt(time);
      if (word) {
        warnings.push(
          `plan: cut "${cut.id || "?"}" ${label}s inside word "${word.text}" (${word.start.toFixed(2)}–${word.end.toFixed(2)})`
        );
      }
    }
  }
  return warnings;
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

  if (plan.music) {
    if (!plan.music.src) warnings.push("plan: music missing src");
    else if (!exists(path.join(dir, plan.music.src))) warnings.push(`plan: music not found "${plan.music.src}"`);
  }

  for (const [index, clip] of (plan.sfx || []).entries()) {
    if (!clip.id) errors.push(`plan: sfx[${index}] missing id`);
    if (!clip.src) errors.push(`plan: sfx[${index}] missing src`);
    else if (!exists(path.join(dir, clip.src))) warnings.push(`plan: sfx not found "${clip.src}"`);
    if (typeof clip.start !== "number" || typeof clip.end !== "number") {
      errors.push(`plan: sfx[${index}] needs numeric start/end`);
    } else if (clip.start >= clip.end) {
      errors.push(`plan: sfx[${index}] has start >= end`);
    }
  }

  if (plan.color) {
    if (plan.color.lut && !exists(path.join(dir, plan.color.lut))) {
      warnings.push(`plan: color LUT not found "${plan.color.lut}"`);
    }
    if (plan.color.stabilize) {
      warnings.push("plan: color.stabilize requires the two-pass vidstab flow");
    }
  }

  if (plan.multicam) {
    try {
      const multicam = buildMulticamPlan(plan.multicam);
      for (const warning of multicam.warnings || []) warnings.push(`plan: multicam: ${warning}`);
    } catch (error) {
      errors.push(`plan: multicam: ${error.message}`);
    }
  }

  for (const element of plan.elements || []) {
    if (element.speed !== undefined && (!Number.isFinite(Number(element.speed)) || Number(element.speed) <= 0)) {
      errors.push(`plan: element "${element.id || "?"}" has invalid speed`);
    }
    if (element.speedRamp) {
      const ramp = element.speedRamp;
      if (!Number.isFinite(Number(ramp.from)) || !Number.isFinite(Number(ramp.to))) {
        warnings.push(`plan: element "${element.id || "?"}" speedRamp needs numeric from/to`);
      }
    }
    for (const key of ["audioOffset", "videoOffset"]) {
      if (element[key] !== undefined && !Number.isFinite(Number(element[key]))) {
        errors.push(`plan: element "${element.id || "?"}" ${key} must be numeric seconds`);
      }
    }
  }

  const notesText = (plan.notes || []).join(" ").toLowerCase();
  const cleanCut = /clean cut|cut only|s[oó] corte|sem elementos|no elements/.test(notesText);
  const hasVisualLayer = (plan.elements || []).length > 0;
  if (!hasVisualLayer && !cleanCut) {
    warnings.push("plan: no visual elements; add letreiros, b-roll, graphics, or state a clean-cut request in notes");
  }
  const noMusic = !plan.music?.src && !/no music|without music|sem m[uú]sica/.test(notesText);
  if (noMusic) {
    warnings.push("plan: no music; add a music track or state 'no music requested' in notes");
  }

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
    Number(plan.duration) ||
    (Array.isArray(plan.keeps) && plan.keeps.length
      ? Math.max(...plan.keeps.map((keep) => Number(keep.end) || 0))
      : 0);

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
    if (element.chart) {
      const chart = validateChart(element);
      for (const error of chart.errors || []) errors.push(`plan: element "${element.id || "?"}" ${error}`);
      for (const warning of chart.warnings || []) warnings.push(`plan: element "${element.id || "?"}" ${warning}`);
    }
  }

  let lastChapter = -1;
  for (const chapter of plan.chapters || []) {
    if (typeof chapter.start !== "number") errors.push("plan: chapter missing numeric start");
    else if (chapter.start < lastChapter) errors.push("plan: chapters are not sorted by start time");
    else lastChapter = chapter.start;
    if (!chapter.title) errors.push("plan: chapter missing title");
  }

  warnings.push(...cutBoundaryWarnings(plan, dir));

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

  const elements = plan.elements || [];
  const broll = elements.filter((element) => element.type === "broll").length;
  const advancedLayers = [
    plan.music?.src ? "music" : null,
    (plan.sfx || []).length ? "sfx" : null,
    plan.color ? "color" : null,
    plan.multicam ? "multicam" : null,
    elements.some((element) => element.type === "zoom" || element.type === "transition") ? "motion" : null,
    elements.some((element) => element.chart) ? "charts" : null,
  ].filter(Boolean);
  heading("Creative layer");
  console.log(`  Elements: ${elements.length}${broll ? ` (b-roll: ${broll})` : ""}`);
  console.log(`  Music:    ${plan.music?.src || "none"}`);
  console.log(`  Layers:   ${advancedLayers.join(", ") || "base"}`);

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
    if (element.chart) console.log(`    ${chartSummary(element)}`);
  }

  if ((plan.chapters || []).length) {
    heading("Chapters");
    for (const chapter of plan.chapters || []) {
      console.log(`  ${formatClock(chapter.start)}  ${chapter.title}`);
    }
  }
}

function planMarkdown(plan) {
  const lines = ["# Edit plan", ""];
  if (plan.source) lines.push(`- Source: ${plan.source}`);
  if (plan.duration) lines.push(`- Duration: ${formatClock(plan.duration)}`);
  if (plan.style) lines.push(`- Style: ${plan.style}`);
  if (plan.summary) lines.push(`- Summary: ${plan.summary}`);
  const elements = plan.elements || [];
  const brollCount = elements.filter((element) => element.type === "broll").length;
  lines.push("", "## Creative layer", "");
  lines.push(`- Visual elements: ${elements.length}${brollCount ? ` (b-roll: ${brollCount})` : ""}`);
  lines.push(`- Music: ${plan.music?.src || "none"}`);
  if (!elements.length) lines.push("- WARNING: no visual elements; add letreiros, b-roll, or graphics, or record a clean-cut request in notes");
  if (!plan.music?.src) lines.push("- WARNING: no music; add a track or record \"no music requested\" in notes");
  lines.push("");

  lines.push(`## Cuts (${(plan.cuts || []).length})`, "");
  for (const cut of plan.cuts || []) {
    lines.push(`- ${formatClock(cut.start)}-${formatClock(cut.end)} - ${cut.reason || "?"}${cut.note ? ` - ${cut.note}` : ""}`);
  }

  if ((plan.keeps || []).length) {
    lines.push("", `## Keeps (${plan.keeps.length})`, "");
    for (const keep of plan.keeps) {
      lines.push(`- ${formatClock(keep.start)}-${formatClock(keep.end)} - ${keep.reason || ""}`);
    }
  }

  lines.push("", `## Elements (${elements.length})`, "");
  for (const element of elements) {
    const text = element.text ? ` "${element.text}"` : "";
    lines.push(`- ${formatClock(element.start)}-${formatClock(element.end)} - ${element.type || "?"}${text} - ${element.description || ""}`);
  }

  if ((plan.chapters || []).length) {
    lines.push("", "## Chapters", "");
    for (const chapter of plan.chapters || []) {
      lines.push(`- ${formatClock(chapter.start)} - ${chapter.title}`);
    }
  }

  lines.push("", "Approve this plan before the timeline and render.");
  return lines.join("\n") + "\n";
}

function planHtml(plan, project, transcript = null) {
  const title = project?.config?.name || project?.slug || "Edit plan";
  const elementsList = plan.elements || [];
  const brollCount = elementsList.filter((element) => element.type === "broll").length;
  const noVisualElements = !elementsList.length;
  const noMusic = !plan.music?.src;
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const sourcePath = plan.source ? path.resolve(project.dir, plan.source) : null;
  const sourceVideo = sourcePath && exists(sourcePath) && /\.(mp4|webm|mov|m4v)$/i.test(sourcePath) && !/\.json$/i.test(sourcePath);
  const mediaRel = sourceVideo
    ? encodeURI(path.relative(path.join(project.dir, "edit"), sourcePath).replace(/\\/g, "/"))
    : null;
  const clipName = path.basename(String(plan.source || ""));
  const contextSegments = segments
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || "").trim(),
    }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.start - b.start);
  const contextStarts = contextSegments.map((segment) => segment.start);
  const contextLowerBound = (value) => {
    let low = 0;
    let high = contextStarts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (contextStarts[mid] < value) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const contextFor = (start, end) => {
    const from = Math.max(0, Number(start) || 0);
    const to = Math.max(from, Number(end) || from);
    let index = contextLowerBound(from);
    if (index > 0 && contextSegments[index - 1].end > from) index -= 1;
    const overlapping = [];
    for (; index < contextSegments.length && contextSegments[index].start < to; index += 1) {
      const segment = contextSegments[index];
      if (segment.end > from) overlapping.push(segment.text);
    }
    const text = overlapping.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  };
  const timeCell = (value) =>
    mediaRel ? `<a href="#" onclick="seek(${Number(value) || 0});return false">${formatClock(value)}</a>` : formatClock(value);
  const cuts = (plan.cuts || [])
    .map(
      (cut) =>
        `<tr><td>${timeCell(cut.start)}–${formatClock(cut.end)}</td><td>${htmlEscape(cut.reason || "")}</td><td>${htmlEscape(cut.note || "")}</td><td class="ctx">${htmlEscape(contextFor(cut.start, cut.end))}</td></tr>`
    )
    .join("");
  const keeps = (plan.keeps || [])
    .map((keep) => `<tr><td>${timeCell(keep.start)}–${formatClock(keep.end)}</td><td>${htmlEscape(keep.reason || "")}</td></tr>`)
    .join("");
  const elements = elementsList
    .map(
      (element) =>
        `<tr><td>${timeCell(element.start)}–${formatClock(element.end)}</td><td>${htmlEscape(element.type || "")}</td><td>${htmlEscape(element.text || "")}</td><td>${htmlEscape(element.description || "")}</td><td class="ctx">${htmlEscape(contextFor(element.start, element.end))}</td></tr>`
    )
    .join("");
  const chapters = (plan.chapters || [])
    .map((chapter) => `<tr><td>${timeCell(chapter.start)}</td><td>${htmlEscape(chapter.title || "")}</td></tr>`)
    .join("");
  const textItems = elementsList.filter((element) => element.text || ["letreiro", "grafico", "lista", "lower-third", "caption-emphasis", "end-card"].includes(element.type));
  const textReview = textItems
    .map(
      (element) =>
        `<tr><td>${timeCell(element.start)}</td><td>${htmlEscape(element.type || "")}</td><td>${htmlEscape(element.text || "(sem texto)")}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Plano de edição - ${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0f19; --card:#121826; --line:#263041; --fg:#f8fafc; --muted:#94a3b8; --accent:#22d3ee; }
    * { box-sizing: border-box; }
    body { margin:0; padding:32px; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 1000px; margin: 0 auto; }
    h1 { margin:0 0 8px; font-size: 30px; }
    .meta { color:var(--muted); margin-bottom:24px; }
    .summary { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--accent); padding:16px 18px; border-radius:10px; margin-bottom:24px; }
    section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:18px; }
    h2 { margin:0 0 12px; font-size:18px; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    tr:last-child td { border-bottom:0; }
    .empty { color:var(--muted); margin:0; }
    .gate { margin-top:24px; color:var(--muted); }
    .player { width:100%; max-height:440px; background:#000; border-radius:10px; margin-bottom:18px; display:block; }
    .ctx { color:var(--muted); font-size:13px; }
    .text-review td:nth-child(3) { font-weight:600; }
  </style>
</head>
<body>
  <main>
    <h1>Plano de edição</h1>
    <p class="meta">${htmlEscape(title)}${plan.source ? ` · ${htmlEscape(plan.source)}` : ""}${plan.duration ? ` · ${formatClock(plan.duration)}` : ""}${plan.style ? ` · ${htmlEscape(plan.style)}` : ""}</p>
    ${mediaRel ? `<video id="player" class="player" controls preload="metadata" src="${mediaRel}"></video>` : ""}
    ${plan.summary ? `<div class="summary">${htmlEscape(plan.summary)}</div>` : ""}
    <section><h2>Camada criativa</h2><p>Elementos visuais: ${elementsList.length}${brollCount ? ` (b-roll: ${brollCount})` : ""}<br />Música: ${plan.music?.src ? htmlEscape(plan.music.src) : "nenhuma"}</p>${noVisualElements ? `<p class="empty">Sem elementos visuais. Adicione letreiros, b-roll ou gráficos, ou registre um corte limpo em <code>notes</code>.</p>` : ""}${noMusic ? `<p class="empty">Sem música. Adicione uma faixa ou registre "no music requested" em <code>notes</code>.</p>` : ""}</section>
    <section><h2>Cortes (${(plan.cuts || []).length})</h2>${cuts ? `<table><thead><tr><th>Tempo</th><th>Motivo</th><th>Nota</th><th>Contexto</th></tr></thead><tbody>${cuts}</tbody></table>` : `<p class="empty">Nenhum corte.</p>`}</section>
    ${keeps ? `<section><h2>Trechos mantidos (${(plan.keeps || []).length})</h2><table><thead><tr><th>Tempo</th><th>Motivo</th></tr></thead><tbody>${keeps}</tbody></table></section>` : ""}
    <section><h2>Elementos (${(plan.elements || []).length})</h2>${elements ? `<table><thead><tr><th>Tempo</th><th>Tipo</th><th>Texto</th><th>Descrição</th><th>Contexto</th></tr></thead><tbody>${elements}</tbody></table>` : `<p class="empty">Nenhum elemento.</p>`}</section>
    ${textReview ? `<section><h2>Textos para revisar</h2><table class="text-review"><thead><tr><th>Tempo</th><th>Tipo</th><th>Texto em tela</th></tr></thead><tbody>${textReview}</tbody></table></section>` : ""}
    ${chapters ? `<section><h2>Capítulos</h2><table><thead><tr><th>Tempo</th><th>Título</th></tr></thead><tbody>${chapters}</tbody></table></section>` : ""}
    <p class="gate">Aprove este plano antes de criar a timeline e renderizar.${mediaRel ? " Clique em um tempo para pular o player." : ""}</p>
  </main>
  <script>
    const player = document.getElementById("player");
    function seek(seconds) {
      if (!player) return;
      player.currentTime = Math.max(0, Number(seconds) || 0);
      player.play().catch(() => {});
      player.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  </script>
</body>
</html>
`;
}


// ---------------------------------------------------------------------------
// style proof
// ---------------------------------------------------------------------------

function styleProofCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);

  const profile = resolveProfile(project.config.profile) || {};
  const theme = themeFromProfile(profile);
  const format = project.config.format || { width: 1920, height: 1080, fps: 30, aspect: "16:9" };
  const stylePath = path.join(project.dir, "style.md");
  const styleText = exists(stylePath) ? fs.readFileSync(stylePath, "utf8") : "";
  const outDir = path.join(project.dir, "style", "proof");
  const htmlPath = path.join(outDir, "index.html");
  const manifestPath = path.join(outDir, "proof.json");

  ensureDir(outDir);
  writeText(htmlPath, styleProofHtml(project, profile, theme, format, styleText));
  writeJson(manifestPath, {
    schema: "rooster.styleproof/v1",
    project: project.slug,
    profile: project.config.profile || null,
    format,
    frames: [
      { id: "hook", label: "Hook", purpose: "Headline, contrast, and first-three-seconds energy" },
      { id: "data", label: "Dado", purpose: "Chart, number, or comparison treatment" },
      { id: "caption", label: "Legenda", purpose: "Caption, lower third, and safe-area check" },
    ],
    createdAt: now(),
  });

  heading("Style proof");
  console.log(`  ${htmlPath}`);
  console.log("\n  Review the three frames before the plan. Ask for color, type,");
  console.log("  motion, or density changes while the proof is open.");
  if (args.open) openPath(htmlPath);
}

function styleProofHtml(project, profile, theme, format, styleText) {
  const name = project.config.name || project.slug;
  const profileId = project.config.profile || "default";
  const aspect = `${format.width || 1920} / ${format.height || 1080}`;
  const display = theme.display || "Inter";
  const body = theme.body || "Inter";
  const styleNote = styleText
    ? styleText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !/^[#\-*]/.test(line)) || ""
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Style proof — ${htmlEscape(name)}</title>
  <style>
    :root { color-scheme: dark; --bg:${theme.bg}; --fg:${theme.fg}; --muted:${theme.muted}; --accent:${theme.accent}; --accent2:${theme.accent2}; --line:color-mix(in srgb, var(--fg) 16%, transparent); }
    * { box-sizing: border-box; }
    body { margin:0; padding:40px; background:#0a0d14; color:var(--fg); font:15px/1.55 ${JSON.stringify(body)}, system-ui, sans-serif; }
    main { max-width:1180px; margin:0 auto; }
    h1 { margin:0 0 6px; font-size:30px; letter-spacing:-0.03em; }
    .meta { color:var(--muted); margin-bottom:28px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:22px; }
    .frame { background:var(--bg); border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 18px 50px rgba(0,0,0,.35); }
    .canvas { position:relative; aspect-ratio:${aspect}; overflow:hidden; padding:9%; display:flex; flex-direction:column; justify-content:center; background:var(--bg); color:var(--fg); }
    .canvas::after { content:""; position:absolute; inset:0; background:radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 42%), radial-gradient(circle at 18% 86%, color-mix(in srgb, var(--accent2) 14%, transparent), transparent 40%); pointer-events:none; }
    .kicker { position:relative; z-index:1; color:var(--accent); font-size:clamp(10px,1.4vw,18px); font-weight:700; letter-spacing:.18em; text-transform:uppercase; margin-bottom:6%; }
    .headline { position:relative; z-index:1; font-family:${JSON.stringify(display)}, ${JSON.stringify(body)}, system-ui, sans-serif; font-size:clamp(22px,5.2vw,58px); line-height:.98; letter-spacing:-0.045em; font-weight:800; max-width:92%; }
    .sub { position:relative; z-index:1; color:var(--muted); font-size:clamp(11px,1.7vw,20px); margin-top:5%; max-width:78%; }
    .rule { position:relative; z-index:1; width:26%; height:4px; background:var(--accent); margin-top:7%; }
    .big { position:relative; z-index:1; font-family:${JSON.stringify(display)}, ${JSON.stringify(body)}, system-ui, sans-serif; font-size:clamp(38px,10vw,104px); line-height:.9; letter-spacing:-0.06em; font-weight:800; }
    .big span { color:var(--accent); }
    .bars { position:relative; z-index:1; display:flex; align-items:flex-end; gap:4%; height:24%; margin-top:6%; }
    .bar { flex:1; background:linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 35%, var(--bg))); border-radius:6px 6px 0 0; min-height:8px; }
    .bar:nth-child(2) { height:62%; background:linear-gradient(180deg, var(--accent2), color-mix(in srgb, var(--accent2) 30%, var(--bg))); }
    .bar:nth-child(3) { height:38%; }
    .caption { position:absolute; z-index:2; left:8%; right:8%; bottom:10%; text-align:center; font-family:${JSON.stringify(display)}, ${JSON.stringify(body)}, system-ui, sans-serif; font-size:clamp(14px,2.7vw,30px); line-height:1.12; font-weight:800; letter-spacing:-0.02em; text-shadow:0 2px 12px rgba(0,0,0,.8); }
    .lower { position:absolute; z-index:2; left:8%; bottom:8%; padding-left:3%; border-left:4px solid var(--accent); }
    .lower strong { display:block; font-size:clamp(13px,2.2vw,26px); }
    .lower span { display:block; color:var(--muted); font-size:clamp(10px,1.6vw,18px); margin-top:2px; }
    .label { display:flex; justify-content:space-between; gap:12px; padding:12px 14px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    .label strong { color:var(--fg); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .tokens { margin-top:26px; border:1px solid var(--line); border-radius:14px; padding:18px 20px; background:rgba(255,255,255,.02); }
    .tokens h2 { margin:0 0 10px; font-size:16px; }
    .swatches { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
    .swatch { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; }
    .dot { width:18px; height:18px; border-radius:5px; border:1px solid var(--line); }
    .note { color:var(--muted); font-size:13px; margin-top:8px; }
    .gate { margin-top:28px; padding:14px 18px; border-left:3px solid var(--accent); background:rgba(255,255,255,.03); color:var(--muted); }
    @media (max-width: 620px) { body { padding:20px; } .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<main>
  <h1>Style proof</h1>
  <p class="meta">${htmlEscape(name)} · profile <code>${htmlEscape(profileId)}</code> · ${format.width || 1920}×${format.height || 1080} · ${format.fps || 30} fps</p>

  <div class="grid">
    <article class="frame">
      <div class="canvas">
        <div class="kicker">${htmlEscape(profile?.tokens?.motion?.feel || "Abertura")}</div>
        <div class="headline">A ideia que<br />muda o jogo.</div>
        <div class="sub">${htmlEscape(styleNote || "Texto de apoio para validar contraste, tipografia e respiro.")}</div>
        <div class="rule"></div>
      </div>
      <div class="label"><strong>1 · Hook</strong><span>headline + contraste</span></div>
    </article>

    <article class="frame">
      <div class="canvas">
        <div class="kicker">Prova</div>
        <div class="big">3<span>×</span> mais rápido</div>
        <div class="bars"><div class="bar" style="height:82%"></div><div class="bar"></div><div class="bar"></div></div>
        <div class="sub">Um gráfico de exemplo com a paleta e a tipografia do perfil.</div>
      </div>
      <div class="label"><strong>2 · Dado</strong><span>gráfico + número</span></div>
    </article>

    <article class="frame">
      <div class="canvas">
        <div class="kicker">Em tela</div>
        <div class="headline" style="font-size:clamp(18px,4.2vw,46px)">O detalhe que<br />ninguém mostra.</div>
        <div class="caption">Legenda de exemplo em duas linhas, dentro da área segura.</div>
        <div class="lower"><strong>Nome do convidado</strong><span>Cargo · Empresa</span></div>
      </div>
      <div class="label"><strong>3 · Legenda</strong><span>safe area + lower third</span></div>
    </article>
  </div>

  <section class="tokens">
    <h2>Tokens em uso</h2>
    <div class="swatches">
      <span class="swatch"><span class="dot" style="background:${theme.bg}"></span>bg ${htmlEscape(theme.bg)}</span>
      <span class="swatch"><span class="dot" style="background:${theme.fg}"></span>fg ${htmlEscape(theme.fg)}</span>
      <span class="swatch"><span class="dot" style="background:${theme.accent}"></span>accent ${htmlEscape(theme.accent)}</span>
      <span class="swatch"><span class="dot" style="background:${theme.accent2}"></span>accent 2 ${htmlEscape(theme.accent2)}</span>
    </div>
    <p class="note">Display: ${htmlEscape(display)} · Body: ${htmlEscape(body)}. Se uma fonte não estiver instalada, o browser usa o fallback do sistema.</p>
  </section>

  <p class="gate">Aprove estes 3 frames antes do plano e do build. Peça ajustes de cor, tipografia, densidade ou motion agora — depois o custo é maior.</p>
</main>
</body>
</html>
`;
}

function runHyperFramesTranscribe({ bin, input, outDir, backend, language, model, words }) {
  const workDir = path.join(outDir, ".transcribe");
  ensureDir(workDir);
  try {
    const hfArgs = hyperFramesTranscribeArgs({
      input,
      dir: workDir,
      engine: backend === "parakeet" ? "parakeet" : "auto",
      language,
      model: backend === "parakeet" ? undefined : model,
      words,
      toSrt: path.join(workDir, "transcript.srt"),
    });
    const result = run("node", [bin, ...hfArgs], {
      cwd: workDir,
      timeout: 2 * 60 * 60 * 1000,
    });

    const transcriptPath = path.join(workDir, "transcript.json");
    let raw = exists(transcriptPath) ? readJson(transcriptPath, null) : null;
    if (!raw && result.stdout) {
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "words" && Array.isArray(parsed.words)) raw = parsed.words;
        } catch {
          // Ignore non-JSON progress lines.
        }
      }
    }
    if (!result.ok || !raw) {
      return { error: result.stderr || result.stdout || "hyperframes transcribe failed" };
    }

    const srt = path.join(workDir, "transcript.srt");
    if (exists(srt)) fs.copyFileSync(srt, path.join(outDir, "captions", "transcript.srt"));
    return { raw };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows can keep the directory handle briefly; it is safe to leave it.
    }
  }
}

function runFasterWhisperTranscribe({ input, outDir, projectDir, language, model, beam, words, args }) {
  const fasterOut = path.join(outDir, ".transcribe-faster.json");
  try {
    const ffArgs = fasterWhisperArgs({
      script: path.join(SKILL_ROOT, "scripts", "transcribe_faster.py"),
      input,
      output: fasterOut,
      language,
      model,
      beam,
      words,
      device: args.device || "auto",
      computeType: args["compute-type"] || "auto",
      vad: true,
      verbose: Boolean(args.verbose),
    });
    const result = run("python", ffArgs, {
      cwd: projectDir,
      timeout: 2 * 60 * 60 * 1000,
    });
    if (!result.ok) {
      return { error: result.stderr || result.stdout || "faster-whisper failed" };
    }
    const raw = readJson(fasterOut, null);
    if (!raw) return { error: "faster-whisper finished but transcript.json is invalid" };
    return { raw };
  } finally {
    try {
      fs.rmSync(fasterOut, { force: true });
    } catch {
      // Best effort.
    }
  }
}

function runWhisperCliTranscribe({ input, outDir, projectDir, language, model }) {
  const workDir = path.join(outDir, ".transcribe-whisper");
  ensureDir(workDir);
  try {
    const result = run(
      "whisper",
      [
        input,
        "--model", model,
        "--language", language,
        "--output_format", "json",
        "--output_dir", workDir,
        "--verbose", "False",
      ],
      { cwd: projectDir, timeout: 2 * 60 * 60 * 1000 }
    );
    if (!result.ok) return { error: result.stderr || result.stdout || "whisper failed" };
    const base = path.parse(input).name;
    const candidates = [
      path.join(workDir, `${base}.json`),
      ...(exists(workDir)
        ? fs.readdirSync(workDir).filter((file) => file.endsWith(".json")).map((file) => path.join(workDir, file))
        : []),
    ];
    const jsonPath = candidates.find((file) => exists(file));
    if (!jsonPath) return { error: "whisper finished but no JSON output was found" };
    return { raw: readJson(jsonPath, null) };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Best effort.
    }
  }
}

async function transcribeCommand(args) {
  const project = resolveProject(args._[0]);
  if (!exists(project.dir)) fail(`Project directory not found: ${project.dir}`);

  const input = typeof args.input === "string" ? path.resolve(CWD, args.input) : findFirstMedia(project.dir);
  if (!input || !exists(input)) {
    fail("No media found. Put a file in assets/source/ or pass --input <path>.");
  }

  const outDir = path.join(project.dir, "edit");
  ensureDir(outDir);
  ensureDir(path.join(outDir, "captions"));
  const transcriptPath = path.join(outDir, "transcript.json");

  const explicitOptions = ["engine", "model", "language", "words", "quality"].filter(
    (key) => args[key] !== undefined
  );
  if (
    !args.refresh &&
    explicitOptions.length === 0 &&
    exists(transcriptPath) &&
    fs.statSync(transcriptPath).mtimeMs >= fs.statSync(input).mtimeMs
  ) {
    const existing = readJson(transcriptPath, null);
    if (existing) {
      heading("Transcript reused");
      console.log(`  ${transcriptPath}`);
      console.log(`  Source unchanged; use --refresh to transcribe again.`);
      console.log(`  ${existing.segments?.length || 0} segments`);
      return;
    }
  }

  const quality = String(args.quality || "fast").toLowerCase();
  if (!["fast", "balanced", "accurate"].includes(quality)) {
    fail(`Unknown --quality "${quality}". Use fast, balanced, or accurate.`);
  }
  const language = normalizeLanguage(
    typeof args.language === "string" ? args.language : project.config.language || "pt"
  );
  const model =
    typeof args.model === "string"
      ? args.model
      : quality === "accurate"
        ? "medium"
        : quality === "balanced"
          ? "small"
          : "base";
  const beam = Number(args["beam-size"]) > 0 ? Number(args["beam-size"]) : quality === "fast" ? 1 : 5;
  const words = shouldUseWords({
    project: project.config,
    requested: args.words === undefined ? "auto" : args.words,
  });
  const requestedEngine = typeof args.engine === "string" ? args.engine : "auto";

  heading(`Transcribing ${path.basename(input)}`);
  console.log(`  Language: ${language}`);
  console.log(`  Quality:  ${quality} (${model}, beam ${beam}${words ? ", words" : ""})`);

  const capabilities = await doctor({ deep: true });
  const selected = pickAsrBackend({
    requested: requestedEngine,
    language,
    capabilities,
  });

  const hasFaster =
    Boolean(capabilities.fasterWhisper) ||
    String(capabilities.whisper || "").includes("faster-whisper");
  const candidates = [];
  const addCandidate = (backend) => {
    if (backend && !candidates.includes(backend)) candidates.push(backend);
  };
  addCandidate(selected.backend);
  if (requestedEngine === "auto") {
    if (capabilities.parakeet?.installed && capabilities.hyperframes?.bin) addCandidate("parakeet");
    if (hasFaster) addCandidate("faster-whisper");
    if (capabilities.hyperframes?.bin) addCandidate("whisper");
  } else if (requestedEngine === "faster-whisper") {
    if (hasFaster) addCandidate("faster-whisper");
    addCandidate("whisper");
  } else {
    if (capabilities.hyperframes?.bin) addCandidate("parakeet");
    addCandidate("whisper");
  }

  const sourceKey = sourceFingerprint(input, { full: false });
  const sourceHash = JSON.stringify(sourceKey);
  const errors = [];
  let raw = null;
  let used = null;
  let finalKey = null;
  let finalMeta = null;
  let cacheHit = false;

  for (const backend of candidates) {
    const backendModel = backend === "parakeet" ? "parakeet" : model;
    const backendVersion =
      backend === "parakeet" || backend === "hyperframes"
        ? capabilities.hyperframes?.version || null
        : backend === "faster-whisper"
          ? String(capabilities.whisper || "faster-whisper")
          : "whisper";
    const key = transcriptKey({
      sourceHash,
      backend,
      model: backendModel,
      language,
      beam,
      vad: true,
      words,
      backendVersion,
    });

    if (!args["no-cache"] && !args.refresh) {
      const cached = readCache(
        "transcripts",
        key,
        ".json",
        (file) => {
          const data = readJson(file, null);
          return Boolean(data && Array.isArray(data.segments));
        },
        WORKSPACE
      );
      if (cached) {
        const data = readJson(cached, null);
        if (data) {
          raw = data;
          used = backend;
          finalKey = key;
          finalMeta = { backend, model: backendModel, language, beam, vad: true, words, backendVersion };
          cacheHit = true;
          break;
        }
      }
    }

    let attempt = null;
    if (backend === "parakeet" || backend === "hyperframes") {
      if (!capabilities.hyperframes?.bin) {
        errors.push("HyperFrames binary not found");
        continue;
      }
      attempt = runHyperFramesTranscribe({
        bin: capabilities.hyperframes.bin,
        input,
        outDir,
        backend,
        language,
        model,
        words,
      });
    } else if (backend === "faster-whisper") {
      attempt = runFasterWhisperTranscribe({
        input,
        outDir,
        projectDir: project.dir,
        language,
        model,
        beam,
        words,
        args,
      });
    } else if (backend === "whisper") {
      attempt = runWhisperCliTranscribe({
        input,
        outDir,
        projectDir: project.dir,
        language,
        model,
      });
    } else {
      errors.push(`Unsupported ASR backend "${backend}"`);
      continue;
    }

    if (attempt?.raw) {
      raw = attempt.raw;
      used = backend;
      finalKey = key;
      finalMeta = { backend, model: backendModel, language, beam, vad: true, words, backendVersion };
      break;
    }
    errors.push(`${backend}: ${attempt?.error || "failed"}`);
  }

  if (!raw) {
    fail(
      "Transcription failed.\n" +
        (errors.length ? errors.join("\n") + "\n" : "") +
        "Install HyperFrames (npx hyperframes) or faster-whisper (python -m pip install --user -U faster-whisper)."
    );
  }

  const transcript = normalizeTranscript(
    raw,
    path.relative(project.dir, input).replace(/\\/g, "/"),
    language
  );
  writeJson(transcriptPath, transcript);
  writeJson(path.join(outDir, "transcript.meta.json"), {
    schema: "rooster.transcript-meta/v1",
    ...transcriptMeta(finalMeta),
    cacheKey: finalKey,
    cacheHit,
    source: sourceKey,
    createdAt: now(),
  });

  if (!args["no-cache"] && finalKey) {
    try {
      withCache({
        kind: "transcripts",
        key: finalKey,
        ext: ".json",
        workspace: WORKSPACE,
        refresh: Boolean(args.refresh),
        produce: (tmp) => fs.copyFileSync(transcriptPath, tmp),
        meta: { ...finalMeta, source: sourceKey },
      });
    } catch (error) {
      console.warn(`  ! Could not write the transcript cache: ${error.message}`);
    }
  }

  heading("Transcript ready");
  console.log(`  ${transcriptPath}`);
  console.log(`  Engine: ${used}${cacheHit ? " (cache)" : ""}`);
  console.log(`  ${transcript.segments.length} segments`);
  console.log(`  key: ${finalKey}`);
  console.log("\nNext: read the transcript and style.md, write edit/plan.json, and show the plan for approval.");
}

function planCommand(args) {
  const project = resolveProject(args._[0]);
  const planPath = path.join(project.dir, "edit", "plan.json");
  if (!exists(planPath)) {
    fail(`Plan not found at ${planPath}.\nRead references/edit-plan.md and write the plan before building.`);
  }

  const plan = readJson(planPath, null);
  if (!plan) fail(`Invalid plan JSON at ${planPath}. Fix the file and run again.`);
  const { errors, warnings } = validatePlan(plan, project.dir);

  if (args.json) {
    console.log(JSON.stringify({ project: project.slug, plan: planPath, errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  if (!args.check) {
    printPlanSummary(plan);
    const markdownPath = path.join(project.dir, "edit", "plan.md");
    const htmlPath = path.join(project.dir, "edit", "plan.html");
    const transcriptPath = path.join(project.dir, "edit", "transcript.json");
    const transcript = exists(transcriptPath) ? readJson(transcriptPath, null) : null;
    writeText(markdownPath, planMarkdown(plan));
    writeText(htmlPath, planHtml(plan, project, transcript));
    const remapped = planForBuild(plan, {});
    const timeline = timelineFromPlan(remapped.plan, {
      projectSlug: project.slug,
      format: remapped.plan.format || project.config.format,
      keeps: remapped.keeps,
      duration: remapped.duration,
      engine: project.config.engine,
    });
    const timelinePath = path.join(project.dir, "edit", "timeline.json");
    writeJson(timelinePath, timeline);
    console.log(`\n  Artifact: ${htmlPath}`);
    console.log(`  Markdown: ${markdownPath}`);
    console.log(`  Timeline: ${timelinePath} (${summarizeTimeline(timeline).clips} clip(s))`);
  }

  heading("Validation");
  if (!errors.length && !warnings.length) console.log("  ✓ No issues found.");
  for (const error of errors) console.log(`  ✗ ${error}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  console.log("\n  The plan must be approved before building.");
  process.exit(errors.length ? 1 : 0);
}

function textcheckCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);

  const plan = readJson(path.join(project.dir, "edit", "plan.json"), { elements: [] });
  const storyboard = readJson(path.join(project.dir, "storyboard", "storyboard.json"), { scenes: [] });
  const items = [];

  for (const element of plan.elements || []) {
    items.push({
      source: "plan",
      id: element.id || null,
      type: element.type || "element",
      start: element.start ?? null,
      end: element.end ?? null,
      text: String(element.text || "").trim(),
    });
  }

  for (const scene of storyboard.scenes || []) {
    const raw = scene.onScreenText ?? scene.on_screen_text ?? scene.text;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const value of values) {
      const text = typeof value === "string" ? value : value?.text ?? value?.label ?? "";
      items.push({
        source: "storyboard",
        id: scene.id || null,
        type: "scene text",
        start: scene.start ?? null,
        end: scene.end ?? null,
        text: String(text || "").trim(),
      });
    }
  }

  const textTypes = new Set(["letreiro", "grafico", "lista", "lower-third", "caption-emphasis", "end-card"]);
  const seen = new Map();
  const issues = [];
  for (const item of items) {
    const text = item.text;
    if (!text) {
      if (textTypes.has(item.type)) issues.push({ level: "error", id: item.id, message: "texto vazio para um elemento que depende de texto" });
      continue;
    }
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) issues.push({ level: "warning", id: item.id, message: `texto duplicado (já apareceu em ${seen.get(key)})` });
    else seen.set(key, `${item.source}:${item.id || item.type}`);
    if (text.length > 80) issues.push({ level: "warning", id: item.id, message: `texto longo (${text.length} caracteres)` });
    if (text.length > 20 && text === text.toUpperCase() && /[A-ZÀ-Ý]/.test(text)) {
      issues.push({ level: "warning", id: item.id, message: "texto todo em maiúsculas" });
    }
    if (/\s{2,}/.test(text)) issues.push({ level: "warning", id: item.id, message: "espaços duplicados" });
    if (/^\s|\s$/.test(item.text)) issues.push({ level: "warning", id: item.id, message: "espaço no início/fim" });
    if (/\?\?|TODO|TBD|FIXME/i.test(text)) issues.push({ level: "error", id: item.id, message: "placeholder no texto" });
  }

  const outDir = path.join(project.dir, "qa");
  ensureDir(outDir);
  const rows = items
    .map(
      (item) =>
        `| ${Number.isFinite(Number(item.start)) ? formatClock(item.start) : "—"} | ${item.source} | ${item.id || "—"} | ${item.type} | ${String(item.text || "").replace(/\|/g, "\\|") || "(vazio)"} |`
    )
    .join("\n");
  const issueRows = issues.length
    ? issues.map((issue) => `- **${issue.level}** · ${issue.id || "—"} — ${issue.message}`).join("\n")
    : "- Nenhum alerta automático. Ainda assim, revise manualmente.";
  const markdown = `# Text review — ${project.config.name || project.slug}

Gerado por \`textcheck\`. Revise cada texto em tela contra o estilo e o contexto.

## Textos

| Tempo | Origem | ID | Tipo | Texto |
|---|---|---|---|---|
${rows || "| — | — | — | — | Nenhum texto encontrado. |"}

## Alertas

${issueRows}

## Checklist

- [ ] Ortografia e acentuação
- [ ] Consistência de nomes e números
- [ ] Texto dentro da safe area
- [ ] Nenhum placeholder
- [ ] Texto legível no mobile
`;
  writeText(path.join(outDir, "text-review.md"), markdown);
  writeJson(path.join(outDir, "text-review.json"), {
    schema: "rooster.textreview/v1",
    project: project.slug,
    items,
    issues,
    createdAt: now(),
  });

  heading("Text review");
  console.log(`  ${path.join(outDir, "text-review.md")}`);
  console.log(`  ${items.length} text(s), ${issues.length} issue(s)`);
  for (const issue of issues.slice(0, 8)) console.log(`  ! ${issue.id || "—"}: ${issue.message}`);
  if (issues.length > 8) console.log(`  … ${issues.length - 8} more in the file`);
}

function captionsCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const transcriptPath = path.join(project.dir, "edit", "transcript.json");
  if (!exists(transcriptPath)) fail(`No transcript at ${transcriptPath}. Run "transcribe" first.`);

  const outDir = args.out ? path.resolve(CWD, String(args.out)) : path.join(project.dir, "edit", "captions");
  const result = writeCaptions({
    transcriptPath,
    outDir,
    maxLineChars: args["max-chars"] ? Number(args["max-chars"]) : undefined,
    maxLines: args["max-lines"] ? Number(args["max-lines"]) : undefined,
  });

  heading("Captions ready");
  console.log(`  ${result.files.srt}`);
  console.log(`  ${result.files.vtt}`);
  console.log(`  ${result.files.json}`);
  console.log(`  ${result.count} cue(s)`);

  if (args.burn) {
    const video = path.resolve(CWD, String(args.burn));
    const out = args["out-video"]
      ? path.resolve(CWD, String(args["out-video"]))
      : path.join(project.dir, "renders", "captioned.mp4");
    const draft = Boolean(args.draft);
    const burn = burnArgs({
      video,
      srt: result.files.srt,
      out,
      preset: args.preset || (draft ? "veryfast" : "medium"),
      crf: Number(args.crf) || (draft ? 23 : 18),
    });
    if (args["dry-run"]) {
      console.log("\nBurn command:");
      console.log(`  ${burn.command}`);
      return;
    }
    ensureDir(path.dirname(out));
    const burned = run("ffmpeg", burn.args, { timeout: 60 * 60 * 1000 });
    if (!burned.ok) fail(`Caption burn failed:\n${burned.stderr || burned.stdout || "unknown error"}`);
    heading("Captioned video");
    console.log(`  ${out}`);
  }
}

function deliverCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const videoArg = args.video ? path.resolve(CWD, String(args.video)) : null;
  const candidates = [
    videoArg,
    path.join(project.dir, "renders", "final.mp4"),
    path.join(project.dir, "renders", "draft.mp4"),
  ].filter(Boolean);
  const video = candidates.find((candidate) => exists(candidate));
  if (!video) fail("No render found. Render a draft/final or pass --video <path>.");

  const probe = probeMedia(video) || {};
  const thumbnailPath = args.thumb
    ? path.resolve(CWD, String(args.thumb))
    : path.join(project.dir, "renders", "thumbnail.jpg");
  const thumbnail = createThumbnail({
    video,
    out: thumbnailPath,
    time: args.time ? Number(args.time) : 1,
  });
  if (!thumbnail.ok) fail(`Thumbnail failed: ${thumbnail.error}`);

  const captionsDir = path.join(project.dir, "edit", "captions");
  const srtPath = path.join(captionsDir, "captions.srt");
  const vttPath = path.join(captionsDir, "captions.vtt");
  const captionsJsonPath = path.join(captionsDir, "captions.json");
  const metadata = buildMetadata({
    project: { ...project.config, slug: project.slug, title: project.config.name },
    plan,
    render: {
      video,
      thumbnail: thumbnailPath,
      srt: exists(srtPath) ? srtPath : null,
      vtt: exists(vttPath) ? vttPath : null,
      captionsJson: exists(captionsJsonPath) ? captionsJsonPath : null,
      ...probe,
    },
  });
  const metadataPath = path.join(project.dir, "renders", "metadata.json");
  writeJson(metadataPath, metadata);

  heading("Delivery package");
  console.log(`  video:     ${video}`);
  console.log(`  thumbnail: ${thumbnailPath}`);
  console.log(`  metadata:  ${metadataPath}`);
  if (exists(srtPath)) console.log(`  captions:  ${srtPath}`);
}

function reframeCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const input = args.input
    ? path.resolve(CWD, String(args.input))
    : plan.source
      ? path.resolve(project.dir, plan.source)
      : null;
  if (!input || !exists(input)) fail("Source not found. Pass --input <path> or set plan.source.");

  const probe = probeMedia(input);
  if (!probe || probe.error || !probe.width || !probe.height) {
    fail(`Could not probe source dimensions: ${probe?.error || input}`);
  }

  const format = args.format || project.config.format?.aspect || "16:9";
  const output = args.out
    ? path.resolve(CWD, String(args.out))
    : path.join(project.dir, "assets", "generated", `reframed-${String(format).replace(":", "x")}.mp4`);
  ensureDir(path.dirname(output));

  const ffArgs = reframeArgs({
    input,
    output,
    sourceWidth: probe.width,
    sourceHeight: probe.height,
    format,
    mode: args.mode || "center",
    focusX: args["focus-x"] !== undefined ? Number(args["focus-x"]) : 0.5,
    focusY: args["focus-y"] !== undefined ? Number(args["focus-y"]) : 0.5,
  });
  const result = run("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
  if (!result.ok) fail(`FFmpeg reframe failed:\n${result.stderr || result.stdout || "unknown error"}`);

  heading("Reframed");
  console.log(`  ${output}`);
  if (args["update-plan"]) {
    const relative = path.relative(project.dir, output).replace(/\\/g, "/");
    const target = targetDimensions(format);
    const fps = Number(project.config.format?.fps) || 30;
    const duration = Number(plan.duration) || Number(project.config.format?.duration) || null;
    writeJson(planPath, {
      ...plan,
      source: relative,
      format: { ...(plan.format || {}), width: target.width, height: target.height, fps, duration },
    });
    writeJson(path.join(project.dir, "project.json"), {
      ...project.config,
      format: { ...(project.config.format || {}), aspect: String(format), width: target.width, height: target.height, fps, duration },
    });
    const timelinePath = path.join(project.dir, "edit", "timeline.json");
    if (exists(timelinePath)) {
      const timeline = readJson(timelinePath, {});
      writeJson(timelinePath, {
        ...timeline,
        format: { ...(timeline.format || {}), width: target.width, height: target.height, fps, duration },
      });
    }
    console.log(`  plan.source + project/timeline format updated to ${format} (${target.width}x${target.height})`);
  }
}

function brollCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const transcriptPath = path.join(project.dir, "edit", "transcript.json");
  const transcript = exists(transcriptPath) ? readJson(transcriptPath, { segments: [] }) : { segments: [] };
  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const sourcePath = plan.source ? path.resolve(project.dir, plan.source) : null;
  const dirs = [
    args.dir ? path.resolve(CWD, String(args.dir)) : null,
    path.join(project.dir, "assets", "source"),
    path.join(project.dir, "assets", "generated"),
    path.join(project.dir, "assets", "licensed"),
    path.join(WORKSPACE, "library", "broll"),
  ].filter(Boolean);
  const indexPath = path.join(
    cacheRoot(WORKSPACE),
    "broll",
    `index-${shortHash(dirs.map((dir) => path.resolve(dir)).join("|"))}.json`
  );
  const index = getBrollIndex({ dirs, indexPath, refresh: Boolean(args.refresh) });
  for (const warning of index.warnings || []) console.warn(`  ! ${warning}`);
  const files = index.files.filter(
    (file) =>
      file !== sourcePath &&
      !/^(reframed-|base-|voiceover-|music-)/i.test(path.basename(file))
  );
  const tags = args.tags ? String(args.tags).split(",").map((tag) => tag.trim()).filter(Boolean) : [];
  const ranked = rankBroll({ files, transcriptText: transcript, tags });
  const suggestions = suggestBrollElements({
    files,
    transcript,
    max: args.max ? Number(args.max) : 3,
    baseDir: project.dir,
  });

  const reportPath = path.join(project.dir, "edit", "broll-suggestions.json");
  writeJson(reportPath, {
    schema: "rooster.broll-suggestions/v1",
    generatedAt: now(),
    roots: dirs,
    candidates: ranked,
    suggestions,
  });

  heading("B-roll candidates");
  for (const item of ranked.slice(0, args.limit ? Number(args.limit) : 10)) {
    const score = String(item.score).padStart(3, " ");
    console.log(`  ${score}  ${path.relative(project.dir, item.path)}`);
  }
  if (!ranked.length) console.log("  (none)");
  console.log(`\n  Report: ${reportPath}`);

  if (suggestions.length) {
    heading("Suggested elements");
    console.log(JSON.stringify(suggestions, null, 2));
    if (args.write) {
      const existing = plan.elements || [];
      const added = suggestions.filter(
        (suggestion) =>
          !existing.some(
            (element) => element.type === "broll" && element.src === suggestion.src && element.start === suggestion.start
          )
      );
      writeJson(planPath, { ...plan, elements: [...existing, ...added] });
      console.log(`\n  Added ${added.length} suggestion(s) to ${planPath}`);
    }
  }
}

function cacheCommand(args) {
  const action = String(args._[0] || "info").toLowerCase();
  const root = cacheRoot(WORKSPACE);

  if (action === "path") {
    if (args.json) console.log(JSON.stringify({ root }, null, 2));
    else console.log(root);
    return;
  }

  if (action === "info") {
    const info = cacheInfo(WORKSPACE);
    if (args.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    heading("Cache");
    console.log(`  ${info.root}`);
    if (!info.exists) {
      console.log("  (empty)");
      return;
    }
    console.log(`  ${info.artifacts} artifact(s) · ${info.files} file(s) · ${formatBytes(info.bytes)}`);
    for (const [kind, entry] of Object.entries(info.byKind).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${kind.padEnd(18)} ${formatBytes(entry.bytes).padStart(10)}  ${entry.files} file(s)`);
    }
    return;
  }

  if (action === "clear") {
    const kind = args._[1] ? String(args._[1]) : undefined;
    const report = cacheClear(WORKSPACE, kind);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    heading("Cache cleared");
    console.log(`  ${report.removed} file(s), ${formatBytes(report.bytes)} freed`);
    if (kind) console.log(`  kind: ${kind}`);
    return;
  }

  if (action === "gc") {
    const maxSizeArg = args["max-size"] !== undefined ? String(args["max-size"]) : "20GB";
    const maxBytes = parseByteSize(maxSizeArg);
    if (maxBytes === null) fail(`Invalid --max-size "${maxSizeArg}". Use e.g. 20GB or 500MB.`);

    let maxAgeMs;
    if (args["max-age"] !== undefined) {
      const match = String(args["max-age"]).trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|h|d|w)?$/i);
      if (!match) fail(`Invalid --max-age "${args["max-age"]}". Use e.g. 30d or 12h.`);
      const amount = Number(match[1].replace(",", "."));
      const unit = (match[2] || "d").toLowerCase();
      const factor = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
      maxAgeMs = Math.round(amount * factor);
    }

    const report = cacheGc(WORKSPACE, { maxBytes, maxAgeMs });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    heading("Cache GC");
    console.log(`  removed ${report.removed} file(s), freed ${formatBytes(report.bytesFreed)}`);
    console.log(`  remaining ${formatBytes(report.bytesRemaining)} (limit ${formatBytes(maxBytes)})`);
    return;
  }

  fail("Usage: cache info | path | clear [kind] | gc [--max-size 20GB] [--max-age 30d]");
}

function framesCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);

  const plan = exists(path.join(project.dir, "edit", "plan.json"))
    ? readJson(path.join(project.dir, "edit", "plan.json"), {})
    : {};
  const candidates = [
    args.video ? path.resolve(CWD, String(args.video)) : null,
    path.join(project.dir, "renders", "final.mp4"),
    path.join(project.dir, "renders", "draft.mp4"),
    plan.source ? path.resolve(project.dir, plan.source) : null,
  ].filter((candidate) => candidate && exists(candidate));
  const video = candidates[0];
  if (!video) fail("No video found. Render a draft/final, pass --video <path>, or set plan.source.");

  const probe = probeMedia(video) || {};
  if (probe.error) fail(`Could not probe ${video}: ${probe.error}`);

  const outDir = args.out ? path.resolve(CWD, String(args.out)) : path.join(project.dir, "qa", "frames");
  ensureDir(outDir);

  const count = Math.max(1, Math.min(60, Number(args.count) || 12));
  const cols = Math.max(1, Math.min(8, Number(args.cols) || 4));
  const scale = Math.max(120, Math.min(1280, Number(args.scale) || 480));
  const duration = Number(probe.duration) || undefined;

  const sheet = contactSheetArgs({
    video,
    out: path.join(outDir, "contact.jpg"),
    count,
    cols,
    scale,
    duration,
  });
  const sheetResult = run("ffmpeg", sheet.args, { timeout: 30 * 60 * 1000 });
  if (!sheetResult.ok) {
    fail(`Contact sheet failed:\n${sheetResult.stderr || sheetResult.stdout || "unknown error"}`);
  }

  const files = [sheet.out];
  if (!args["sheet-only"]) {
    const framesDir = path.join(outDir, "stills");
    ensureDir(framesDir);
    const frames = extractFramesArgs({ video, outDir: framesDir, count, scale, duration });
    const framesResult = run("ffmpeg", frames.args, { timeout: 30 * 60 * 1000 });
    if (!framesResult.ok) {
      fail(`Frame extraction failed:\n${framesResult.stderr || framesResult.stdout || "unknown error"}`);
    }
    files.push(frames.pattern);
  }

  if (args.json) {
    console.log(JSON.stringify({ video, outDir, sheet: sheet.out, files, count, cols, scale, duration }, null, 2));
    return;
  }

  heading("QA frames");
  console.log(`  ${sheet.out}`);
  if (!args["sheet-only"]) console.log(`  ${path.join(outDir, "stills")}`);
  console.log(`  ${count} frame(s) · ${cols} columns · ${scale}px`);
}

function audioCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const input = args.input
    ? path.resolve(CWD, String(args.input))
    : plan.source
      ? path.resolve(project.dir, plan.source)
      : null;
  if (!input || !exists(input)) fail("Source not found. Pass --input <path> or set plan.source.");

  const music = plan.music?.src
    ? { ...plan.music, src: path.resolve(project.dir, plan.music.src) }
    : null;
  const sfx = (plan.sfx || [])
    .filter((clip) => clip?.src)
    .map((clip) => ({ ...clip, src: path.resolve(project.dir, clip.src) }));
  if (!music && !sfx.length) fail("No plan.music or plan.sfx to mix.");

  const probe = probeMedia(input);
  if (!probe || probe.error) fail(`Could not probe source: ${probe?.error || input}`);
  const output = args.out
    ? path.resolve(CWD, String(args.out))
    : path.join(project.dir, "assets", "generated", "audio-mix.mp4");
  ensureDir(path.dirname(output));

  const ffArgs = mixAudioArgs({
    base: {
      path: input,
      kind: probe.width ? "video" : "audio",
      hasAudio: probe.audio,
      duration: probe.duration,
    },
    music,
    sfx,
    out: output,
    duration: probe.duration,
  });
  const result = run("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
  if (!result.ok) fail(`Audio mix failed:\n${result.stderr || result.stdout || "unknown error"}`);

  heading("Audio mix ready");
  console.log(`  ${output}`);
  console.log("  Preview it before building; the plan still owns the music/SFX decisions.");
}

function colorCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const input = args.input
    ? path.resolve(CWD, String(args.input))
    : plan.source
      ? path.resolve(project.dir, plan.source)
      : null;
  if (!input || !exists(input)) fail("Source not found. Pass --input <path> or set plan.source.");

  const color = plan.color && typeof plan.color === "object" ? plan.color : {};
  if (!Object.keys(color).length) fail("No plan.color settings to apply.");

  let colorInput = input;
  if (color.stabilize && !args["skip-stabilize"]) {
    const workDir = path.join(project.dir, "assets", "generated", "stabilize");
    ensureDir(workDir);
    const passes = buildStabilizePasses({ input, workDir });
    heading("Stabilization pass 1/2");
    const detect = run("ffmpeg", passes.detectArgs || passes.detect, { timeout: 60 * 60 * 1000 });
    if (!detect.ok) fail(`Stabilization detect failed:\n${detect.stderr || detect.stdout || "unknown error"}`);
    heading("Stabilization pass 2/2");
    const transform = run("ffmpeg", passes.transformArgs || passes.transform, { timeout: 60 * 60 * 1000 });
    if (!transform.ok) fail(`Stabilization transform failed:\n${transform.stderr || transform.stdout || "unknown error"}`);
    colorInput = passes.output;
    console.log(`  ${colorInput}`);
  } else if (color.stabilize) {
    console.warn("  ! Stabilization skipped by --skip-stabilize.");
  }

  const output = args.out
    ? path.resolve(CWD, String(args.out))
    : path.join(project.dir, "assets", "generated", "graded.mp4");
  ensureDir(path.dirname(output));

  const ffArgs = colorArgs({ input: colorInput, output, color });
  const result = run("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
  if (!result.ok) fail(`Color pass failed:\n${result.stderr || result.stdout || "unknown error"}`);

  heading("Color pass ready");
  console.log(`  ${output}`);
  if (args["update-plan"]) {
    const relative = path.relative(project.dir, output).replace(/\\/g, "/");
    writeJson(planPath, { ...plan, source: relative });
    console.log(`  plan.source updated to ${relative}`);
  }
}

async function ttsCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const scriptPath = args.script ? path.resolve(CWD, String(args.script)) : path.join(project.dir, "script.md");
  if (!exists(scriptPath)) fail(`Script not found at ${scriptPath}. Write script.md or pass --script <path>.`);

  const script = fs.readFileSync(scriptPath, "utf8");
  const lines = splitScript(script);
  if (!lines.length) fail(`No speakable lines found in ${scriptPath}.`);

  const providers = detectTtsProviders();
  const provider = args.provider || providers.defaultProvider || "edge-tts";
  const language = String(args.language || project.config.language || "pt-BR");
  const voice =
    args.voice ||
    process.env.ROOSTER_TTS_VOICE ||
    (language.toLowerCase().startsWith("pt") ? "pt-BR-FranciscaNeural" : "en-US-AriaNeural");

  const manifest = buildVoiceoverPlan({
    lines,
    outDir: path.join(project.dir, "assets", "generated", "voice"),
    provider,
    voice,
    rate: args.rate,
    language,
  });
  const manifestPath = path.join(project.dir, "edit", "voiceover.json");
  writeJson(manifestPath, manifest);

  heading("Voiceover plan");
  console.log(`  lines: ${manifest.lines.length}`);
  console.log(`  provider: ${provider}`);
  console.log(`  available: ${providers.available.length ? providers.available.join(", ") : "none detected"}`);
  console.log(`  manifest: ${manifestPath}`);

  if (!args.generate) {
    const first = manifest.lines.find((line) => line.text);
    if (first) {
      const preview = buildTtsArgs({
        provider,
        text: first.text,
        voice,
        out: path.resolve(project.dir, first.audio),
        rate: args.rate,
        language,
      });
      console.log("\n  First command:");
      console.log(`  ${preview.display || "(provider has no shell command)"}`);
    }
    console.log("\n  Re-run with --generate after the user approves TTS/network use.");
    return;
  }

  if (!providers.providers?.some((item) => item.id === provider && item.available)) {
    fail(`TTS provider "${provider}" is not available. Run without --generate to inspect the plan.`);
  }

  const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 3));
  const summary = await generateVoiceover({
    manifest,
    projectDir: project.dir,
    provider,
    voice,
    rate: args.rate,
    language,
    concurrency,
    refresh: Boolean(args.refresh),
    cachePath: path.join(project.dir, "edit", "voiceover.cache.json"),
    run: (descriptor) => {
      const result = run(descriptor.command, descriptor.args, {
        cwd: descriptor.cwd,
        timeout: 5 * 60 * 1000,
      });
      const transient =
        Boolean(result.error && /timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(result.error)) ||
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|\b429\b|\b503\b/i.test(result.stderr || "");
      return { ...result, transient };
    },
    runPool,
    probe: (file) => probeMedia(file),
    onProgress: (event) => {
      if (event.type === "ok") {
        console.log(`  ✓ ${event.id} (${event.attempts} attempt(s))`);
      } else if (event.type === "skip" && event.reason === "cached") {
        console.log(`  = ${event.id} (cache)`);
      } else if (event.type === "retry") {
        console.warn(`  ~ ${event.id}: retry ${event.attempts}`);
      } else if (event.type === "error") {
        console.warn(`  ! ${event.id}: ${event.error}`);
      }
    },
  });

  manifest.generatedAt = now();
  writeJson(manifestPath, manifest);

  heading("Voiceover generated");
  console.log(
    `  ${summary.generated} generated · ${summary.skipped} cached · ${summary.failed} failed · ${manifest.lines.length} line(s)`
  );
  if (summary.cachePath) console.log(`  cache: ${summary.cachePath}`);
  console.log(`  ${manifestPath}`);
  for (const warning of summary.warnings || []) console.warn(`  ! ${warning}`);
  if (!summary.ok) process.exitCode = 1;
}

async function multicamCommand(args) {
  const slug = projectSlugFromArg(args);
  const project = resolveProject(slug);
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, {}) : {};
  const source = args.file
    ? readJson(path.resolve(CWD, String(args.file)), null)
    : plan.multicam;
  if (!source) fail("No plan.multicam. Add cameras/cuts to edit/plan.json or pass --file <json>.");

  const result = buildMulticamPlan(source);
  const output = path.join(project.dir, "edit", "multicam.json");
  writeJson(output, result);

  heading("Multicam plan");
  console.log(`  cameras: ${(result.cameras || []).length}`);
  console.log(`  segments: ${(result.segments || []).length}`);
  for (const warning of result.warnings || []) console.log(`  ! ${warning}`);
  console.log(`  ${output}`);

  if (!args.render) return;

  const tempDir = path.join(project.dir, "assets", "generated", "multicam-parts");
  if (exists(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  ensureDir(tempDir);
  const settingsById = new Map();
  (source.cuts || []).forEach((cut, index) => {
    settingsById.set(cut.id || `cut-${String(index + 1).padStart(3, "0")}`, cut);
  });
  const jobs = (result.segments || []).map((segment, index) => ({ segment, index }));
  const concurrency = Math.max(1, Math.min(4, os.cpus()?.length || 2));
  const outcomes = await runPool(jobs, concurrency, async ({ segment, index }) => {
    const cameraSource = path.resolve(project.dir, segment.src);
    if (!exists(cameraSource)) throw new Error(`Camera source not found: ${cameraSource}`);
    const part = path.join(tempDir, `part-${String(index).padStart(3, "0")}.mp4`);
    const settings = settingsById.get(segment.cutId) || {};
    const offsets = jlCutOffsets({
      clip: {
        start: segment.start,
        end: segment.end,
        audioOffset: settings.audioOffset,
        videoOffset: settings.videoOffset,
      },
    });
    const hasOffsets = offsets.audioOffset !== 0 || offsets.videoOffset !== 0;
    const speed = Number(settings.speed) || 1;
    const speedValues = speed !== 1 ? speedFilter({ speed, fps: 30 }) : null;
    const segmentDuration = offsets.duration || segment.duration;
    const ffArgs = ["-y"];

    if (hasOffsets && offsets.videoStart !== null && offsets.audioStart !== null) {
      ffArgs.push("-ss", String(offsets.videoStart), "-t", String(segmentDuration), "-i", cameraSource);
      ffArgs.push("-ss", String(offsets.audioStart), "-t", String(segmentDuration), "-i", cameraSource);
      ffArgs.push("-map", "0:v:0", "-map", "1:a:0?");
    } else {
      ffArgs.push("-ss", String(segment.start), "-t", String(segment.duration), "-i", cameraSource);
    }

    if (speedValues) {
      ffArgs.push("-vf", speedValues.videoFilter, "-af", speedValues.audioFilter);
    } else {
      ffArgs.push("-vf", "fps=30");
    }
    ffArgs.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      part
    );
    const partResult = await runAsync("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
    if (!partResult.ok) {
      throw new Error(
        `Multicam segment ${index + 1} failed: ${partResult.stderr || partResult.stdout || "unknown error"}`
      );
    }
    return part;
  });

  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed) fail(String(failed.reason?.message || failed.reason));
  const parts = outcomes.map((outcome) => outcome.value);

  const listPath = path.join(tempDir, "concat.txt");
  writeText(listPath, `${parts.map((part) => `file '${part.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n")}\n`);
  const rendered = path.join(project.dir, "assets", "generated", "multicam.mp4");
  const concat = run(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", rendered],
    { timeout: 60 * 60 * 1000 }
  );
  if (!concat.ok) fail(`Multicam concat failed:\n${concat.stderr || concat.stdout || "unknown error"}`);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  heading("Multicam render");
  console.log(`  ${rendered}`);
  if (args["update-plan"]) {
    const relative = path.relative(project.dir, rendered).replace(/\\/g, "/");
    writeJson(planPath, { ...plan, source: relative });
    console.log(`  plan.source updated to ${relative}`);
  }
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

function samplePlan(plan, count) {
  const elements = Array.isArray(plan.elements) ? plan.elements : [];
  const wanted = Number.isFinite(count) && count > 0 ? Math.floor(count) : 3;
  if (!elements.length || wanted >= elements.length) return plan;

  const priority = [
    ["letreiro"],
    ["grafico", "lista"],
    ["caption-emphasis", "lower-third"],
    ["zoom", "broll"],
    ["transition", "end-card"],
  ];
  const selected = [];
  for (const types of priority) {
    const found = elements.find((element) => types.includes(element.type) && !selected.includes(element));
    if (found) selected.push(found);
    if (selected.length >= wanted) break;
  }
  for (const element of elements) {
    if (selected.length >= wanted) break;
    if (!selected.includes(element)) selected.push(element);
  }

  return {
    ...plan,
    elements: selected.sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)),
  };
}

function sampleWindow(element, duration, { padding = 0.75, maxWindow = 8 } = {}) {
  const total = Math.max(0, Number(duration) || 0);
  const start = Math.max(0, (Number(element.start) || 0) - padding);
  let end = Math.min(total, (Number(element.end) || start + 1) + padding);
  if (end <= start) end = Math.min(total, start + 1);
  if (end - start > maxWindow) {
    const center = ((Number(element.start) || 0) + (Number(element.end) || start)) / 2;
    let left = Math.max(0, center - maxWindow / 2);
    let right = Math.min(total, left + maxWindow);
    left = Math.max(0, right - maxWindow);
    return { start: Number(left.toFixed(3)), end: Number(right.toFixed(3)) };
  }
  return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
}

function mergeSampleWindows(windows, gap = 0.5) {
  const sorted = windows
    .filter((window) => window.end > window.start)
    .map((window) => ({ ...window }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + gap) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push(window);
    }
  }
  return merged;
}

function splitWindowByKeeps(window, keeps) {
  const segments = [];
  let cursor = 0;
  for (const keep of keeps) {
    const length = keep.end - keep.start;
    const keepStart = cursor;
    const keepEnd = cursor + length;
    cursor = keepEnd;
    const start = Math.max(window.start, keepStart);
    const end = Math.min(window.end, keepEnd);
    if (end - start <= 0.001) continue;
    segments.push({
      sourceStart: keep.start + (start - keepStart),
      sourceEnd: keep.start + (end - keepStart),
      timelineStart: start,
      timelineEnd: end,
    });
  }
  return segments;
}

function buildSamplePlan(plan, count, args) {
  const remapped = planForBuild(plan, args);
  const timelinePlan = remapped.plan;
  const total = Number(timelinePlan.duration) || 0;
  const selected = samplePlan(timelinePlan, count).elements || [];
  if (!selected.length || total <= 0) return samplePlan(plan, count);

  const keeps = remapped.keeps?.length ? remapped.keeps : keepsFromPlan(timelinePlan);
  const windows = mergeSampleWindows(selected.map((element) => sampleWindow(element, total)));
  const sampleKeeps = [];
  const windowMap = [];
  let cursor = 0;

  for (const window of windows) {
    const segments = splitWindowByKeeps(window, keeps);
    if (!segments.length) continue;
    const sampleStart = cursor;
    for (const segment of segments) {
      sampleKeeps.push({
        start: Number(segment.sourceStart.toFixed(3)),
        end: Number(segment.sourceEnd.toFixed(3)),
      });
      cursor += segment.sourceEnd - segment.sourceStart;
    }
    windowMap.push({ ...window, sampleStart, sampleEnd: cursor });
  }

  if (!sampleKeeps.length) return samplePlan(plan, count);
  const sampleDuration = Number(cursor.toFixed(3));
  const sampleElements = selected
    .map((element) => {
      const window = windowMap.find(
        (candidate) => (Number(element.end) || 0) > candidate.start && (Number(element.start) || 0) < candidate.end
      );
      if (!window) return null;
      const start = Math.max(
        window.sampleStart,
        window.sampleStart + ((Number(element.start) || 0) - window.start)
      );
      const end = Math.min(
        sampleDuration,
        window.sampleStart + ((Number(element.end) || start) - window.start)
      );
      return {
        ...element,
        start: Number(start.toFixed(3)),
        end: Number(Math.max(start + 0.1, end).toFixed(3)),
      };
    })
    .filter(Boolean);

  return {
    ...timelinePlan,
    duration: sampleDuration,
    cuts: [],
    keeps: sampleKeeps,
    elements: sampleElements,
    sample: true,
    notes: [
      ...(timelinePlan.notes || []),
      `sample: ${sampleElements.length} element(s) in ${windowMap.length} window(s)`,
    ],
  };
}

function planForBuild(plan, args) {
  if (plan.sample === true) {
    return { plan, cuts: [], keeps: plan.keeps || [], duration: Number(plan.duration) || 0 };
  }
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
    return;
  } catch (error) {
    // On Windows a previous browser/check process can hold a handle briefly.
    // Rename the directory out of the way so the rebuild can continue.
    const trash = `${dir}.old-${Date.now()}`;
    try {
      fs.renameSync(dir, trash);
    } catch {
      throw error;
    }
    try {
      fs.rmSync(trash, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.warn(`  ! Could not delete the old engine folder; left it at ${trash}`);
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

function buildBaseMediaCore(project, plan, keeps, engineDir, args, assetsSubdir = "assets") {
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

  if (image) {
    const target = path.join(assetsDir, `base${sourceExt || ".png"}`);
    linkOrCopy(source, target);
    return {
      path: `assets/${path.basename(target)}`,
      duration: Number(plan.duration) || 0,
      hasVideo: false,
      hasAudio: false,
      kind,
    };
  }

  const targetExt = hasVideo ? ".mp4" : ".m4a";
  const target = path.join(assetsDir, `base${targetExt}`);
  const cutKeeps = args["no-cuts"] ? [] : keeps;
  const ffArgs = buildBaseMediaArgs({
    source,
    keeps: cutKeeps,
    out: target,
    hasVideo,
    hasAudio,
    encoder: args.encoder || "libx264",
    crf: Number(args.crf) || 20,
    preset: args.preset || "veryfast",
    loudnorm: true,
    duration: Number(plan.duration) || null,
  });

  const result = run("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
  if (!result.ok) {
    fail(`FFmpeg failed to prepare the base media:\n${result.stderr || result.stdout || "unknown error"}`);
  }

  return {
    path: `assets/${path.basename(target)}`,
    duration: cutKeeps.length
      ? cutKeeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0)
      : Number(plan.duration) || Number(probe.duration) || 0,
    hasVideo,
    hasAudio,
    kind,
  };
}

function buildBaseMedia(project, plan, keeps, engineDir, args, assetsSubdir = "assets") {
  const base = buildBaseMediaCore(project, plan, keeps, engineDir, args, assetsSubdir);
  const voiced = applyVoiceover(project, plan, base, engineDir, assetsSubdir);
  return applyMusic(project, plan, voiced, engineDir, assetsSubdir);
}

function planMediaKey(project, plan, keeps, args) {
  const source = path.resolve(project.dir, plan.source);
  const format = plan.format || project.config.format || {};
  const fps = Number(format.fps) || 30;
  const encoder = args.encoder || "libx264";
  const crf = Number(args.crf) || 20;
  const preset = args.preset || "veryfast";
  const sourceKey = sourceFingerprint(source, { full: false });
  const alignedKeeps = roundKeeps(keeps, fps);
  const baseCutKey = cutKey({
    sourceKey,
    keeps: alignedKeeps,
    format,
    encoder,
    crf,
    preset,
    loudnorm: true,
  });

  const voiceoverPath = path.join(project.dir, "edit", "voiceover.json");
  const voiceover = exists(voiceoverPath) ? readJson(voiceoverPath, null) : null;
  const voiceFiles = (voiceover?.lines || [])
    .map((line) => {
      if (!line?.audio) return null;
      try {
        return sourceFingerprint(path.resolve(project.dir, line.audio), { full: false });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const baseVoiceKey = voiceKey({ cutKey: baseCutKey, voiceover, voiceFiles });

  const fingerprint = (value) => {
    try {
      return sourceFingerprint(path.resolve(project.dir, value), { full: false });
    } catch {
      return null;
    }
  };
  const musicEntry = plan.music?.src
    ? { ...plan.music, src: path.resolve(project.dir, plan.music.src), fingerprint: fingerprint(plan.music.src) }
    : null;
  const sfxEntries = (plan.sfx || [])
    .filter((clip) => clip?.src)
    .map((clip) => ({
      ...clip,
      src: path.resolve(project.dir, clip.src),
      fingerprint: fingerprint(clip.src),
    }));
  const mediaKey = musicKey({ voiceKey: baseVoiceKey, music: musicEntry, sfx: sfxEntries });

  return {
    mediaKey,
    sourceKey,
    alignedKeeps,
    format,
    fps,
    encoder,
    crf,
    preset,
    voiceover,
    musicEntry,
    sfxEntries,
  };
}

function buildMediaCached(project, plan, keeps, engineDir, args, assetsSubdir = "assets") {
  const { mediaKey, sourceKey, alignedKeeps, format, encoder, crf, preset } = planMediaKey(
    project,
    plan,
    keeps,
    args
  );

  const assetsDir = path.join(engineDir, assetsSubdir);
  ensureDir(assetsDir);
  const useCache = !args["no-cache"];

  if (useCache) {
    for (const ext of [".mp4", ".m4a", ".wav", ".mov"]) {
      const hit = readCache("build", mediaKey, ext, undefined, WORKSPACE);
      if (!hit) continue;
      const meta = readJson(`${hit}.meta.json`, null);
      if (!meta?.base) continue;
      const targetName = `base${ext}`;
      linkOrCopy(hit, path.join(assetsDir, targetName));
      return { ...meta.base, path: `assets/${targetName}` };
    }
  }

  const stageDir = path.join(cacheRoot(WORKSPACE), "build", `stage-${process.pid}-${Date.now()}`);
  ensureDir(stageDir);
  try {
    const built = buildBaseMedia(project, plan, keeps, stageDir, args, "assets");
    const builtPath = path.join(stageDir, built.path);
    if (!exists(builtPath)) fail(`Build did not produce the base media at ${builtPath}`);
    const ext = path.extname(builtPath) || ".mp4";
    const targetName = `base${ext}`;
    const targetPath = path.join(assetsDir, targetName);

    if (!useCache) {
      linkOrCopy(builtPath, targetPath);
      return { ...built, path: `assets/${targetName}` };
    }

    const cachePath = withCache({
      kind: "build",
      key: mediaKey,
      ext,
      workspace: WORKSPACE,
      refresh: Boolean(args["rebuild-media"]),
      validate: (file) => fs.statSync(file).size > 0,
      produce: (tmp) => fs.renameSync(builtPath, tmp),
      meta: {
        source: sourceKey,
        keeps: alignedKeeps,
        format,
        encoder,
        crf,
        preset,
        base: {
          kind: built.kind,
          hasVideo: built.hasVideo,
          hasAudio: built.hasAudio,
          duration: built.duration,
        },
      },
    });
    linkOrCopy(cachePath, targetPath);
    return { ...built, path: `assets/${targetName}` };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // The stage is inside the cache; a leftover folder is harmless.
    }
  }
}

function applyVoiceover(project, plan, base, engineDir, assetsSubdir = "assets") {
  const manifestPath = path.join(project.dir, "edit", "voiceover.json");
  if (!exists(manifestPath)) return base;
  const manifest = readJson(manifestPath, null);
  const lines = (manifest?.lines || []).filter(
    (line) => line.audio && Number.isFinite(Number(line.start)) && Number(line.duration) > 0
  );
  const usable = lines
    .map((line) => ({ line, source: path.resolve(project.dir, line.audio) }))
    .filter((entry) => exists(entry.source));
  if (!usable.length) return base;
  if (base.kind === "image") {
    console.warn("  ! TTS voiceover for still-image projects is not automated; add the voice track in the engine.");
    return base;
  }
  if (!versionOf("ffmpeg", ["-version"])) {
    console.warn("  ! FFmpeg not found; TTS voiceover was not mixed.");
    return base;
  }

  const duration = Math.max(0.1, Number(base.duration) || Number(plan.duration) || 0);
  const basePath = path.join(engineDir, assetsSubdir, path.basename(base.path));
  const ext = path.extname(base.path) || ".mp4";
  const mixedName = `base-voice${ext}`;
  const mixedPath = path.join(engineDir, assetsSubdir, mixedName);

  const ffArgs = ["-y", "-i", basePath];
  const chains = [];
  const voiceLabels = [];
  usable.forEach((entry, index) => {
    ffArgs.push("-i", entry.source);
    const delayMs = Math.max(0, Math.round(Number(entry.line.start) * 1000));
    const voiceDuration = Math.max(0.05, Number(entry.line.duration));
    chains.push(
      `[${index + 1}:a]atrim=start=0:end=${voiceDuration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[v${index}]`
    );
    voiceLabels.push(`[v${index}]`);
  });

  if (base.hasAudio) {
    chains.push("[0:a]volume=0.35[basea]");
    chains.push(
      `[basea]${voiceLabels.join("")}amix=inputs=${voiceLabels.length + 1}:duration=first:dropout_transition=2:normalize=0[aout]`
    );
  } else {
    chains.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:duration=longest:dropout_transition=2:normalize=0,apad=whole_dur=${duration.toFixed(3)}[aout]`);
  }

  ffArgs.push("-filter_complex", chains.join(";"));
  if (base.kind === "video") ffArgs.push("-map", "0:v:0", "-c:v", "copy");
  ffArgs.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-t", duration.toFixed(3), mixedPath);

  const result = run("ffmpeg", ffArgs, { timeout: 60 * 60 * 1000 });
  if (!result.ok) {
    console.warn(`  ! Could not mix TTS voiceover: ${result.stderr || result.stdout || "unknown error"}`);
    return base;
  }
  try {
    fs.rmSync(basePath, { force: true });
  } catch {}

  return {
    ...base,
    path: `assets/${mixedName}`,
    hasAudio: true,
  };
}

function applyMusic(project, plan, base, engineDir, assetsSubdir = "assets") {
  let music = plan.music?.src
    ? { ...plan.music, src: path.resolve(project.dir, plan.music.src) }
    : null;
  if (music && !exists(music.src)) {
    console.warn(`  ! Music not found: ${music.src}`);
    music = null;
  }

  const sfx = (plan.sfx || [])
    .map((clip, index) => {
      if (!clip?.src) {
        console.warn(`  ! SFX ${index + 1} is missing src`);
        return null;
      }
      const source = path.resolve(project.dir, clip.src);
      if (!exists(source)) {
        console.warn(`  ! SFX not found: ${source}`);
        return null;
      }
      return { ...clip, src: source };
    })
    .filter(Boolean);

  if (!music && !sfx.length) return base;
  if (base.kind === "image") {
    console.warn("  ! Audio mixing for still-image projects is not automated; add the track in the engine.");
    return base;
  }
  if (!versionOf("ffmpeg", ["-version"])) {
    console.warn("  ! FFmpeg not found; audio was not mixed.");
    return base;
  }

  const duration = Math.max(0.1, Number(base.duration) || Number(plan.duration) || 0);
  const basePath = path.join(engineDir, assetsSubdir, path.basename(base.path));
  const ext = path.extname(base.path) || ".mp4";
  const mixedName = `base-mix${ext}`;
  const mixedPath = path.join(engineDir, assetsSubdir, mixedName);

  let ffArgs;
  try {
    ffArgs = mixAudioArgs({
      base: {
        path: basePath,
        kind: base.kind,
        hasAudio: base.hasAudio,
        duration,
      },
      music,
      sfx,
      out: mixedPath,
      duration,
    });
  } catch (error) {
    console.warn(`  ! Could not build audio mix: ${error.message}`);
    return base;
  }

  const result = run("ffmpeg", ffArgs, { timeout: 30 * 60 * 1000 });
  if (!result.ok) {
    console.warn(`  ! Could not mix audio: ${result.stderr || result.stdout || "unknown error"}`);
    return base;
  }
  try {
    fs.rmSync(basePath, { force: true });
  } catch {}

  return {
    ...base,
    path: `assets/${mixedName}`,
    hasAudio: true,
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHyperFramesElement(element, index, theme = {}) {
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
      if (element.chart) {
        return `<div ${common("chart")} data-layout-allow-overlap data-layout-ignore data-description="${htmlEscape(element.description || "")}">${renderChartSvg(element, theme)}</div>`;
      }
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

/**
 * Shared CSS for HyperFrames compositions.
 *
 * `transparent: true` removes the page and root background so the render can
 * carry an alpha channel (MOV ProRes 4444 / WebM). Element clips use it;
 * the full-film composition keeps the themed background.
 */
function hyperFramesCss(theme, width, height, { transparent = false, extraCss = "" } = {}) {
  return `
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
        background: ${transparent ? "transparent" : "var(--bg)"};
        font-family: var(--body);
      }
      #root {
        position: relative;
        width: 100%; height: 100%;
        overflow: hidden;
        background: ${
          transparent
            ? "transparent"
            : `radial-gradient(circle at 70% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 45%),
          radial-gradient(circle at 20% 80%, color-mix(in srgb, var(--accent2) 12%, transparent), transparent 40%),
          var(--bg)`
        };
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
      .chart { position: absolute; inset: 80px; z-index: 2; }
      .chart svg { width: 100%; height: 100%; }
      ${extraCss}
  `;
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
    .map((element, index) => ({ element, index, html: renderHyperFramesElement(element, index, theme) }))
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

  const transitions = (plan.elements || [])
    .filter((element) => element.type === "transition")
    .map((element, index) =>
      hyperframesTransition(element, theme, { id: `transition-${index}`, trackIndex: 40 + index })
    );
  const zooms = base.kind === "audio"
    ? []
    : (plan.elements || [])
        .filter((element) => element.type === "zoom")
        .map((element) => hyperframesZoom(element, "#base"));
  const motionHtml = transitions.map((transition) => transition.html).join("\n      ");
  const motionCss = [...transitions.map((transition) => transition.css), ...zooms.map((zoom) => zoom.css)].join("\n");
  const motionTween = [...zooms.map((zoom) => zoom.tween), ...transitions.map((transition) => transition.tween)].join("\n");

  let baseHtml = "";
  if (base.kind === "image") {
    baseHtml = `<img id="base" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" src="${base.path}" alt="" />`;
  } else if (base.kind === "video") {
    baseHtml = `<video id="base" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" data-has-audio="${base.hasAudio}" src="${base.path}"${base.hasAudio ? "" : " muted"}></video>`;
  } else {
    baseHtml = `<audio id="voice" src="${base.path}" data-start="0" data-duration="${duration.toFixed(3)}"></audio>`;
  }

  const baseTween =
    (base.kind === "image" || base.kind === "video") && !zooms.length
      ? `tl.to("#base", { scale: 1.035, duration: ${duration.toFixed(3)}, ease: "none" }, 0);`
      : "";

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      ${hyperFramesCss(theme, width, height, { extraCss: `${motionCss}\n${panelCss}` })}
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
      ${motionHtml}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.seek(0);
      ${baseTween}
      ${timeline}
      ${motionTween}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

function renderHyperFramesElementDocument(project, plan, element, spec, theme) {
  const width = plan.format?.width || 1920;
  const height = plan.format?.height || 1080;
  const fps = plan.format?.fps || 30;
  const duration = Math.max(0.1, Number(spec.duration) || Number(element.end) - Number(element.start) || 1);
  const local = { ...element, start: 0, end: duration };
  let elementHtml = "";
  let extraCss = "";
  let tween = "";

  if (local.type === "transition") {
    const transition = hyperframesTransition(local, theme, { id: "el-0", trackIndex: 0, zIndex: 60 });
    elementHtml = transition.html;
    extraCss = transition.css;
    tween = transition.tween;
  } else {
    elementHtml = renderHyperFramesElement(local, 0, theme);
    tween = `
      tl.fromTo("#el-0", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 0);
      tl.to("#el-0", { opacity: 0, duration: 0.25, ease: "power2.in" }, ${Math.max(0.5, duration - 0.25).toFixed(3)});`;
  }
  if (!elementHtml) return null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      ${hyperFramesCss(theme, width, height, { transparent: true, extraCss })}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="element"
      data-start="0"
      data-duration="${duration.toFixed(3)}"
      data-fps="${fps}"
      data-width="${width}"
      data-height="${height}"
    >
      ${elementHtml}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.seek(0);
      ${tween}
      window.__timelines["element"] = tl;
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
  const engineCacheDir = path.join(cacheRoot(WORKSPACE), "engine-cache", project.slug);
  if (exists(engineDir)) {
    try {
      preserveEngineCaches(engineDir, engineCacheDir);
    } catch (error) {
      console.warn(`  ! Could not preserve engine caches: ${error.message}`);
    }
    removeDirRobust(engineDir);
  }
  ensureDir(engineDir);
  try {
    restoreEngineCaches(engineDir, engineCacheDir);
  } catch (error) {
    console.warn(`  ! Could not restore engine caches: ${error.message}`);
  }

  const remapped = planForBuild(plan, args);
  const base = buildMediaCached(project, plan, remapped.keeps, engineDir, args);
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
      if (element.chartSvg) {
        return <div style={{ ...common, left: 80, right: 80, top: 80, bottom: 80 }} dangerouslySetInnerHTML={{ __html: element.chartSvg }} />;
      }
      return (
        <div style={{ ...common, left: 200, right: 200, top: 300, padding: 48, border: \`1px solid \${theme.accent}\`, borderRadius: 18, background: "rgba(0,0,0,0.28)" }}>
          <div style={{ color: theme.accent, fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 18 }}>{element.type}</div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.05 }}>{text}</div>
          <div style={{ marginTop: 18, color: theme.muted, fontSize: 28, lineHeight: 1.35 }}>{element.description ?? ""}</div>
        </div>
      );
    case "zoom":
      return null;
    case "transition": {
      if (!element.motion) return null;
      const value = interpolate(frame, element.motion.inputRange, element.motion.outputRange, {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      if (element.motion.slide) {
        const transform = element.motion.property === "xPercent" ? \`translateX(\${value}%)\` : \`translateY(\${value}%)\`;
        return <div style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: element.motion.color, transform }} />;
      }
      return <div style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: element.motion.color, opacity: value }} />;
    }
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
  const activeZoom = (plan.elements ?? []).find(
    (element: any) =>
      element.motion?.type === "zoom" &&
      frame >= element.motion.inputRange[0] &&
      frame <= element.motion.inputRange[element.motion.inputRange.length - 1]
  );
  const zoomScale = activeZoom
    ? interpolate(frame, activeZoom.motion.inputRange, activeZoom.motion.outputRange, {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const zoomOrigin = activeZoom?.motion?.transformOrigin ?? "50% 50%";
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, color: theme.fg, fontFamily: theme.body + ', "Segoe UI", sans-serif', overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: \`radial-gradient(circle at 70% 30%, \${theme.accent}22, transparent 45%), radial-gradient(circle at 20% 80%, \${theme.accent2}18, transparent 40%), \${theme.bg}\` }} />
      <div style={{ position: "absolute", inset: 0, transform: \`scale(\${zoomScale})\`, transformOrigin: zoomOrigin }}>
        {base.kind === "image" ? <Img src={staticFile(base.path)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        {base.kind === "video" ? <OffthreadVideo src={staticFile(base.path)} muted={!base.hasAudio} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        {base.kind === "audio" ? <Audio src={staticFile(base.path)} /> : null}
      </div>
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
  const engineCacheDir = path.join(cacheRoot(WORKSPACE), "engine-cache", `${project.slug}-remotion`);
  if (exists(engineDir)) {
    try {
      preserveEngineCaches(engineDir, engineCacheDir);
    } catch (error) {
      console.warn(`  ! Could not preserve engine caches: ${error.message}`);
    }
    removeDirRobust(engineDir);
  }
  ensureDir(engineDir);
  try {
    restoreEngineCaches(engineDir, engineCacheDir);
  } catch (error) {
    console.warn(`  ! Could not restore engine caches: ${error.message}`);
  }

  const assetsDir = path.join(engineDir, "public", "assets");
  const remapped = planForBuild(plan, args);
  const base = buildMediaCached(project, plan, remapped.keeps, engineDir, args, "public/assets");
  const finalPlan = { ...remapped.plan, duration: base.duration };
  copyElementAssets(project.dir, finalPlan, assetsDir, "assets/");
  const theme = themeFromProfile(resolveProfile(project.config.profile));
  const fps = Number(finalPlan.format?.fps || project.config.format?.fps) || 30;
  const enrichedPlan = {
    ...finalPlan,
    elements: (finalPlan.elements || []).map((element) => {
      if (element.type === "grafico" && element.chart) {
        return { ...element, chartSvg: renderChartSvg(element, theme) };
      }
      if (element.type === "zoom") {
        const zoom = remotionZoomValues(element, fps);
        return {
          ...element,
          motion: {
            type: "zoom",
            inputRange: zoom.inputRange,
            outputRange: zoom.outputRange,
            transformOrigin: zoom.transformOrigin,
          },
        };
      }
      if (element.type === "transition") {
        const transition = remotionTransitionValues(element, fps, { theme });
        return {
          ...element,
          motion: {
            type: "transition",
            inputRange: transition.inputRange,
            outputRange: transition.outputRange,
            property: transition.property,
            color: transition.color,
            slide: transition.slide,
          },
        };
      }
      return element;
    }),
  };

  writeText(
    path.join(engineDir, "src", "data", "plan.ts"),
    `export const plan = ${JSON.stringify(enrichedPlan, null, 2)};\nexport const theme = ${JSON.stringify(theme, null, 2)};\nexport const base = ${JSON.stringify(base, null, 2)};\n`
  );
  writeText(path.join(engineDir, "src", "Video.tsx"), renderRemotionTsx(project, enrichedPlan, theme, base));
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
  const has3d = (finalPlan.elements || []).some((element) => /3d/i.test(String(element.type || "")));
  writeText(
    path.join(engineDir, "remotion.config.ts"),
    `import { Config } from "@remotion/cli/config";\n\nConfig.setVideoImageFormat("jpeg");\nConfig.setOverwriteOutput(true);\n${has3d ? 'Config.setChromiumOpenGlRenderer("angle");\n' : ""}`
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
      "@remotion/cli": REMOTION_VERSION,
      react: "19.0.0",
      "react-dom": "19.0.0",
      remotion: REMOTION_VERSION,
    },
    devDependencies: {
      "@types/react": "19.0.0",
      typescript: "5.9.3",
    },
  });
  writeText(
    path.join(engineDir, "README.md"),
    `# ${project.config.name || project.slug} - Remotion\n\nGenerated by RoosterEdit from \`edit/plan.json\`.\n\n\`\`\`bash\nnpm install\nnpx remotion studio\nnpx remotion render src/index.ts RoosterVideo out/final.mp4\n\`\`\`\n`
  );

  return { engineDir, base, duration: base.duration };
}

// ---------------------------------------------------------------------------
// FilmCraft (optional timeline target)
// ---------------------------------------------------------------------------

function filmCraftPaths(project) {
  const dir = path.join(project.dir, "engine", "filmcraft");
  return {
    dir,
    projectFile: path.join(dir, `${project.slug}.fcproj`),
    assetsDir: path.join(dir, "assets"),
    elementsDir: path.join(dir, "elements"),
    hyperframesDir: path.join(dir, "hyperframes"),
    remotionDir: path.join(dir, "remotion"),
    archiveDir: path.join(dir, "archive"),
    statePath: path.join(project.dir, "work", "filmcraft.json"),
  };
}

function filmCraftCliOrFail() {
  const found = findFilmCraft({
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    cwd: CWD,
  });
  if (!found.cli) {
    fail(
      "FilmCraft CLI not found.\n" +
        "Install FilmCraft from https://getartcraft.com/apps/filmcraft (MIT/Apache-2.0), or set ROOSTER_FILMCRAFT_CLI to filmcraft-cli.\n" +
        "To keep the current workflow, use --target hyperframes or --target remotion."
    );
  }
  return found;
}

function filmCraftElementEngine(args, plan, project) {
  let engine = args.engine && args.engine !== "filmcraft" ? args.engine : project.config.engine || "auto";
  if (engine === "auto") {
    const has3d = (plan.elements || []).some((element) => /3d/i.test(String(element.type || "")));
    engine = has3d ? "remotion" : "hyperframes";
  }
  if (!["hyperframes", "remotion"].includes(engine)) {
    fail(`FilmCraft elements need HyperFrames or Remotion; got "${engine}".`);
  }
  return engine;
}

function filmCraftCaptionsFile(project) {
  const dir = path.join(project.dir, "edit", "captions");
  if (!exists(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((file) => /\.(srt|vtt)$/i.test(file))
    .sort((a, b) => (/\.srt$/i.test(a) ? -1 : 0) - (/\.srt$/i.test(b) ? -1 : 0) || a.localeCompare(b));
  return files.length ? path.join(dir, files[0]) : null;
}

function ensureFilmCraftHyperFramesProject(project, plan, theme, specs, paths) {
  ensureDir(paths.hyperframesDir);
  ensureDir(path.join(paths.hyperframesDir, "assets"));
  writeJson(path.join(paths.hyperframesDir, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  });
  writeJson(path.join(paths.hyperframesDir, "package.json"), {
    name: `${project.slug}-filmcraft-elements`,
    private: true,
    type: "module",
    scripts: { render: "npx --yes hyperframes render" },
  });
  writeJson(path.join(paths.hyperframesDir, "meta.json"), {
    id: `${project.slug}-filmcraft-elements`,
    name: `${project.config.name || project.slug} elements`,
    createdAt: now(),
  });

  const renderPlan = {
    ...plan,
    elements: specs.map((spec) => JSON.parse(JSON.stringify(spec.element))),
  };
  copyElementAssets(project.dir, renderPlan, path.join(paths.hyperframesDir, "assets"), "assets/");

  const documents = new Map();
  specs.forEach((spec, index) => {
    const element = renderPlan.elements[index];
    const html = renderHyperFramesElementDocument(project, plan, element, spec, theme);
    if (!html) {
      console.warn(`  ! ${spec.id} (${spec.type}) cannot be rendered as a standalone clip; skipped.`);
      return;
    }
    const file = path.join(paths.hyperframesDir, `element-${spec.id}.html`);
    writeText(file, html);
    documents.set(spec.id, file);
  });
  return documents;
}

function renderRemotionElementTsx() {
  return `import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const textOf = (element: any) => element.text ?? element.description ?? "";

const fade = (frame: number, duration: number, fps: number) => {
  const end = Math.max(1, duration * fps);
  const out = Math.max(1, end - 0.25 * fps);
  return interpolate(frame, [0, Math.min(0.35 * fps, out - 1), out, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const RoosterElement = ({ entry }: { entry: any }) => {
  const frame = useCurrentFrame();
  const element = entry.element ?? {};
  const fps = entry.fps ?? 30;
  const duration = entry.duration ?? 1;
  const opacity = fade(frame, duration, fps);
  if (opacity <= 0.001) return null;
  const text = textOf(element);
  const common = { position: "absolute" as const, opacity };
  const theme = entry.theme ?? {};

  switch (element.type) {
    case "letreiro":
      return <div style={{ ...common, left: 96, top: 240, width: 1600, fontSize: 104, fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.04em" }}>{text}</div>;
    case "caption-emphasis":
      return <div style={{ ...common, left: 96, bottom: 170, width: 1500, fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em" }}>{text}</div>;
    case "grafico":
    case "lista":
      if (element.chartSvg) {
        return <div style={{ ...common, left: 80, right: 80, top: 80, bottom: 80 }} dangerouslySetInnerHTML={{ __html: element.chartSvg }} />;
      }
      return (
        <div style={{ ...common, left: 200, right: 200, top: 300, padding: 48, border: \`1px solid \${theme.accent}\`, borderRadius: 18, background: "rgba(0,0,0,0.28)" }}>
          <div style={{ color: theme.accent, fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 18 }}>{element.type}</div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.05 }}>{text}</div>
          <div style={{ marginTop: 18, color: theme.muted, fontSize: 28, lineHeight: 1.35 }}>{element.description ?? ""}</div>
        </div>
      );
    case "zoom":
      return null;
    case "transition": {
      if (!element.motion) return null;
      const value = interpolate(frame, element.motion.inputRange, element.motion.outputRange, {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      if (element.motion.slide) {
        const transform = element.motion.property === "xPercent" ? \`translateX(\${value}%)\` : \`translateY(\${value}%)\`;
        return <div style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: element.motion.color, transform }} />;
      }
      return <div style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: element.motion.color, opacity: value }} />;
    }
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
`;
}

function ensureFilmCraftRemotionProject(project, plan, theme, specs, format, paths) {
  const fps = Number(format.fps) || 30;
  const width = Number(format.width) || 1920;
  const height = Number(format.height) || 1080;
  ensureDir(paths.remotionDir);
  const assetsDir = path.join(paths.remotionDir, "public", "assets");
  ensureDir(assetsDir);

  const renderPlan = {
    ...plan,
    elements: specs.map((spec) => JSON.parse(JSON.stringify(spec.element))),
  };
  copyElementAssets(project.dir, renderPlan, assetsDir, "assets/");

  const entries = specs.map((spec, index) => {
    let element = renderPlan.elements[index];
    if (element.type === "grafico" && element.chart) {
      element = { ...element, chartSvg: renderChartSvg(element, theme) };
    }
    if (element.type === "transition") {
      const transition = remotionTransitionValues(element, fps, { theme });
      element = {
        ...element,
        motion: {
          type: "transition",
          inputRange: transition.inputRange,
          outputRange: transition.outputRange,
          property: transition.property,
          color: transition.color,
          slide: transition.slide,
        },
      };
    }
    return {
      id: spec.id,
      duration: spec.duration,
      fps,
      width,
      height,
      element,
      theme,
    };
  });

  writeJson(path.join(paths.remotionDir, "src", "data", "elements.json"), entries);
  writeText(path.join(paths.remotionDir, "src", "Element.tsx"), renderRemotionElementTsx());
  writeText(
    path.join(paths.remotionDir, "src", "Root.tsx"),
    `import { Composition } from "remotion";
import { RoosterElement } from "./Element";
import elements from "./data/elements.json";

export const RemotionRoot = () => (
  <>
    {elements.map((entry: any) => (
      <Composition
        key={entry.id}
        id={entry.id}
        component={RoosterElement}
        durationInFrames={Math.max(1, Math.ceil(entry.duration * entry.fps))}
        fps={entry.fps}
        width={entry.width}
        height={entry.height}
        defaultProps={{ entry }}
      />
    ))}
  </>
);
`
  );
  writeText(
    path.join(paths.remotionDir, "src", "index.ts"),
    `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./Root";\n\nregisterRoot(RemotionRoot);\n`
  );
  writeText(
    path.join(paths.remotionDir, "remotion.config.ts"),
    `import { Config } from "@remotion/cli/config";\n\nConfig.setVideoImageFormat("png");\nConfig.setOverwriteOutput(true);\n`
  );
  writeText(
    path.join(paths.remotionDir, "tsconfig.json"),
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
          resolveJsonModule: true,
        },
        include: ["src"],
      },
      null,
      2
    )
  );
  writeJson(path.join(paths.remotionDir, "package.json"), {
    name: `${project.slug}-filmcraft-elements`,
    version: "1.0.0",
    private: true,
    scripts: { studio: "remotion studio" },
    dependencies: {
      "@remotion/cli": REMOTION_VERSION,
      react: "19.0.0",
      "react-dom": "19.0.0",
      remotion: REMOTION_VERSION,
    },
    devDependencies: {
      "@types/react": "19.0.0",
      typescript: "5.9.3",
    },
  });
  return entries;
}

function runEngineBinary(bin, args, options = {}) {
  if (/\.(mjs|cjs|js)$/i.test(String(bin))) {
    return run(process.execPath, [bin, ...args], options);
  }
  return run(bin, args, options);
}

function renderFilmCraftElements(project, plan, specs, theme, engine, args, paths) {
  const renderable = specs.filter((spec) => spec.renderable);
  if (!renderable.length) return [];

  const format = plan.format || project.config.format || {};
  const width = Number(format.width) || 1920;
  const height = Number(format.height) || 1080;
  const fps = Number(format.fps) || 30;
  const engineDir = engine === "hyperframes" ? paths.hyperframesDir : paths.remotionDir;
  if (engine === "remotion") {
    ensureFilmCraftRemotionProject(project, plan, theme, renderable, format, paths);
  }
  const info = engineVersion(engine, {
    workspace: WORKSPACE,
    cwd: engineDir,
    home: ROOSTER_HOME,
    projectDir: engineDir,
  });
  if (!info || !info.bin) {
    if (engine === "hyperframes") {
      fail("HyperFrames not found. Install it with `npm install --prefix <workspace>/cache/tools hyperframes` or use --engine remotion.");
    }
    fail(`Remotion not found in ${engineDir}. Run npm install there, or use --engine hyperframes.`);
  }

  const documents =
    engine === "hyperframes"
      ? ensureFilmCraftHyperFramesProject(project, plan, theme, renderable, paths)
      : null;

  ensureDir(paths.elementsDir);
  ensureDir(paths.assetsDir);
  const validate = (file) => fs.statSync(file).size > 0;
  const rendered = [];

  for (const spec of renderable) {
    const renderElement = { ...spec.element, start: 0, end: spec.duration };
    const assetPath = renderElement.src || renderElement.asset;
    let assetFingerprint = null;
    if (assetPath) {
      try {
        assetFingerprint = sourceFingerprint(path.resolve(project.dir, assetPath), { full: false });
      } catch {
        assetFingerprint = null;
      }
    }
    const hash = elementKey({
      element: renderElement,
      theme,
      format: { width, height, fps },
      engine,
      engineVersion: info.version || "unknown",
      render: { format: "mov", alpha: true, proresProfile: "4444", asset: assetFingerprint },
    });
    const targetName = `${spec.id}-${hash.slice(0, 8)}.mov`;
    const targetPath = path.join(paths.elementsDir, targetName);
    let cached = false;

    if (!args["no-cache"] && !args["rebuild-media"]) {
      const hit = readCache("elements", hash, ".mov", validate, WORKSPACE);
      if (hit) {
        linkOrCopy(hit, targetPath);
        cached = true;
      }
    }

    if (!cached) {
      const renderTo = (tmp) => {
        const timeout = Math.max(5 * 60 * 1000, (Number(spec.duration) || 1) * 60 * 1000);
        let result;
        if (engine === "hyperframes") {
          const document = documents?.get(spec.id);
          if (!document) {
            throw new Error(`${spec.id}: no HyperFrames document was generated`);
          }
          result = runEngineBinary(
            info.bin,
            [
              "render",
              paths.hyperframesDir,
              "--composition",
              path.basename(document),
              "--format",
              "mov",
              "--prores-profile",
              "4444",
              "--quality",
              "delivery",
              "-o",
              tmp,
            ],
            { timeout }
          );
        } else {
          const invocation = remotionRenderArgs({
            bin: info.bin,
            entry: "src/index.ts",
            composition: spec.id,
            out: tmp,
            quality: "final",
            concurrency: args.concurrency,
            codec: "prores",
            proresProfile: "4444",
            imageFormat: "png",
            pixelFormat: "yuva444p10le",
          });
          result = runEngineBinary(invocation.command, invocation.args, {
            cwd: paths.remotionDir,
            timeout,
          });
        }
        if (!result.ok) {
          throw new Error(
            `Element ${spec.id} (${spec.type}) failed to render:\n${(result.stderr || result.stdout || result.error || "unknown error").slice(-2000)}`
          );
        }
      };

      const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-element-"));
      const stageFile = path.join(stageDir, `${spec.id}.mov`);
      try {
        renderTo(stageFile);
        if (args["no-cache"]) {
          fs.rmSync(targetPath, { force: true });
          fs.copyFileSync(stageFile, targetPath);
        } else {
          const cachePath = withCache({
            kind: "elements",
            key: hash,
            ext: ".mov",
            workspace: WORKSPACE,
            refresh: Boolean(args["rebuild-media"]),
            validate,
            produce: (tmp) => fs.copyFileSync(stageFile, tmp),
            meta: {
              project: project.slug,
              element: spec.id,
              type: spec.type,
              engine,
              engineVersion: info.version || null,
              format: { width, height, fps },
            },
          });
          linkOrCopy(cachePath, targetPath);
        }
      } catch (error) {
        fail(error.message);
      } finally {
        try {
          fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        } catch {
          // A leftover temp dir is harmless.
        }
      }
    }

    rendered.push({ spec, file: targetPath, hash, cached });
  }

  return rendered;
}

function filmCraftPlaceCommand(item, track, start, sourceIn, duration, options = {}) {
  const params = {
    item,
    track,
    time: secondsToTicks(start),
    duration: secondsToTicks(duration),
  };
  if (sourceIn !== null && sourceIn !== undefined) params.sourceIn = secondsToTicks(sourceIn);
  if (options.video !== undefined) params.video = Boolean(options.video);
  if (options.audio !== undefined) params.audio = Boolean(options.audio);
  return { id: "timeline.place", params };
}

function filmCraftMarkerCommands(markers) {
  return (markers || [])
    .filter((marker) => Number.isFinite(Number(marker.time)) && Number(marker.time) >= 0)
    .map((marker) => ({
      id: "markers.add",
      params: {
        target: "program",
        time: secondsToTicks(marker.time),
        name: String(marker.label || marker.kind || "marker"),
        comment: marker.kind ? `rooster:${marker.kind}` : "rooster",
      },
    }));
}

function syncFilmCraftProject({
  project,
  plan,
  keeps,
  base,
  baseKey,
  rendered,
  specs,
  format,
  fps,
  duration,
  markers,
  captionsFile,
  cli,
  paths,
  state,
  args,
}) {
  const sourcePath = plan.source ? path.resolve(project.dir, plan.source) : null;
  const basePath = path.resolve(paths.dir, base.path);
  const hasSourceVideo = Boolean(sourcePath) && exists(sourcePath) && base.kind !== "audio";
  const hasAudio = Boolean(base.hasAudio) && exists(basePath);
  const maxTrack = Math.max(3, ...specs.map((spec) => Number(spec.trackIndex) || 2));

  if (!state) {
    const created = filmCraftRun(
      cli,
      null,
      [
        {
          id: "file.newSequence",
          params: {
            name: project.config.name || project.slug,
            width: Number(format.width) || 1920,
            height: Number(format.height) || 1080,
            fps: Number(fps) || 30,
            video: maxTrack,
            audio: 3,
          },
        },
      ],
      { saveAs: paths.projectFile }
    );
    if (!created.ok) {
      fail(`FilmCraft could not create the project:\n${created.error || created.stderr || created.stdout || "unknown error"}`);
    }
    const sequence = created.results?.[0]?.result?.sequence ?? null;

    const importPaths = [];
    const importKeys = [];
    if (hasSourceVideo) {
      importPaths.push(sourcePath);
      importKeys.push("source");
    }
    if (hasAudio) {
      importPaths.push(basePath);
      importKeys.push("audio");
    }
    for (const item of rendered) {
      importPaths.push(item.file);
      importKeys.push(item.spec.id);
    }

    const items = {};
    if (importPaths.length) {
      const imported = filmCraftRun(
        cli,
        paths.projectFile,
        [{ id: "file.import", params: { paths: importPaths } }],
        { save: true }
      );
      if (!imported.ok) {
        fail(`FilmCraft could not import the media:\n${imported.error || imported.stderr || imported.stdout || "unknown error"}`);
      }
      const list = imported.results?.[0]?.result?.items || [];
      importKeys.forEach((key, index) => {
        if (list[index] !== undefined) items[key] = list[index];
      });
      for (const key of importKeys) {
        if (items[key] === undefined) {
          fail(`FilmCraft did not return an item id for "${key}". Check the media path and try again.`);
        }
      }
    }

    const commands = [];
    const meta = [];
    const cuts = [];
    let cursor = 0;
    if (hasSourceVideo) {
      if (base.kind === "image") {
        commands.push(filmCraftPlaceCommand(items.source, "V1", 0, null, duration, { video: true, audio: false }));
        meta.push({ kind: "cut", index: 0, item: items.source, start: 0, sourceIn: 0, duration });
        cuts.push({ index: 0, item: items.source, start: 0, sourceIn: 0, duration });
      } else {
        keeps.forEach((keep, index) => {
          const length = Math.max(0, keep.end - keep.start);
          if (length <= 0) return;
          commands.push(
            filmCraftPlaceCommand(items.source, "V1", cursor, keep.start, length, {
              video: true,
              audio: false,
            })
          );
          meta.push({ kind: "cut", index, item: items.source, start: cursor, sourceIn: keep.start, duration: length });
          cuts.push({ index, item: items.source, start: cursor, sourceIn: keep.start, duration: length });
          cursor += length;
        });
      }
    }
    if (hasAudio) {
      commands.push(
        filmCraftPlaceCommand(items.audio, "A1", 0, 0, duration, { video: false, audio: true })
      );
      meta.push({ kind: "audio", item: items.audio, start: 0, sourceIn: 0, duration });
    }
    for (const item of rendered) {
      const spec = item.spec;
      commands.push(
        filmCraftPlaceCommand(items[spec.id], `V${spec.trackIndex}`, spec.start, null, spec.duration, {
          video: true,
          audio: false,
        })
      );
      meta.push({
        kind: "element",
        id: spec.id,
        item: items[spec.id],
        start: spec.start,
        duration: spec.duration,
        track: `V${spec.trackIndex}`,
        hash: item.hash,
        file: item.file,
      });
    }
    const placed = filmCraftRun(cli, paths.projectFile, commands, { save: true });
    if (!placed.ok) {
      fail(`FilmCraft could not place the timeline:\n${placed.error || placed.stderr || placed.stdout || "unknown error"}`);
    }

    const markerCommands = filmCraftMarkerCommands(markers);
    if (markerCommands.length) {
      const marked = filmCraftRun(cli, paths.projectFile, markerCommands, {
        save: true,
        keepGoing: true,
      });
      if (!marked.ok) {
        console.warn(
          `  ! Could not add all markers: ${marked.error || marked.stderr || "unknown error"}`
        );
      }
    }

    const elements = {};
    const cutState = [];
    let audioState = null;
    (placed.results || []).forEach((result, index) => {
      const entry = meta[index];
      if (!entry) return;
      const clip = result.result?.clips?.[0] ?? null;
      if (entry.kind === "cut") cutState.push({ ...entry, clip });
      else if (entry.kind === "audio") audioState = { ...entry, clip };
      else if (entry.kind === "element") {
        elements[entry.id] = {
          hash: entry.hash,
          file: entry.file,
          item: entry.item,
          clip,
          track: entry.track,
          start: entry.start,
          duration: entry.duration,
        };
      }
    });

    if (captionsFile) {
      const captions = filmCraftRun(
        cli,
        paths.projectFile,
        [{ id: "captions.import", params: { path: captionsFile } }],
        { save: true, keepGoing: true }
      );
      if (!captions.ok) {
        console.warn(`  ! Could not import captions: ${captions.error || captions.stderr || "unknown error"}`);
      }
    }

    return {
      schema: "rooster.filmcraft/v1",
      key: null,
      projectFile: paths.projectFile,
      sequence,
      tracks: { video: maxTrack, audio: 3 },
      format: { width: Number(format.width) || 1920, height: Number(format.height) || 1080, fps: Number(fps) || 30 },
      base: {
        key: baseKey,
        kind: base.kind,
        duration,
        path: basePath,
        fingerprint: sourceFingerprint(basePath, { full: false }),
      },
      source: sourcePath
        ? { path: sourcePath, item: items.source, fingerprint: sourceFingerprint(sourcePath, { full: false }) }
        : null,
      cuts: cutState,
      audio: audioState,
      elements,
      markers: markers || [],
      createdAt: now(),
      updatedAt: now(),
    };
  }

  // Incremental update: touch only the base/audio when they changed and the
  // element clips whose content hash changed. Everything else is user work and
  // stays where it is.
  state.elements = state.elements || {};
  state.cuts = state.cuts || [];
  const commands = [];
  const imports = [];
  const importKeys = [];
  const importKey = (key, file) => {
    imports.push(file);
    importKeys.push(key);
    return key;
  };

  const baseChanged = state.base?.key !== baseKey;
  if (baseChanged) {
    const deleteClips = [
      ...(state.cuts || []).map((cut) => cut.clip),
      state.audio?.clip,
    ].filter((clip) => clip !== null && clip !== undefined);
    if (deleteClips.length) {
      commands.push({ id: "timeline.delete", params: { clips: deleteClips, ripple: false } });
    }
  }

  const currentIds = new Set(rendered.map((item) => item.spec.id));
  const removed = Object.keys(state.elements || {}).filter((id) => !currentIds.has(id));
  for (const id of removed) {
    const clip = state.elements[id]?.clip;
    if (clip !== null && clip !== undefined) {
      commands.push({ id: "timeline.delete", params: { clips: [clip], ripple: false } });
    }
  }

  const neededVideoTracks = Math.max(3, ...specs.map((spec) => Number(spec.trackIndex) || 2));
  const currentVideoTracks = Number(state.tracks?.video) || 3;
  if (neededVideoTracks > currentVideoTracks) {
    commands.push({
      id: "sequence.addTracks",
      params: { video: neededVideoTracks - currentVideoTracks },
    });
    state.tracks = { ...(state.tracks || {}), video: neededVideoTracks, audio: state.tracks?.audio || 3 };
  }

  const elementActions = [];
  for (const item of rendered) {
    const spec = item.spec;
    const previous = state.elements?.[spec.id];
    if (previous && previous.hash === item.hash && previous.clip !== null && previous.clip !== undefined) {
      continue;
    }
    if (previous && previous.clip !== null && previous.clip !== undefined) {
      const sameWindow =
        Math.abs(Number(previous.start) - Number(spec.start)) < 0.001 &&
        Math.abs(Number(previous.duration) - Number(spec.duration)) < 0.001;
      if (sameWindow) {
        const key = importKey(`replace:${spec.id}`, item.file);
        elementActions.push({ kind: "replace", spec, key, clip: previous.clip, hash: item.hash, file: item.file });
      } else {
        commands.push({ id: "timeline.delete", params: { clips: [previous.clip], ripple: false } });
        const key = importKey(`place:${spec.id}`, item.file);
        elementActions.push({ kind: "place", spec, key, hash: item.hash, file: item.file });
      }
    } else {
      const key = importKey(`place:${spec.id}`, item.file);
      elementActions.push({ kind: "place", spec, key, hash: item.hash, file: item.file });
    }
  }

  const sourceChanged =
    !state.source || state.source.path !== sourcePath || state.source.fingerprint !== (sourcePath ? sourceFingerprint(sourcePath, { full: false }) : null);
  const audioChanged =
    !state.audio || state.base?.fingerprint !== (exists(basePath) ? sourceFingerprint(basePath, { full: false }) : null);

  if (baseChanged && hasSourceVideo) {
    if (sourceChanged) importKey("source", sourcePath);
  }
  if (baseChanged && hasAudio) {
    if (audioChanged) importKey("audio", basePath);
  }

  const importedItems = {};
  if (imports.length) {
    const imported = filmCraftRun(
      cli,
      paths.projectFile,
      [{ id: "file.import", params: { paths: imports } }],
      { save: true }
    );
    if (!imported.ok) {
      fail(`FilmCraft could not import the updated media:\n${imported.error || imported.stderr || imported.stdout || "unknown error"}`);
    }
    const list = imported.results?.[0]?.result?.items || [];
    importKeys.forEach((key, index) => {
      if (list[index] !== undefined) importedItems[key] = list[index];
    });
  }

  let cursor = 0;
  const nextCuts = [];
  if (baseChanged && hasSourceVideo) {
    if (base.kind === "image") {
      commands.push(filmCraftPlaceCommand(importedItems.source ?? state.source?.item, "V1", 0, null, duration, { video: true, audio: false }));
      nextCuts.push({ index: 0, item: importedItems.source ?? state.source?.item, start: 0, sourceIn: 0, duration, clip: null });
    } else {
      keeps.forEach((keep, index) => {
        const length = Math.max(0, keep.end - keep.start);
        if (length <= 0) return;
        commands.push(
          filmCraftPlaceCommand(importedItems.source ?? state.source?.item, "V1", cursor, keep.start, length, {
            video: true,
            audio: false,
          })
        );
        nextCuts.push({ index, item: importedItems.source ?? state.source?.item, start: cursor, sourceIn: keep.start, duration: length, clip: null });
        cursor += length;
      });
    }
  }

  let nextAudio = state.audio || null;
  if (baseChanged && hasAudio) {
    commands.push(
      filmCraftPlaceCommand(importedItems.audio ?? state.audio?.item, "A1", 0, 0, duration, { video: false, audio: true })
    );
    nextAudio = { item: importedItems.audio ?? state.audio?.item, start: 0, sourceIn: 0, duration, clip: null };
  } else if (baseChanged) {
    nextAudio = null;
  }

  for (const action of elementActions) {
    const item = importedItems[action.key];
    if (action.kind === "replace") {
      commands.push({ id: "clip.replaceFromBin", params: { clips: [action.clip], item, keepSourceIn: true } });
    } else {
      commands.push(
        filmCraftPlaceCommand(item, `V${action.spec.trackIndex}`, action.spec.start, null, action.spec.duration, {
          video: true,
          audio: false,
        })
      );
    }
  }

  if (commands.length) {
    const result = filmCraftRun(cli, paths.projectFile, commands, { save: true });
    if (!result.ok) {
      fail(`FilmCraft could not update the timeline:\n${result.error || result.stderr || result.stdout || "unknown error"}`);
    }
    // Map newly placed clips back to the state. Replacements keep their clip id.
    let commandIndex = 0;
    for (const command of commands) {
      const outcome = result.results?.[commandIndex];
      const clip = outcome?.result?.clips?.[0] ?? null;
      if (command.id === "timeline.place") {
        const params = command.params;
        if (params.track === "V1") {
          const cut = nextCuts.find((entry) => entry.clip === null && Math.abs(entry.start - ticksToSeconds(params.time)) < 0.002);
          if (cut) cut.clip = clip;
        } else if (params.track === "A1" && nextAudio) {
          nextAudio.clip = clip;
        } else {
          const action = elementActions.find((entry) => entry.kind === "place" && `V${entry.spec.trackIndex}` === params.track && Math.abs(entry.spec.start - ticksToSeconds(params.time)) < 0.002);
          if (action) {
            state.elements[action.spec.id] = {
              hash: action.hash,
              file: action.file,
              item: importedItems[action.key],
              clip,
              track: `V${action.spec.trackIndex}`,
              start: action.spec.start,
              duration: action.spec.duration,
            };
          }
        }
      } else if (command.id === "clip.replaceFromBin") {
        const action = elementActions.find((entry) => entry.kind === "replace" && entry.clip === command.params.clips[0]);
        if (action) {
          state.elements[action.spec.id] = {
            hash: action.hash,
            file: action.file,
            item: importedItems[action.key],
            clip: command.params.clips[0],
            track: `V${action.spec.trackIndex}`,
            start: action.spec.start,
            duration: action.spec.duration,
          };
        }
      }
      commandIndex += 1;
    }
  }

  if (baseChanged) {
    state.cuts = nextCuts;
    state.audio = nextAudio;
    state.base = {
      key: baseKey,
      kind: base.kind,
      duration,
      path: basePath,
      fingerprint: exists(basePath) ? sourceFingerprint(basePath, { full: false }) : null,
    };
    state.source = sourcePath
      ? { path: sourcePath, item: importedItems.source ?? state.source?.item, fingerprint: sourceFingerprint(sourcePath, { full: false }) }
      : null;
  }
  for (const id of removed) delete state.elements[id];
  state.updatedAt = now();
  return state;
}

function buildFilmCraft(project, plan, args) {
  const found = filmCraftCliOrFail();
  const cli = found.cli;
  const paths = filmCraftPaths(project);
  ensureDir(paths.dir);
  ensureDir(paths.assetsDir);
  ensureDir(paths.elementsDir);

  const remapped = planForBuild(plan, args);
  const theme = themeFromProfile(resolveProfile(project.config.profile));
  const engine = filmCraftElementEngine(args, plan, project);
  const format = remapped.plan.format || project.config.format || {};
  const fps = Number(format.fps) || 30;
  const plannedDuration = Number(remapped.duration) || Number(format.duration) || 0;
  const baseKey = planMediaKey(project, plan, remapped.keeps, args).mediaKey;
  const filmcraftVersion = filmCraftVersion(cli);
  const elementEngineDir = engine === "hyperframes" ? paths.hyperframesDir : paths.remotionDir;
  const elementEngineInfo = engineVersion(engine, {
    workspace: WORKSPACE,
    cwd: elementEngineDir,
    home: ROOSTER_HOME,
    projectDir: elementEngineDir,
  });
  const elementEngineVersion = elementEngineInfo?.version || "missing";

  let state = exists(paths.statePath) ? readJson(paths.statePath, null) : null;
  if (state && state.schema !== "rooster.filmcraft/v1") state = null;
  if (exists(paths.projectFile) && !state) {
    ensureDir(paths.archiveDir);
    const archived = path.join(paths.archiveDir, `${project.slug}-${Date.now()}.fcproj`);
    try {
      fs.renameSync(paths.projectFile, archived);
      console.warn(`  ! Existing FilmCraft project had no Rooster state; archived to ${archived}`);
    } catch (error) {
      fail(`Could not archive the existing FilmCraft project (close FilmCraft and retry): ${error.message}`);
    }
  }
  if (args.force) {
    if (exists(paths.projectFile)) {
      ensureDir(paths.archiveDir);
      const archived = path.join(paths.archiveDir, `${project.slug}-${Date.now()}.fcproj`);
      try {
        fs.renameSync(paths.projectFile, archived);
        console.warn(`  ! Archived the previous FilmCraft project to ${archived}`);
      } catch (error) {
        fail(`Could not archive the previous FilmCraft project (close FilmCraft and retry): ${error.message}`);
      }
    }
    state = null;
  }

  const stateKey = hashKey([
    "rooster.filmcraft/v1",
    htmlKey({
      plan,
      theme,
      version: VERSION,
      engine,
      engineVersion: `${engine}-${elementEngineVersion};filmcraft-${filmcraftVersion || "unknown"}`,
    }),
    baseKey,
    { width: Number(format.width) || 1920, height: Number(format.height) || 1080, fps, duration: plannedDuration },
  ]);
  const stateFilesOk = state
    ? [state.base?.path, ...Object.values(state.elements || {}).map((element) => element.file)]
        .filter(Boolean)
        .every((file) => exists(file))
    : false;
  if (
    args["if-needed"] &&
    !args.force &&
    !args["rebuild-media"] &&
    state?.key === stateKey &&
    stateFilesOk &&
    exists(paths.projectFile)
  ) {
    heading(`Build up to date — ${project.slug}`);
    console.log(`  ${paths.projectFile}`);
    console.log("  Use --force or --rebuild-media to rebuild anyway.");
    return;
  }

  const base = buildMediaCached(project, plan, remapped.keeps, paths.dir, args, "assets");
  const duration = Number(base.duration) || plannedDuration;
  const finalPlan = { ...remapped.plan, duration, format: { ...format, duration } };
  const specs = elementSpecs(finalPlan, {
    projectSlug: project.slug,
    format: finalPlan.format,
    engine,
    duration,
  });
  const markers = timelineMarkers(finalPlan, {
    keeps: roundKeeps(remapped.keeps, fps),
    duration,
  }).filter((marker) => Number(marker.time) >= 0 && Number(marker.time) <= duration + 0.001);

  const rendered = renderFilmCraftElements(project, finalPlan, specs, theme, engine, args, paths);
  const captionsFile = filmCraftCaptionsFile(project);
  const nextState = syncFilmCraftProject({
    project,
    plan: finalPlan,
    keeps: roundKeeps(remapped.keeps, fps),
    base,
    baseKey,
    rendered,
    specs: specs.filter((spec) => spec.renderable),
    format: finalPlan.format,
    fps,
    duration,
    markers,
    captionsFile,
    cli,
    paths,
    state,
    args,
  });
  nextState.key = stateKey;
  writeJson(paths.statePath, nextState);

  const timeline = timelineFromPlan(finalPlan, {
    projectSlug: project.slug,
    format: finalPlan.format,
    keeps: roundKeeps(remapped.keeps, fps),
    duration,
    engine,
  });
  writeJson(path.join(project.dir, "edit", "timeline.json"), timeline);

  writeBuildState(project.dir, {
    key: stateKey,
    engine: "filmcraft",
    engineVersion: filmcraftVersion || null,
    sample: Boolean(plan.sample),
    media: { kind: base.kind, duration },
    createdAt: now(),
  });

  const updated = {
    ...project.config,
    engine,
    timeline: "filmcraft",
    status: "preview",
    updatedAt: now(),
    pipeline: Array.from(new Set([...(project.config.pipeline || []), "plan", engine, "filmcraft"])),
  };
  writeJson(path.join(project.dir, "project.json"), updated);

  const cachedCount = rendered.filter((item) => item.cached).length;
  const renderedSpecs = specs.filter((spec) => spec.renderable);
  const maxTrack = renderedSpecs.length ? Math.max(...renderedSpecs.map((spec) => spec.trackIndex)) : 1;
  heading(`Built FilmCraft timeline — ${project.slug}`);
  console.log(`  project:  ${paths.projectFile}`);
  console.log(`  base:     ${base.kind} · ${duration.toFixed(2)}s`);
  console.log(`  elements: ${rendered.length} (${cachedCount} cached) · ${specs.filter((spec) => !spec.renderable).length} skipped`);
  console.log(`  tracks:   V1${maxTrack >= 2 ? `–V${maxTrack}` : ""} · A1`);
  console.log(`  markers:  ${markers.length}`);
  console.log("\nNext:");
  console.log(`  node "${path.join(SKILL_ROOT, "scripts", "rooster.mjs")}" timeline ${project.slug} --open`);
  console.log(`  node "${path.join(SKILL_ROOT, "scripts", "rooster.mjs")}" render ${project.slug} --draft`);
  console.log(`  node "${path.join(SKILL_ROOT, "scripts", "rooster.mjs")}" build ${project.slug} --if-needed   # only changed elements`);
}

function buildCommand(args) {
  const project = resolveProject(args._[0]);
  if (!exists(project.dir)) fail(`Project directory not found: ${project.dir}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  if (!exists(planPath)) {
    fail(`No edit/plan.json found at ${planPath}. Run transcribe and write the plan first.`);
  }

  const plan = readJson(planPath, null);
  const { errors, warnings } = validatePlan(plan, project.dir);
  if (errors.length) {
    fail(`The plan has ${errors.length} error(s):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const noVisualElements = warnings.find((warning) => warning.startsWith("plan: no visual elements"));
  if (noVisualElements && !args["allow-cut-only"]) {
    fail(
      "This plan has no visual elements. Add letreiros, b-roll, or graphics, or record a clean-cut request in notes.\n" +
        "To build a deliberate clean cut, pass --allow-cut-only."
    );
  }
  const noMusic = warnings.find((warning) => warning.startsWith("plan: no music"));
  if (noMusic && !args["allow-no-music"]) {
    fail(
      "This plan has no music. Add a track to edit/plan.json or record \"no music requested\" in notes.\n" +
        "To build intentionally without music, pass --allow-no-music."
    );
  }
  const missingMusic = warnings.find((warning) => warning.startsWith("plan: music not found"));
  if (missingMusic) {
    fail(`Music file not found. ${missingMusic}\nFix music.src in edit/plan.json before building.`);
  }

  const requestedTarget = typeof args.target === "string" ? args.target : null;
  if (requestedTarget && !TARGET_IDS.includes(requestedTarget)) {
    fail(`Unknown target "${requestedTarget}". Use auto, hyperframes, remotion, or filmcraft.`);
  }
  if (args.engine === "filmcraft" && !requestedTarget) args.target = "filmcraft";
  const projectTimeline = project.config.timeline || "none";
  const target =
    requestedTarget && requestedTarget !== "auto"
      ? requestedTarget
      : projectTimeline === "filmcraft"
        ? "filmcraft"
        : null;

  if (target && target !== "filmcraft" && args.engine && args.engine !== target) {
    fail(`Conflicting build targets: --target ${target} and --engine ${args.engine}.`);
  }

  const sampleWanted = args.sample === true ? 3 : Number(args.sample);
  const isSample = Number.isFinite(sampleWanted) && sampleWanted > 0;
  const buildPlan = isSample ? buildSamplePlan(plan, sampleWanted, args) : plan;

  if (target === "filmcraft") {
    buildFilmCraft(project, buildPlan, args);
    return;
  }

  let engine = target || (typeof args.engine === "string" ? args.engine : project.config.engine || "auto");
  if (engine === "auto") {
    const has3d = (plan.elements || []).some((element) => /3d/i.test(String(element.type || "")));
    engine = has3d ? "remotion" : "hyperframes";
  }
  if (!["hyperframes", "remotion"].includes(engine)) {
    fail(`Engine "${engine}" is not a creative build target. Use hyperframes or remotion (FFmpeg is a media utility).`);
  }

  const engineDir = path.join(project.dir, "engine", engine);
  const theme = themeFromProfile(resolveProfile(project.config.profile));
  const resolvedEngine = engineVersion(engine, {
    workspace: WORKSPACE,
    cwd: engineDir,
    home: ROOSTER_HOME,
    projectDir: engineDir,
  });
  const stateKey = `${htmlKey({
    plan: buildPlan,
    theme,
    version: VERSION,
    engine,
    engineVersion: resolvedEngine?.version || "unknown",
  })}:${planMediaKey(project, buildPlan, planForBuild(buildPlan, args).keeps, args).mediaKey}`;

  if (args["if-needed"]) {
    const state = readBuildState(project.dir);
    if (!args.force && state?.key === stateKey && exists(engineDir)) {
      heading(`Build up to date — ${project.slug}`);
      console.log(`  ${engineDir}`);
      console.log("  Use --force or --rebuild-media to rebuild anyway.");
      return;
    }
    args.force = true;
  }

  const result = engine === "hyperframes" ? buildHyperFrames(project, buildPlan, args) : buildRemotion(project, buildPlan, args);
  writeBuildState(project.dir, {
    key: stateKey,
    engine,
    engineVersion: resolvedEngine?.version || null,
    sample: isSample,
    media: { kind: result.base.kind, duration: result.duration },
    createdAt: now(),
  });

  const updated = {
    ...project.config,
    engine,
    timeline: "none",
    status: "preview",
    updatedAt: now(),
    pipeline: Array.from(new Set([...(project.config.pipeline || []), "plan", engine])),
  };
  writeJson(path.join(project.dir, "project.json"), updated);

  heading(`Built ${engine} project${isSample ? " (sample)" : ""}`);
  console.log(`  ${result.engineDir}`);
  console.log(`  Media: ${result.base.kind} · ${result.duration.toFixed(2)}s`);
  if (isSample) {
    console.log(`  Sample: ${buildPlan.elements.length} of ${(plan.elements || []).length} element(s)`);
    console.log("  Approve these elements, then rebuild with --force for the full set.");
  }
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

let ffprobeVersionMemo;

function ffprobeVersion() {
  if (ffprobeVersionMemo === undefined) {
    ffprobeVersionMemo = versionOf("ffprobe", ["-version"]);
  }
  return ffprobeVersionMemo;
}

function probeMedia(file, options = {}) {
  const resolved = path.resolve(String(file));
  const key = probeKey(resolved, { ffprobeVersion: ffprobeVersion() });
  if (!key) return { error: `Could not stat ${resolved}` };

  if (!options.refresh) {
    const hit = readCache(
      "probes",
      key,
      ".json",
      (candidate) => {
        const data = readJson(candidate, null);
        return Boolean(data && !data.error);
      },
      WORKSPACE
    );
    if (hit) {
      const data = readJson(hit, null);
      if (data) return data;
    }
  }

  const result = run("ffprobe", buildProbeArgs(resolved));
  if (!result.ok) return { error: result.stderr || "ffprobe failed" };

  const data = parseProbeJson(result.stdout);
  if (!data.error) {
    try {
      withCache({
        kind: "probes",
        key,
        ext: ".json",
        workspace: WORKSPACE,
        produce: (tmp) => fs.writeFileSync(tmp, JSON.stringify(data) + "\n", "utf8"),
        meta: { file: resolved, ffprobeVersion: ffprobeVersion() },
      });
    } catch {
      // A probe cache failure must not break the command.
    }
  }
  return data;
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
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);

  const planPath = path.join(project.dir, "edit", "plan.json");
  const timelinePath = path.join(project.dir, "edit", "timeline.json");
  const plan = exists(planPath) ? readJson(planPath, null) : null;
  const timeline = exists(timelinePath) ? readJson(timelinePath, null) : null;
  if (!plan && !timeline) {
    fail("No edit/plan.json or edit/timeline.json found. Build the plan before previewing.");
  }

  const planCheck = plan ? validatePlan(plan, project.dir) : { errors: [], warnings: [] };
  const timelineCheck = timeline ? validateTimeline(timeline, project.dir) : { errors: [], warnings: [] };
  const validation = {
    errors: [...planCheck.errors, ...timelineCheck.errors],
    warnings: [...planCheck.warnings, ...timelineCheck.warnings],
  };
  const manifest = readJson(path.join(project.dir, "assets", "manifest.json"), { assets: [] });
  const outDir = path.join(project.dir, "preview");
  const htmlPath = path.join(outDir, "index.html");

  ensureDir(outDir);
  writeText(htmlPath, previewHtml(project, plan, timeline, validation, manifest));

  heading("Preview");
  console.log(`  ${htmlPath}`);
  if (validation.errors.length) console.log(`  ! ${validation.errors.length} validation error(s) — review before rendering.`);
  if (validation.warnings.length) console.log(`  ! ${validation.warnings.length} warning(s).`);

  const engineDir = path.join(project.dir, "engine");
  const hyperframes = path.join(engineDir, "hyperframes");
  const remotion = path.join(engineDir, "remotion");
  const filmcraft = filmCraftPaths(project);
  if (exists(filmcraft.projectFile)) {
    console.log(`\n  Timeline: ${filmcraft.projectFile}`);
    console.log(`  Open:     node "<skill>/scripts/rooster.mjs" timeline ${project.slug} --open`);
  } else if (exists(hyperframes)) {
    console.log(`\n  Native preview: cd "${hyperframes}" && npx hyperframes preview`);
  } else if (exists(remotion)) {
    console.log(`\n  Native preview: cd "${remotion}" && npx remotion studio`);
  } else if (exists(path.join(engineDir, "ffmpeg"))) {
    console.log(`\n  Render a draft first: node "<skill>/scripts/rooster.mjs" render ${project.slug} --draft`);
  }

  if (args.open) openPath(htmlPath);
}

function previewHtml(project, plan, timeline, validation, manifest) {
  const name = project.config.name || project.slug;
  const format = timeline?.format || project.config.format || plan?.format || {};
  const duration = Number(timeline?.format?.duration || plan?.duration || format.duration) || 0;
  const fps = Number(format.fps) || 30;
  const previewDir = path.join(project.dir, "preview");
  const mediaCandidates = [
    { label: "Draft", file: path.join(project.dir, "renders", "draft.mp4") },
    { label: "Final", file: path.join(project.dir, "renders", "final.mp4") },
    { label: "Source", file: plan?.source ? path.resolve(project.dir, plan.source) : null },
  ].filter((entry) => entry.file && exists(entry.file) && /\.(mp4|webm|mov|m4v)$/i.test(entry.file));
  const media = mediaCandidates[0] || null;
  const mediaRel = media ? encodeURI(path.relative(previewDir, media.file).replace(/\\/g, "/")) : null;
  const seek = (value) => `<a href="#" onclick="seek(${Number(value) || 0});return false">${formatClock(value)}</a>`;
  const timeCell = (value) => (mediaRel ? seek(value) : formatClock(value));

  const cuts = (plan?.cuts || [])
    .map(
      (cut) =>
        `<tr><td>${timeCell(cut.start)} – ${formatClock(cut.end)}</td><td>${htmlEscape(cut.reason || "")}</td><td>${htmlEscape(cut.note || "")}</td></tr>`
    )
    .join("");
  const elements = (plan?.elements || [])
    .map(
      (element) =>
        `<tr><td>${timeCell(element.start)} – ${formatClock(element.end)}</td><td>${htmlEscape(element.type || "")}</td><td>${htmlEscape(element.text || "")}</td><td>${htmlEscape(element.description || "")}</td></tr>`
    )
    .join("");
  const chapters = (plan?.chapters || [])
    .map((chapter) => `<tr><td>${timeCell(chapter.start)}</td><td>${htmlEscape(chapter.title || "")}</td></tr>`)
    .join("");

  const tracks = (timeline?.tracks || [])
    .map((track) => {
      const clips = (track.clips || [])
        .map(
          (clip) =>
            `<li><strong>${formatClock(clip.start)} – ${formatClock(clip.end)}</strong> · ${htmlEscape(clip.id || clip.src || clip.scene || "clip")}${clip.src ? ` <span class="muted">${htmlEscape(clip.src)}</span>` : ""}</li>`
        )
        .join("");
      return `<div class="track"><h3>${htmlEscape(track.id || track.kind || "track")} · ${htmlEscape(track.kind || "")}</h3>${clips ? `<ul>${clips}</ul>` : `<p class="muted">No clips.</p>`}</div>`;
    })
    .join("");

  const captionsDir = path.join(project.dir, "edit", "captions");
  const captions = exists(captionsDir)
    ? fs
        .readdirSync(captionsDir)
        .filter((file) => /\.(srt|vtt|json)$/i.test(file))
        .map((file) => `<li>${htmlEscape(file)}</li>`)
        .join("")
    : "";
  const voiceover = readJson(path.join(project.dir, "edit", "voiceover.json"), null);
  const voiceLines = Array.isArray(voiceover?.lines) ? voiceover.lines.length : 0;
  const manifestAssets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const missingAssets = manifestAssets.filter((asset) => asset.path && !exists(path.resolve(project.dir, asset.path)));
  const rendersDir = path.join(project.dir, "renders");
  const renders = exists(rendersDir)
    ? fs
        .readdirSync(rendersDir)
        .filter((file) => /\.(mp4|mov|webm|jpg|png)$/i.test(file))
        .map((file) => `<li>${htmlEscape(file)}</li>`)
        .join("")
    : "";

  const issueList = (items, className) =>
    items.length ? `<ul class="${className}">${items.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>` : `<p class="muted">None.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Preview — ${htmlEscape(name)}</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0f19; --card:#121826; --line:#263041; --fg:#f8fafc; --muted:#94a3b8; --accent:#22d3ee; --danger:#fb7185; --warn:#fbbf24; }
    * { box-sizing:border-box; }
    body { margin:0; padding:32px; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width:1200px; margin:0 auto; }
    h1 { margin:0 0 6px; font-size:30px; letter-spacing:-.03em; }
    h2 { margin:0 0 12px; font-size:18px; }
    h3 { margin:0 0 6px; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    a { color:var(--accent); }
    .meta { color:var(--muted); margin-bottom:22px; }
    .grid { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr); gap:20px; align-items:start; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:18px; }
    video { width:100%; border-radius:10px; background:#000; display:block; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
    th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
    tr:last-child td { border-bottom:0; }
    ul { margin:0; padding-left:18px; }
    li { margin:4px 0; }
    .muted { color:var(--muted); }
    .track { border-top:1px solid var(--line); padding-top:10px; margin-top:10px; }
    .track:first-child { border-top:0; padding-top:0; margin-top:0; }
    .pill { display:inline-block; padding:2px 8px; border:1px solid var(--line); border-radius:999px; color:var(--muted); font-size:12px; }
    .errors { color:var(--danger); }
    .warnings { color:var(--warn); }
    .gate { border-left:3px solid var(--accent); background:rgba(34,211,238,.06); padding:14px 16px; border-radius:8px; }
    button { background:var(--accent); color:#061018; border:0; border-radius:8px; padding:10px 14px; font-weight:700; cursor:pointer; }
    .checklist label { display:block; margin:6px 0; color:var(--muted); }
    .checklist input { margin-right:8px; }
    @media (max-width: 900px) { .grid { grid-template-columns:1fr; } body { padding:18px; } }
  </style>
</head>
<body>
<main>
  <h1>Preview</h1>
  <p class="meta">${htmlEscape(name)} · ${format.width || 1920}×${format.height || 1080} · ${fps} fps · ${formatClock(duration)} · engine <span class="pill">${htmlEscape(project.config.engine || "auto")}</span></p>

  <div class="grid">
    <div>
      <section class="card">
        <h2>Player</h2>
        ${mediaRel ? `<video id="player" controls preload="metadata" src="${mediaRel}"></video><p class="muted">${htmlEscape(media.label)}: ${htmlEscape(path.basename(media.file))}</p>` : `<p class="muted">No video render yet. Render a draft or use the native engine preview.</p>`}
      </section>

      <section class="card">
        <h2>Plano</h2>
        <p>${htmlEscape(plan?.summary || "No plan summary.")}</p>
        <p class="muted">${(plan?.cuts || []).length} cut(s) · ${(plan?.elements || []).length} element(s) · ${(plan?.chapters || []).length} chapter(s)</p>
      </section>

      <section class="card">
        <h2>Cortes</h2>
        ${cuts ? `<table><thead><tr><th>Tempo</th><th>Motivo</th><th>Nota</th></tr></thead><tbody>${cuts}</tbody></table>` : `<p class="muted">No cuts.</p>`}
      </section>

      <section class="card">
        <h2>Elementos</h2>
        ${elements ? `<table><thead><tr><th>Tempo</th><th>Tipo</th><th>Texto</th><th>Descrição</th></tr></thead><tbody>${elements}</tbody></table>` : `<p class="muted">No elements.</p>`}
      </section>

      <section class="card">
        <h2>Timeline</h2>
        ${tracks || `<p class="muted">No timeline.json yet.</p>`}
      </section>
    </div>

    <aside>
      <section class="card">
        <h2>Validação</h2>
        <h3>Erros</h3>
        ${issueList(validation.errors, "errors")}
        <h3>Warnings</h3>
        ${issueList(validation.warnings, "warnings")}
        ${exists(path.join(project.dir, "qa", "report.md")) ? `<p class="muted">QA: <a href="../qa/report.md">qa/report.md</a></p>` : ""}
        ${exists(path.join(project.dir, "style", "proof", "index.html")) ? `<p class="muted">Style proof: <a href="../style/proof/index.html">style/proof/index.html</a></p>` : ""}
      </section>

      <section class="card">
        <h2>Assets e áudio</h2>
        <p class="muted">${manifestAssets.length} asset(s) no manifest · ${missingAssets.length} faltando</p>
        ${missingAssets.length ? `<ul class="errors">${missingAssets.map((asset) => `<li>${htmlEscape(asset.path)}</li>`).join("")}</ul>` : ""}
        <p class="muted">Música: ${htmlEscape(plan?.music?.src || "nenhuma")}</p>
        <p class="muted">Voz: ${voiceLines} linha(s) em voiceover.json</p>
        <h3>Legendas</h3>
        ${captions ? `<ul>${captions}</ul>` : `<p class="muted">None.</p>`}
        <h3>Renders</h3>
        ${renders ? `<ul>${renders}</ul>` : `<p class="muted">None.</p>`}
      </section>

      <section class="card checklist">
        <h2>QA checklist</h2>
        <label><input type="checkbox" /> Assisti ao draft inteiro uma vez</label>
        <label><input type="checkbox" /> Textos em tela revisados</label>
        <label><input type="checkbox" /> Nenhum corte no meio de palavra</label>
        <label><input type="checkbox" /> Áudio sem clipping e no loudness alvo</label>
        <label><input type="checkbox" /> Legendas sincronizadas e na safe area</label>
        <label><input type="checkbox" /> Assets e licenças conferidos</label>
        <label><input type="checkbox" /> Hook nos primeiros 3 segundos</label>
        <label><input type="checkbox" /> CTA e ritmo conferem com o plano</label>
      </section>

      <section class="card gate">
        <h2>Aprovação</h2>
        <p class="muted">Revise o player, o plano e a timeline. A aprovação final continua no chat.</p>
        <button onclick="approve()">Copiar aprovação</button>
      </section>
    </aside>
  </div>
</main>
<script>
  const player = document.getElementById('player');
  function seek(seconds) {
    if (!player) return;
    player.currentTime = Math.max(0, Number(seconds) || 0);
    player.play().catch(() => {});
    player.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function approve() {
    const text = 'Preview aprovado. Pode seguir para o render final.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        document.querySelector('.gate button').textContent = 'Copiado';
      }).catch(() => prompt('Copie a mensagem:', text));
    } else {
      prompt('Copie a mensagem:', text);
    }
  }
</script>
</body>
</html>
`;
}

function exportCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  const planPath = path.join(project.dir, "edit", "plan.json");
  if (!exists(planPath)) fail(`No edit/plan.json found at ${planPath}. Write the plan first.`);
  const plan = readJson(planPath, null);
  if (!plan) fail(`Invalid plan JSON at ${planPath}.`);
  if (!plan.source) fail("The plan has no source. Set source in edit/plan.json.");
  const { errors } = validatePlan(plan, project.dir);
  if (errors.length) fail(`The plan has ${errors.length} error(s):\n${errors.map((error) => `- ${error}`).join("\n")}`);

  const requested = String(args.format || "both").toLowerCase();
  if (!["edl", "fcpxml", "both"].includes(requested)) {
    fail(`Unsupported format "${requested}". Use --format edl, fcpxml, or both.`);
  }
  const source = path.resolve(project.dir, plan.source || "");
  if (!exists(source)) fail(`Plan source not found: ${source}`);
  const fps = Number(args.fps) || Number(plan.format?.fps) || Number(project.config.format?.fps) || 30;
  const keeps = keepsFromPlan(plan);
  const outDir = path.join(project.dir, "edit", "export");
  const files = [];

  ensureDir(outDir);
  if (requested === "edl" || requested === "both") {
    const file = path.join(outDir, "cuts.edl");
    writeText(file, edlText(project, plan, keeps, fps));
    files.push(file);
  }
  if (requested === "fcpxml" || requested === "both") {
    const file = path.join(outDir, "timeline.fcpxml");
    writeText(file, fcpxmlText(project, plan, keeps, fps));
    files.push(file);
  }
  writeText(path.join(outDir, "README.md"), exportReadme(project, plan, keeps, fps));

  heading("NLE export");
  for (const file of files) console.log(`  ${file}`);
  console.log(`  ${path.join(outDir, "README.md")}`);
  console.log("\n  Import the EDL/FCPXML in DaVinci Resolve or Premiere.");
  console.log("  EDL is cuts-only; FCPXML is the track/overlay handoff. The plan remains the source of truth.");
}

function editTimecode(seconds, fps) {
  const totalFrames = Math.max(0, Math.round(Number(seconds) * fps));
  const rate = Math.max(1, Math.round(fps));
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function edlReel(plan) {
  const base = path.basename(String(plan.source || "rooster")).replace(/\.[^.]+$/, "");
  const clean = base.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean || "ROOSTER";
}

function edlText(project, plan, keeps, fps) {
  const title = String(project.config.name || project.slug).replace(/\r?\n/g, " ");
  const clip = path.basename(String(plan.source || "source"));
  const reel = edlReel(plan);
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  let record = 0;
  keeps.forEach((keep, index) => {
    const sourceIn = editTimecode(keep.start, fps);
    const sourceOut = editTimecode(keep.end, fps);
    const recordIn = editTimecode(record, fps);
    const recordOut = editTimecode(record + (keep.end - keep.start), fps);
    lines.push(
      `${String(index + 1).padStart(3, "0")}  ${reel.padEnd(8, " ")} V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`
    );
    lines.push(`* FROM CLIP NAME: ${clip}`);
    if (keep.reason) lines.push(`* COMMENT: ${String(keep.reason).replace(/\r?\n/g, " ")}`);
    lines.push("");
    record += keep.end - keep.start;
  });
  return lines.join("\n");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fcpxmlTime(seconds, fps) {
  const frames = Math.max(0, Math.round(Number(seconds) * fps));
  return `${frames}/${Math.max(1, Math.round(fps))}s`;
}

function fcpxmlText(project, plan, keeps, fps) {
  const source = path.resolve(project.dir, plan.source);
  const probe = probeMedia(source) || {};
  const width = Number(plan.format?.width) || Number(project.config.format?.width) || probe.width || 1920;
  const height = Number(plan.format?.height) || Number(project.config.format?.height) || probe.height || 1080;
  const sourceDuration = Math.max(...keeps.map((keep) => keep.end), Number(plan.duration) || 0);
  const total = keeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0);
  const assetId = "r2";
  const formatId = "r1";
  const clipName = path.basename(String(plan.source || "source"));
  const mediaUrl = pathToFileURL(source).href;
  let recordStart = 0;
  const clips = keeps
    .map((keep) => {
      const duration = keep.end - keep.start;
      const line = `            <asset-clip ref="${assetId}" offset="${fcpxmlTime(recordStart, fps)}" start="${fcpxmlTime(keep.start, fps)}" duration="${fcpxmlTime(duration, fps)}" name="${xmlEscape(clipName)}" />`;
      recordStart += duration;
      return line;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="${formatId}" name="Rooster ${width}x${height} ${Math.round(fps)}p" frameDuration="${fcpxmlTime(1 / fps, fps)}" width="${width}" height="${height}" />
    <asset id="${assetId}" name="${xmlEscape(clipName)}" start="0s" duration="${fcpxmlTime(sourceDuration, fps)}" hasVideo="${probe.width ? 1 : 0}" hasAudio="${probe.audio ? 1 : 0}" format="${formatId}">
      <media-rep kind="original-media" src="${xmlEscape(mediaUrl)}" />
    </asset>
  </resources>
  <library>
    <event name="RoosterEdit">
      <project name="${xmlEscape(project.config.name || project.slug)}">
        <sequence format="${formatId}" duration="${fcpxmlTime(total, fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

function exportReadme(project, plan, keeps, fps) {
  return `# NLE export — ${project.config.name || project.slug}

Generated from \`edit/plan.json\`. The plan remains the source of truth; this is a handoff, not a new edit.

- \`cuts.edl\` — CMX 3600, cuts only. Import in DaVinci Resolve or Premiere, then relink the source media if asked.
- \`timeline.fcpxml\` — basic FCPXML 1.10 with the same cuts on a single video track. Overlays, music, and captions are not included.

## DaVinci Resolve

1. Open the project and create a timeline with the same frame rate (${Math.round(fps)} fps).
2. File > Import > Timeline, or drag the file into the media pool.
3. Relink the source file if the path changed.
4. Add overlays, music, and captions from \`edit/plan.json\` and \`edit/timeline.json\`.

## Premiere Pro

1. File > Import, select the EDL or FCPXML.
2. Relink the source file if needed.

## Limits

- EDL does not carry overlays, effects, captions, or music.
- FCPXML here is intentionally minimal; complex effects remain engine-side.
- Non-integer frame rates and drop-frame timecode need manual review.
- Keep the original source in \`${plan.source || "assets/source"}\`.

The full edit is still reproducible with:

\`\`\`bash
node "<skill>/scripts/rooster.mjs" build ${project.slug} --engine hyperframes
\`\`\`
`;
}


function renderFilmCraftTimeline(project, plan, args, paths) {
  const found = filmCraftCliOrFail();
  const cli = found.cli;
  const config = project.config || {};

  const quality = String(args.quality || (args.final ? "final" : "draft")).toLowerCase();
  if (!["draft", "final", "delivery", "high"].includes(quality)) {
    fail(`Unknown --quality "${quality}". Use draft or final.`);
  }
  const normalizedQuality = quality === "final" || quality === "delivery" || quality === "high" ? "final" : "draft";
  const scale = normalizedQuality === "draft" ? 0.5 : 1;
  const format = plan.format || config.format || {};
  const fps = Number(format.fps) || 30;
  const width = Number(format.width) || 1920;
  const height = Number(format.height) || 1080;
  const state = readJson(paths.statePath, null);
  const duration = Number(state?.base?.duration) || Number(plan.duration) || 0;
  const outWidth = Math.max(2, Math.round(width * scale));
  const outHeight = Math.max(2, Math.round(height * scale));

  const out = args.out
    ? path.resolve(CWD, String(args.out))
    : path.join(project.dir, "renders", `${normalizedQuality}.mp4`);
  const metaPath = path.join(project.dir, "renders", `render-${normalizedQuality}.json`);
  const stat = fs.statSync(paths.projectFile);
  const version = filmCraftVersion(cli);
  const key = renderKey({
    htmlKey: hashKey([state?.key || "", stat.size, stat.mtimeMs, plan, normalizedQuality]),
    quality: normalizedQuality,
    fps,
    width: outWidth,
    height: outHeight,
    engine: "filmcraft",
    engineVersion: version || "unknown",
  });

  const existing = readRenderMeta(metaPath);
  if (!args.force && existing?.key === key && exists(out)) {
    heading(`Render ${normalizedQuality} — cache hit`);
    console.log(`  ${out}`);
    console.log(`  key: ${key}`);
    if (args.json) console.log(JSON.stringify({ ...existing, cached: true }, null, 2));
    return;
  }

  heading(`Render ${normalizedQuality} — ${project.slug}`);
  console.log(`  engine: filmcraft ${version || ""}`.trim());
  console.log(`  project: ${paths.projectFile}`);
  console.log(`  out:    ${out}`);

  const started = Date.now();
  const exported = filmCraftExport(cli, paths.projectFile, out, {
    format: "h264",
    range: "entire",
    scale,
    quality: normalizedQuality === "draft" ? 65 : 90,
    audio: true,
    wait: true,
  });
  if (exported?.ok === false || exported?.error) {
    fail(`FilmCraft export failed:\n${exported.error || exported.stderr || exported.stdout || "unknown error"}`);
  }

  const probe = probeMedia(out) || { error: "probe failed" };
  const validation = validateRenderProbe(probe, {
    width: outWidth,
    height: outHeight,
    fps,
    duration: duration || undefined,
    requireAudio: false,
  });
  for (const issue of validation.issues) console.warn(`  ! ${issue}`);

  const bytes = exists(out) ? fs.statSync(out).size : 0;
  const meta = {
    schema: "rooster.render/v1",
    key,
    quality: normalizedQuality,
    engine: "filmcraft",
    engineVersion: version || null,
    projectFile: paths.projectFile,
    out,
    bytes,
    duration: Number(probe.duration) || null,
    elapsedMs: Date.now() - started,
    logPath: null,
    probe,
    validation,
    createdAt: now(),
  };
  writeRenderMeta(metaPath, meta);

  const status = normalizedQuality === "final" ? "done" : "preview";
  writeJson(path.join(project.dir, "project.json"), {
    ...config,
    status,
    updatedAt: now(),
    pipeline: Array.from(new Set([...(config.pipeline || []), "filmcraft", "render"])),
  });

  heading(`Rendered ${normalizedQuality}`);
  console.log(`  ${out}`);
  console.log(`  ${formatBytes(bytes)} · ${Number(probe.duration)?.toFixed(2) || "?"}s · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  ${metaPath}`);
  if (args.json) console.log(JSON.stringify(meta, null, 2));
}

async function render(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(project.dir)) fail(`Project "${project.slug}" not found.`);

  const config = project.config || {};
  const planPath = path.join(project.dir, "edit", "plan.json");
  const plan = exists(planPath) ? readJson(planPath, null) : null;
  if (!plan) fail(`No edit/plan.json at ${planPath}. Run build first.`);

  const filmcraftPaths = filmCraftPaths(project);
  const wantsFilmCraft =
    config.timeline === "filmcraft" || args.target === "filmcraft" || args.engine === "filmcraft";
  if (wantsFilmCraft) {
    if (!exists(filmcraftPaths.projectFile)) {
      fail(
        `FilmCraft timeline not found at ${filmcraftPaths.projectFile}.\n` +
          `Run build ${project.slug} --target filmcraft first.`
      );
    }
    renderFilmCraftTimeline(project, plan, args, filmcraftPaths);
    return;
  }

  const hfDir = path.join(project.dir, "engine", "hyperframes");
  const remotionDir = path.join(project.dir, "engine", "remotion");
  let engine = typeof args.engine === "string" ? args.engine : config.engine || "auto";
  if (engine === "auto") {
    engine = exists(hfDir) ? "hyperframes" : exists(remotionDir) ? "remotion" : null;
  }
  if (!engine) {
    fail("No engine project found. Run build <slug> first (or pass --engine hyperframes|remotion).");
  }
  if (!["hyperframes", "remotion"].includes(engine)) {
    fail(`Engine "${engine}" cannot render here. Use hyperframes or remotion.`);
  }

  const engineDir = path.join(project.dir, "engine", engine);
  if (!exists(engineDir)) {
    fail(`Engine project not found at ${engineDir}. Run build ${project.slug} --engine ${engine}.`);
  }

  const quality = String(args.quality || (args.final ? "final" : "draft")).toLowerCase();
  if (!["draft", "final", "delivery", "high"].includes(quality)) {
    fail(`Unknown --quality "${quality}". Use draft or final.`);
  }
  const normalizedQuality = quality === "final" || quality === "delivery" || quality === "high" ? "final" : "draft";

  const format = plan.format || config.format || {};
  const fps = Number(format.fps) || 30;
  const width = Number(format.width) || 1920;
  const height = Number(format.height) || 1080;
  const duration = Number(plan.duration) || 0;

  const profile = resolveProfile(config.profile);
  const theme = themeFromProfile(profile);
  const info = engineVersion(engine, {
    workspace: WORKSPACE,
    cwd: engineDir,
    home: ROOSTER_HOME,
    projectDir: engineDir,
  });
  if (!info || !info.bin) {
    if (engine === "hyperframes") {
      fail("HyperFrames not found. Install it with `npm install --prefix <workspace>/cache/tools hyperframes` or use npx once.");
    }
    fail(`Remotion not found in ${engineDir}. Run npm install in that directory.`);
  }

  const sourceKey = htmlKey({
    plan,
    theme,
    version: VERSION,
    engine,
    engineVersion: info.version || "unknown",
  });
  const buildState = readBuildState(project.dir);
  const compositionKey = buildState?.key || sourceKey;
  const key = renderKey({
    htmlKey: compositionKey,
    quality: normalizedQuality,
    fps,
    width,
    height,
    engine,
    engineVersion: info.version || "unknown",
  });
  const expectedDuration =
    Number(buildState?.media?.duration) > 0 ? Number(buildState.media.duration) : duration;

  const out = args.out
    ? path.resolve(CWD, String(args.out))
    : path.join(project.dir, "renders", `${normalizedQuality}.mp4`);
  const metaPath = path.join(project.dir, "renders", `render-${normalizedQuality}.json`);
  const existing = readRenderMeta(metaPath);
  if (!args.force && existing?.key === key && exists(out)) {
    heading(`Render ${normalizedQuality} — cache hit`);
    console.log(`  ${out}`);
    console.log(`  key: ${key}`);
    if (args.json) {
      console.log(JSON.stringify({ ...existing, cached: true }, null, 2));
    }
    return;
  }

  const logPath = path.join(project.dir, "work", "logs", `render-${normalizedQuality}.log`);
  const framesCacheDir =
    typeof args["frames-cache-dir"] === "string"
      ? path.resolve(CWD, args["frames-cache-dir"])
      : path.join(cacheRoot(WORKSPACE), "hyperframes-frames");

  let command;
  let commandArgs;
  if (engine === "hyperframes") {
    const invocation = hyperFramesRenderArgs({
      bin: info.bin,
      out,
      quality: normalizedQuality,
      workers: args.workers !== undefined ? args.workers : "auto",
      resume: Boolean(args.resume),
      gpu: Boolean(args.gpu),
      framesCacheDir,
      videoFrameFormat: args["video-frame-format"],
      start: args.start !== undefined ? Number(args.start) : undefined,
      end: args.end !== undefined ? Number(args.end) : undefined,
    });
    command = invocation.command;
    commandArgs = invocation.args;
  } else {
    const has3d = (plan.elements || []).some((element) => /3d/i.test(String(element.type || "")));
    const invocation = remotionRenderArgs({
      bin: info.bin,
      entry: args.entry || "src/index.ts",
      composition: args.composition || "RoosterVideo",
      out,
      quality: normalizedQuality,
      concurrency: args.concurrency,
      gl: args.gl || (has3d ? "angle" : undefined),
      frames: args.frames,
      log: args.log,
    });
    command = invocation.command;
    commandArgs = invocation.args;
  }

  if (args.print) {
    console.log([command, ...commandArgs].map((part) => (/\s/.test(String(part)) ? `"${part}"` : part)).join(" "));
    return;
  }

  ensureDir(path.dirname(out));
  ensureDir(path.dirname(logPath));

  heading(`Render ${normalizedQuality} — ${project.slug}`);
  console.log(`  engine: ${engine} ${info.version || ""}`.trim());
  console.log(`  out:    ${out}`);
  console.log(`  log:    ${logPath}`);

  let lastPercent = -10;
  const timeout =
    Number(args.timeout) > 0
      ? Number(args.timeout)
      : Math.max(10 * 60 * 1000, (expectedDuration || 60) * 4 * 1000);

  const result = await runRender({
    command,
    args: commandArgs,
    cwd: engineDir,
    logPath,
    timeout,
    onProgress: (line) => {
      const progress = parseRenderProgress(line);
      if (!progress) return;
      if (progress.percent !== null && progress.percent >= lastPercent + 5) {
        lastPercent = progress.percent;
        console.log(`  ${progress.stage ? `${progress.stage} ` : ""}${progress.percent.toFixed(0)}%`);
      }
    },
  });

  if (!result.ok) {
    const tail = (result.stderr || result.stdout || "").split(/\r?\n/).slice(-12).join("\n");
    if (tail) console.error(tail);
    fail(`Render failed${result.timedOut ? " (timeout)" : ""}:\n  ${result.error || "unknown error"}\n  log: ${logPath}`);
  }

  const probe = probeMedia(out) || { error: "probe failed" };
  const validation = validateRenderProbe(probe, {
    width,
    height,
    fps,
    duration: expectedDuration || undefined,
    requireAudio: false,
  });
  for (const issue of validation.issues) console.warn(`  ! ${issue}`);

  const bytes = exists(out) ? fs.statSync(out).size : 0;
  const meta = {
    schema: "rooster.render/v1",
    key,
    quality: normalizedQuality,
    engine,
    engineVersion: info.version || null,
    engineDir,
    out,
    bytes,
    duration: Number(probe.duration) || null,
    elapsedMs: result.elapsedMs,
    logPath,
    probe,
    validation,
    createdAt: now(),
  };
  writeRenderMeta(metaPath, meta);

  const status = normalizedQuality === "final" ? "done" : "preview";
  writeJson(path.join(project.dir, "project.json"), {
    ...config,
    status,
    updatedAt: now(),
    pipeline: Array.from(new Set([...(config.pipeline || []), "render"])),
  });

  heading(`Rendered ${normalizedQuality}`);
  console.log(`  ${out}`);
  console.log(`  ${formatBytes(bytes)} · ${Number(probe.duration)?.toFixed(2) || "?"}s · ${(result.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  ${metaPath}`);
  if (args.json) console.log(JSON.stringify(meta, null, 2));
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
  doctor [--json] [--deep]        Detect tools, engines, TTS, and workspace
  init [--dir <path>] [--force]   Create a workspace
  new <slug> [options]            Create a project inside a channel
  open <slug> [--project] [--print] Open assets/source or the project folder
  paths <slug> [--json]           Show bruto/estilo/trabalho/final paths
  list [--json]                   List channels, projects, and profiles
  channel list|show|new|set|use   Manage channels and their defaults
  check <slug> [--json]           Validate project and timeline
  check [--json]                  Validate the root project (no slug)
  config [show|path|get|set]      Workspace defaults and asset/TTS policy
  profile list|show|fork          Reusable visual identities
  digest <slug> [--from/--to]     Compact transcript summary
  transcribe [slug] [options]     Transcribe assets/source with Whisper
  plan [slug] [--check|--show]    Validate, show, and write edit/plan.html
  textcheck <slug>                Write qa/text-review.md with on-screen text
  styleproof <slug> [--open]      Write style/proof/index.html with 3 frames
  captions <slug> [options]       Generate SRT/VTT from the transcript
  deliver <slug> [options]        Extract thumbnail and write metadata.json
  reframe <slug> [options]        Crop/scale the source to another aspect ratio
  broll <slug> [options]          Rank local b-roll and suggest plan elements
  audio <slug> [options]          Preview plan.music + plan.sfx mix
  color <slug> [options]          Apply plan.color filters to the source
  tts <slug> [options]            Build (and optionally generate) a voiceover
  multicam <slug> [options]       Normalize cameras, J/L cuts, and speed ramps
  build <slug> [options]          Build a HyperFrames, Remotion, or FilmCraft timeline from the plan
  timeline <slug> [--open]        Show or open the FilmCraft project
  filmcraft status|setup|open     Detect FilmCraft, connect MCP, open a timeline
  export <slug> [options]         Export cuts to EDL/FCPXML for DaVinci or Premiere
  ingest <slug> --url <url>       Download a link with yt-dlp
  ingest <slug> --file <path>     Copy a local media file
  preview <slug> [--open]         Write preview/index.html with player and timeline
  frames <slug> [options]         Extract QA frames and a contact sheet
  cache info|path|clear|gc        Inspect or clean the workspace cache
  render <slug> [--draft|--final] Render with the engine (cache-aware)

Ingest options:
  --confirm-rights                Required for --url; confirms you have rights
  --cookies-from-browser <name>   Pass browser cookies to yt-dlp
  --cookies <path>                Pass a cookies.txt file to yt-dlp
  --license <id>                  License for local files (default: unknown)
  --force                         Override a disabled download policy

Transcribe options:
  --input <path>                  Override the media file
  --engine <id>                   auto | parakeet | hyperframes | faster-whisper | whisper
  --quality <id>                  fast (base/beam1) | balanced (small) | accurate (medium)
  --model <name>                  Override the Whisper model
  --language <code>               Language (default: project language)
  --words <mode>                  auto | always | never (default: auto)
  --beam-size <n>                 Whisper beam size (default: 1 on fast, 5 otherwise)
  --device <id>                   auto | cpu | cuda (faster-whisper)
  --compute-type <id>             auto | int8 | float16 | float32 | int8_float16
  --refresh                       Ignore the transcript cache
  --no-cache                      Do not read or write the cache
  --verbose                       Print every transcript segment

Doctor options:
  --deep                          Probe Parakeet and deep engine details
  --refresh                       Ignore the capabilities cache

Plan options:
  --check                         Validate only
  --show                          Show the plan summary (default)
  --json                          Machine-readable output

Captions options:
  --out <dir>                     Output directory (default: edit/captions)
  --max-chars <n>                 Max characters per line (default: 42)
  --max-lines <n>                 Max lines per cue (default: 2)
  --burn <video>                  Burn captions into this video
  --out-video <path>              Output for the burned video
  --draft                         Fast burn preset (veryfast, CRF 23)
  --preset <id>                   x264 preset (default: medium; draft: veryfast)
  --crf <n>                       Burn quality (default: 18; draft: 23)
  --dry-run                       Print the burn command without running it

Delivery options:
  --video <path>                  Render to deliver (default: renders/final.mp4 or draft.mp4)
  --thumb <path>                  Thumbnail output (default: renders/thumbnail.jpg)
  --time <seconds>                Thumbnail timestamp (default: 1)

Reframe options:
  --input <path>                  Source (default: plan.source)
  --format <aspect>               16:9 | 9:16 | 1:1 | 4:5 (default: project format)
  --out <path>                    Output (default: assets/generated/reframed-<aspect>.mp4)
  --mode <id>                     center | left | right | focus
  --focus-x <0..1>                Horizontal focus for mode=focus
  --focus-y <0..1>                Vertical focus for mode=focus
  --update-plan                   Point plan.source at the reframed file

B-roll options:
  --dir <path>                    Extra directory to scan
  --tags <list>                   Comma-separated keywords
  --max <n>                       Maximum suggested elements (default: 3)
  --limit <n>                     Maximum candidates printed (default: 10)
  --write                         Append suggestions to edit/plan.json
  --refresh                       Rebuild the cached b-roll index

Frames options:
  --video <path>                  Video to sample (default: final/draft/plan.source)
  --out <dir>                     Output directory (default: qa/frames)
  --count <n>                     Number of frames (default: 12)
  --cols <n>                      Contact-sheet columns (default: 4)
  --scale <px>                    Frame width (default: 480)
  --sheet-only                    Write only the contact sheet
  --json                          Machine-readable output

Cache options:
  --max-size <size>               GC limit, e.g. 20GB (default: 20GB)
  --max-age <age>                 GC max age, e.g. 30d or 12h
  --json                          Machine-readable output

Audio mix options:
  --input <path>                  Source (default: plan.source)
  --out <path>                    Output (default: assets/generated/audio-mix.mp4)

Color options:
  --input <path>                  Source (default: plan.source)
  --out <path>                    Output (default: assets/generated/graded.mp4)
  --update-plan                   Point plan.source at the graded file
  --skip-stabilize                Skip plan.color.stabilize

TTS options:
  --script <path>                 Script source (default: script.md)
  --provider <id>                 edge-tts | hyperframes | custom
  --voice <id>                    Provider voice
  --rate <value>                  Rate, e.g. 1.1x or +10%
  --language <code>               Language (default: project language)
  --generate                      Execute TTS after explicit approval
  --concurrency <n>               Parallel provider calls (default: 3)
  --refresh                       Regenerate every line, ignoring cache

Multicam options:
  --file <path>                   JSON with cameras/cuts (default: plan.multicam)
  --render                        Cut and concat the camera segments
  --update-plan                   Point plan.source at the multicam render

Build options:
  --target <id>                   auto | hyperframes | remotion | filmcraft (default: project)
  --engine <id>                   Renderer: hyperframes | remotion (default: auto)
  --force                         Rebuild an existing engine project (archives FilmCraft)
  --if-needed                     Skip if the build state is unchanged
  --rebuild-media                 Re-run FFmpeg and element renders, ignoring the cache
  --no-cache                      Do not read or write the cache
  --encoder <id>                  libx264 | h264_amf | h264_nvenc | h264_qsv | ...
  --crf <n>                       Quality (default: 20)
  --preset <id>                   Encoder preset (default: veryfast)
  --no-cuts                       Ignore plan cuts and use the original source
  --allow-cut-only                Allow a plan with no visual elements
  --allow-no-music                Allow a plan with no music decision
  --sample <n>                    Build a short montage with n elements (default: 3)

Render options:
  --draft | --final               Quality tier (default: draft)
  --quality <id>                  draft | final (alias for the flags above)
  --out <path>                    Output (default: renders/<quality>.mp4)
  --force                         Re-render even if the cache key matches
  --workers <n|auto>              HyperFrames workers (default: auto)
  --concurrency <n|auto>          Remotion concurrency
  --gpu                           HyperFrames hardware encoding
  --resume                        HyperFrames segmented resume
  --frames <start-end>            Remotion frame range
  --gl <id>                       Remotion renderer (angle, swangle, ...)
  --frames-cache-dir <path>       Persistent HyperFrames frame cache
  --print                         Print the command without running it
  --json                          Machine-readable result
  --timeout <ms>                  Render timeout

Export options:
  --format <id>                   edl | fcpxml | both (default: both)
  --fps <n>                       Timecode frame rate (default: project/plan fps)

Style proof options:
  --open                          Open style/proof/index.html after writing

Preview options:
  --open                          Open preview/index.html after writing

New project options:
  --channel <id>                  Channel (default: workspace default)
  --name <name>                   Display name
  --profile <id>                  Profile (default: channel profile)
  --target <id>                   auto | hyperframes | remotion | filmcraft
  --engine <id>                   auto | hyperframes | remotion | ffmpeg
  --format <aspect>               16:9 | 9:16 | 1:1 | 4:5 (default: channel)
  --duration <seconds>            Target duration for this project (default: 60)
  --language <code>               Language (default: channel language)
  --source <id>                   live | generated | hybrid
  --voice <id>                    user | tts | none
  --style <id>                    user | profile | ai | reference
  --autonomy <id>                 auto | guided | manual
  --assets <id>                   user | link | library | generated | none | mixed
  --force                         Overwrite an existing project

Open options:
  --project                       Open the project root instead of assets/source
  --print                         Print the path without opening it

Channel options:
  --name <name>                   Display name
  --content <text>                What this channel produces
  --language <code>               Default language
  --format <aspect>               Default format (or auto)
  --profile <id>                  Default profile
  --source <id>                   live | generated | hybrid
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
  ROOSTER_FILMCRAFT_CLI           Path to filmcraft-cli (optional)
  ROOSTER_TTS_PROVIDER            Default TTS provider
  ROOSTER_BROWSER                 available | unavailable | unknown

Examples:
  node scripts/rooster.mjs init
  node scripts/rooster.mjs channel new en-tech --language en --format 16:9 --profile tech-neon --voice tts
  node scripts/rooster.mjs new video-x --channel en-tech --duration 60
  node scripts/rooster.mjs open en-tech/video-x
  node scripts/rooster.mjs config set assets.strategy user
  node scripts/rooster.mjs profile fork minimal --as my-brand
  node scripts/rooster.mjs digest en-tech/video-x --from 0 --to 60
  node scripts/rooster.mjs check en-tech/video-x
  node scripts/rooster.mjs ingest en-tech/video-x --url "https://youtu.be/..." --confirm-rights
  node scripts/rooster.mjs transcribe en-tech/video-x --model small --language en
  node scripts/rooster.mjs plan en-tech/video-x --show
  node scripts/rooster.mjs build en-tech/video-x --engine hyperframes
  node scripts/rooster.mjs filmcraft status
  node scripts/rooster.mjs build en-tech/video-x --target filmcraft
  node scripts/rooster.mjs timeline en-tech/video-x --open
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// timeline / filmcraft
// ---------------------------------------------------------------------------

function timelineCommand(args) {
  const project = resolveProject(projectSlugFromArg(args));
  if (!exists(path.join(project.dir, "project.json"))) fail(`Project not found: ${project.slug}`);
  const paths = filmCraftPaths(project);
  if (!exists(paths.projectFile)) {
    fail(
      `No FilmCraft timeline at ${paths.projectFile}.\n` +
        `Run build ${project.slug} --target filmcraft first.`
    );
  }
  const state = readJson(paths.statePath, null);
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          project: project.slug,
          projectFile: paths.projectFile,
          sequence: state?.sequence ?? null,
          elements: state?.elements ? Object.keys(state.elements).length : 0,
          updatedAt: state?.updatedAt ?? null,
        },
        null,
        2
      )
    );
    return;
  }

  heading(`Timeline — ${project.slug}`);
  console.log(`  ${paths.projectFile}`);
  if (state?.sequence !== undefined) console.log(`  sequence: ${state.sequence}`);
  if (state?.elements) console.log(`  elements: ${Object.keys(state.elements).length}`);
  console.log("\n  Open it in FilmCraft:");
  console.log(`  node "<skill>/scripts/rooster.mjs" timeline ${project.slug} --open`);
  if (args.open) openPath(paths.projectFile);
}

function filmcraftCommand(args) {
  const sub = typeof args._[0] === "string" ? args._[0] : "status";
  const client = args.client === "claude" ? "claude" : "opencode";

  if (sub === "status") {
    const status = filmCraftStatus({
      cwd: CWD,
      home: os.homedir(),
      env: process.env,
      platform: process.platform,
    });
    const prompt = filmCraftOnboardingPrompt(status);
    if (args.json) {
      console.log(JSON.stringify({ ...status, prompt }, null, 2));
      return;
    }
    heading("FilmCraft");
    console.log(`  installed: ${status.installed ? "yes" : "no"}`);
    if (status.cli) console.log(`  cli:       ${status.cli}`);
    if (status.app) console.log(`  app:       ${status.app}`);
    if (status.version) console.log(`  version:   ${status.version}`);
    console.log(`  source:    ${status.source || "unknown"}`);
    const mcp = status.mcp || {};
    console.log(
      `  mcp:       ${
        mcp.registered === true
          ? `configured (${mcp.client || "client"}${mcp.path ? `: ${mcp.path}` : ""})`
          : mcp.registered === false
            ? "not configured"
            : "no client config found"
      }`
    );
    if (mcp.registered === true) console.log("             restart the agent after connecting MCP");
    if (!status.installed) {
      console.log("\n  Install: https://getartcraft.com/apps/filmcraft");
      console.log("  Or continue with HyperFrames/Remotion: build <slug> --target hyperframes|remotion");
    }
    console.log(`\n  ${prompt.questionPt || prompt.question}`);
    for (const option of prompt.optionsPt?.length ? prompt.optionsPt : prompt.options) {
      console.log(`   - ${option}`);
    }
    return;
  }

  if (sub === "mcp-config" || sub === "setup") {
    const found = findFilmCraft({
      env: process.env,
      platform: process.platform,
      home: os.homedir(),
      cwd: CWD,
    });
    if (!found.cli) {
      fail(
        "FilmCraft CLI not found. Install it from https://getartcraft.com/apps/filmcraft, " +
          "or set ROOSTER_FILMCRAFT_CLI to the filmcraft-cli path."
      );
    }
    const snippet = filmCraftMcpSnippet({ client, cli: found.cli });
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            client,
            cli: found.cli,
            snippet,
            restartRequired: true,
          },
          null,
          2
        )
      );
      return;
    }
    heading(`FilmCraft MCP — ${client}`);
    console.log(`  Project config: ${client === "claude" ? path.join(CWD, ".mcp.json") : path.join(CWD, "opencode.json")}`);
    if (path.resolve(CWD) === path.resolve(SKILL_ROOT)) {
      console.log("  ! You are in the skill repository. Run this from your project/workspace to write its config.");
    }
    console.log(snippet);
    if (sub === "setup" && args.write) {
      const result = setupFilmCraftMcp({
        client,
        cli: found.cli,
        write: true,
        cwd: CWD,
        home: os.homedir(),
        env: process.env,
        platform: process.platform,
      });
      if (!result.ok) fail(result.error || "Could not write the MCP config.");
      console.log(
        result.changed
          ? `\n  Wrote: ${result.path}`
          : `\n  Already configured: ${result.path}`
      );
      console.log("  Restart the agent now.");
    } else if (sub === "setup") {
      console.log("\n  Add the snippet to your client config, or run with --write.");
    }
    return;
  }

  if (sub === "open") {
    timelineCommand({ ...args, _: args._.slice(1), open: true });
    return;
  }

  fail(`Unknown filmcraft subcommand "${sub}". Use status, setup, mcp-config, or open.`);
}

async function main() {
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
      const data = await doctor(args);
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
    case "open":
      openProject(args);
      return;
    case "paths":
      pathsCommand(args);
      return;
    case "list":
      listWorkspace(args);
      return;
    case "config":
      configCommand(args);
      return;
    case "profile":
      profileCommand(args);
      return;
    case "digest":
      digestCommand(args);
      return;
    case "check":
      if (args._[0]) checkProject(args);
      else checkRoot(args);
      return;
    case "transcribe":
      await transcribeCommand(args);
      return;
    case "plan":
      planCommand(args);
      return;
    case "textcheck":
      textcheckCommand(args);
      return;
    case "styleproof":
      styleProofCommand(args);
      return;
    case "captions":
      captionsCommand(args);
      return;
    case "deliver":
      deliverCommand(args);
      return;
    case "reframe":
      reframeCommand(args);
      return;
    case "broll":
      brollCommand(args);
      return;
    case "audio":
      audioCommand(args);
      return;
    case "color":
      colorCommand(args);
      return;
    case "tts":
      await ttsCommand(args);
      return;
    case "multicam":
      await multicamCommand(args);
      return;
    case "build":
      buildCommand(args);
      return;
    case "timeline":
      timelineCommand(args);
      return;
    case "filmcraft":
      filmcraftCommand(args);
      return;
    case "export":
      exportCommand(args);
      return;
    case "ingest":
      ingest(args);
      return;
    case "preview":
      preview(args);
      return;
    case "cache":
      cacheCommand(args);
      return;
    case "frames":
      framesCommand(args);
      return;
    case "render":
      await render(args);
      return;
    default:
      fail(`Unknown command "${command}". Run with --help for usage.`);
  }
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
