#!/usr/bin/env node
/**
 * Copy the skill from the repository root into .opencode/skills/rooster-edit
 * so OpenCode can discover it while the skill is being developed.
 *
 * The root remains the source of truth. This is a build artifact, not a fork.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, ".opencode", "skills", "rooster-edit");

const ITEMS = ["SKILL.md", "references", "scripts", "templates", "agents", "assets"];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function main() {
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  for (const item of ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(DEST, item);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
    console.log(`  copied ${item}`);
  }

  console.log(`\nSynced to ${DEST}`);
  console.log("Reload OpenCode if the skill does not appear immediately.");
}

main();
