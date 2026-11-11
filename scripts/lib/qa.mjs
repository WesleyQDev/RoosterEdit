/**
 * QA report assembly for RoosterEdit.
 *
 * Pure: this module never reads media, spawns a process, or touches disk. The
 * CLI collects measurements (probe, HyperFrames check/audio/measure, plan
 * validation) and passes them here. Keeping the judgment pure makes the QA
 * gate testable and keeps the same thresholds in every command.
 */

import { cacheKey } from "./cache.mjs";

export const QA_SCHEMA = "rooster.qa/v1";

export const QA_TARGET = Object.freeze({
  lufs: -14,
  truePeak: -1.0,
  toleranceLu: 1.0,
  tolerancePeakDb: 0.0,
  maxSilence: 2.0,
  edgeSilence: 0.35,
  durationTolerance: 0.5,
});

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Stable cache key for one QA run. Content and options only; no clock.
 * @param {object} parts
 * @returns {string}
 */
export function qaKey(parts = {}) {
  return cacheKey(parts).slice(0, 24);
}

/**
 * Loudness, true peak, and clipping findings.
 * @param {object|null} loudness
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function loudnessFindings(loudness, options = {}) {
  const target = { ...QA_TARGET, ...(options.target || {}) };
  if (!loudness || !Number.isFinite(Number(loudness.lufsIntegrated))) {
    return [
      {
        severity: "info",
        code: "audio.unmeasured",
        message: "No integrated loudness measured; check that the deliverable has an audio stream.",
      },
    ];
  }

  const findings = [];
  const lufs = Number(loudness.lufsIntegrated);
  const delta = lufs - target.lufs;

  if (Math.abs(delta) > 3) {
    findings.push({
      severity: "error",
      code: "audio.loudness",
      message: `Integrated loudness ${lufs.toFixed(1)} LUFS is ${delta > 0 ? "+" : ""}${delta.toFixed(1)} LU from the ${target.lufs} LUFS target.`,
    });
  } else if (Math.abs(delta) > target.toleranceLu) {
    findings.push({
      severity: "warning",
      code: "audio.loudness",
      message: `Integrated loudness ${lufs.toFixed(1)} LUFS is ${delta > 0 ? "+" : ""}${delta.toFixed(1)} LU from the ${target.lufs} LUFS target.`,
    });
  }

  const peak = Number(loudness.truePeakDb);
  if (Number.isFinite(peak)) {
    if (peak > target.truePeak) {
      findings.push({
        severity: peak > 0 ? "error" : "warning",
        code: "audio.truePeak",
        message: `True peak ${peak.toFixed(1)} dBTP is above the ${target.truePeak} dBTP ceiling.`,
      });
    }
  }

  const clipping = Number(loudness.clipping?.count) || 0;
  if (clipping > 0) {
    findings.push({
      severity: "error",
      code: "audio.clipping",
      message: `${clipping} clipped sample${clipping === 1 ? "" : "s"} detected${loudness.clipping?.firstAt != null ? ` (first at ${Number(loudness.clipping.firstAt).toFixed(2)} s)` : ""}.`,
    });
  }

  return findings;
}

/**
 * Silence spans that are long enough to be an edit problem.
 * Leading and trailing silence is expected and ignored.
 * @param {Array<{start:number,end:number}>} spans
 * @param {number} duration
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function silenceFindings(spans, duration, options = {}) {
  const target = { ...QA_TARGET, ...(options.target || {}) };
  const total = Number(duration) || 0;
  const findings = [];
  for (const span of Array.isArray(spans) ? spans : []) {
    const start = Number(span?.start);
    const end = Number(span?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (start <= target.edgeSilence || (total > 0 && end >= total - target.edgeSilence)) continue;
    const length = end - start;
    if (length > target.maxSilence) {
      findings.push({
        severity: "warning",
        code: "audio.silence",
        time: Number(start.toFixed(3)),
        message: `Silence of ${length.toFixed(1)} s starting at ${start.toFixed(1)} s.`,
      });
    }
  }
  return findings;
}

/**
 * Face report findings. `expectFace` is set when the plan has a presenter cue
 * (lower third, punch-in, or a face-focused element).
 * @param {object|null} faces
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function faceFindings(faces, options = {}) {
  if (!faces) return [];
  const sampled = Number(faces.framesSampled) || 0;
  const withFace = Number(faces.framesWithFace) || 0;
  const findings = [];

  if (sampled === 0) {
    return [
      {
        severity: "info",
        code: "face.unmeasured",
        message: "Face measurement returned no sampled frames.",
      },
    ];
  }

  if (withFace === 0 && options.expectFace) {
    findings.push({
      severity: "warning",
      code: "face.missing",
      message: "No face found in any sampled frame, but the plan has presenter cues.",
    });
  }

  const height = Number(faces.face_height);
  if (withFace > 0 && Number.isFinite(height) && height < 0.06) {
    findings.push({
      severity: "warning",
      code: "face.small",
      message: `Face occupies ${(height * 100).toFixed(1)}% of the frame height; check the vertical crop or the presenter size.`,
    });
  }

  return findings;
}

/**
 * Probe findings: missing streams and duration drift.
 * @param {object|null} probe
 * @param {object|null} plan
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function probeFindings(probe, plan, options = {}) {
  const target = { ...QA_TARGET, ...(options.target || {}) };
  if (!probe || probe.error) {
    return [
      {
        severity: "error",
        code: "render.missing",
        message: `Could not probe the render: ${probe?.error || "unknown error"}.`,
      },
    ];
  }

  const findings = [];
  if (!probe.width || !probe.height) {
    findings.push({
      severity: "error",
      code: "render.stream",
      message: "The deliverable has no readable video stream.",
    });
  }

  const expectsAudio = Boolean(plan?.music?.src) || (plan?.elements || []).some((element) => element?.voice || element?.tts);
  if (!probe.audio) {
    findings.push({
      severity: expectsAudio ? "error" : "info",
      code: "render.audio",
      message: expectsAudio
        ? "The deliverable has no audio stream, but the plan asks for music or voice."
        : "The deliverable has no audio stream.",
    });
  }

  const duration = Number(probe.duration);
  const planned = Number(plan?.duration);
  if (Number.isFinite(duration) && Number.isFinite(planned) && planned > 0) {
    const drift = Math.abs(duration - planned);
    if (drift > target.durationTolerance) {
      findings.push({
        severity: "warning",
        code: "render.duration",
        message: `Render is ${duration.toFixed(2)} s; the plan says ${planned.toFixed(2)} s (${(duration - planned).toFixed(2)} s).`,
      });
    }
  }

  return findings;
}

/**
 * Flatten a HyperFrames `check --json` report into findings.
 * @param {object|null} check
 * @returns {Array<object>}
 */
export function checkFindings(check) {
  if (!check || typeof check !== "object") return [];
  const findings = [];
  const sections = ["lint", "layout", "contrast", "craft", "audio", "runtime", "motion"];
  for (const section of sections) {
    for (const item of check[section]?.findings || []) {
      const severity = String(item.severity || "warning").toLowerCase();
      findings.push({
        severity: severity === "error" ? "error" : severity === "info" ? "info" : "warning",
        code: `check.${section}${item.code ? `.${item.code}` : ""}`,
        message: String(item.message || item.code || `${section} finding`).slice(0, 300),
      });
    }
  }
  return findings;
}

/**
 * Cut/event summary findings.
 * @param {object|null} events
 * @returns {Array<object>}
 */
export function eventsFindings(events) {
  if (!events || typeof events !== "object") return [];
  const counts = events.counts || {};
  const cuts = Number(counts.cut) || 0;
  const disappear = Number(counts.disappear) || 0;
  const findings = [];
  if (disappear > 0) {
    findings.push({
      severity: "info",
      code: "events.disappear",
      message: `${disappear} element disappearance${disappear === 1 ? "" : "s"} detected; confirm the beat was intentional.`,
    });
  }
  if (cuts === 0) {
    findings.push({
      severity: "info",
      code: "events.static",
      message: "No hard cuts detected; confirm this is a single continuous shot.",
    });
  }
  return findings;
}

function normalizeFindings(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      if (typeof item === "string") return { severity: "warning", code: "plan", message: item };
      if (!item || !item.message) return null;
      return {
        severity: ["error", "warning", "info"].includes(item.severity) ? item.severity : "warning",
        code: String(item.code || "qa"),
        message: String(item.message),
        ...(Number.isFinite(Number(item.time)) ? { time: Number(item.time) } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * Build the QA report object.
 *
 * @param {object} input
 * @param {object} input.project
 * @param {object} input.plan
 * @param {string} input.video
 * @param {object} [input.probe]
 * @param {object} [input.check]
 * @param {object} [input.audio]
 * @param {object} [input.events]
 * @param {object} [input.faces]
 * @param {string[]} [input.errors]
 * @param {string[]} [input.warnings]
 * @param {Array<object>} [input.findings]
 * @param {string[]} [input.vision]
 * @param {string} [input.key]
 * @param {string} [input.generatedAt]
 * @returns {object}
 */
export function buildQaReport(input = {}) {
  const findings = [
    ...normalizeFindings(
      (Array.isArray(input.errors) ? input.errors : []).map((message) => ({
        severity: "error",
        code: "plan.error",
        message,
      }))
    ),
    ...normalizeFindings(
      (Array.isArray(input.warnings) ? input.warnings : []).map((message) => ({
        severity: "warning",
        code: "plan.warning",
        message,
      }))
    ),
    ...normalizeFindings(input.findings),
    ...checkFindings(input.check),
    ...probeFindings(input.probe, input.plan),
    ...loudnessFindings(input.audio?.items?.[0]?.loudness || input.audio?.loudness, input.options),
    ...silenceFindings(
      input.audio?.items?.[0]?.silence || input.audio?.silence || [],
      input.probe?.duration,
      input.options
    ),
    ...faceFindings(input.faces, input.options),
    ...eventsFindings(input.events),
  ];

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  const seen = new Set();
  const unique = [];
  for (const finding of findings) {
    const key = `${finding.severity}|${finding.code}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of unique) counts[finding.severity] += 1;
  const status = counts.error > 0 ? "fail" : counts.warning > 0 ? "warn" : "pass";

  const loudness = input.audio?.items?.[0]?.loudness || input.audio?.loudness || null;
  return {
    schema: QA_SCHEMA,
    generatedAt: input.generatedAt || new Date().toISOString(),
    project: input.project?.slug || null,
    video: input.video || null,
    quality: input.quality || null,
    status,
    counts,
    key: input.key || null,
    metrics: {
      duration: Number(input.probe?.duration) || null,
      width: Number(input.probe?.width) || null,
      height: Number(input.probe?.height) || null,
      fps: Number(input.probe?.fps) || null,
      lufs: Number.isFinite(Number(loudness?.lufsIntegrated)) ? Number(loudness.lufsIntegrated) : null,
      truePeakDb: Number.isFinite(Number(loudness?.truePeakDb)) ? Number(loudness.truePeakDb) : null,
      clipping: Number(loudness?.clipping?.count) || 0,
      cuts: Number(input.events?.counts?.cut) || 0,
      faces: Number(input.faces?.framesWithFace) || 0,
      faceSamples: Number(input.faces?.framesSampled) || 0,
    },
    findings: unique,
    vision: Array.isArray(input.vision) ? input.vision : [],
  };
}

/**
 * Compact review file. The main context reads this, not the raw JSON.
 * @param {object} report
 * @returns {string}
 */
export function formatQaMarkdown(report) {
  const verdict =
    report.status === "pass"
      ? "PASS"
      : report.status === "warn"
        ? `WARN (${report.counts.warning} warning${report.counts.warning === 1 ? "" : "s"})`
        : `FAIL (${report.counts.error} error${report.counts.error === 1 ? "" : "s"})`;
  const metrics = report.metrics || {};
  const lines = [
    `# QA — ${report.project || "project"}`,
    "",
    `- Video: ${report.video || "unknown"}`,
    `- Verdict: **${verdict}**`,
    `- Format: ${metrics.width || "?"}x${metrics.height || "?"} · ${metrics.fps ? `${metrics.fps} fps` : "fps ?"} · ${metrics.duration ? `${metrics.duration.toFixed(2)} s` : "duration ?"}`,
    `- Audio: ${metrics.lufs == null ? "not measured" : `${metrics.lufs.toFixed(1)} LUFS`} · peak ${metrics.truePeakDb == null ? "?" : `${metrics.truePeakDb.toFixed(1)} dBTP`} · ${metrics.clipping} clipped`,
    `- Cuts: ${metrics.cuts} · faces: ${metrics.faces}/${metrics.faceSamples}`,
    "",
    "## Findings",
  ];

  if (!report.findings.length) {
    lines.push("- none");
  } else {
    for (const finding of report.findings.slice(0, 12)) {
      const time = finding.time != null ? ` @ ${Number(finding.time).toFixed(1)}s` : "";
      const message = String(finding.message).replace(/\s+/g, " ").trim();
      lines.push(`- [${finding.severity}] ${finding.code}${time}: ${message}`);
    }
    if (report.findings.length > 12) {
      lines.push(`- ... ${report.findings.length - 12} more in qa/qa.json`);
    }
  }

  if (report.vision.length) {
    lines.push("", "## Frames to inspect");
    for (const frame of report.vision.slice(0, 6)) lines.push(`- ${frame}`);
  }

  lines.push(
    "",
    "## Next",
    report.status === "pass"
      ? "Technical checks passed. Watch the draft once before the final render."
      : "Fix the errors first; warnings are editorial decisions. Then run `qa` again."
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Exit code convention for the CLI.
 * @param {object} report
 * @param {boolean} [strict]
 * @returns {number}
 */
export function qaExitCode(report, strict = false) {
  if (report.counts.error > 0) return 1;
  if (strict && report.counts.warning > 0) return 1;
  return 0;
}
