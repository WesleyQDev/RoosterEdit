/**
 * ASR backend selection, argument builders, and cache metadata.
 *
 * Pure module: it never spawns a process, reads a file, or creates a
 * directory. Callers resolve the HyperFrames binary (see `lib/engines.mjs`)
 * and execute the returned argument arrays themselves.
 *
 * Zero dependencies beyond `cacheKey`.
 */

import { cacheKey as makeCacheKey } from "./cache.mjs";

export const ASR_KEY_VERSION = "rooster-asr/v1";

/** Languages covered by Parakeet TDT v3 (sherpa-onnx). */
export const PARAKEET_LANGUAGES = new Set([
  "en",
  "es",
  "fr",
  "de",
  "bg",
  "hr",
  "cs",
  "da",
  "nl",
  "et",
  "fi",
  "el",
  "hu",
  "it",
  "lv",
  "lt",
  "mt",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "sv",
  "ru",
  "uk",
]);

/** Canonical backend names returned by `pickAsrBackend`. */
export const ASR_BACKENDS = Object.freeze([
  "parakeet",
  "hyperframes",
  "faster-whisper",
  "whisper",
  "openai-whisper",
]);

/**
 * Reduce a language tag to a bare lowercase code.
 *
 * `"pt-BR"`, `"pt_BR"`, and `" PT "` all become `"pt"`.
 *
 * @param {unknown} value Language tag or code.
 * @returns {string} Normalized code, or an empty string.
 */
export function normalizeLanguage(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/[-_.]/)[0];
}

/**
 * Whether Parakeet can transcribe the language.
 *
 * @param {unknown} value Language tag or code.
 * @returns {boolean} True when the normalized code is covered.
 */
export function languageCoveredByParakeet(value) {
  const code = normalizeLanguage(value);
  return Boolean(code) && PARAKEET_LANGUAGES.has(code);
}

/**
 * Pick an ASR backend.
 *
 * `requested` wins when it names a known backend. In `auto` mode the order is:
 * Parakeet (installed and language covered), faster-whisper, HyperFrames,
 * whisper, then the OpenAI Whisper CLI as a last resort.
 *
 * Capabilities are intentionally loose: `true`, a non-empty version string, or
 * an object such as `{ installed: true }` / `{ bin }` all count as available.
 * A `parakeet` object with `installed: false` never counts.
 *
 * @param {{requested?: string, language?: string, capabilities?: object}} [options]
 * @returns {{backend: string, reason: string}} Selected backend and why.
 */
export function pickAsrBackend({ requested = "auto", language, capabilities = {} } = {}) {
  const caps = capabilities && typeof capabilities === "object" ? capabilities : {};
  const lang = normalizeLanguage(language);
  const target = backendName(requested);

  if (target && target !== "auto" && ASR_BACKENDS.includes(target)) {
    return { backend: target, reason: explicitReason(target, lang, caps) };
  }

  const picked = pickAutoBackend(lang, caps);
  if (target && target !== "auto") {
    return {
      backend: picked.backend,
      reason: `unrecognized requested backend "${String(requested)}"; ${picked.reason}`,
    };
  }
  return picked;
}

/**
 * Build HyperFrames `transcribe` arguments (everything after the bin name).
 *
 * HyperFrames always writes word-level timestamps, so `words` is accepted for
 * API symmetry but adds no flag. `--engine auto` is kept explicit so the
 * command is readable in logs.
 *
 * @param {{input: string, dir?: string, engine?: string, language?: string, model?: string|null, words?: boolean, toSrt?: string|boolean|null}} options
 * @returns {string[]} Arguments for `hyperframes`.
 */
export function hyperFramesTranscribeArgs({
  input,
  dir,
  engine = "auto",
  language = "pt",
  model = null,
  words = false,
  toSrt = null,
} = {}) {
  if (!input) throw new TypeError("hyperFramesTranscribeArgs requires input.");
  void words;

  const args = ["transcribe", String(input)];
  if (dir) args.push("--dir", String(dir));
  args.push("--engine", String(engine || "auto"));

  const lang = normalizeLanguage(language) || "pt";
  if (lang !== "auto" && lang !== "detect") args.push("--language", lang);
  if (model) args.push("--model", String(model));

  args.push("--json");
  if (toSrt) {
    args.push("--to", "srt");
    if (typeof toSrt === "string") args.push("-o", toSrt);
  }
  return args;
}

/**
 * Build `scripts/transcribe_faster.py` arguments (everything after `python`).
 *
 * Required flags are always present. Optional flags are only added when they
 * change behavior, evaluated against the Python script's defaults:
 * - `beam-size` is emitted unless it is 5 (the script default), so the fast
 *   `beam: 1` default actually takes effect;
 * - `--words` / `--no-words` is always explicit because the script defaults to
 *   word timestamps on;
 * - `--no-vad` is emitted for `vad: false`.
 *
 * @param {object} options
 * @param {string} options.script Path to `transcribe_faster.py`.
 * @param {string} options.input Audio or video file.
 * @param {string} options.output Transcript JSON path.
 * @param {string} [options.language] Language code.
 * @param {string} [options.model] Whisper model.
 * @param {number} [options.beam] Beam size.
 * @param {boolean} [options.words] Request word timestamps.
 * @param {string} [options.device] `auto`, `cpu`, or `cuda`.
 * @param {string} [options.computeType] CTranslate2 compute type.
 * @param {boolean} [options.vad] Enable VAD.
 * @param {number} [options.vadMinSilenceMs] VAD minimum silence.
 * @param {number} [options.maxAudioMinutes] Split long audio when > 0.
 * @param {boolean} [options.verbose] Print each segment.
 * @returns {string[]} Arguments for `python`.
 */
export function fasterWhisperArgs({
  script,
  input,
  output,
  language = "pt",
  model = "base",
  beam = 1,
  words = false,
  device = "auto",
  computeType = "auto",
  vad = true,
  vadMinSilenceMs = 500,
  maxAudioMinutes = 0,
  verbose = false,
} = {}) {
  if (!script) throw new TypeError("fasterWhisperArgs requires script.");
  if (!input) throw new TypeError("fasterWhisperArgs requires input.");
  if (!output) throw new TypeError("fasterWhisperArgs requires output.");

  const languageCode = normalizeLanguage(language) || "pt";
  const modelName = model === null || model === undefined || model === "" ? "base" : String(model);
  const args = [
    String(script),
    "--input", String(input),
    "--output", String(output),
    "--language", languageCode,
    "--model", modelName,
  ];

  const beamSize = beam === null || beam === undefined ? 1 : Number(beam);
  if (!Number.isFinite(beamSize)) throw new TypeError("fasterWhisperArgs beam must be a number.");
  if (beamSize !== 5) args.push("--beam-size", String(beamSize));

  args.push(words ? "--words" : "--no-words");

  const deviceName = String(device ?? "auto").trim().toLowerCase();
  if (deviceName && deviceName !== "auto") args.push("--device", deviceName);

  const compute = String(computeType ?? "auto").trim().toLowerCase();
  if (compute && compute !== "auto") args.push("--compute-type", compute);

  if (vad === false) args.push("--no-vad");

  const silence = Number(vadMinSilenceMs);
  if (!Number.isFinite(silence)) {
    throw new TypeError("fasterWhisperArgs vadMinSilenceMs must be a number.");
  }
  if (silence !== 500) args.push("--vad-min-silence-ms", String(silence));

  const minutes = Number(maxAudioMinutes);
  if (!Number.isFinite(minutes)) {
    throw new TypeError("fasterWhisperArgs maxAudioMinutes must be a number.");
  }
  if (minutes > 0) args.push("--max-audio-minutes", String(minutes));

  if (verbose) args.push("--verbose");
  return args;
}

/**
 * Stable cache key for a transcript artifact.
 *
 * The source content hash plus every option that changes the output are part
 * of the key; `backendVersion` invalidates when the engine or model changes.
 *
 * @param {{sourceHash: string, backend?: string, model?: string|null, language?: string|null, beam?: number|null, vad?: boolean|null, words?: boolean|null, backendVersion?: string|null}} options
 * @returns {string} 32 hexadecimal characters.
 */
export function transcriptKey({
  sourceHash,
  backend = "auto",
  model = null,
  language = null,
  beam = null,
  vad = null,
  words = null,
  backendVersion = null,
} = {}) {
  if (typeof sourceHash !== "string" || !sourceHash.trim()) {
    throw new TypeError("transcriptKey requires sourceHash.");
  }

  return makeCacheKey([
    ASR_KEY_VERSION,
    {
      sourceHash: sourceHash.trim(),
      backend: backendName(backend) || "auto",
      model: model ?? null,
      language: language === null || language === undefined ? null : normalizeLanguage(language) || null,
      beam: beam === null || beam === undefined ? null : Number(beam),
      vad: vad === null || vad === undefined ? null : Boolean(vad),
      words: words === null || words === undefined ? null : Boolean(words),
      backendVersion: backendVersion ?? null,
    },
  ]);
}

/**
 * Metadata stored next to a transcript or cache artifact.
 *
 * @param {{backend?: string, model?: string|null, language?: string|null, beam?: number|null, vad?: boolean|null, words?: boolean|null, backendVersion?: string|null, cacheKey?: string|null, createdAt?: string}} [options]
 * @returns {object} Plain metadata object.
 */
export function transcriptMeta({
  backend = "auto",
  model = null,
  language = null,
  beam = null,
  vad = null,
  words = null,
  backendVersion = null,
  cacheKey = null,
  createdAt,
} = {}) {
  return {
    backend: backendName(backend) || "auto",
    model: model ?? null,
    language: language === null || language === undefined ? null : normalizeLanguage(language) || null,
    beam: beam ?? null,
    vad: vad ?? null,
    words: words ?? null,
    backendVersion: backendVersion ?? null,
    cacheKey: cacheKey ?? null,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

/**
 * Decide whether to request word timestamps.
 *
 * `requested: "always"` / `"never"` wins. Otherwise words are enabled when the
 * project asks for captions (`project.captions.enabled`,
 * `project.mode.captions`, or `plan.captions.enabled`) or when `force` is set.
 *
 * @param {{project?: object, plan?: object, requested?: string|boolean, force?: boolean}} [options]
 * @returns {boolean} True when word timestamps are needed.
 */
export function shouldUseWords({ project, plan, requested = "auto", force = false } = {}) {
  const choice = typeof requested === "string" ? requested.trim().toLowerCase() : requested;
  if (choice === "never" || requested === false) return false;
  if (choice === "always" || requested === true) return true;
  if (force) return true;

  const data = project && typeof project === "object" ? project : {};
  const effectivePlan = plan ?? data.plan ?? null;
  return (
    captionsRequested(data.captions) ||
    captionsRequested(data.mode?.captions) ||
    captionsRequested(effectivePlan?.captions)
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function backendName(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!raw) return "";
  if (raw === "auto") return "auto";
  if (raw.includes("parakeet")) return "parakeet";
  if (raw.includes("hyperframes") || raw === "hf") return "hyperframes";
  if (raw.includes("faster") || raw === "ct2" || raw === "ctranslate2") return "faster-whisper";
  if (raw.includes("openai")) return "openai-whisper";
  if (raw.includes("whisper")) return "whisper";
  return raw;
}

function pickAutoBackend(language, capabilities) {
  const lang = language || "the requested language";
  const covered = languageCoveredByParakeet(language);

  if (isCapabilityAvailable(capabilities.parakeet) && covered) {
    return {
      backend: "parakeet",
      reason: `parakeet installed and covers ${lang}`,
    };
  }

  const parakeetNote = isCapabilityAvailable(capabilities.parakeet)
    ? `parakeet does not cover ${lang}`
    : "parakeet not installed";

  if (isCapabilityAvailable(capabilities.fasterWhisper)) {
    return { backend: "faster-whisper", reason: `${parakeetNote}; faster-whisper detected` };
  }

  const whisperValue = capabilities.whisper;
  if (typeof whisperValue === "string" && /faster[-_ ]?whisper/i.test(whisperValue)) {
    return {
      backend: "faster-whisper",
      reason: `${parakeetNote}; faster-whisper detected in capabilities.whisper`,
    };
  }

  if (
    isCapabilityAvailable(capabilities.hyperframes) ||
    isCapabilityAvailable(capabilities.hyperframesCli)
  ) {
    return { backend: "hyperframes", reason: "faster-whisper not detected; hyperframes available" };
  }

  if (isCapabilityAvailable(whisperValue) && !/faster[-_ ]?whisper/i.test(String(whisperValue))) {
    return { backend: "whisper", reason: "hyperframes not available; whisper detected" };
  }

  return {
    backend: "openai-whisper",
    reason: "no local ASR backend detected; openai-whisper is the fallback",
  };
}

function explicitReason(backend, language, capabilities) {
  const lang = language || "the requested language";
  if (backend === "parakeet") {
    if (!isCapabilityAvailable(capabilities.parakeet)) {
      return "requested parakeet, but it is not reported as installed";
    }
    if (!languageCoveredByParakeet(language)) {
      return `requested parakeet, but it does not cover ${lang}`;
    }
    return "requested parakeet";
  }
  if (backend === "hyperframes") {
    const available =
      isCapabilityAvailable(capabilities.hyperframes) ||
      isCapabilityAvailable(capabilities.hyperframesCli);
    return available ? "requested hyperframes" : "requested hyperframes, but it was not detected";
  }
  return `requested ${backend}`;
}

function isCapabilityAvailable(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return false;
    if (/^(false|none|null)$/i.test(text)) return false;
    return !/^not\b/i.test(text);
  }
  if (value && typeof value === "object") {
    if (value.installed === false || value.available === false || value.found === false) return false;
    return Boolean(
      value.installed ||
        value.available ||
        value.found ||
        value.bin ||
        value.path ||
        value.version ||
        value.command
    );
  }
  return false;
}

function captionsRequested(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return Boolean(text) && !["none", "off", "false", "no", "disabled"].includes(text);
  }
  if (value && typeof value === "object") return value.enabled === true;
  return false;
}
