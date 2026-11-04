/**
 * Unit tests for scripts/lib/render.mjs.
 *
 * Only tiny child processes are spawned; nothing renders a video.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hyperFramesRenderArgs,
  normalizeRenderQuality,
  parseRenderProgress,
  readRenderMeta,
  remotionRenderArgs,
  renderKey,
  runRender,
  validateRenderProbe,
  writeRenderMeta,
} from "../lib/render.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rooster-render-test-"));
}

function cleanup(t, dir) {
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold a handle briefly; the OS temp directory is disposable.
    }
  });
}

test("normalizeRenderQuality maps final aliases and rejects unknown values", () => {
  assert.equal(normalizeRenderQuality("draft"), "draft");
  assert.equal(normalizeRenderQuality("FINAL"), "final");
  assert.equal(normalizeRenderQuality("delivery"), "final");
  assert.equal(normalizeRenderQuality("high"), "final");
  assert.equal(normalizeRenderQuality(undefined, "draft"), "draft");
  assert.throws(() => normalizeRenderQuality("ultra"), RangeError);
});

test("hyperFramesRenderArgs applies safe defaults", () => {
  const result = hyperFramesRenderArgs({ bin: "hf", out: "renders/draft.mp4" });
  assert.equal(result.command, "hf");
  assert.deepEqual(result.args, [
    "render",
    "--quality",
    "draft",
    "--workers",
    "auto",
    "--video-frame-format",
    "jpg",
    "--quiet",
    "-o",
    "renders/draft.mp4",
  ]);
  assert.equal(result.out, "renders/draft.mp4");
});

test("hyperFramesRenderArgs includes final, workers, cache, resume, gpu and extra", () => {
  const result = hyperFramesRenderArgs({
    bin: "node",
    out: "renders/final.mp4",
    quality: "final",
    workers: 6,
    framesCacheDir: "cache/hyperframes-frames",
    resume: true,
    gpu: true,
    videoFrameFormat: "png",
    extra: ["--debug"],
  });
  assert.deepEqual(result.args, [
    "render",
    "--quality",
    "delivery",
    "--workers",
    "6",
    "--video-frame-format",
    "png",
    "--frames-cache-dir",
    "cache/hyperframes-frames",
    "--resume",
    "--gpu",
    "--quiet",
    "--debug",
    "-o",
    "renders/final.mp4",
  ]);
});

test("hyperFramesRenderArgs omits undefined flags", () => {
  const { args } = hyperFramesRenderArgs({ out: "out.mp4" });
  for (const flag of ["--frames-cache-dir", "--resume", "--gpu", "--start", "--end"]) {
    assert.equal(args.includes(flag), false, `${flag} should be omitted`);
  }
  assert.equal(args.includes("undefined"), false);
});

test("hyperFramesRenderArgs passes explicit start/end and validates input", () => {
  const { args } = hyperFramesRenderArgs({ out: "out.mp4", start: 1.5, end: 4 });
  assert.ok(args.includes("--start"));
  assert.equal(args[args.indexOf("--start") + 1], "1.5");
  assert.ok(args.includes("--end"));
  assert.equal(args[args.indexOf("--end") + 1], "4");

  assert.throws(() => hyperFramesRenderArgs({ out: "out.mp4", quality: "ultra" }), RangeError);
  assert.throws(() => hyperFramesRenderArgs({ out: "out.mp4", workers: 0 }), RangeError);
  assert.throws(() => hyperFramesRenderArgs({ out: "out.mp4", workers: "many" }), RangeError);
  assert.throws(
    () => hyperFramesRenderArgs({ out: "out.mp4", videoFrameFormat: "webm" }),
    RangeError
  );
  assert.throws(() => hyperFramesRenderArgs({ out: "out.mp4", start: 5, end: 5 }), RangeError);
  assert.throws(() => hyperFramesRenderArgs({ out: "out.mp4", start: -1 }), RangeError);
  assert.throws(() => hyperFramesRenderArgs({}), TypeError);
});

test("remotionRenderArgs uses positional entry/composition/out and quiet log", () => {
  const result = remotionRenderArgs({
    bin: "remotion",
    entry: "src/index.ts",
    composition: "RoosterVideo",
    out: "renders/final.mp4",
  });
  assert.equal(result.command, "remotion");
  assert.deepEqual(result.args, [
    "render",
    "src/index.ts",
    "RoosterVideo",
    "renders/final.mp4",
    "--log=error",
  ]);
  assert.equal(result.quality, null);
});

test("remotionRenderArgs includes optional concurrency, gl, frames and log", () => {
  const result = remotionRenderArgs({
    composition: "RoosterVideo",
    out: "renders/final.mp4",
    quality: "final",
    concurrency: 4,
    gl: "angle",
    frames: "10-40",
    log: "verbose",
  });
  assert.deepEqual(result.args, [
    "render",
    "RoosterVideo",
    "renders/final.mp4",
    "--concurrency=4",
    "--gl=angle",
    "--log=verbose",
    "--frames=10-40",
  ]);
  assert.equal(result.quality, "final");
});

test("remotionRenderArgs normalizes frame objects and omits gl when absent", () => {
  const result = remotionRenderArgs({
    composition: "C",
    out: "out.mp4",
    frames: { start: 10, end: 40 },
  });
  assert.ok(result.args.includes("--frames=10-40"));
  assert.equal(result.args.some((arg) => arg.startsWith("--gl")), false);
  assert.equal(result.args.some((arg) => arg.startsWith("--concurrency")), false);
  assert.ok(result.args.includes("--frames=10-40"));
});

test("remotionRenderArgs validates optional flags", () => {
  assert.throws(
    () => remotionRenderArgs({ composition: "C", out: "o.mp4", concurrency: 0 }),
    RangeError
  );
  assert.throws(
    () => remotionRenderArgs({ composition: "C", out: "o.mp4", concurrency: "half" }),
    RangeError
  );
  assert.throws(
    () => remotionRenderArgs({ composition: "C", out: "o.mp4", gl: "angle;rm" }),
    RangeError
  );
  assert.throws(
    () => remotionRenderArgs({ composition: "C", out: "o.mp4", frames: "40-10" }),
    RangeError
  );
  assert.throws(
    () => remotionRenderArgs({ composition: "C", out: "o.mp4", frames: "start-end" }),
    RangeError
  );
  assert.throws(() => remotionRenderArgs({ out: "o.mp4" }), TypeError);
  assert.throws(() => remotionRenderArgs({ composition: "C" }), TypeError);
});

test("parseRenderProgress reads @hf-progress JSON", () => {
  const progress = parseRenderProgress('@hf-progress {"percent":42,"stage":"capture"}');
  assert.equal(progress.percent, 42);
  assert.equal(progress.stage, "capture");
  assert.equal(progress.data.percent, 42);

  const trailing = parseRenderProgress('log prefix @hf-progress {"percent":40} trailing');
  assert.equal(trailing.percent, 40);
});

test("parseRenderProgress strips ANSI and computes frame progress", () => {
  const ansi = parseRenderProgress('\u001b[32m@hf-progress {"percent":10,"stage":"encode"}\u001b[0m');
  assert.equal(ansi.percent, 10);
  assert.equal(ansi.stage, "encode");

  const frames = parseRenderProgress('@hf-progress {"frame":30,"total":120,"stage":"capture"}');
  assert.equal(frames.percent, 25);
  assert.equal(frames.stage, "capture");

  const fraction = parseRenderProgress('@hf-progress {"percent":0.5}');
  assert.equal(fraction.percent, 0.5);

  const stringPercent = parseRenderProgress('@hf-progress {"percent":"33%"}');
  assert.equal(stringPercent.percent, 33);

  const clamped = parseRenderProgress('@hf-progress {"percent":150}');
  assert.equal(clamped.percent, 100);
});

test("parseRenderProgress accepts stage-only JSON and plain percent lines", () => {
  const stageOnly = parseRenderProgress('@hf-progress {"stage":"starting"}');
  assert.equal(stageOnly.percent, null);
  assert.equal(stageOnly.stage, "starting");

  const plain = parseRenderProgress("Rendering 42%");
  assert.equal(plain.percent, 42);
  assert.equal(plain.stage, null);

  const staged = parseRenderProgress("stage: encode 75%");
  assert.equal(staged.percent, 75);
  assert.equal(staged.stage, "encode");
});

test("parseRenderProgress tolerates malformed and unrelated lines", () => {
  for (const value of [
    null,
    undefined,
    42,
    "",
    "   ",
    "just a log line",
    "@hf-progress",
    "@hf-progress {bad json",
    "@hf-progress [1,2,3]",
    '{"percent":50} without a marker',
    "Rendering soon",
  ]) {
    assert.equal(parseRenderProgress(value), null, `expected null for ${String(value)}`);
  }
});

test("renderKey is stable and ignores workers", () => {
  const base = {
    htmlKey: "abc123",
    quality: "draft",
    fps: 30,
    width: 1920,
    height: 1080,
    engine: "hyperframes",
    engineVersion: "1.2.3",
  };
  const key = renderKey(base);
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(renderKey({ ...base }), key);
  assert.equal(renderKey({ ...base, workers: 8 }), key);
  assert.equal(
    renderKey({
      engineVersion: "1.2.3",
      engine: "hyperframes",
      height: 1080,
      width: 1920,
      fps: 30,
      quality: "draft",
      htmlKey: "abc123",
    }),
    key
  );
});

test("renderKey changes with quality, fps, resolution, engine and version", () => {
  const base = {
    htmlKey: "abc123",
    quality: "draft",
    fps: 30,
    width: 1920,
    height: 1080,
    engine: "hyperframes",
    engineVersion: "1.2.3",
  };
  const key = renderKey(base);
  for (const change of [
    { quality: "final" },
    { fps: 60 },
    { width: 1280 },
    { height: 720 },
    { engine: "remotion" },
    { engineVersion: "1.2.4" },
    { htmlKey: "def456" },
  ]) {
    assert.notEqual(renderKey({ ...base, ...change }), key, JSON.stringify(change));
  }
  assert.equal(renderKey({ ...base, quality: "delivery" }), renderKey({ ...base, quality: "final" }));
  assert.throws(() => renderKey({}), TypeError);
});

test("runRender streams lines, captures output, and writes the log", async (t) => {
  const dir = tempDir();
  cleanup(t, dir);
  const logPath = path.join(dir, "logs", "render.log");
  const seen = [];
  const result = await runRender({
    command: process.execPath,
    args: ["-e", "console.log('hello from render'); console.error('warning line');"],
    logPath,
    onProgress: (line, stream) => seen.push({ line, stream }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.error, null);
  assert.match(result.stdout, /hello from render/);
  assert.match(result.stderr, /warning line/);
  assert.ok(result.elapsedMs >= 0);
  assert.equal(result.logPath, path.resolve(logPath));
  assert.equal(result.logError, null);

  const log = fs.readFileSync(logPath, "utf8");
  assert.match(log, /hello from render/);
  assert.match(log, /warning line/);
  assert.ok(seen.some((entry) => entry.line === "hello from render" && entry.stream === "stdout"));
  assert.ok(seen.some((entry) => entry.line === "warning line" && entry.stream === "stderr"));
});

test("runRender reports a non-zero exit without throwing", async () => {
  const result = await runRender({
    command: process.execPath,
    args: ["-e", "console.error('boom'); process.exit(3);"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 3);
  assert.equal(result.timedOut, false);
  assert.match(result.error, /code 3/);
  assert.match(result.stderr, /boom/);
});

test("runRender enforces a timeout", async () => {
  const result = await runRender({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000);"],
    timeout: 250,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /timed out/);
  assert.ok(result.elapsedMs >= 200);
});

test("runRender resolves a spawn error", async () => {
  const result = await runRender({
    command: "rooster-missing-binary-for-tests-xyz",
    args: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.timedOut, false);
  assert.ok(result.error);
});

test("runRender runs .mjs scripts through the current Node binary", async (t) => {
  const dir = tempDir();
  cleanup(t, dir);
  const script = path.join(dir, "fake-engine.mjs");
  fs.writeFileSync(script, "console.log('engine-ok');\n", "utf8");

  const result = await runRender({ command: script, args: [] });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /engine-ok/);
});

test("writeRenderMeta writes atomically and readRenderMeta tolerates bad files", (t) => {
  const dir = tempDir();
  cleanup(t, dir);
  const file = path.join(dir, "renders", "render.json");

  writeRenderMeta(file, { key: "abc", quality: "draft" });
  assert.deepEqual(readRenderMeta(file), { key: "abc", quality: "draft" });

  writeRenderMeta(file, { key: "def", quality: "final", bytes: 10 });
  assert.deepEqual(readRenderMeta(file), { key: "def", quality: "final", bytes: 10 });

  const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);

  assert.equal(readRenderMeta(path.join(dir, "missing.json")), null);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json", "utf8");
  assert.equal(readRenderMeta(bad), null);

  assert.throws(() => writeRenderMeta(file, null), TypeError);
  assert.throws(() => writeRenderMeta("", {}), TypeError);
});

test("validateRenderProbe accepts a matching probe", () => {
  const result = validateRenderProbe(
    { duration: 60.05, width: 1920, height: 1080, fps: 29.97, audio: true },
    { width: 1920, height: 1080, fps: 30, duration: 60 }
  );
  assert.deepEqual(result, { ok: true, issues: [] });

  const short = validateRenderProbe(
    { duration: 10.4, width: 1920, height: 1080, fps: 30, audio: true },
    { width: 1920, height: 1080, fps: 30, duration: 10 }
  );
  assert.equal(short.ok, true);
});

test("validateRenderProbe reports duration, resolution, fps and audio issues", () => {
  const duration = validateRenderProbe(
    { duration: 61.5, width: 1920, height: 1080, fps: 30, audio: true },
    { duration: 60 }
  );
  assert.equal(duration.ok, false);
  assert.match(duration.issues.join("\n"), /duration:/);

  const resolution = validateRenderProbe(
    { duration: 60, width: 1280, height: 720, fps: 30, audio: true },
    { width: 1920, height: 1080 }
  );
  assert.equal(resolution.ok, false);
  assert.match(resolution.issues.join("\n"), /resolution:/);

  const fps = validateRenderProbe(
    { duration: 60, width: 1920, height: 1080, fps: 25, audio: true },
    { fps: 30 }
  );
  assert.equal(fps.ok, false);
  assert.match(fps.issues.join("\n"), /fps:/);

  const audio = validateRenderProbe(
    { duration: 60, width: 1920, height: 1080, fps: 30, audio: false },
    { duration: 60 }
  );
  assert.equal(audio.ok, false);
  assert.match(audio.issues.join("\n"), /audio:/);

  const silent = validateRenderProbe(
    { duration: 60, width: 1920, height: 1080, fps: 30, audio: false },
    { duration: 60, requireAudio: false }
  );
  assert.equal(silent.ok, true);
});

test("validateRenderProbe rejects missing probes and explains what is missing", () => {
  assert.equal(validateRenderProbe(null).ok, false);
  assert.equal(validateRenderProbe("nope").ok, false);

  const missingDuration = validateRenderProbe(
    { width: 1920, height: 1080, fps: 30, audio: true },
    { duration: 60 }
  );
  assert.equal(missingDuration.ok, false);
  assert.match(missingDuration.issues.join("\n"), /duration: missing/);

  const failed = validateRenderProbe({ error: "ffprobe failed" });
  assert.equal(failed.ok, false);
  assert.match(failed.issues.join("\n"), /ffprobe failed/);

  const zero = validateRenderProbe({ duration: 0, width: 10, height: 10, fps: 30, audio: true });
  assert.equal(zero.ok, false);
  assert.match(zero.issues.join("\n"), /duration: must be positive/);
});

test("remotionRenderArgs supports alpha codecs and props", () => {
  const invocation = remotionRenderArgs({
    bin: "remotion",
    entry: "src/index.ts",
    composition: "el-001",
    out: "out.mov",
    codec: "prores",
    proresProfile: "4444",
    imageFormat: "png",
    pixelFormat: "yuva444p10le",
    props: { id: "el-001" },
  });
  assert.equal(invocation.command, "remotion");
  assert.deepEqual(invocation.args.slice(0, 4), ["render", "src/index.ts", "el-001", "out.mov"]);
  assert.ok(invocation.args.includes("--codec=prores"));
  assert.ok(invocation.args.includes("--prores-profile=4444"));
  assert.ok(invocation.args.includes("--image-format=png"));
  assert.ok(invocation.args.includes("--pixel-format=yuva444p10le"));
  assert.ok(invocation.args.includes('--props={"id":"el-001"}'));
});
