# Audio — music ducking and SFX

Use this layer when the edit needs a music bed, sound effects, or both. It turns the audio fields in `edit/plan.json` into an FFmpeg mix that keeps the voice intelligible and the delivery loudness on target.

SFX are part of the channel's audio identity, not an optional afterthought. Tech, ads, motion graphics, and high-energy styles usually want whooshes, clicks, impacts, and UI sounds. Documentary and minimal styles should use them sparingly. If the channel style is unclear, ask before planning the audio layer.

The helpers live in `scripts/features/audio.mjs`. They build filter graphs and argument arrays; they never spawn FFmpeg or touch the workspace.

## Plan fields

`plan.music` is optional. `src` is required when the object exists and is relative to the project root.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `src` | string | — | Music file path. |
| `start` | number | `0` | Source in-point in seconds. |
| `end` | number | `start + duration` | Source out-point in seconds. |
| `gainDb` | number | `-18` | Music gain under the voice. |
| `duckUnderVoice` | boolean | `true` | Duck with `sidechaincompress`; `false` keeps constant gain. |
| `license`, `attribution` | string | — | Provenance metadata; not used by the mixer. |

`plan.sfx` is an optional array. `start` and `end` are **timeline** positions, not source in/out points. The source is trimmed from 0 to `end - start` and delayed to `start`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | `sfx-<n>` | Stable id for review and QA. |
| `src` | string | — | SFX file path. |
| `start` | number | — | Timeline start in seconds. |
| `end` | number | — | Timeline end in seconds; must be greater than `start`. |
| `gainDb` | number | `-12` | SFX gain. Keep it below the voice. |

```json
{
  "music": {
    "src": "assets/licensed/music/theme.mp3",
    "start": 12,
    "end": 72,
    "gainDb": -18,
    "duckUnderVoice": true,
    "license": "licensed",
    "attribution": "Track name - Artist"
  },
  "sfx": [
    {
      "id": "whoosh-01",
      "src": "library/sfx/whoosh-02.wav",
      "start": 11.8,
      "end": 12.6,
      "gainDb": -12
    }
  ]
}
```

Music is looped with `-stream_loop -1` and capped at the video duration. A music `end` beyond the source file is a planning error: FFmpeg will pad the missing part with silence.

## How the mix is built

`buildDuckingFilter({ duration, musicStart, musicEnd, gainDb, duck })` returns a graph with voice on input 0 and music on input 1:

```text
[1:a]atrim=...,volume=0.1259,afade=...,apad=whole_dur=60[music];
[0:a]asplit=2[voice][sc];
[music][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[ducked];
[voice][ducked]amix=inputs=2:duration=first:normalize=0[aout]
```

- `duck: true` uses the voice as a sidechain key. The music drops under speech and releases after it.
- `duck: false` uses the constant-gain fallback: trim, fade, pad, then `amix` with no sidechain.
- The music fades in for 1.2 s and out for 1.5 s, shortened for very short cues.
- `amix` uses `normalize=0` so `gainDb` is the actual gain instead of being halved again.
- The final mix is normalized to -14 LUFS integrated with a -1.5 dBTP ceiling. Use `-16`/`-23` for podcast or broadcast targets if the project requires it.

`buildSfxFilters({ sfx, duration })` returns one fragment per usable clip, with input indices starting at 2 by default:

```text
[2:a]atrim=start=0:end=1.5,asetpts=PTS-STARTPTS,volume=0.5012,adelay=2500:all=1[sfx0]
```

Pass `inputStart` when the SFX inputs do not begin after a music input. `normalizeMusic()` and `normalizeSfx()` are also exported for plans, previews, and validation code that need resolved timing and gain without building a filter.

## FFmpeg integration

`mixAudioArgs()` assembles the full argument list. `<skill>` below is the RoosterEdit base directory. The module does not resolve paths: convert `base.path` (usually under `engine/<engine>/assets/`), `music.src`, and each `sfx[].src` to absolute paths, or choose an FFmpeg `cwd` that resolves all of them.

```js
import { spawnSync } from "node:child_process";
import { mixAudioArgs } from "<skill>/scripts/features/audio.mjs";

const args = mixAudioArgs({
  base: {
    path: "engine/hyperframes/assets/base.mp4",
    hasVideo: true,
    hasAudio: true,
    duration: 60,
    kind: "video",
  },
  music: {
    src: "assets/licensed/music/theme.mp3",
    start: 12,
    end: 72,
    gainDb: -18,
    duckUnderVoice: true,
  },
  sfx: [
    { id: "whoosh-01", src: "library/sfx/whoosh-02.wav", start: 11.8, end: 12.6, gainDb: -12 },
  ],
  out: "engine/hyperframes/assets/base-mixed.mp4",
  duration: 60,
});

const result = spawnSync("ffmpeg", args, {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});
if (result.status !== 0) throw new Error(result.stderr);
```

Input order is base, music, then SFX. Video is stream-copied when the base has a video stream and the output is not audio-only. Audio is AAC 192 kbps for MP4/M4A/MOV, PCM for WAV, FLAC for FLAC, and MP3/Opus/Vorbis for those containers.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" audio <slug> [--input <path>] [--out <path>]
```

The command renders a preview of `plan.music` + `plan.sfx` into `assets/generated/audio-mix.mp4`. The plan remains the source of truth; `build` applies the same mix to the engine base.

## QA

- Voice remains intelligible at normal playback volume.
- Music is audible in gaps and clearly lower under speech.
- Ducking releases without pumping or a long recovery tail.
- SFX land on the intended frame and never mask a word.
- No clipping; true peak is at or below -1 dBTP.
- Integrated loudness matches the target (-14 LUFS for YouTube, -16 for podcasts, -23 for broadcast).
- The mix has no dropouts at music loop points or SFX boundaries.
- `ffprobe` confirms duration, sample rate, and channel layout.

## Limitations

- One music bed per plan; multiple simultaneous beds need separate passes.
- Ducking uses fixed threshold, ratio, attack, and release. There is no per-section volume automation or EQ-based de-esser.
- SFX always start at source time 0; there is no `in` field for one-shots.
- `mixAudioArgs` re-encodes the final audio and always applies `loudnorm` at a fixed -14 LUFS target; it is meant to be the final audio pass, not an intermediate stem. Change `LOUDNESS_FILTER` in the module for a different delivery target.
- Still-image projects are not automated; add the audio mix in the HyperFrames or Remotion project.
- The module does not probe media. Bad paths, unsupported codecs, or a music `end` past the file end fail in FFmpeg.
- Plan validation checks `sfx` ids, `src`, and timing; it does not yet validate every gain or all ducking parameters.
- `build` now uses `mixAudioArgs` for `plan.music` and `plan.sfx`; the `audio` command is a preview pass.
