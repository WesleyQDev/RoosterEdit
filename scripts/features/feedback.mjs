/**
 * Feedback issue helpers for RoosterEdit.
 *
 * Pure, dependency-free builders that turn a failed or awkward video run into
 * a redacted, reviewable GitHub issue draft. The caller collects diagnostics,
 * summaries, and a log tail; this module only formats and redacts them.
 *
 * No filesystem access, no child processes, no network, no I/O. Nothing
 * happens at import time and no timestamps are added here.
 */

export const FEEDBACK_REPO = "WesleyQDev/RoosterEdit";
export const FEEDBACK_ISSUES_URL = `https://github.com/${FEEDBACK_REPO}/issues`;

const MAX_TITLE = 120;
const MAX_ERROR = 90;
const MAX_LOG_LINES = 120;
const MAX_LOG_CHARS = 12000;
const SECRET_KEY = "api[_-]?key|apikey|token|secret|password|cookie";

const PROJECT_FIELDS = [
  "slug",
  "engine",
  "timeline",
  "format",
  "duration",
  "status",
  "profile",
  "channel",
];

const ENVIRONMENT_FIELDS = [
  "rooster",
  "os",
  "node",
  "ffmpeg",
  "hyperframes",
  "remotion",
  "filmcraft",
  "git",
  "gh",
];

const RENDER_FIELDS = ["quality", "engine", "duration", "resolution", "createdAt"];

// ---------------------------------------------------------------------------
// Small pure utilities
// ---------------------------------------------------------------------------

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coerceText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

function scalarText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function cleanInline(value) {
  return scalarText(value).replace(/\s+/g, " ").trim();
}

function cleanBlock(value) {
  return coerceText(value).replace(/\r\n?/g, "\n").trim();
}

function truncate(value, limit) {
  const text = coerceText(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return coerceText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stringList(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.map(scalarText).map((text) => text.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function pathRegExp(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw === "/" || raw === "\\") return null;
  if (/^[A-Za-z]:[\\/]?$/.test(raw)) return null;

  const trimmed = raw.replace(/[\\/]+$/, "");
  if (!trimmed) return null;

  const leading = /^[\\/]/.test(trimmed) ? "[\\\\/]+" : "";
  const body = trimmed
    .replace(/^[\\/]+/, "")
    .split(/[\\/]+/)
    .map(escapeRegExp)
    .join("[\\\\/]+");
  if (!body) return null;

  const windows =
    /^[A-Za-z]:/.test(trimmed) || /^\\\\/.test(trimmed) || process.platform === "win32";
  return new RegExp(`${leading}${body}(?![A-Za-z0-9_-])`, windows ? "gi" : "g");
}

function redactKeyValues(text) {
  let output = text;

  const doubleQuoted = new RegExp(
    `((?:${SECRET_KEY})\\b["']?\\s*[:=]\\s*)"([^"\\r\\n]*)"`,
    "gi",
  );
  output = output.replace(doubleQuoted, (match, prefix) => `${prefix}"<redacted>"`);

  const singleQuoted = new RegExp(
    `((?:${SECRET_KEY})\\b["']?\\s*[:=]\\s*)'([^'\\r\\n]*)'`,
    "gi",
  );
  output = output.replace(singleQuoted, (match, prefix) => `${prefix}'<redacted>'`);

  const bare = new RegExp(
    `((?:${SECRET_KEY})\\b["']?\\s*[:=]\\s*)([^\\s"'&,;}\\]]+)`,
    "gi",
  );
  output = output.replace(bare, (match, prefix) => `${prefix}<redacted>`);

  return output;
}

function redactTokens(text) {
  let output = text;

  output = output.replace(/\bgithub_pat_[A-Za-z0-9_]+/gi, "<redacted>");
  output = output.replace(/\bgh[pousr]_[A-Za-z0-9]+/gi, "<redacted>");
  output = output.replace(/\bsk-[A-Za-z0-9_-]+/gi, "<redacted>");
  output = output.replace(/\bxox[baprs]-[A-Za-z0-9-]+/gi, "<redacted>");
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
  output = redactKeyValues(output);

  return output;
}

function redactUserHomes(text) {
  let output = text.replace(
    /\b([A-Za-z]:)[\\/]+Users[\\/]+([^\\/\s"'<>|]+)/gi,
    (match, drive) => `${drive}\\Users\\<user>`,
  );

  output = output.replace(
    /\/(home|Users)\/([^/\s"'<>]+)/g,
    (match, root) => `/${root}/<user>`,
  );

  return output;
}

/**
 * Redact sensitive values and local paths from a string.
 *
 * Paths passed in `options` are replaced longest-first, so a workspace inside
 * the home directory becomes `<workspace>` rather than `~`. Windows-style
 * paths match both separators and are case-insensitive; POSIX paths are
 * case-sensitive unless running on Windows. Token patterns and fallback user
 * home paths are always redacted.
 *
 * @param {unknown} text Value to redact. Non-strings are coerced; this never throws.
 * @param {{home?: string, workspace?: string, project?: string, extraPaths?: string[]}} [options] Paths to replace.
 * @returns {string} Redacted text with newlines preserved.
 */
export function redactText(text, options = {}) {
  let output = coerceText(text);
  const opts = isRecord(options) ? options : {};
  const entries = [];

  const add = (value, replacement) => {
    const regex = pathRegExp(value);
    if (!regex) return;
    entries.push({ value: value.trim(), regex, replacement });
  };

  add(opts.project, "<project>");
  add(opts.workspace, "<workspace>");
  if (Array.isArray(opts.extraPaths)) {
    for (const extra of opts.extraPaths) add(extra, "<path>");
  }
  add(opts.home, "~");

  entries.sort((a, b) => b.value.length - a.value.length);
  for (const entry of entries) {
    output = output.replace(entry.regex, () => entry.replacement);
  }

  output = redactTokens(output);
  output = redactUserHomes(output);
  return output;
}

/**
 * Deep clone a JSON-compatible value, redacting every string.
 *
 * Arrays and plain objects are traversed and cloned. Numbers, booleans, null,
 * and other primitives are preserved. Non-plain objects are returned as-is.
 *
 * @param {unknown} value Value to clone and redact.
 * @param {object} [options] Same options as {@link redactText}.
 * @returns {unknown} Redacted clone.
 */
export function redactObject(value, options = {}) {
  const seen = new WeakMap();

  const walk = (input) => {
    if (typeof input === "string") return redactText(input, options);
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return seen.get(input);

    if (Array.isArray(input)) {
      const copy = [];
      seen.set(input, copy);
      for (const item of input) copy.push(walk(item));
      return copy;
    }

    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return input;

    const copy = {};
    seen.set(input, copy);
    for (const [key, item] of Object.entries(input)) copy[key] = walk(item);
    return copy;
  };

  return walk(value);
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function projectLabel(value) {
  if (!isRecord(value)) return value;
  for (const key of ["slug", "name", "title"]) {
    const text = cleanInline(value[key]);
    if (text) return text;
  }
  return "";
}

/**
 * Build a short issue title.
 *
 * Precedence: summary, error (`command failed: ...`), command
 * (`issue with: ...`), project (`Feedback: ...`), then a generic default.
 * Whitespace is collapsed and the final title is capped at 120 characters.
 *
 * @param {{summary?: string, command?: string, error?: string, project?: string|object}} [options] Title inputs.
 * @returns {string} Issue title.
 */
export function feedbackTitle(options = {}) {
  const opts = isRecord(options) ? options : {};
  const summary = cleanInline(opts.summary);
  const error = cleanInline(opts.error);
  const command = cleanInline(opts.command);
  const project = cleanInline(projectLabel(opts.project));

  let title;
  if (summary) title = truncate(summary, MAX_TITLE);
  else if (error) title = `command failed: ${truncate(error, MAX_ERROR)}`;
  else if (command) title = truncate(`issue with: ${command}`, MAX_TITLE);
  else if (project) title = `Feedback: ${project}`;
  else title = "RoosterEdit feedback";

  const projectPath =
    typeof opts.project === "string" && /[\\/]/.test(opts.project)
      ? opts.project
      : undefined;

  return truncate(
    redactText(title, {
      home: opts.home,
      workspace: opts.workspace,
      project: projectPath,
      extraPaths: opts.extraPaths,
    }),
    MAX_TITLE,
  );
}

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

function bullet(label, value) {
  const lines = coerceText(value).replace(/\r\n?/g, "\n").split("\n");
  const first = lines.shift() ?? "";
  const out = [`- **${label}:** ${first}`];
  for (const line of lines) out.push(`  ${line}`);
  return out.join("\n");
}

function plainBullet(value) {
  const lines = coerceText(value).replace(/\r\n?/g, "\n").split("\n");
  const first = lines.shift() ?? "";
  const out = [`- ${first}`];
  for (const line of lines) out.push(`  ${line}`);
  return out.join("\n");
}

function nestedBullet(value) {
  const lines = coerceText(value).replace(/\r\n?/g, "\n").split("\n");
  const first = lines.shift() ?? "";
  const out = [`  - ${first}`];
  for (const line of lines) out.push(`    ${line}`);
  return out.join("\n");
}

function renderFields(source, fields, redact) {
  if (!isRecord(source)) return "";
  const lines = [];

  for (const field of fields) {
    const value = cleanBlock(redact(scalarText(source[field])));
    if (!value) continue;
    lines.push(bullet(field, value));
  }

  return lines.join("\n");
}

function renderSteps(value, redact) {
  if (Array.isArray(value)) {
    const steps = value
      .map((step) => cleanBlock(redact(scalarText(step))))
      .filter(Boolean);
    if (!steps.length) return "";

    return steps
      .map((step, index) => {
        const lines = step.split("\n");
        const first = lines.shift() ?? "";
        const out = [`${index + 1}. ${first}`];
        for (const line of lines) out.push(`   ${line}`);
        return out.join("\n");
      })
      .join("\n");
  }

  return cleanBlock(redact(scalarText(value)));
}

function renderLogs(value, redact) {
  const raw = Array.isArray(value) ? value.map(scalarText).join("\n") : scalarText(value);
  if (!raw.trim()) return "";

  let text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length > MAX_LOG_LINES) text = lines.slice(-MAX_LOG_LINES).join("\n");

  text = redact(text);
  if (text.length > MAX_LOG_CHARS) text = text.slice(-MAX_LOG_CHARS);

  text = escapeHtml(text);
  if (text.length > MAX_LOG_CHARS) text = text.slice(-MAX_LOG_CHARS);
  return text;
}

function projectObject(value) {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) return { slug: value };
  return {};
}

function redactionOptions(options) {
  const projectPath =
    typeof options.projectPath === "string"
      ? options.projectPath
      : isRecord(options.project) && typeof options.project.path === "string"
        ? options.project.path
        : typeof options.project === "string" && /[\\/]/.test(options.project)
          ? options.project
          : undefined;

  return {
    home: options.home,
    workspace: options.workspace,
    project: projectPath,
    extraPaths: options.extraPaths,
  };
}

/**
 * Build a Markdown issue body.
 *
 * Every caller-provided string passes through {@link redactText}. Sections
 * with no data are omitted except Summary (which gets a placeholder), Privacy,
 * and the footer. Logs are truncated to 120 lines / 12000 characters and
 * HTML-escaped inside a `<pre>` block.
 *
 * @param {object} [options] Feedback inputs. Includes summary, notes, command,
 *   error, expected, actual, steps, project, environment, validation, render,
 *   logs, repo, and includeDiagnostics.
 * @returns {string} Markdown issue body.
 */
export function feedbackBody(options = {}) {
  const opts = isRecord(options) ? options : {};
  const redactOptions = redactionOptions(opts);
  const redact = (value) => redactText(coerceText(value), redactOptions);
  const blocks = [];

  // Summary
  const summary = cleanBlock(redact(scalarText(opts.summary)));
  const notes = cleanBlock(redact(scalarText(opts.notes)));
  const summaryParts = [];
  if (summary) summaryParts.push(summary);
  if (notes) summaryParts.push(`**Notes:** ${notes}`);
  blocks.push(
    `## Summary\n\n${summaryParts.length ? summaryParts.join("\n\n") : "(describe here)"}`,
  );

  // What happened
  const happened = [];
  for (const [label, value] of [
    ["Command", opts.command],
    ["Error", opts.error],
    ["Expected", opts.expected],
    ["Actual", opts.actual],
  ]) {
    const text = cleanBlock(redact(scalarText(value)));
    if (text) happened.push(bullet(label, text));
  }
  if (happened.length) blocks.push(`## What happened\n\n${happened.join("\n")}`);

  // Steps to reproduce
  const steps = renderSteps(opts.steps, redact);
  if (steps) blocks.push(`## Steps to reproduce\n\n${steps}`);

  const includeDiagnostics = opts.includeDiagnostics !== false;

  if (includeDiagnostics) {
    // Environment
    const environment = renderFields(opts.environment, ENVIRONMENT_FIELDS, redact);
    if (environment) blocks.push(`## Environment\n\n${environment}`);

    // Project
    const project = renderFields(projectObject(opts.project), PROJECT_FIELDS, redact);
    if (project) blocks.push(`## Project\n\n${project}`);

    // Validation
    const validation = isRecord(opts.validation) ? opts.validation : null;
    if (validation) {
      const errors = stringList(validation.errors)
        .map((error) => cleanBlock(redact(error)))
        .filter(Boolean);
      const warnings = stringList(validation.warnings)
        .map((warning) => cleanBlock(redact(warning)))
        .filter(Boolean);

      const lines = [];
      if (errors.length) {
        lines.push("**Errors**");
        for (const error of errors) lines.push(plainBullet(error));
      }
      if (warnings.length) {
        lines.push("**Warnings**");
        for (const warning of warnings) lines.push(plainBullet(warning));
      }
      if (!lines.length) lines.push("none");
      blocks.push(`## Validation\n\n${lines.join("\n")}`);
    }

    // Last render
    const render = isRecord(opts.render) ? opts.render : null;
    if (render) {
      const issues = stringList(render.issues)
        .map((issue) => cleanBlock(redact(issue)))
        .filter(Boolean);
      const lines = [];

      for (const field of RENDER_FIELDS) {
        if (field === "duration" && issues.length) {
          lines.push("- **issues:**");
          for (const issue of issues) lines.push(nestedBullet(issue));
        }

        const value = cleanBlock(redact(scalarText(render[field])));
        if (value) lines.push(bullet(field, value));
      }

      if (lines.length) blocks.push(`## Last render\n\n${lines.join("\n")}`);
    }

    // Logs
    const logs = renderLogs(opts.logs, redact);
    if (logs) {
      blocks.push(
        `## Logs\n\n<details><summary>Log tail</summary><pre>${logs}</pre></details>`,
      );
    }
  }

  // Privacy
  blocks.push(
    [
      "## Privacy",
      "",
      "- [ ] I reviewed the diagnostics included in this issue and removed anything private.",
      "- [ ] This issue contains no media, transcript, cookies, tokens, or API keys.",
    ].join("\n"),
  );

  // Footer
  blocks.push(`---\n\nReported from RoosterEdit. Issues: ${FEEDBACK_ISSUES_URL}`);

  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

function normalizeRepo(value) {
  if (typeof value !== "string") return FEEDBACK_REPO;
  const repo = value.trim();
  return repo || FEEDBACK_REPO;
}

function normalizeLabels(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const labels = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  return labels;
}

/**
 * Bundle a complete issue draft.
 *
 * @param {object} [options] Feedback inputs plus `repo` and `labels`.
 * @returns {{title: string, body: string, repo: string, labels: string[]}} Issue draft.
 */
export function buildFeedbackIssue(options = {}) {
  const opts = isRecord(options) ? options : {};

  return {
    title: feedbackTitle(opts),
    body: feedbackBody(opts),
    repo: normalizeRepo(opts.repo),
    labels: normalizeLabels(opts.labels),
  };
}
