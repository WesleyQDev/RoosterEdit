/**
 * GPU and hardware-encoder detection.
 *
 * Video tools default to `libx264` because it works everywhere, but almost
 * every modern machine has a usable hardware H.264 encoder. Detecting only
 * `nvidia-smi` hides AMD, Intel, and Apple GPUs, so this module combines the
 * OS GPU list with the encoders the local FFmpeg was built with.
 *
 * Detection is synchronous and spawns a few short probes. It never installs
 * anything. `doctor` caches the result for six hours; build/render paths call
 * it once per process and reuse the answer.
 */

import { spawnSync } from "node:child_process";

const PROBE_TIMEOUT_MS = 8000;
const ENCODER_PATTERN = /^\s*V[.A-Z]{5}\s+([A-Za-z0-9_]+)\s/;
const VENDOR_PATTERN = /(nvidia|geforce|quadro|rtx|gtx|tesla)/i;
const AMD_PATTERN = /(amd|radeon|advanced micro devices)/i;
const INTEL_PATTERN = /(intel|arc\b|iris|uhd graphics|hd graphics)/i;
const APPLE_PATTERN = /(apple|m1\b|m2\b|m3\b|m4\b)/i;

const H264_CANDIDATES = {
  nvidia: "h264_nvenc",
  amd: "h264_amf",
  intel: "h264_qsv",
  apple: "h264_videotoolbox",
};
const HEVC_CANDIDATES = {
  nvidia: "hevc_nvenc",
  amd: "hevc_amf",
  intel: "hevc_qsv",
  apple: "hevc_videotoolbox",
};
const AV1_CANDIDATES = {
  nvidia: "av1_nvenc",
  amd: "av1_amf",
  intel: "av1_qsv",
  apple: "av1_videotoolbox",
};

function text(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : null;
}

/**
 * Convert a memory string such as "24 GB" or "8192 MB" to megabytes.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function memoryMB(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = /([\d.]+)\s*(TB|GB|MB)/i.exec(text);
  if (!match) return toNumber(text);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "TB") return Math.round(amount * 1024 * 1024);
  if (unit === "GB") return Math.round(amount * 1024);
  return Math.round(amount);
}

function runProbe(run, name, args, options = {}) {
  try {
    const result = run(name, args, {
      encoding: "utf8",
      timeout: options.timeout || PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    if (!result) return { ok: false, stdout: "", stderr: "", error: "no result" };
    return {
      ok: result.status === 0 || result.ok === true,
      status: result.status ?? null,
      stdout: text(result.stdout),
      stderr: text(result.stderr),
      error: result.error ? String(result.error.message || result.error) : null,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: String(error?.message || error),
    };
  }
}

function defaultRun(name, args, options = {}) {
  return spawnSync(name, args, {
    encoding: "utf8",
    timeout: options.timeout || PROBE_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * Classify a GPU name into a vendor bucket. Unknown names fall back to
 * `unknown` instead of guessing NVIDIA just because an encoder exists.
 *
 * @param {string} name
 * @returns {"nvidia"|"amd"|"intel"|"apple"|"unknown"}
 */
export function classifyVendor(name) {
  const value = String(name || "");
  if (APPLE_PATTERN.test(value)) return "apple";
  if (VENDOR_PATTERN.test(value)) return "nvidia";
  if (AMD_PATTERN.test(value)) return "amd";
  if (INTEL_PATTERN.test(value)) return "intel";
  return "unknown";
}

/**
 * Parse `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader`.
 *
 * @param {string} output
 * @returns {Array<{name: string, vramMB: number|null, driver: string|null, vendor: "nvidia"}>}
 */
export function parseNvidiaSmi(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",").map((part) => part.trim());
    const name = parts[0];
    if (!name || /^name$/i.test(name)) continue;
    const memory = /(\d+)\s*MiB/i.exec(parts[1] || "");
    rows.push({
      name,
      vramMB: memory ? Number(memory[1]) : null,
      driver: parts[2] || null,
      vendor: "nvidia",
    });
  }
  return rows;
}

/**
 * Parse `Get-CimInstance Win32_VideoController | ConvertTo-Json`.
 * Windows returns an object for one adapter and an array for several.
 *
 * @param {string|object} input
 * @returns {Array<{name: string, vendor: string, driver: string|null, vramMB: number|null}>}
 */
export function parseWindowsVideoControllers(input) {
  let data = input;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return [];
    try {
      data = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!data) return [];
  const rows = Array.isArray(data) ? data : [data];
  const adapters = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.Name || row.name || row.VideoProcessor || "").trim();
    if (!name) continue;
    // Virtual display drivers are not useful for encoding.
    if (/virtual|remote|basic display|mirror/i.test(name)) continue;
    // WMI reports AdapterRAM in bytes as a uint32, so cards with 8 GB or more
    // wrap around. Treat values near the uint32 ceiling as unknown instead of
    // printing a fictional amount.
    const bytes = toNumber(row.AdapterRAM);
    const vramMB =
      bytes && bytes > 0 && bytes < 4_000_000_000
        ? Math.round(bytes / (1024 * 1024))
        : null;
    adapters.push({
      name,
      vendor: classifyVendor(name),
      driver: String(row.DriverVersion || row.driverVersion || "").trim() || null,
      vramMB,
    });
  }
  return adapters;
}

/**
 * Parse `system_profiler SPDisplaysDataType -json` on macOS.
 *
 * @param {string|object} input
 * @returns {Array<{name: string, vendor: string, driver: string|null, vramMB: number|null}>}
 */
export function parseSystemProfiler(input) {
  let data = input;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return [];
    try {
      data = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  const list = data?.SPDisplaysDataType;
  if (!Array.isArray(list)) return [];
  const adapters = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.sppci_model || row._name || "").trim();
    if (!name) continue;
    adapters.push({
      name,
      vendor: classifyVendor(name),
      driver: null,
      vramMB: memoryMB(row.spdisplays_vram || row.spdisplays_vram_shared),
    });
  }
  return adapters;
}

/**
 * Parse `lspci -mm` display controllers on Linux.
 *
 * @param {string} output
 * @returns {Array<{name: string, vendor: string, driver: string|null, vramMB: number|null}>}
 */
export function parseLspci(output) {
  const adapters = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!/(VGA compatible controller|3D controller|Display controller)/i.test(line)) {
      continue;
    }
    const fields = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    const vendorName = fields[1] || "";
    const deviceName = fields[2] || "";
    const name = [vendorName, deviceName].filter(Boolean).join(" ").trim();
    if (!name) continue;
    adapters.push({
      name: name.replace(/\s+/g, " "),
      vendor: classifyVendor(name),
      driver: null,
      vramMB: null,
    });
  }
  return adapters;
}

/**
 * Parse `ffmpeg -hide_banner -encoders` into a set of encoder ids.
 *
 * @param {string} output
 * @returns {Set<string>}
 */
export function parseFfmpegEncoders(output) {
  const found = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = ENCODER_PATTERN.exec(line);
    if (match) found.add(match[1]);
  }
  return found;
}

/**
 * Pick the best available hardware encoder per codec for a vendor.
 *
 * @param {{vendor?: string, encoders?: Set<string>|string[], platform?: string}} options
 * @returns {{h264: string|null, hevc: string|null, av1: string|null}}
 */
export function recommendEncoders({ vendor = "unknown", encoders = [], platform = process.platform } = {}) {
  const available =
    encoders instanceof Set ? encoders : new Set((encoders || []).map((value) => String(value)));
  const bucket = String(vendor || "unknown").toLowerCase();
  const pick = (map) => {
    // VAAPI needs a render node and a hwupload filter graph, which the build
    // does not generate. Do not recommend an encoder that would fail.
    if (bucket === "amd" && platform !== "win32") return null;
    const candidate = map[bucket];
    return candidate && available.has(candidate) ? candidate : null;
  };
  return {
    h264: pick(H264_CANDIDATES),
    hevc: pick(HEVC_CANDIDATES),
    av1: pick(AV1_CANDIDATES),
  };
}

/**
 * Merge one or more adapter lists, dropping duplicates and virtual devices.
 *
 * @param {Array<Array<object>>} lists
 * @returns {Array<object>}
 */
function mergeAdapters(lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const adapter of list || []) {
      const key = String(adapter.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(adapter);
    }
  }
  return merged;
}

function gpuLabel(hardware) {
  if (!hardware?.detected) return null;
  const name = hardware.name || "GPU";
  const vendor = hardware.vendor && hardware.vendor !== "unknown" ? `, ${hardware.vendor}` : "";
  const vram =
    Number.isFinite(hardware.vramMB) && hardware.vramMB > 0
      ? `, ${Math.round(hardware.vramMB / 1024)} GB`
      : "";
  return `${name} (${`${vendor}${vram}`.replace(/^, /, "") || "detected"})`;
}

/**
 * Human-readable one-line summary for doctor and build logs.
 *
 * @param {object|null} hardware
 * @returns {string}
 */
export function describeHardware(hardware) {
  if (!hardware || !hardware.detected) return "not detected (CPU)";
  const label = gpuLabel(hardware) || hardware.name || "GPU";
  const encoders = hardware.recommended || {};
  const list = [encoders.h264, encoders.hevc, encoders.av1].filter(Boolean);
  if (!list.length) return `${label} — no hardware encoder in this FFmpeg`;
  return `${label} — ${list.join(", ")}`;
}

/**
 * Detect GPUs and the hardware encoders available to the local FFmpeg.
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   run?: Function,
 *   env?: NodeJS.ProcessEnv,
 *   ffmpeg?: string,
 * }} [options]
 * @returns {{
 *   detected: boolean,
 *   platform: string,
 *   vendor: string|null,
 *   name: string|null,
 *   vramMB: number|null,
 *   driver: string|null,
 *   gpus: Array<object>,
 *   source: string|null,
 *   encoders: {h264: string|null, hevc: string|null, av1: string|null},
 *   available: string[],
 *   recommended: {h264: string|null, hevc: string|null, av1: string|null},
 *   delivery: string,
 *   note: string|null,
 * }}
 */
export function detectHardware(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const env = options.env || process.env;
  const run = typeof options.run === "function" ? options.run : defaultRun;
  const ffmpeg = options.ffmpeg || "ffmpeg";
  const lists = [];
  const sources = [];

  const nvidia = runProbe(run, "nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader",
  ]);
  if (nvidia.ok && nvidia.stdout.trim()) {
    const rows = parseNvidiaSmi(nvidia.stdout);
    if (rows.length) {
      lists.push(rows);
      sources.push("nvidia-smi");
    }
  }

  if (platform === "win32") {
    const wmi = runProbe(
      run,
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor | ConvertTo-Json -Compress",
      ],
      { timeout: 12000 }
    );
    if (wmi.ok && wmi.stdout.trim()) {
      const rows = parseWindowsVideoControllers(wmi.stdout);
      if (rows.length) {
        lists.push(rows);
        sources.push("win32-video-controller");
      }
    }
  } else if (platform === "darwin") {
    const profiler = runProbe(run, "system_profiler", ["SPDisplaysDataType", "-json"], {
      timeout: 15000,
    });
    if (profiler.ok && profiler.stdout.trim()) {
      const rows = parseSystemProfiler(profiler.stdout);
      if (rows.length) {
        lists.push(rows);
        sources.push("system_profiler");
      }
    }
    if (!lists.length && arch === "arm64") {
      lists.push([{ name: "Apple Silicon GPU", vendor: "apple", driver: null, vramMB: null }]);
      sources.push("arch");
    }
  } else {
    const lspci = runProbe(run, "lspci", ["-mm"]);
    if (lspci.ok && lspci.stdout.trim()) {
      const rows = parseLspci(lspci.stdout);
      if (rows.length) {
        lists.push(rows);
        sources.push("lspci");
      }
    }
  }

  const gpus = mergeAdapters(lists);
  const primary =
    gpus.find((gpu) => gpu.vendor !== "unknown") ||
    gpus[0] ||
    null;
  const vendor = primary?.vendor || "unknown";

  const encodersProbe = runProbe(run, ffmpeg, ["-hide_banner", "-encoders"], {
    timeout: 12000,
  });
  const available = parseFfmpegEncoders(
    `${encodersProbe.stdout}\n${encodersProbe.stderr}`
  );
  const hardwareAvailable = [...available].filter((id) => HARDWARE_ENCODER.test(id));
  const recommended = recommendEncoders({
    vendor,
    encoders: hardwareAvailable,
    platform,
  });

  const detected = Boolean(primary);
  const anyHardware = Boolean(
    recommended.h264 || recommended.hevc || recommended.av1
  );
  const note = !detected
    ? "no GPU detected; using libx264"
    : !anyHardware
      ? `${primary.name} detected, but this FFmpeg has no matching hardware encoder`
      : null;

  return {
    detected,
    platform,
    vendor: detected ? vendor : null,
    name: primary?.name || null,
    vramMB: primary?.vramMB ?? null,
    driver: primary?.driver ?? null,
    gpus,
    source: sources.join("+") || null,
    encoders: recommended,
    available: hardwareAvailable.sort(),
    recommended,
    // Delivery stays on software x264: hardware quality is not validated for
    // final delivery, and the project rule is draft/intermediate only.
    delivery: "libx264",
    note,
  };
}

const VALID_ENCODER = /^[A-Za-z0-9_]+$/;
const HARDWARE_ENCODER = /_(nvenc|amf|qsv|videotoolbox|vaapi)$/i;

/**
 * Whether an encoder id is a hardware encoder.
 *
 * @param {string} encoder
 * @returns {boolean}
 */
export function isHardwareEncoder(encoder) {
  return HARDWARE_ENCODER.test(String(encoder || ""));
}

/**
 * Resolve `--encoder auto` (or the `ROOSTER_ENCODER` env) for a quality tier.
 *
 * `draft`/intermediate work uses the best hardware H.264 encoder. `final`
 * delivery stays on libx264 unless the user names a hardware encoder
 * explicitly; hardware quality has not been validated for delivery.
 *
 * @param {string|null|undefined} requested
 * @param {{quality?: "draft"|"final", hardware?: object|null, env?: NodeJS.ProcessEnv}} [options]
 * @returns {string}
 */
export function resolveEncoder(requested, options = {}) {
  const env = options.env || process.env;
  const quality = options.quality === "final" ? "final" : "draft";
  const hardware = options.hardware || null;
  const raw = String(requested ?? "").trim();
  const fromEnv = String(env.ROOSTER_ENCODER ?? "").trim();
  const choice = raw && raw.toLowerCase() !== "auto" ? raw : fromEnv;

  if (choice && choice.toLowerCase() !== "auto") {
    if (!VALID_ENCODER.test(choice)) {
      throw new TypeError(`Invalid encoder "${choice}". Use an FFmpeg encoder id such as libx264.`);
    }
    return choice;
  }

  if (quality === "final") return "libx264";
  const candidate = hardware?.recommended?.h264 || hardware?.encoders?.h264 || null;
  return candidate && VALID_ENCODER.test(candidate) ? candidate : "libx264";
}

/**
 * Convert CRF to a sensible hardware quality value for encoders that use a
 * different scale. Kept explicit so quality does not silently drift.
 *
 * @param {string} encoder
 * @param {number} crf
 * @returns {number}
 */
export function hardwareCrf(encoder, crf = 20) {
  const value = Number(crf);
  const base = Number.isFinite(value) ? value : 20;
  if (String(encoder).includes("videotoolbox")) {
    // VideoToolbox `-q:v` runs 1..100 where higher is better.
    return Math.max(1, Math.min(100, 100 - base * 3));
  }
  return base;
}

/**
 * Summarize the machine for the `doctor` text output.
 *
 * @param {object|null} hardware
 * @returns {string[]}
 */
export function formatHardwareLines(hardware) {
  const value = hardware || {};
  const lines = [];
  lines.push(`  GPU              ${value.name || "not detected"}`);
  if (value.vendor) lines.push(`  GPU vendor       ${value.vendor}`);
  const encoders = value.recommended || value.encoders || {};
  const list = [encoders.h264, encoders.hevc, encoders.av1].filter(Boolean);
  lines.push(`  HW encoders      ${list.length ? list.join(", ") : "none in this FFmpeg"}`);
  lines.push(`  Draft encoder    ${encoders.h264 || "libx264"}`);
  lines.push(`  Final encoder    ${value.delivery || "libx264"}`);
  if (value.note) lines.push(`  Note             ${value.note}`);
  return lines;
}
