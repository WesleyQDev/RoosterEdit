import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  INSTALL_MARKER,
  SKILL_NAME,
  installSkill,
  readInstallMarker,
  resolveInstallTarget,
} from "../lib/install.mjs";

function tempDir(t, prefix = "rooster-install-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

function write(file, content = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture(t) {
  const source = tempDir(t, "rooster-source-");
  write(path.join(source, "SKILL.md"), "---\nname: rooster-edit\n---\n");
  write(path.join(source, "package.json"), JSON.stringify({ name: "rooster-edit", version: "9.9.9" }));
  write(path.join(source, "references", "workflow.md"), "reference\n");
  write(path.join(source, "scripts", "rooster.mjs"), "#!/usr/bin/env node\n");
  write(path.join(source, "templates", "profile.md"), "template\n");
  write(path.join(source, "agents", "editor.md"), "agent\n");
  write(path.join(source, "docs", "COSTS.md"), "costs\n");
  write(path.join(source, "docs", "assets", "preview.mp4"), "not copied\n");
  write(path.join(source, "node_modules", "pkg", "index.js"), "not copied\n");
  return source;
}

test("resolves local and global harness folders", () => {
  const cwd = path.join(os.tmpdir(), "rooster-project");
  const local = resolveInstallTarget({ cwd, harness: "opencode" });
  assert.equal(local.dest, path.join(cwd, ".opencode", "skills", SKILL_NAME));
  assert.equal(local.global, false);

  const claude = resolveInstallTarget({ cwd, harness: "claude", global: true });
  assert.equal(claude.dest, path.join(os.homedir(), ".claude", "skills", SKILL_NAME));

  const custom = resolveInstallTarget({ cwd, dir: "skills" });
  assert.equal(custom.dest, path.join(cwd, "skills", SKILL_NAME));
});

test("rejects an unknown harness", () => {
  assert.throws(() => resolveInstallTarget({ cwd: os.tmpdir(), harness: "nope" }), /Unknown harness/);
});

test("installs the payload and skips heavy or unrelated files", (t) => {
  const source = fixture(t);
  const cwd = tempDir(t, "rooster-project-");

  const result = installSkill({ source, cwd, harness: "opencode" });

  assert.equal(result.status, "installed");
  assert.equal(result.version, "9.9.9");
  assert.equal(result.dest, path.join(cwd, ".opencode", "skills", SKILL_NAME));
  assert.ok(fs.existsSync(path.join(result.dest, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(result.dest, "references", "workflow.md")));
  assert.ok(fs.existsSync(path.join(result.dest, "docs", "COSTS.md")));
  assert.ok(!fs.existsSync(path.join(result.dest, "docs", "assets", "preview.mp4")));
  assert.ok(!fs.existsSync(path.join(result.dest, "node_modules")));

  const marker = readInstallMarker(result.dest);
  assert.equal(marker.schema, "rooster.install/v1");
  assert.equal(marker.version, "9.9.9");
  assert.equal(marker.harness, "opencode");
  assert.ok(fs.existsSync(path.join(result.dest, INSTALL_MARKER)));
});

test("requires --force to update and keeps the folder owned", (t) => {
  const source = fixture(t);
  const cwd = tempDir(t, "rooster-project-");

  installSkill({ source, cwd });
  assert.throws(() => installSkill({ source, cwd }), /already installed/);

  const updated = installSkill({ source, cwd, force: true });
  assert.equal(updated.status, "updated");
  assert.ok(fs.existsSync(path.join(updated.dest, "SKILL.md")));
});

test("refuses to delete a folder it does not own", (t) => {
  const source = fixture(t);
  const cwd = tempDir(t, "rooster-project-");
  const dest = path.join(cwd, ".opencode", "skills", SKILL_NAME);
  write(path.join(dest, "notes.txt"), "keep me\n");

  assert.throws(() => installSkill({ source, cwd, force: true }), /does not look like/);
  assert.ok(fs.existsSync(path.join(dest, "notes.txt")));
});

test("dry-run reports the target without writing", (t) => {
  const source = fixture(t);
  const cwd = tempDir(t, "rooster-project-");

  const result = installSkill({ source, cwd, "dry-run": true });

  assert.equal(result.status, "dry-run");
  assert.ok(result.copied.includes("SKILL.md"));
  assert.ok(!fs.existsSync(result.dest));
});

test("refuses to install over the source directory", (t) => {
  const parent = tempDir(t, "rooster-parent-");
  const source = path.join(parent, SKILL_NAME);
  write(path.join(source, "SKILL.md"), "---\nname: rooster-edit\n---\n");
  write(path.join(source, "package.json"), JSON.stringify({ version: "9.9.9" }));

  assert.throws(() => installSkill({ source, cwd: parent, dir: "." }), /contains the source directory/);
});
