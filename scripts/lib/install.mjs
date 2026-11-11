/**
 * Install the skill into a harness skills directory.
 *
 * `npx rooster-edit install` copies the skill payload into
 * `<skills-dir>/rooster-edit` and writes a small marker file so later installs
 * can recognize and update the folder. It never deletes a directory it does
 * not own.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_NAME = "rooster-edit";
export const INSTALL_MARKER = ".rooster-install.json";
export const INSTALL_SCHEMA = "rooster.install/v1";
export const SKILL_ITEMS = ["SKILL.md", "references", "scripts", "templates", "agents", "docs"];

const SKIP_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const SKIP_PATHS = new Set(["docs/assets", "scripts/test"]);

export const HARNESSES = {
  opencode: { local: [".opencode", "skills"], global: [".config", "opencode", "skills"] },
  claude: { local: [".claude", "skills"], global: [".claude", "skills"] },
  agents: { local: [".agents", "skills"], global: [".agents", "skills"] },
};

export function harnessIds() {
  return Object.keys(HARNESSES);
}

function readVersion(source) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInstallTarget(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const harness = String(options.harness || "opencode").toLowerCase();
  const global = Boolean(options.global);

  if (options.dir) {
    const skillsDir = path.resolve(cwd, String(options.dir));
    return { harness, global, skillsDir, dest: path.join(skillsDir, SKILL_NAME) };
  }

  const entry = HARNESSES[harness];
  if (!entry) {
    throw new Error(
      `Unknown harness "${harness}". Use one of: ${harnessIds().join(", ")}. ` +
        "Or pass --dir <skills-folder>."
    );
  }

  const parts = global ? entry.global : entry.local;
  const skillsDir = global ? path.join(os.homedir(), ...parts) : path.join(cwd, ...parts);
  return { harness, global, skillsDir, dest: path.join(skillsDir, SKILL_NAME) };
}

function looksOwned(dest) {
  if (!fs.existsSync(dest)) return false;
  return fs.existsSync(path.join(dest, INSTALL_MARKER)) || fs.existsSync(path.join(dest, "SKILL.md"));
}

function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (SKIP_PATHS.has(normalized)) return true;
  return normalized.split("/").some((part) => SKIP_NAMES.has(part));
}

function copyTree(source, destination, relativePath, result) {
  if (shouldSkip(relativePath)) {
    result.skipped.push(relativePath);
    return;
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
      copyTree(path.join(source, entry.name), path.join(destination, entry.name), childRelative, result);
    }
    return;
  }

  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  result.copied.push(relativePath);
}

function writeMarker(dest, values) {
  const marker = {
    schema: INSTALL_SCHEMA,
    skill: SKILL_NAME,
    ...values,
  };
  fs.writeFileSync(path.join(dest, INSTALL_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Copy the skill from `source` into the target skills folder.
 *
 * @returns {{
 *   status: "installed" | "updated" | "dry-run",
 *   dest: string,
 *   skillsDir: string,
 *   harness: string,
 *   global: boolean,
 *   version: string | null,
 *   copied: string[],
 *   skipped: string[]
 * }}
 */
export function installSkill(options = {}) {
  const source = path.resolve(options.source || path.join(process.cwd(), "."));
  const target = resolveInstallTarget(options);
  const force = Boolean(options.force);
  const dryRun = Boolean(options["dry-run"] || options.dryRun);
  const version = options.version || readVersion(source);

  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`SKILL.md not found in ${source}. Run install from the npm package or the repository root.`);
  }

  if (target.dest === source || isInside(source, target.dest)) {
    throw new Error(`Refusing to install into ${target.dest}: it contains the source directory.`);
  }

  if (isInside(target.dest, source)) {
    const first = path.relative(source, target.dest).split(path.sep)[0];
    if (SKILL_ITEMS.includes(first)) {
      throw new Error(`Refusing to install into ${target.dest}: it sits inside a folder being copied.`);
    }
  }

  const exists = fs.existsSync(target.dest);
  const owned = looksOwned(target.dest);

  if (exists && !owned) {
    throw new Error(
      `${target.dest} exists and does not look like a RoosterEdit install. ` +
        "Choose another --dir or remove that folder yourself."
    );
  }

  if (exists && !force) {
    throw new Error(
      `RoosterEdit is already installed at ${target.dest}. ` +
        "Run again with --force to update it."
    );
  }

  const status = exists ? "updated" : "installed";
  const result = { copied: [], skipped: [] };

  if (dryRun) {
    const files = [];
    for (const item of SKILL_ITEMS) {
      const from = path.join(source, item);
      if (fs.existsSync(from)) files.push(item);
    }
    return {
      status: "dry-run",
      dest: target.dest,
      skillsDir: target.skillsDir,
      harness: target.harness,
      global: target.global,
      version,
      copied: files,
      skipped: [],
    };
  }

  if (exists) fs.rmSync(target.dest, { recursive: true, force: true });
  fs.mkdirSync(target.dest, { recursive: true });

  for (const item of SKILL_ITEMS) {
    const from = path.join(source, item);
    if (!fs.existsSync(from)) continue;
    copyTree(from, path.join(target.dest, item), item, result);
  }

  const cli = path.join(target.dest, "scripts", "rooster.mjs");
  if (process.platform !== "win32" && fs.existsSync(cli)) {
    fs.chmodSync(cli, 0o755);
  }

  writeMarker(target.dest, {
    version,
    installedAt: new Date().toISOString(),
    harness: target.harness,
    global: target.global,
  });

  return {
    status,
    dest: target.dest,
    skillsDir: target.skillsDir,
    harness: target.harness,
    global: target.global,
    version,
    copied: result.copied,
    skipped: result.skipped,
  };
}

export function readInstallMarker(dest) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dest, INSTALL_MARKER), "utf8"));
  } catch {
    return null;
  }
}
