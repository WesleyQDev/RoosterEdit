import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  DRAFT_ENCODER_ORDER,
  buildProbeArgs,
  detectEncoders,
  parseEncoders,
  parseProbeJson,
  pickEncoder,
  probeKey,
  probeMedia,
  sourceFingerprint,
} from "../lib/media.mjs";

const tempDirs = [];

function makeTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-media-"));
  tempDirs.push(dir);
  return dir;
}

function makeFile(dir, name, content) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function ok(stdout = "", stderr = "") {
  return { ok: true, status: 0, stdout, stderr, error: null };
}

function fail(stderr = "") {
  return { ok: false, status: 1, stdout: "", stderr, error: null };
}

const PROBE_JSON = JSON.stringify({
  format: {
    duration: "12.5",
    size: "1000",
    bit_rate: "640000",
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
  },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "30000/1001",
      avg_frame_rate: "30000/1001",
    },
    { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
  ],
});

const FFMPEG_ENCODERS = [
  "Encoders:",
  " V..... = Video",
  " A..... = Audio",
  " S..... = Subtitle",
  " .F.... = Frame-level multithreading",
  " ------",
  " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC",
  " V....D h264_nvenc           NVIDIA NVENC H.264 encoder",
  " V....D h264_amf             AMD AMF H.264 Encoder",
  " A....D aac                  AAC (Advanced Audio Coding)",
  " S..... srt                  SubRip subtitle",
  " V....D libx264              duplicate line",
  "",
].join("\n");

function memoryCache() {
  const store = new Map();
  return {
    store,
    read(key) {
      return store.has(key) ? store.get(key) : null;
    },
    write(key, value) {
      store.set(key, value);
    },
  };
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProbeArgs requests JSON format and stream metadata", () => {
  const args = buildProbeArgs("clip.mp4");
  assert.deepEqual(args, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate,format_name",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate",
    "-of",
    "json",
    "clip.mp4",
  ]);
  assert.equal(buildProbeArgs(null).at(-1), "");
});

test("parseProbeJson normalizes ffprobe output", () => {
  const parsed = parseProbeJson(PROBE_JSON);
  assert.deepEqual(parsed, {
    duration: 12.5,
    bytes: 1000,
    bitRate: 640000,
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    width: 1920,
    height: 1080,
    fps: 29.97,
    codec: "h264",
    audio: true,
    channels: 2,
    sampleRate: 48000,
  });

  const invalid = parseProbeJson("{ nope");
  assert.match(invalid.error, /Could not parse ffprobe output/);

  const empty = parseProbeJson("{}");
  assert.equal(empty.duration, null);
  assert.equal(empty.width, null);
  assert.equal(empty.audio, false);
  assert.equal(empty.sampleRate, null);

  const noVideo = parseProbeJson(
    JSON.stringify({ format: { duration: "0" }, streams: [{ codec_type: "audio" }] })
  );
  assert.equal(noVideo.fps, null);
  assert.equal(noVideo.codec, null);
  assert.equal(noVideo.duration, null);
});

test("sourceFingerprint supports shallow, full, injected, and missing files", () => {
  const root = makeTemp();
  const file = makeFile(root, "clip.mp4", "hello world");
  const expected = crypto.createHash("sha256").update("hello world").digest("hex");

  const shallow = sourceFingerprint(file);
  assert.equal(shallow.path, fs.realpathSync.native(file));
  assert.equal(shallow.size, 11);
  assert.equal(typeof shallow.mtimeMs, "number");
  assert.equal("sha256" in shallow, false);

  const full = sourceFingerprint(file, { full: true });
  assert.equal(full.sha256, expected);

  const injected = sourceFingerprint(file, { full: true, hashFile: () => "deadbeef" });
  assert.equal(injected.sha256, "deadbeef");

  const injectedObject = sourceFingerprint(file, {
    full: true,
    hashFile: () => ({ sha256: "cafebabe" }),
  });
  assert.equal(injectedObject.sha256, "cafebabe");

  assert.throws(
    () => sourceFingerprint(file, { full: true, hashFile: async () => "nope" }),
    /must be synchronous/
  );

  assert.equal(sourceFingerprint(path.join(root, "missing.mp4")), null);
  assert.equal(sourceFingerprint(root), null);
  assert.equal(sourceFingerprint(null), null);
  assert.equal(sourceFingerprint(file, null).size, 11);
});

test("probeKey is stable and invalidates on content, stat, or version changes", () => {
  const file = path.join(os.tmpdir(), "rooster-fake-source.mp4");
  const stat = { size: 2048, mtimeMs: 1234.5 };

  const key = probeKey(file, { ffprobeVersion: "ffprobe 7.1", stat });
  assert.match(key, /^probe-[0-9a-f]{32}$/);
  assert.equal(probeKey(file, { ffprobeVersion: "ffprobe 7.1", stat }), key);
  assert.notEqual(probeKey(file, { ffprobeVersion: "ffprobe 7.2", stat }), key);
  assert.notEqual(probeKey(file, { ffprobeVersion: "ffprobe 7.1", stat: { ...stat, size: 4096 } }), key);
  assert.notEqual(
    probeKey(file, { ffprobeVersion: "ffprobe 7.1", stat: { ...stat, mtimeMs: 9999 } }),
    key
  );
  assert.equal(
    probeKey(file, { ffprobeVersion: "ffprobe 7.1", stat: () => stat }),
    key
  );
  assert.equal(probeKey(null, { stat }), null);
  assert.equal(probeKey(path.join(os.tmpdir(), "rooster-missing-source.mp4")), null);
});

test("probeMedia caches successful probes and bypasses with refresh", async () => {
  const root = makeTemp();
  const file = makeFile(root, "clip.mp4", "fake media");
  const cache = memoryCache();
  const calls = [];
  const run = async (name, args, options) => {
    calls.push({ name, args, options });
    return ok(PROBE_JSON);
  };

  const first = await probeMedia(file, {
    run,
    cache,
    ffprobeVersion: "ffprobe 7.1",
  });
  assert.equal(first.codec, "h264");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "ffprobe");
  assert.equal(calls[0].options.timeout, 30000);
  assert.equal(cache.store.size, 1);

  const second = await probeMedia(file, {
    run,
    cache,
    ffprobeVersion: "ffprobe 7.1",
  });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);

  const refreshed = await probeMedia(file, {
    run,
    cache,
    refresh: true,
    ffprobeVersion: "ffprobe 7.1",
  });
  assert.deepEqual(refreshed, first);
  assert.equal(calls.length, 2);
});

test("probe and encoder caches accept JSON-serialized values", async () => {
  const root = makeTemp();
  const file = makeFile(root, "clip.mp4", "fake media");
  const probeStore = new Map();
  const probeCache = {
    read(key) {
      return probeStore.has(key) ? probeStore.get(key) : null;
    },
    write(key, value) {
      probeStore.set(key, JSON.stringify(value));
    },
  };
  let probeRuns = 0;
  const probeRun = async () => {
    probeRuns += 1;
    return ok(PROBE_JSON);
  };

  await probeMedia(file, { run: probeRun, cache: probeCache, ffprobeVersion: "ffprobe 7.1" });
  const firstProbeRuns = probeRuns;
  const warmProbe = await probeMedia(file, {
    run: probeRun,
    cache: probeCache,
    ffprobeVersion: "ffprobe 7.1",
  });
  assert.equal(warmProbe.codec, "h264");
  assert.equal(probeRuns, firstProbeRuns);

  const encoderStore = new Map();
  const encoderCache = {
    read(key) {
      return encoderStore.has(key) ? encoderStore.get(key) : null;
    },
    write(key, value) {
      encoderStore.set(key, JSON.stringify(value));
    },
  };
  let encoderRuns = 0;
  const encoderRun = async () => {
    encoderRuns += 1;
    return ok(FFMPEG_ENCODERS);
  };

  await detectEncoders({ run: encoderRun, cache: encoderCache });
  const firstEncoderRuns = encoderRuns;
  const warmEncoders = await detectEncoders({ run: encoderRun, cache: encoderCache });
  assert.equal(warmEncoders.length, 5);
  assert.equal(encoderRuns, firstEncoderRuns);
});

test("probeMedia resolves the ffprobe version when caching and never caches errors", async () => {
  const root = makeTemp();
  const file = makeFile(root, "clip.mp4", "fake media");
  const cache = memoryCache();
  const calls = [];
  const run = async (name, args) => {
    calls.push({ name, args });
    if (args[0] === "-version") return ok("ffprobe version 7.1\nbuilt with gcc");
    return ok(PROBE_JSON);
  };

  const parsed = await probeMedia(file, { run, cache });
  assert.equal(parsed.codec, "h264");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["-version"]);
  assert.equal(cache.store.size, 1);

  const brokenFile = makeFile(root, "broken.mp4", "not media");
  const brokenCache = memoryCache();
  const broken = await probeMedia(brokenFile, {
    run: async () => fail("invalid data found when processing input"),
    cache: brokenCache,
    ffprobeVersion: "ffprobe 7.1",
  });
  assert.equal(broken.error, "invalid data found when processing input");
  assert.equal(brokenCache.store.size, 0);

  const noRun = await probeMedia(file, { cache, ffprobeVersion: "ffprobe 7.1" });
  assert.match(noRun.error, /run is required/);
});

test("parseEncoders understands ffmpeg encoder tables", () => {
  const encoders = parseEncoders(FFMPEG_ENCODERS);
  assert.deepEqual(
    encoders.map((encoder) => `${encoder.type}:${encoder.name}`),
    [
      "video:libx264",
      "video:h264_nvenc",
      "video:h264_amf",
      "audio:aac",
      "subtitle:srt",
    ]
  );
  assert.equal(encoders[0].description, "libx264 H.264 / AVC / MPEG-4 AVC");
  assert.deepEqual(parseEncoders(""), []);
  assert.deepEqual(parseEncoders("Encoders:\n V..... = Video\n ------"), []);
});

test("detectEncoders caches results, refreshes, and tolerates missing ffmpeg", async () => {
  const cache = memoryCache();
  const calls = [];
  const run = async (name, args, options) => {
    calls.push({ name, args, options });
    return ok(FFMPEG_ENCODERS);
  };

  const first = await detectEncoders({ run, cache });
  assert.equal(first.length, 5);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["-hide_banner", "-encoders"]);
  assert.equal(cache.store.size, 1);

  const second = await detectEncoders({ run, cache });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);

  const refreshed = await detectEncoders({ run, cache, refresh: true });
  assert.deepEqual(refreshed, first);
  assert.equal(calls.length, 2);

  const [key] = cache.store.keys();
  cache.store.set(key, { savedAt: 0, encoders: [{ name: "stale" }] });
  const expired = await detectEncoders({ run, cache });
  assert.deepEqual(expired, first);
  assert.equal(calls.length, 3);

  assert.deepEqual(await detectEncoders({}), []);
  assert.deepEqual(await detectEncoders({ run: async () => fail("ffmpeg missing"), cache: memoryCache() }), []);
});

test("pickEncoder prefers hardware for draft and libx264 for final", () => {
  assert.equal(DRAFT_ENCODER_ORDER[0], "h264_nvenc");
  assert.equal(
    pickEncoder({ quality: "draft", available: ["libx264", "h264_qsv", "h264_nvenc"] }),
    "h264_nvenc"
  );
  assert.equal(
    pickEncoder({ quality: "draft", available: ["libx264", "h264_amf"] }),
    "h264_amf"
  );
  assert.equal(
    pickEncoder({ quality: "draft", available: ["libx264", "h264_qsv"] }),
    "h264_qsv"
  );
  assert.equal(
    pickEncoder({
      quality: "draft",
      available: ["h264_videotoolbox", "libx264"],
      platform: "darwin",
    }),
    "h264_videotoolbox"
  );
  assert.equal(pickEncoder({ quality: "draft", available: ["libx264"] }), "libx264");
  assert.equal(pickEncoder({ quality: "draft", available: [] }), "libx264");
  assert.equal(pickEncoder({ quality: "draft", available: ["h264_nvenc"] }), "h264_nvenc");
  assert.equal(pickEncoder({ quality: "draft", available: ["something_else"] }), null);

  assert.equal(pickEncoder({ quality: "final", available: ["h264_nvenc", "libx264"] }), "libx264");
  assert.equal(pickEncoder({ quality: "final", available: [] }), "libx264");
  assert.equal(
    pickEncoder({ quality: "final", available: ["libx264"], override: "h264_nvenc" }),
    "h264_nvenc"
  );
  assert.equal(
    pickEncoder({ quality: "final", available: ["libx264"], encoder: "h264_amf" }),
    "h264_amf"
  );

  assert.equal(
    pickEncoder({ quality: "draft", available: [{ name: "h264_amf" }, "libx264"] }),
    "h264_amf"
  );
  assert.equal(pickEncoder(null), "libx264");
});
