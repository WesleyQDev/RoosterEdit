import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStabilizePasses, colorArgs } from "../features/color.mjs";
import { videoEncoderArgs } from "../features/encoders.mjs";

test("colorArgs defaults to a fast intermediate", () => {
  const args = colorArgs({
    input: "in.mp4",
    output: "out.mp4",
    color: { contrast: 1.08 },
  });
  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "in.mp4", "-vf"]);
  assert.equal(args[4], "eq=contrast=1.08");
  assert.ok(args.includes("libx264"));
  assert.equal(args[args.indexOf("-preset") + 1], "veryfast");
  assert.equal(args[args.indexOf("-crf") + 1], "20");
});

test("colorArgs final quality and explicit overrides", () => {
  const final = colorArgs({ input: "in.mp4", output: "out.mp4", color: { contrast: 1.1 }, quality: "final" });
  assert.equal(final[final.indexOf("-preset") + 1], "medium");
  assert.equal(final[final.indexOf("-crf") + 1], "18");

  const override = colorArgs({
    input: "in.mp4",
    output: "out.mp4",
    color: { contrast: 1.1 },
    preset: "slow",
    crf: 16,
  });
  assert.equal(override[override.indexOf("-preset") + 1], "slow");
  assert.equal(override[override.indexOf("-crf") + 1], "16");
});

test("colorArgs supports hardware encoders, scale, and filter threads", () => {
  const amf = colorArgs({
    input: "in.mp4",
    output: "out.mp4",
    color: { saturation: 1.2 },
    encoder: "h264_amf",
    crf: 22,
    filterThreads: 8,
    scale: "1280:-2",
  });
  assert.deepEqual(amf.slice(0, 4), ["-y", "-filter_threads", "8", "-i"]);
  assert.match(amf[amf.indexOf("-vf") + 1], /scale=1280:-2$/);
  assert.deepEqual(amf.slice(amf.indexOf("-c:v"), amf.indexOf("-c:v") + 2), ["-c:v", "h264_amf"]);
  assert.equal(amf[amf.indexOf("-quality") + 1], "speed");
  assert.equal(amf[amf.indexOf("-qp_i") + 1], "22");

  assert.throws(
    () => colorArgs({ input: "in.mp4", output: "out.mp4", color: { contrast: 1.1 }, scale: "wide" }),
    /scale must be W:H/
  );
  assert.throws(
    () => colorArgs({ input: "in.mp4", output: "out.mp4", color: { contrast: 1.1 }, crf: 99 }),
    /crf must be between 0 and 63/
  );
});

test("colorArgs stream-copies when nothing changes", () => {
  const args = colorArgs({ input: "in.mp4", output: "out.mp4", color: {} });
  assert.deepEqual(args, ["-y", "-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "out.mp4"]);
});

test("videoEncoderArgs maps libx264, nvenc, amf, qsv, and copy", () => {
  assert.deepEqual(videoEncoderArgs({ encoder: "libx264", crf: 20, preset: "veryfast" }), [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
  ]);
  assert.deepEqual(videoEncoderArgs({ encoder: "h264_nvenc", crf: 21, preset: "p5" }), [
    "-c:v",
    "h264_nvenc",
    "-preset",
    "p5",
    "-rc",
    "vbr",
    "-cq",
    "21",
  ]);
  assert.deepEqual(videoEncoderArgs({ encoder: "h264_nvenc", crf: 21, preset: "slow" }), [
    "-c:v",
    "h264_nvenc",
    "-preset",
    "p4",
    "-rc",
    "vbr",
    "-cq",
    "21",
  ]);
  assert.deepEqual(videoEncoderArgs({ encoder: "h264_qsv", crf: 23 }), [
    "-c:v",
    "h264_qsv",
    "-preset",
    "veryfast",
    "-global_quality",
    "23",
  ]);
  assert.deepEqual(videoEncoderArgs({ encoder: "copy", crf: 20 }), ["-c:v", "copy"]);
  assert.throws(() => videoEncoderArgs({ encoder: "lib x264" }), /invalid encoder/);
});

test("stabilize passes follow the same encoder options", () => {
  const passes = buildStabilizePasses({
    input: "in.mp4",
    workDir: "work",
    encoder: "h264_amf",
    preset: "speed",
    crf: 22,
    filterThreads: 6,
  });
  assert.deepEqual(passes.detect.slice(0, 4), ["-y", "-filter_threads", "6", "-i"]);
  assert.deepEqual(passes.transform.slice(0, 4), ["-y", "-filter_threads", "6", "-i"]);
  assert.equal(passes.transform[passes.transform.indexOf("-c:v") + 1], "h264_amf");
  assert.equal(passes.transform[passes.transform.indexOf("-qp_i") + 1], "22");
});
