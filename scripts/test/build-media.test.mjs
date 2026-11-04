import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ENGINE_CACHE_NAMES,
  buildBaseMediaArgs,
  buildTimelineAudioArgs,
  preserveEngineCaches,
  restoreEngineCaches,
} from "../lib/build-media.mjs";

function filterOf(args) {
  const index = args.indexOf("-filter_complex");
  return index === -1 ? null : args[index + 1];
}

function inputsOf(args) {
  const inputs = [];
  args.forEach((arg, index) => {
    if (arg === "-i") inputs.push(args[index + 1]);
  });
  return inputs;
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-build-media-"));
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

test("buildTimelineAudioArgs cuts source audio and applies one loudnorm", () => {
  const args = buildTimelineAudioArgs({
    source: "source.mp4",
    keeps: [],
    duration: 12,
    out: "mix.m4a",
    loudnorm: true,
  });
  assert.deepEqual(inputsOf(args), ["source.mp4"]);
  const graph = filterOf(args);
  assert.match(graph, /\[0:a\]atrim=start=0:end=12,asetpts=PTS-STARTPTS\[tl_cut\]/);
  assert.match(graph, /\[tl_cut\]atrim=start=0:end=12,apad=whole_dur=12\[tl_base\]/);
  assert.equal(count(graph, "loudnorm="), 1);
  assert.match(graph, /\[tl_base\]loudnorm=I=-14:TP=-1\.5:LRA=11\[aout\]$/);
  assert.ok(args.includes("[aout]"));
  assert.ok(args.includes("-c:a"));
  assert.ok(args.includes("aac"));
  assert.deepEqual(args.slice(-5), ["-ac", "2", "-t", "12", "mix.m4a"]);
  assert.equal(args.at(-1), "mix.m4a");
});

test("buildTimelineAudioArgs concatenates keeps without duplicating indexes", () => {
  const args = buildTimelineAudioArgs({
    source: "source.mp4",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    voiceover: [
      { audio: "voice-a.mp3", start: 0.5, duration: 1.5 },
      { audio: "voice-b.mp3", start: 3, duration: 2 },
    ],
    duration: 8,
    out: "mix.m4a",
  });
  const graph = filterOf(args);
  assert.match(graph, /\[0:a\]atrim=start=0:end=4,asetpts=PTS-STARTPTS\[tl_cut0\]/);
  assert.match(graph, /\[0:a\]atrim=start=6:end=10,asetpts=PTS-STARTPTS\[tl_cut1\]/);
  assert.match(graph, /\[tl_cut0\]\[tl_cut1\]concat=n=2:v=0:a=1\[tl_cut\]/);
  assert.match(graph, /\[1:a\]atrim=start=0:end=1\.5,asetpts=PTS-STARTPTS,adelay=500:all=1\[tl_line0\]/);
  assert.match(graph, /\[2:a\]atrim=start=0:end=2,asetpts=PTS-STARTPTS,adelay=3000:all=1\[tl_line1\]/);
  assert.match(graph, /amix=inputs=2:duration=longest:dropout_transition=2:normalize=0\[tl_voice\]/);
  assert.match(graph, /\[tl_base\]\[tl_voice\]amix=inputs=2:duration=first:/);
  assert.equal(count(graph, "loudnorm="), 1);
  assert.deepEqual(inputsOf(args), ["source.mp4", "voice-a.mp3", "voice-b.mp3"]);
});

test("buildTimelineAudioArgs mixes looped music, voice and SFX in fixed input order", () => {
  const args = buildTimelineAudioArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 10 }],
    voiceover: [{ audio: "voice.mp3", start: 1, duration: 2 }],
    music: { src: "music.mp3", start: 5, end: 15, gainDb: -18, duckUnderVoice: true },
    sfx: [{ src: "pop.wav", start: 4, end: 4.5, gainDb: -10 }],
    duration: 10,
    out: "mix.m4a",
  });
  const graph = filterOf(args);
  assert.deepEqual(inputsOf(args), ["source.mp4", "music.mp3", "voice.mp3", "pop.wav"]);
  assert.ok(args.join(" ").includes("-stream_loop -1 -i music.mp3"));
  assert.match(graph, /\[1:a\]atrim=start=5:end=15,asetpts=PTS-STARTPTS,volume=0\.1259/);
  assert.match(graph, /\[tl_music\]/);
  assert.match(graph, /asplit=2\[tl_prog\]\[tl_sc\]/);
  assert.match(graph, /\[tl_music\]\[tl_sc\]sidechaincompress=/);
  assert.match(graph, /\[3:a\]atrim=start=0:end=0\.5,[^\]]*\[sfx0\]/);
  assert.match(graph, /\[tl_musicmix\]\[sfx0\]amix=inputs=2:duration=first:/);
  assert.equal(count(graph, "loudnorm="), 1);
});

test("buildTimelineAudioArgs handles a video-only source with music and SFX", () => {
  const args = buildTimelineAudioArgs({
    source: "silent.mp4",
    hasAudio: false,
    music: { src: "music.mp3", duckUnderVoice: true },
    sfx: [{ src: "pop.wav", start: 1, end: 1.2 }],
    duration: 10,
    out: "mix.m4a",
  });
  const graph = filterOf(args);
  assert.ok(graph.includes("anullsrc=r=48000:cl=stereo"));
  assert.ok(!graph.includes("[0:a]"));
  assert.ok(!graph.includes("sidechaincompress"));
  assert.match(graph, /\[1:a\]atrim=start=0:end=10/);
  assert.match(graph, /\[2:a\]atrim=start=0:end=0\.2/);
  assert.deepEqual(inputsOf(args), ["silent.mp4", "music.mp3", "pop.wav"]);
});

test("buildTimelineAudioArgs ducks music under voice when the source is silent", () => {
  const args = buildTimelineAudioArgs({
    source: "silent.mp4",
    hasAudio: false,
    voiceover: [{ audio: "voice.mp3", start: 2, duration: 1 }],
    music: { src: "music.mp3", duckUnderVoice: true },
    duration: 10,
    out: "mix.m4a",
  });
  const graph = filterOf(args);
  assert.ok(graph.includes("anullsrc"));
  assert.match(graph, /\[tl_base\]\[tl_voice\]amix=inputs=2:duration=first:/);
  assert.match(graph, /\[tl_speech\]asplit=2/);
  assert.match(graph, /sidechaincompress=/);
});

test("buildTimelineAudioArgs skips ducking when requested and can disable loudnorm", () => {
  const args = buildTimelineAudioArgs({
    source: "source.mp4",
    music: { src: "music.mp3", duckUnderVoice: false },
    duration: 5,
    out: "mix.wav",
    loudnorm: false,
  });
  const graph = filterOf(args);
  assert.ok(!graph.includes("sidechaincompress"));
  assert.ok(!graph.includes("loudnorm="));
  assert.match(graph, /\[tl_musicmix\]anull\[aout\]$/);
  assert.ok(args.includes("pcm_s16le"));
});

test("buildTimelineAudioArgs chunks many voice lines instead of one huge amix", () => {
  const voiceover = Array.from({ length: 40 }, (_, index) => ({
    id: `line-${index}`,
    audio: `voice-${index}.mp3`,
    start: index,
    duration: 0.5,
  }));
  const args = buildTimelineAudioArgs({
    source: "source.mp4",
    voiceover,
    duration: 60,
    out: "mix.m4a",
  });
  const graph = filterOf(args);
  assert.equal(count(graph, "amix=inputs=40"), 0);
  assert.equal(count(graph, "amix=inputs=32"), 1);
  assert.equal(count(graph, "amix=inputs=8"), 1);
  assert.match(graph, /\[tl_voice\]/);
  assert.equal(inputsOf(args).length, 41);
});

test("buildTimelineAudioArgs validates required inputs", () => {
  assert.throws(() => buildTimelineAudioArgs({ duration: 1, out: "x.m4a" }), /source is required/);
  assert.throws(
    () => buildTimelineAudioArgs({ source: "s.mp4", duration: 1 }),
    /out is required/
  );
  assert.throws(
    () => buildTimelineAudioArgs({ source: "s.mp4", duration: 0, out: "x.m4a" }),
    /duration must be a positive/
  );
  assert.throws(
    () =>
      buildTimelineAudioArgs({
        source: "s.mp4",
        duration: 1,
        out: "x.m4a",
        sampleRate: 0,
      }),
    /sampleRate must be a positive/
  );
});

test("buildBaseMediaArgs copies streams when there are no cuts", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [],
    out: "base.mp4",
    hasVideo: true,
    hasAudio: true,
    loudnorm: false,
  });
  assert.equal(filterOf(args), null);
  assert.deepEqual(args, [
    "-y",
    "-i",
    "source.mp4",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c",
    "copy",
    "base.mp4",
  ]);
});

test("buildBaseMediaArgs treats a full-length keep as no cuts when duration is known", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 10 }],
    duration: 10,
    out: "base.mp4",
    loudnorm: false,
  });
  assert.equal(filterOf(args), null);
  assert.ok(args.includes("copy"));

  const withoutDuration = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 10 }],
    out: "base.mp4",
    loudnorm: false,
  });
  assert.ok(filterOf(withoutDuration).includes("trim=start=0:end=10"));
});

test("buildBaseMediaArgs re-encodes audio and copies video when normalizing without cuts", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    out: "base.mp4",
    loudnorm: true,
  });
  assert.equal(filterOf(args), null);
  assert.ok(args.includes("-c:v"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.ok(args.includes("-af"));
  assert.match(args[args.indexOf("-af") + 1], /^loudnorm=/);
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("-ar"));
});

test("buildBaseMediaArgs cuts video and audio in one graph", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    out: "base.mp4",
    hasVideo: true,
    hasAudio: true,
    encoder: "libx264",
    preset: "veryfast",
    crf: 20,
    loudnorm: true,
  });
  const graph = filterOf(args);
  assert.match(graph, /\[0:v\]trim=start=0:end=4,setpts=PTS-STARTPTS\[bv0\]/);
  assert.match(graph, /\[0:a\]atrim=start=0:end=4,asetpts=PTS-STARTPTS\[ba0\]/);
  assert.match(
    graph,
    /\[bv0\]\[ba0\]\[bv1\]\[ba1\]concat=n=2:v=1:a=1\[basev\]\[basea\]/
  );
  assert.match(graph, /\[basea\]loudnorm=I=-14:TP=-1\.5:LRA=11\[aout\]$/);
  assert.equal(count(graph, "loudnorm="), 1);
  assert.ok(args.includes("[basev]"));
  assert.ok(args.includes("[aout]"));
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("veryfast"));
  assert.ok(args.includes("20"));
  assert.equal(args.at(-1), "base.mp4");
});

test("buildBaseMediaArgs handles video-only cuts without audio filters", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    out: "base.mp4",
    hasVideo: true,
    hasAudio: false,
    loudnorm: true,
  });
  const graph = filterOf(args);
  assert.ok(!graph.includes("atrim"));
  assert.match(graph, /concat=n=2:v=1:a=0\[basev\]/);
  assert.ok(!graph.includes("loudnorm"));
  assert.ok(args.includes("[basev]"));
  assert.ok(!args.includes("-c:a"));
});

test("buildBaseMediaArgs handles audio-only cuts", () => {
  const args = buildBaseMediaArgs({
    source: "source.wav",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    out: "base.m4a",
    hasVideo: false,
    hasAudio: true,
    loudnorm: true,
  });
  const graph = filterOf(args);
  assert.ok(!graph.includes("[0:v]"));
  assert.match(graph, /concat=n=2:v=0:a=1\[basea\]/);
  assert.match(graph, /\[basea\]loudnorm=I=-14:TP=-1\.5:LRA=11\[aout\]$/);
  assert.ok(args.includes("[aout]"));
  assert.ok(!args.includes("-c:v"));
});

test("buildBaseMediaArgs emits valid hardware encoder flags", () => {
  const defaults = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 4 }],
    out: "base.mp4",
    crf: null,
    preset: null,
  });
  assert.deepEqual(
    defaults.slice(defaults.indexOf("-c:v"), defaults.indexOf("-c:v") + 6),
    ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
  );

  const nvenc = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 4 }],
    out: "base.mp4",
    encoder: "h264_nvenc",
    preset: "veryfast",
    crf: 23,
  });
  assert.deepEqual(
    nvenc.slice(nvenc.indexOf("-c:v"), nvenc.indexOf("-c:v") + 7),
    ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq"]
  );

  const amf = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [{ start: 0, end: 4 }],
    out: "base.mp4",
    encoder: "h264_amf",
    preset: "balanced",
    crf: 23,
  });
  assert.ok(amf.includes("h264_amf"));
  assert.ok(amf.includes("-quality"));
  assert.ok(amf.includes("balanced"));
  assert.ok(amf.includes("-qp_i"));
});

test("buildBaseMediaArgs adds punch-in and audio micro-fades at cut joins", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    out: "base.mp4",
    hasVideo: true,
    hasAudio: true,
    loudnorm: false,
    punchKeeps: [false, true],
    punchScale: 1.04,
    frameWidth: 640,
    frameHeight: 360,
    cutFade: 0.04,
  });
  const graph = filterOf(args);
  assert.match(
    graph,
    /\[0:v\]trim=start=6:end=10,scale=trunc\(iw\*1\.04\/2\)\*2:trunc\(ih\*1\.04\/2\)\*2,crop=640:360,setsar=1,setpts=PTS-STARTPTS\[bv1\]/
  );
  assert.equal(count(graph, "afade=t=in"), 1);
  assert.equal(count(graph, "afade=t=out"), 1);
  assert.match(graph, /\[0:a\]atrim=start=0:end=4,asetpts=PTS-STARTPTS,afade=t=out:st=3\.96:d=0\.04\[ba0\]/);
  assert.match(graph, /\[0:a\]atrim=start=6:end=10,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.04\[ba1\]/);
});

test("buildBaseMediaArgs applies punch only to flagged keeps", () => {
  const args = buildBaseMediaArgs({
    source: "source.mp4",
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
      { start: 12, end: 16 },
    ],
    out: "base.mp4",
    loudnorm: false,
    punchKeeps: [false, true, false],
    punchScale: 1.05,
    frameWidth: 1920,
    frameHeight: 1080,
  });
  const graph = filterOf(args);
  assert.equal(count(graph, "scale=trunc"), 1);
  assert.ok(!graph.includes("[0:v]trim=start=0:end=4,scale="));
  assert.ok(!graph.includes("[0:v]trim=start=12:end=16,scale="));
});

test("buildBaseMediaArgs validates its inputs", () => {
  assert.throws(
    () => buildBaseMediaArgs({ source: "s.mp4", out: "x.mp4", hasVideo: false, hasAudio: false }),
    /neither video nor audio/
  );
  assert.throws(
    () => buildBaseMediaArgs({ source: "s.mp4", out: "x.m4a", hasVideo: true }),
    /video container/
  );
  assert.throws(
    () =>
      buildBaseMediaArgs({
        source: "s.mp4",
        out: "x.mp4",
        keeps: [{ start: 0, end: 1 }],
        encoder: "copy",
      }),
    /cannot be "copy"/
  );
  assert.throws(
    () => buildBaseMediaArgs({ source: "s.mp4", out: "x.mp4", keeps: [{ start: 2, end: 1 }] }),
    /must end after/
  );
});

test("preserveEngineCaches and restoreEngineCaches move caches around a rebuild", () => {
  const project = tempRoot();
  try {
    const engineDir = path.join(project.root, "engine", "hyperframes");
    const cacheDir = path.join(project.root, "work", "engine-cache");
    const transcode = path.join(engineDir, ".transcode-cache");
    const waveform = path.join(engineDir, ".waveform-cache");
    fs.mkdirSync(path.join(transcode, "nested"), { recursive: true });
    fs.writeFileSync(path.join(transcode, "nested", "clip.bin"), "cache", "utf8");
    fs.mkdirSync(waveform, { recursive: true });
    fs.writeFileSync(path.join(waveform, "wave.json"), "{}", "utf8");

    const preserved = preserveEngineCaches(engineDir, cacheDir);
    assert.deepEqual(
      preserved.moved.map((entry) => entry.name).sort(),
      [...ENGINE_CACHE_NAMES].sort()
    );
    assert.ok(!fs.existsSync(transcode));
    assert.ok(!fs.existsSync(waveform));
    assert.equal(fs.readFileSync(path.join(cacheDir, ".transcode-cache", "nested", "clip.bin"), "utf8"), "cache");

    // Simulate a rebuild that created a fresh, incomplete cache.
    fs.mkdirSync(path.join(engineDir, ".transcode-cache"), { recursive: true });
    fs.writeFileSync(path.join(engineDir, ".transcode-cache", "fresh.bin"), "fresh", "utf8");

    const restored = restoreEngineCaches(engineDir, cacheDir);
    assert.deepEqual(
      restored.restored.map((entry) => entry.name).sort(),
      [...ENGINE_CACHE_NAMES].sort()
    );
    assert.equal(fs.readFileSync(path.join(transcode, "nested", "clip.bin"), "utf8"), "cache");
    assert.ok(!fs.existsSync(path.join(transcode, "fresh.bin")));
    assert.ok(!fs.existsSync(path.join(cacheDir, ".transcode-cache")));
  } finally {
    project.cleanup();
  }
});

test("engine cache helpers tolerate missing directories and reject nested cache dirs", () => {
  const project = tempRoot();
  try {
    const engineDir = path.join(project.root, "engine");
    const cacheDir = path.join(project.root, "cache");

    const preserved = preserveEngineCaches(engineDir, cacheDir);
    assert.deepEqual(preserved.moved, []);
    assert.deepEqual(preserved.missing, [...ENGINE_CACHE_NAMES]);

    const restored = restoreEngineCaches(engineDir, cacheDir);
    assert.deepEqual(restored.restored, []);
    assert.deepEqual(restored.missing, [...ENGINE_CACHE_NAMES]);

    assert.throws(() => preserveEngineCaches(engineDir, path.join(engineDir, "caches")), /inside the engine/);
    assert.throws(() => preserveEngineCaches("", cacheDir), /engineDir is required/);
  } finally {
    project.cleanup();
  }
});
