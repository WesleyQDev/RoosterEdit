import { test } from "node:test";
import assert from "node:assert/strict";

import {
  blockAddArgs,
  blockDurationMismatch,
  blockHostHtml,
  blockInstallHint,
  blockName,
  blockVars,
  isBlockElement,
} from "../features/blocks.mjs";

const element = {
  id: "logo",
  type: "scene",
  template: "block",
  block: "extruded-logo",
  vars: { text: "ROOSTER", finish: "chrome", nested: { bad: true } },
  start: 12,
  end: 17,
};

test("isBlockElement matches scene/block elements", () => {
  assert.equal(isBlockElement(element), true);
  assert.equal(isBlockElement({ type: "scene", block: "cosmic-orb" }), true);
  assert.equal(isBlockElement({ type: "letreiro" }), false);
  assert.equal(isBlockElement({ type: "broll", template: "block" }), false);
});

test("blockName accepts registry names and rejects paths", () => {
  assert.equal(blockName(element), "extruded-logo");
  assert.throws(() => blockName({ block: "../escape" }), /registry name/);
  assert.throws(() => blockName({}), /registry name/);
});

test("blockVars keeps scalar variables only", () => {
  assert.deepEqual(blockVars(element), { text: "ROOSTER", finish: "chrome" });
  assert.deepEqual(blockVars({ vars: ["x"] }), {});
});

test("blockHostHtml emits the composition host with variables", () => {
  const html = blockHostHtml({ element, index: 3, width: 1080, height: 1920 });
  assert.match(html, /data-composition-id="el-3"/);
  assert.match(html, /data-composition-src="compositions\/extruded-logo.html"/);
  assert.match(html, /data-start="12\.000"/);
  assert.match(html, /data-duration="5\.000"/);
  assert.match(html, /data-track-index="5"/);
  assert.match(html, /data-variable-values='\{&quot;text&quot;:&quot;ROOSTER&quot;,&quot;finish&quot;:&quot;chrome&quot;\}'/);
});

test("blockHostHtml omits empty variables", () => {
  const html = blockHostHtml({
    element: { type: "scene", block: "cosmic-orb", start: 0, end: 4 },
    index: 0,
    width: 1920,
    height: 1080,
  });
  assert.doesNotMatch(html, /data-variable-values/);
});

test("blockAddArgs builds an offline-safe add command", () => {
  assert.deepEqual(blockAddArgs({ name: "cosmic-orb", dir: "style/blocks/cosmic-orb" }), [
    "add",
    "cosmic-orb",
    "--dir",
    "style/blocks/cosmic-orb",
    "--json",
    "--no-clipboard",
  ]);
  assert.deepEqual(
    blockAddArgs({ name: "cosmic-orb", dir: "x", varsFile: "vars.json" }).slice(-2),
    ["--vars", "vars.json"]
  );
});

test("blockInstallHint names the missing block and the flag", () => {
  const hint = blockInstallHint({ name: "cosmic-orb" });
  assert.match(hint, /npx hyperframes add cosmic-orb/);
  assert.match(hint, /--allow-download/);
});

test("blockDurationMismatch detects a planned duration away from the block", () => {
  assert.equal(blockDurationMismatch({ start: 0, end: 5 }, 5), false);
  assert.equal(blockDurationMismatch({ start: 0, end: 12 }, 5), true);
});
