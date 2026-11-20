import test from "node:test";
import assert from "node:assert/strict";

import { reframeArgs } from "../features/reframe.mjs";

const base = {
  input: "in.mp4",
  output: "out.mp4",
  sourceWidth: 1920,
  sourceHeight: 1080,
  format: "9:16",
};

test("reframeArgs defaults to libx264 and keeps the audio map optional", () => {
  const args = reframeArgs(base);
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("-crf"));
  assert.ok(args.includes("0:a:0?"));
  assert.ok(args.includes("-pix_fmt"));
  assert.equal(args.at(-1), "out.mp4");
});

test("reframeArgs uses hardware encoder flags", () => {
  const args = reframeArgs({ ...base, encoder: "h264_amf", crf: 20 });
  assert.ok(args.includes("h264_amf"));
  assert.ok(args.includes("-qp_i"));
  assert.ok(!args.includes("-crf"));
});

test("reframeArgs rejects copy with a filter", () => {
  assert.throws(() => reframeArgs({ ...base, encoder: "copy" }), /cannot be "copy"/);
});
