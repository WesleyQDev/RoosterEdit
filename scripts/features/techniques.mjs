/**
 * Technique catalog.
 *
 * RoosterEdit does not have one engine that does everything. Each layer of a
 * video maps to a technique, and each technique maps to the best tool that is
 * actually available on the machine. This module is pure: it receives the
 * `doctor` capabilities and returns what is usable, what is missing, and why.
 *
 * The agent asks three questions before building:
 *   1. What must the viewer see and hear?
 *   2. Which techniques produce that?
 *   3. Which of those techniques is available and cheapest here?
 */

const CATALOG = [
  {
    id: "cut",
    label: "Cut and cleanup",
    kind: "edit",
    tool: "FFmpeg",
    tags: ["edit", "cleanup", "condensed", "interview", "talking-head", "footage"],
    bestFor: "Trimming silence, removing filler, assembling real footage, punch-ins",
    requires: ["ffmpeg"],
    cost: "local, fast",
    ref: "references/edit-plan.md",
  },
  {
    id: "captions",
    label: "Captions and subtitles",
    kind: "edit",
    tool: "FFmpeg",
    tags: ["captions", "subtitles", "accessibility", "social", "shorts"],
    bestFor: "SRT/VTT, burned captions, readable cues inside the safe area",
    requires: ["ffmpeg"],
    cost: "local, fast",
    ref: "references/features/captions.md",
  },
  {
    id: "audio-mix",
    label: "Audio mix and loudness",
    kind: "audio",
    tool: "FFmpeg",
    tags: ["audio", "music", "ducking", "loudness", "mix", "voice"],
    bestFor: "Loudness normalization, music ducking, voice/SFX balance",
    requires: ["ffmpeg"],
    cost: "local, fast",
    ref: "references/features/audio.md",
  },
  {
    id: "color",
    label: "Color and finishing",
    kind: "edit",
    tool: "FFmpeg",
    tags: ["color", "grade", "lut", "stabilize", "denoise"],
    bestFor: "LUT, contrast, temperature, stabilization, denoise",
    requires: ["ffmpeg"],
    optional: ["gpu"],
    cost: "local; GPU speeds the encode",
    ref: "references/features/color.md",
  },
  {
    id: "reframe",
    label: "Vertical reframe",
    kind: "edit",
    tool: "FFmpeg",
    tags: ["vertical", "shorts", "reels", "tiktok", "crop", "face"],
    bestFor: "16:9 to 9:16 or 1:1, face-aware crop",
    requires: ["ffmpeg"],
    cost: "local, medium",
    ref: "references/features/reframe.md",
  },
  {
    id: "multicam",
    label: "Multicam",
    kind: "edit",
    tool: "FFmpeg",
    tags: ["multicam", "podcast", "interview", "cameras"],
    bestFor: "Camera selection, J/L cuts, speed ramps",
    requires: ["ffmpeg"],
    cost: "local, medium",
    ref: "references/features/multicam.md",
  },
  {
    id: "motion",
    label: "Motion graphics",
    kind: "engine",
    tool: "HyperFrames",
    tags: [
      "motion",
      "kinetic-type",
      "titles",
      "lower-third",
      "charts",
      "maps",
      "explainer",
      "faceless",
      "slides",
    ],
    bestFor: "HTML/CSS/GSAP, kinetic type, charts, maps, overlays, generated explainers",
    requires: ["hyperframes"],
    cost: "local, free; render is the expensive part",
    ref: "references/engines.md",
  },
  {
    id: "canvas",
    label: "Canvas / 2.5D camera",
    kind: "engine",
    tool: "HyperFrames",
    tags: ["parallax", "2.5d", "camera", "depth", "photo", "documentary"],
    bestFor: "Layered stills with a camera path, parallax scenes, slow push-ins",
    requires: ["hyperframes"],
    cost: "local, free",
    ref: "references/edit-plan.md",
  },
  {
    id: "three",
    label: "3D and WebGL in the browser",
    kind: "3d",
    tool: "HyperFrames + Three.js",
    tags: ["3d", "webgl", "shader", "product", "particles", "orbit", "three"],
    bestFor: "Product orbit, particles, shader backgrounds, 3D text, simple physics",
    requires: ["hyperframes"],
    optional: ["network"],
    cost: "local; a registry block needs network once",
    ref: "references/techniques/three-js.md",
  },
  {
    id: "blender",
    label: "Blender 3D",
    kind: "3d",
    tool: "Blender (headless or MCP)",
    tags: ["3d", "cgi", "simulation", "physics", "render", "product", "character", "environment"],
    bestFor: "Real 3D scenes, materials, lighting, simulation, heavy renders, asset import",
    requires: ["blender"],
    cost: "local; GPU render, heavy and slow",
    install:
      "winget install BlenderFoundation.Blender (Windows) or brew install --cask blender (macOS); ask first",
    ref: "references/techniques/blender.md",
  },
  {
    id: "ears",
    label: "Listening and sound design",
    kind: "audio",
    tool: "earshot",
    tags: ["audio", "sound-design", "sfx", "qa", "listening", "music", "critique"],
    bestFor: "Audio QA, finding the best take, matching SFX, code-generated sound, launch scorecard",
    requires: ["earshot"],
    cost: "local CPU; ~1.1 GB of models, first call is slow",
    install:
      'uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"; ask first',
    ref: "references/techniques/ears.md",
  },
  {
    id: "tts",
    label: "Voiceover",
    kind: "audio",
    tool: "TTS provider",
    tags: ["voice", "narration", "faceless", "tts", "voiceover"],
    bestFor: "Script to narration when the user has no recorded voice",
    requires: ["tts"],
    cost: "free (edge-tts) or paid (OpenAI, ElevenLabs); ask before paid",
    ref: "references/features/tts.md",
  },
  {
    id: "timeline",
    label: "Editable timeline",
    kind: "timeline",
    tool: "FilmCraft",
    tags: ["nle", "timeline", "edit-by-hand", "client", "review"],
    bestFor: "Finishing the cut by hand in an NLE while the agent prepares the base",
    requires: ["filmcraft"],
    cost: "local, free; an extra ProRes clip per element",
    ref: "references/nle-handoff.md",
  },
  {
    id: "handoff",
    label: "NLE handoff",
    kind: "handoff",
    tool: "EDL / FCPXML",
    tags: ["resolve", "premiere", "edl", "fcpxml", "handoff"],
    bestFor: "Delivering cuts and markers to DaVinci Resolve or Premiere",
    requires: ["ffmpeg"],
    cost: "local, instant",
    ref: "references/nle-handoff.md",
  },
  {
    id: "delivery",
    label: "Delivery package",
    kind: "delivery",
    tool: "RoosterEdit",
    tags: ["thumbnail", "metadata", "package", "youtube", "delivery"],
    bestFor: "Thumbnail, chapters, description, sidecar captions, metadata",
    requires: ["ffmpeg"],
    cost: "local, instant",
    ref: "references/features/delivery.md",
  },
];

function capabilityValue(caps, key) {
  const data = caps && typeof caps === "object" ? caps : {};
  switch (key) {
    case "ffmpeg":
      return Boolean(data.ffmpeg);
    case "hyperframes":
      return Boolean(
        data.hyperframes?.bin || data.hyperframesCli || data.engines?.hyperframes === "detected"
      );
    case "blender":
      return Boolean(data.blender?.installed);
    case "earshot":
      return Boolean(data.earshot?.installed);
    case "filmcraft":
      return Boolean(data.filmcraft?.installed);
    case "gpu":
      return Boolean(data.hardware?.recommended?.h264 || data.gpu);
    case "network":
      // The harness knows; the CLI does not probe the network.
      return true;
    case "tts":
      return Boolean(
        data.tts &&
          Object.values(data.tts).some((value) => value === true)
      );
    default:
      return false;
  }
}

/**
 * Resolve the catalog against `doctor --json`.
 *
 * @param {object|null} caps Capabilities from `detectCapabilities`.
 * @param {{needs?: string[]}} [options] Optional tags to filter by.
 * @returns {Array<{id:string,label:string,kind:string,tool:string,tags:string[],bestFor:string,requires:string[],optional:string[],available:boolean,missing:string[],cost:string,install:string|null,ref:string}>}
 */
export function resolveTechniques(caps, options = {}) {
  const needs = (Array.isArray(options.needs) ? options.needs : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  const rows = CATALOG.map((entry) => {
    const requires = Array.isArray(entry.requires) ? entry.requires : [];
    const optional = Array.isArray(entry.optional) ? entry.optional : [];
    const missing = requires.filter((key) => !capabilityValue(caps, key));
    return {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      tool: entry.tool,
      tags: [...entry.tags],
      bestFor: entry.bestFor,
      requires: [...requires],
      optional: [...optional],
      available: missing.length === 0,
      missing,
      optionalAvailable: optional.filter((key) => capabilityValue(caps, key)),
      cost: entry.cost,
      install: entry.install || null,
      ref: entry.ref,
    };
  });

  const filtered = needs.length
    ? rows.filter((row) => {
        const haystack = [...row.tags, row.id, row.label, row.kind]
          .join(" ")
          .toLowerCase();
        return needs.some((need) => haystack.includes(need));
      })
    : rows;

  return filtered.sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

const MOTION_TYPES = new Set([
  "letreiro",
  "grafico",
  "lista",
  "lower-third",
  "emphasis",
  "callout",
  "terminal",
  "end-card",
  "custom",
  "broll",
  "caption-emphasis",
  "zoom",
  "transition",
]);

/**
 * Derive the techniques a plan needs from its elements and project settings.
 * This is a starting point for the gate, not a replacement for the three
 * questions: the agent still reads the plan and explains the choice.
 *
 * @param {object|null} plan `edit/plan.json`
 * @param {object} [project] `project.json`
 * @returns {string[]} Need tags accepted by `resolveTechniques`.
 */
export function needsFromPlan(plan, project = {}) {
  const needs = new Set(["cut", "delivery"]);
  const elements = Array.isArray(plan?.elements) ? plan.elements : [];

  for (const element of elements) {
    const type = String(element?.type || "").toLowerCase();
    const template = String(element?.template || "").toLowerCase();
    if (type === "canvas" || template === "canvas") needs.add("canvas");
    if (type === "parallax" || template === "parallax") needs.add("canvas");
    if (type === "scene" || template === "block" || /3d/i.test(type)) needs.add("3d");
    if (MOTION_TYPES.has(type) || template) needs.add("motion");
  }

  if (project?.captions?.enabled !== false) needs.add("captions");
  if (plan?.music || (Array.isArray(plan?.sfx) && plan.sfx.length)) needs.add("audio");
  if (project?.mode?.voice === "tts" || project?.voice === "tts") needs.add("voice");
  if (project?.timeline === "filmcraft") needs.add("timeline");
  if (plan?.multicam) needs.add("multicam");
  if (plan?.color) needs.add("color");

  return [...needs];
}

/**
 * Pick the first available technique for each need. Used by the agent to turn
 * a need list into a concrete proposal.
 *
 * @param {object|null} caps
 * @param {string[]} needs
 * @returns {Array<{need:string, technique:object|null, alternatives:object[]}>}
 */
export function recommendTechniques(caps, needs = []) {
  const list = Array.isArray(needs) ? needs : [];
  return list.map((need) => {
    const matches = resolveTechniques(caps, { needs: [need] });
    const available = matches.filter((row) => row.available);
    return {
      need,
      technique: available[0] || null,
      alternatives: matches.filter((row) => row.id !== available[0]?.id),
    };
  });
}

/**
 * Stable JSON payload for `techniques --json`.
 *
 * @param {object|null} caps
 * @param {{needs?: string[]}} [options]
 * @returns {object}
 */
export function techniquesReport(caps, options = {}) {
  const needs = Array.isArray(options.needs) ? options.needs : [];
  return {
    schema: "rooster.techniques/v1",
    needs,
    techniques: resolveTechniques(caps, { needs }),
    recommendation: recommendTechniques(caps, needs),
  };
}

/**
 * Human-readable table for `techniques`.
 *
 * @param {object} report
 * @returns {string}
 */
export function formatTechniques(report) {
  const rows = Array.isArray(report?.techniques) ? report.techniques : [];
  if (!rows.length) return "No technique matches those needs.";
  const lines = [];
  for (const row of rows) {
    const status = row.available ? "yes" : `no (needs ${row.missing.join(", ")})`;
    lines.push(`${row.id.padEnd(12)} ${row.tool.padEnd(28)} ${status}`);
    lines.push(`  ${row.bestFor}`);
    if (!row.available && row.install) lines.push(`  install: ${row.install}`);
    lines.push(`  cost: ${row.cost}`);
  }
  if (report?.recommendation?.length) {
    lines.push("", "Recommendation");
    for (const item of report.recommendation) {
      lines.push(
        `  ${item.need.padEnd(14)} ${
          item.technique ? `${item.technique.id} (${item.technique.tool})` : "no available technique"
        }`
      );
    }
  }
  return lines.join("\n");
}

export const TECHNIQUE_IDS = CATALOG.map((entry) => entry.id);
