import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LOUDNORM_FILTER,
  MAX_AMIX_INPUTS,
  audioOutputArgs,
  buildDuckingFilter,
  buildSfxFilters,
  buildTimelineAudioGraph,
  loudnormFilter,
  mixAudioArgs,
  normalizeMusic,
  normalizeSfx,
  normalizeTimelineKeeps,
  normalizeVoiceover,
} from "../features/audio.mjs";

function count(text, needle) {
  return text.split(needle).length - 1;
}

test("normalizeMusic applies defaults and clamps timing and gain", () => {
  assert.equal(normalizeMusic(null, 10), null);
  assert.equal(normalizeMusic({}, 10), null);

  const music = normalizeMusic({ src: " music.mp3 ", start: 5, end: 20 }, 10);
  assert.equal(music.src, "music.mp3");
  assert.equal(music.start, 5);
  assert.equal(music.end, 15);
  assert.equal(music.gainDb, -18);
  assert.equal(music.duckUnderVoice, true);

  assert.equal(normalizeMusic({ src: "m.mp3", gainDb: -100 }, 10).gainDb, -60);
  assert.equal(normalizeMusic({ src: "m.mp3", gainDb: 50 }, 10).gainDb, 12);
  assert.equal(normalizeMusic({ src: "m.mp3", duckUnderVoice: false }, 10).duckUnderVoice, false);
});

test("normalizeSfx resolves durations, drops clips past the end and validates input", () => {
  assert.deepEqual(normalizeSfx(null, 10), []);
  const clips = normalizeSfx(
    [
      { id: "pop", src: "pop.wav", start: 1, end: 2 },
      { src: "late.wav", start: 10, end: 12 },
      { src: "tail.wav", start: 9, end: 20 },
    ],
    10
  );
  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0], {
    id: "pop",
    src: "pop.wav",
    start: 1,
    end: 2,
    gainDb: -12,
    duration: 1,
  });
  assert.equal(clips[1].end, 10);
  assert.equal(clips[1].duration, 1);

  assert.throws(() => normalizeSfx([{ start: 0, end: 1 }], 10), /missing src/);
  assert.throws(() => normalizeSfx([{ src: "x.wav" }], 10), /numeric start\/end/);
  assert.throws(() => normalizeSfx([{ src: "x.wav", start: 1, end: 1 }], 10), /end after/);
  assert.throws(() => normalizeSfx("x", 10), /must be an array/);
});

test("normalizeVoiceover skips unmeasured lines and clamps to the timeline", () => {
  const lines = normalizeVoiceover(
    {
      lines: [
        { id: "a", audio: "a.mp3", start: 1, duration: 2 },
        { id: "b", audio: "b.mp3", start: null, duration: null },
        { id: "c", audio: "", start: 1, duration: 2 },
        { id: "d", audio: "d.mp3", start: 9, duration: 5, srcStart: 0.5, gainDb: -3 },
        { id: "e", audio: "e.mp3", start: 20, duration: 1 },
      ],
    },
    { duration: 10 }
  );
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    id: "a",
    src: "a.mp3",
    start: 1,
    duration: 2,
    srcStart: 0,
    gainDb: 0,
  });
  assert.equal(lines[1].start, 9);
  assert.equal(lines[1].duration, 1);
  assert.equal(lines[1].srcStart, 0.5);
  assert.equal(lines[1].gainDb, -3);

  assert.throws(() => normalizeVoiceover("a.mp3"), /array or \{ lines/);
  assert.throws(() => normalizeVoiceover([null]), /must be an object/);
});

test("normalizeTimelineKeeps defaults to the full source and rejects bad ranges", () => {
  assert.deepEqual(normalizeTimelineKeeps(null, 10), [{ start: 0, end: 10 }]);
  assert.deepEqual(normalizeTimelineKeeps([], 10), [{ start: 0, end: 10 }]);
  assert.deepEqual(
    normalizeTimelineKeeps(
      [
        { start: -1, end: 4 },
        { start: 8, end: 12 },
        { start: 20, end: 22 },
      ],
      10
    ),
    [
      { start: 0, end: 4 },
      { start: 8, end: 12 },
      { start: 20, end: 22 },
    ]
  );

  assert.throws(() => normalizeTimelineKeeps([{ start: 2, end: 1 }], 10), /end after/);
  assert.throws(() => normalizeTimelineKeeps([{ start: 0 }], 10), /numeric start\/end/);
  assert.throws(() => normalizeTimelineKeeps([], 0), /duration must be a positive/);
  assert.throws(() => normalizeTimelineKeeps("x", 10), /must be an array/);
});

test("loudnormFilter resolves every supported option shape", () => {
  assert.equal(loudnormFilter(true), DEFAULT_LOUDNORM_FILTER);
  assert.equal(loudnormFilter(undefined), DEFAULT_LOUDNORM_FILTER);
  assert.equal(loudnormFilter(false), null);
  assert.equal(loudnormFilter(null), null);
  assert.equal(loudnormFilter("I=-16:TP=-2:LRA=9"), "loudnorm=I=-16:TP=-2:LRA=9");
  assert.equal(
    loudnormFilter("loudnorm=I=-16:TP=-2:LRA=9"),
    "loudnorm=I=-16:TP=-2:LRA=9"
  );
  assert.equal(loudnormFilter({ I: -16, TP: -2, LRA: 9 }), "loudnorm=I=-16:TP=-2:LRA=9");
  assert.throws(() => loudnormFilter("I=-16;[evil]"), /must not contain/);
  assert.throws(() => loudnormFilter([]), /expected true, false/);
});

test("audioOutputArgs picks codecs from the output extension", () => {
  assert.deepEqual(audioOutputArgs("mix.wav"), ["-c:a", "pcm_s16le"]);
  assert.deepEqual(audioOutputArgs("mix.flac"), ["-c:a", "flac"]);
  assert.deepEqual(audioOutputArgs("mix.mp3"), ["-c:a", "libmp3lame", "-b:a", "192k"]);
  assert.deepEqual(audioOutputArgs("mix.opus"), ["-c:a", "libopus", "-b:a", "160k"]);
  assert.deepEqual(audioOutputArgs("mix.m4a"), ["-c:a", "aac", "-b:a", "192k"]);
});

test("buildDuckingFilter keeps the documented voice-0/music-1 layout", () => {
  const graph = buildDuckingFilter({ duration: 10, outputLabel: "mix" });
  assert.match(graph, /^\[1:a\]atrim=start=0:end=10/);
  assert.match(graph, /\[0:a\]asplit=2\[voice\]\[sc\]/);
  assert.match(graph, /\[music\]\[sc\]sidechaincompress=/);
  assert.match(graph, /\[voice\]\[ducked\]amix=inputs=2:duration=first:[^;]*\[mix\]$/);

  const noDuck = buildDuckingFilter({ duration: 10, duck: false, outputLabel: "mix" });
  assert.ok(!noDuck.includes("sidechaincompress"));
  assert.match(noDuck, /\[0:a\]\[music\]amix=inputs=2/);
  assert.throws(() => buildDuckingFilter({ duration: 0 }), /duration must be a positive/);
  assert.throws(
    () => buildDuckingFilter({ duration: 10, outputLabel: "music" }),
    /reserved/
  );
});

test("buildSfxFilters indexes inputs from inputStart and delays timeline positions", () => {
  const filters = buildSfxFilters({
    sfx: [
      { src: "a.wav", start: 1.5, end: 2.5 },
      { src: "b.wav", start: 3, end: 3.2 },
    ],
    duration: 10,
    inputStart: 4,
  });
  assert.equal(filters.length, 2);
  assert.match(filters[0], /^\[4:a\]atrim=start=0:end=1,asetpts=PTS-STARTPTS,volume=0\.2512,adelay=1500:all=1\[sfx0\]$/);
  assert.match(filters[1], /^\[5:a\]atrim=start=0:end=0\.2,/);
  assert.match(filters[1], /adelay=3000:all=1\[sfx1\]$/);
});

test("mixAudioArgs still rejects images and mixes SFX onto a silent video base", () => {
  assert.throws(
    () =>
      mixAudioArgs({
        base: { path: "still.png", kind: "image", hasVideo: false, hasAudio: false },
        sfx: [{ src: "pop.wav", start: 1, end: 2 }],
        out: "mix.mp4",
        duration: 10,
      }),
    /still-image/
  );

  const args = mixAudioArgs({
    base: { path: "silent.mp4", kind: "video", hasVideo: true, hasAudio: false, duration: 10 },
    sfx: [{ src: "pop.wav", start: 1, end: 2 }],
    out: "mix.mp4",
    duration: 10,
  });
  assert.ok(args.join(" ").includes("anullsrc="));
  assert.ok(args.includes("-c:v"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.match(args[args.indexOf("-filter_complex") + 1], /loudnorm=/);
  assert.equal(args.at(-1), "mix.mp4");
});

test("buildTimelineAudioGraph handles a full-length source with no extras", () => {
  const graph = buildTimelineAudioGraph({
    duration: 10,
    hasSourceAudio: true,
    keeps: [],
  });
  assert.match(graph.filterComplex, /^\[0:a\]atrim=start=0:end=10,asetpts=PTS-STARTPTS\[tl_cut\]/);
  assert.match(graph.filterComplex, /\[tl_cut\]atrim=start=0:end=10,apad=whole_dur=10\[tl_base\]/);
  assert.match(graph.filterComplex, /\[tl_base\]loudnorm=I=-14:TP=-1\.5:LRA=11\[aout\]$/);
  assert.equal(count(graph.filterComplex, "loudnorm="), 1);
  assert.ok(!graph.filterComplex.includes("adelay"));
  assert.ok(!graph.filterComplex.includes("sidechaincompress"));
  assert.ok(!graph.filterComplex.includes("anullsrc"));
  assert.deepEqual(graph.inputs, { source: 0, music: null, voice: [], sfx: [] });
  assert.equal(graph.usesSilentBed, false);
});

test("buildTimelineAudioGraph concatenates multiple keeps and mixes voice lines", () => {
  const graph = buildTimelineAudioGraph({
    duration: 8,
    keeps: [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ],
    voiceover: [
      { audio: "a.mp3", start: 1.5, duration: 2, gainDb: -6 },
      { audio: "b.mp3", start: 5, duration: 1, srcStart: 0.25 },
    ],
  });
  assert.match(graph.filterComplex, /\[0:a\]atrim=start=0:end=4,asetpts=PTS-STARTPTS\[tl_cut0\]/);
  assert.match(graph.filterComplex, /\[0:a\]atrim=start=6:end=10,asetpts=PTS-STARTPTS\[tl_cut1\]/);
  assert.match(graph.filterComplex, /\[tl_cut0\]\[tl_cut1\]concat=n=2:v=0:a=1\[tl_cut\]/);
  assert.match(
    graph.filterComplex,
    /\[1:a\]atrim=start=0:end=2,asetpts=PTS-STARTPTS,volume=0\.5012,adelay=1500:all=1\[tl_line0\]/
  );
  assert.match(
    graph.filterComplex,
    /\[2:a\]atrim=start=0\.25:end=1\.25,asetpts=PTS-STARTPTS,adelay=5000:all=1\[tl_line1\]/
  );
  assert.match(graph.filterComplex, /\[tl_line0\]\[tl_line1\]amix=inputs=2:duration=longest:/);
  assert.match(graph.filterComplex, /\[tl_base\]\[tl_voice\]amix=inputs=2:duration=first:/);
  assert.deepEqual(graph.inputs.voice, [1, 2]);
  assert.equal(graph.counts.voice, 2);
});

test("buildTimelineAudioGraph mixes music with sidechain ducking", () => {
  const graph = buildTimelineAudioGraph({
    duration: 10,
    music: { src: "music.mp3", start: 2, end: 12, gainDb: -20, duckUnderVoice: true },
    voiceover: [{ audio: "voice.mp3", start: 1, duration: 2 }],
  });
  assert.match(graph.filterComplex, /\[1:a\]atrim=start=2:end=12,asetpts=PTS-STARTPTS,volume=0\.1/);
  assert.match(graph.filterComplex, /\[tl_speech\]asplit=2\[tl_prog\]\[tl_sc\]/);
  assert.match(graph.filterComplex, /\[tl_music\]\[tl_sc\]sidechaincompress=/);
  assert.match(graph.filterComplex, /\[tl_prog\]\[tl_ducked\]amix=inputs=2:duration=first:/);
  assert.equal(count(graph.filterComplex, "loudnorm="), 1);
  assert.equal(graph.music.loop, true);
  assert.equal(graph.music.input, 1);
  assert.deepEqual(graph.inputs.voice, [2]);
});

test("buildTimelineAudioGraph can skip ducking and mix music without a voice", () => {
  const graph = buildTimelineAudioGraph({
    duration: 10,
    music: { src: "music.mp3", duckUnderVoice: false },
  });
  assert.ok(!graph.filterComplex.includes("sidechaincompress"));
  assert.match(graph.filterComplex, /\[tl_base\]\[tl_music\]amix=inputs=2:duration=first:/);
});

test("buildTimelineAudioGraph uses a silent bed for video-only sources", () => {
  const graph = buildTimelineAudioGraph({
    duration: 10,
    hasSourceAudio: false,
    music: { src: "music.mp3", duckUnderVoice: true },
    sfx: [{ src: "pop.wav", start: 1, end: 1.2 }],
  });
  assert.match(graph.filterComplex, /^anullsrc=r=48000:cl=stereo,atrim=end=10,asetpts=PTS-STARTPTS\[tl_base\]/);
  assert.ok(!graph.filterComplex.includes("[0:a]"));
  assert.ok(!graph.filterComplex.includes("sidechaincompress"));
  assert.match(graph.filterComplex, /\[2:a\]atrim=start=0:end=0\.2/);
  assert.equal(graph.usesSilentBed, true);
  assert.equal(graph.speechPresent, false);
  assert.deepEqual(graph.inputs, { source: 0, music: 1, voice: [], sfx: [2] });
});

test("buildTimelineAudioGraph ducks music under voice even with a silent source", () => {
  const graph = buildTimelineAudioGraph({
    duration: 10,
    hasSourceAudio: false,
    voiceover: [{ audio: "voice.mp3", start: 2, duration: 1 }],
    music: { src: "music.mp3", duckUnderVoice: true },
    sfx: [{ src: "pop.wav", start: 1, end: 1.2 }],
  });
  assert.ok(graph.filterComplex.includes("anullsrc"));
  assert.match(graph.filterComplex, /\[tl_base\]\[tl_voice\]amix=inputs=2:duration=first:/);
  assert.match(graph.filterComplex, /\[tl_speech\]asplit=2/);
  assert.match(graph.filterComplex, /sidechaincompress=/);
  assert.deepEqual(graph.inputs, { source: 0, music: 1, voice: [2], sfx: [3] });
});

test("buildTimelineAudioGraph chunks many voice and SFX inputs", () => {
  assert.equal(MAX_AMIX_INPUTS, 32);
  const voiceover = Array.from({ length: 40 }, (_, index) => ({
    audio: `voice-${index}.mp3`,
    start: index,
    duration: 0.5,
  }));
  const graph = buildTimelineAudioGraph({
    duration: 60,
    voiceover,
  });
  assert.equal(count(graph.filterComplex, "amix=inputs=40"), 0);
  assert.equal(count(graph.filterComplex, "amix=inputs=32"), 1);
  assert.equal(count(graph.filterComplex, "amix=inputs=8"), 1);
  assert.match(graph.filterComplex, /\[tl_voice\]/);
  assert.equal(graph.inputs.voice.length, 40);

  const sfx = Array.from({ length: 40 }, (_, index) => ({
    src: `sfx-${index}.wav`,
    start: index,
    end: index + 0.2,
  }));
  const sfxGraph = buildTimelineAudioGraph({ duration: 60, sfx });
  assert.equal(count(sfxGraph.filterComplex, "amix=inputs=40"), 0);
  assert.equal(count(sfxGraph.filterComplex, "amix=inputs=32"), 1);
  assert.match(sfxGraph.filterComplex, /\[tl_sfxmix\]/);
  assert.equal(sfxGraph.inputs.sfx.length, 40);
});

test("buildTimelineAudioGraph emits a single loudnorm or a clean anull ending", () => {
  for (const loudnorm of [true, { I: -16, TP: -2, LRA: 9 }, false]) {
    const graph = buildTimelineAudioGraph({
      duration: 10,
      voiceover: [{ audio: "voice.mp3", start: 1, duration: 1 }],
      music: { src: "music.mp3" },
      sfx: [{ src: "pop.wav", start: 2, end: 2.2 }],
      loudnorm,
    });
    assert.equal(count(graph.filterComplex, "loudnorm="), loudnorm ? 1 : 0);
    assert.match(graph.filterComplex, /\[aout\]$/);
  }

  const custom = buildTimelineAudioGraph({ duration: 5, outputLabel: "deliver" });
  assert.match(custom.filterComplex, /\[deliver\]$/);
  assert.equal(custom.outputLabel, "deliver");
  assert.throws(
    () => buildTimelineAudioGraph({ duration: 5, outputLabel: "tl_bad" }),
    /must not start with/
  );
});

test("buildTimelineAudioGraph is deterministic and validates its inputs", () => {
  const options = {
    duration: 12,
    keeps: [{ start: 0, end: 6 }],
    voiceover: [{ audio: "v.mp3", start: 1, duration: 2 }],
    music: { src: "m.mp3", gainDb: -20 },
    sfx: [{ src: "s.wav", start: 3, end: 3.5 }],
    loudnorm: { I: -15, TP: -1.5, LRA: 10 },
  };
  assert.deepEqual(buildTimelineAudioGraph(options), buildTimelineAudioGraph(options));

  assert.throws(() => buildTimelineAudioGraph({ duration: 0 }), /duration must be a positive/);
  assert.throws(
    () => buildTimelineAudioGraph({ duration: 5, music: { gainDb: -18 } }),
    /music\.src is required/
  );
  assert.throws(
    () => buildTimelineAudioGraph({ duration: 5, music: "   " }),
    /music\.src is required/
  );
  assert.throws(
    () => buildTimelineAudioGraph({ duration: 5, sampleRate: 0 }),
    /sampleRate must be a positive/
  );
});
