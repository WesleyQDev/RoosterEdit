import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  contactSheetArgs,
  extractFramesArgs,
  framesKey,
} from "../lib/qa-frames.mjs";

const temps = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-qa-frames-"));
  temps.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold a handle; temp cleanup is best-effort.
    }
  }
});

function filterOf(args) {
  const index = args.indexOf("-vf");
  assert.notEqual(index, -1, "expected -vf in args");
  return args[index + 1];
}

test("contact sheet uses one fps filter and one tiled output frame", () => {
  const sheet = contactSheetArgs({
    video: "render.mp4",
    out: "qa/sheet.jpg",
    count: 12,
    cols: 4,
    scale: 480,
    duration: 10,
  });

  assert.equal(sheet.args[0], "-y");
  assert.equal(sheet.args.filter((arg) => arg === "-i").length, 1);
  assert.equal(sheet.args.at(-1), "qa/sheet.jpg");
  assert.equal(sheet.args[sheet.args.indexOf("-frames:v") + 1], "1");
  assert.equal(sheet.count, 12);
  assert.equal(sheet.rows, 3);
  assert.equal(sheet.rate, "1.2");

  const filter = filterOf(sheet.args);
  assert.match(filter, /^fps=1\.2,scale=480:-1,tile=4x3$/);
  assert.equal(sheet.filter, filter);
  assert.equal(sheet.command.includes("tile=4x3"), true);
});

test("contact sheet rounds incomplete rows up", () => {
  const sheet = contactSheetArgs({
    video: "render.mp4",
    out: "sheet.png",
    count: 10,
    cols: 4,
    scale: 320,
    duration: 30,
  });

  assert.equal(sheet.rows, 3);
  assert.match(filterOf(sheet.args), /tile=4x3$/);
  assert.match(filterOf(sheet.args), /^fps=0\.333333,/);
});

test("contact sheet falls back to an fps filter without per-frame seeks", () => {
  const sheet = contactSheetArgs({ video: "render.mp4", out: "sheet.jpg" });

  assert.equal(sheet.duration, null);
  assert.equal(sheet.rate, "1/10");
  assert.match(filterOf(sheet.args), /^fps=1\/10,scale=480:-1,tile=4x3$/);
  assert.equal(sheet.args.includes("-ss"), false);
});

test("extract frames runs one pass with vsync vfr and a numbered prefix", () => {
  const frames = extractFramesArgs({
    video: "render.mp4",
    outDir: "qa/frames",
    count: 8,
    scale: 640,
    duration: 16,
    prefix: "shot",
  });

  assert.equal(frames.args.filter((arg) => arg === "-i").length, 1);
  assert.equal(frames.args.includes("-ss"), false);
  assert.equal(frames.args[frames.args.indexOf("-vsync") + 1], "vfr");
  assert.equal(frames.args[frames.args.indexOf("-frames:v") + 1], "8");
  assert.equal(frames.args.at(-1), frames.pattern);
  assert.equal(path.basename(frames.pattern), "shot-%03d.jpg");
  assert.equal(path.dirname(frames.pattern), path.join("qa", "frames"));
  assert.equal(frames.step, 2);
  assert.equal(frames.rate, null);
  assert.match(
    filterOf(frames.args),
    /^select='isnan\(prev_selected_t\)\+gte\(t-prev_selected_t\\,2\)',scale=640:-1$/
  );
});

test("extract frames sanitizes the prefix and uses the fallback rate", () => {
  const frames = extractFramesArgs({
    video: "render.mp4",
    outDir: "qa/frames",
    prefix: "../bad prefix%",
  });

  assert.equal(path.basename(frames.pattern), "bad-prefix-%03d.jpg");
  assert.equal(frames.args.includes("-ss"), false);
  assert.match(filterOf(frames.args), /^fps=1\/10,/);
});

test("framesKey is stable and reacts to options and file changes", () => {
  const dir = tempDir();
  const video = path.join(dir, "render.mp4");
  fs.writeFileSync(video, "not really a video");

  const base = { video, count: 12, cols: 4, scale: 480, mode: "sheet" };
  const first = framesKey(base);
  const second = framesKey({ ...base });

  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(first, second);
  assert.notEqual(first, framesKey({ ...base, count: 6 }));
  assert.notEqual(first, framesKey({ ...base, cols: 3 }));
  assert.notEqual(first, framesKey({ ...base, scale: 320 }));
  assert.notEqual(first, framesKey({ ...base, mode: "frames" }));

  const later = new Date(Date.now() + 5000);
  fs.utimesSync(video, later, later);
  assert.notEqual(first, framesKey(base));
});

test("framesKey does not throw for a missing video", () => {
  const key = framesKey({ video: path.join(tempDir(), "missing.mp4") });
  assert.match(key, /^[a-f0-9]{32}$/);
});

test("invalid frame options throw actionable errors", () => {
  assert.throws(
    () => contactSheetArgs({ video: "a.mp4", out: "a.jpg", count: 0 }),
    /count must be a positive number/
  );
  assert.throws(
    () => contactSheetArgs({ video: "a.mp4", out: "a.jpg", cols: 0 }),
    /cols must be a positive number/
  );
  assert.throws(
    () => extractFramesArgs({ video: "a.mp4", outDir: "frames", scale: -1 }),
    /scale must be a positive number/
  );
  assert.throws(() => contactSheetArgs({ out: "a.jpg" }), /video is required/);
  assert.throws(() => contactSheetArgs({ video: "a.mp4" }), /out is required/);
  assert.throws(() => framesKey({}), /video is required/);
});
