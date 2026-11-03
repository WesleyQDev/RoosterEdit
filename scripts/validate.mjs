#!/usr/bin/env node
/**
 * Lightweight repository validation: SKILL.md frontmatter and every JSON file.
 * Zero dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const errors = [];
const warnings = [];
let jsonCount = 0;

const skillPath = path.join(ROOT, "SKILL.md");
if (!fs.existsSync(skillPath)) {
  errors.push("SKILL.md not found");
} else {
  const content = fs.readFileSync(skillPath, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    errors.push("SKILL.md: missing YAML frontmatter");
  } else {
    const block = frontmatter[1];
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const descriptionMatch = block.match(/^description:\s*(.+)$/m);
    if (!nameMatch) errors.push("SKILL.md: missing name");
    if (!descriptionMatch) errors.push("SKILL.md: missing description");
    if (nameMatch) {
      const name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        errors.push(`SKILL.md: name "${name}" must be lowercase kebab-case`);
      }
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".opencode") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".json")) {
      jsonCount++;
      try {
        JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (error) {
        errors.push(`${path.relative(ROOT, full)}: invalid JSON (${error.message})`);
      }
    }
  }
}

walk(ROOT);

console.log(`Validated SKILL.md and ${jsonCount} JSON file(s).`);
for (const warning of warnings) console.log(`  ! ${warning}`);
for (const error of errors) console.log(`  ✗ ${error}`);
console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
