# Multicamera, J/L cuts, and speed ramps

## Purpose

Describe camera switching, overlapping audio/video, and speed changes in the edit plan, then normalize them for an FFmpeg or engine adapter. The helpers are editorial tools, not an automatic multicam synchronizer. Camera choice stays a human/agent decision.

## Plan fields

### Multicamera

Add `multicam` to `edit/plan.json` (unknown fields are preserved) or use the same object in the timeline adapter:

```json
{
  "multicam": {
    "cameras": [
      { "id": "cam-a", "src": "assets/source/cam-a.mp4", "angle": "wide" },
      { "id": "cam-b", "src": "assets/source/cam-b.mp4", "angle": "close" }
    ],
    "cuts": [
      { "id": "switch-1", "start": 0, "end": 8.0, "camera": "cam-a" },
      { "id": "switch-2", "start": 8.0, "end": 12.0, "camera": "cam-b" },
      { "id": "switch-3", "start": 12.0, "end": 15.0, "camera": "cam-a" }
    ]
  }
}
```

`cameras[].id` and `src` are required. `angle` is a human label (`wide`, `close`, `left`) and may be a number for a rig angle. `cuts` are explicit switch points; include a cut at `0` when the opening camera matters. Times are seconds on a shared timeline.

### Speed

A constant speed is a clip or element field:

```json
{ "id": "clip-02", "src": "assets/source/take.mp4", "speed": 1.25 }
```

A ramp is local to the clip or element:

```json
{
  "id": "clip-03",
  "src": "assets/source/take.mp4",
  "speedRamp": { "from": 0.5, "to": 2.0, "start": 4.0, "end": 6.0 }
}
```

`speed` is a multiplier: `1` is normal, `2` is twice as fast, `0.5` is half speed. `speedRamp.start` and `end` are seconds inside the clip or element, not global timeline seconds.

### J/L cuts

Add offsets to a clip:

```json
{ "id": "clip-04", "src": "assets/source/interview.mp4", "audioOffset": -0.4, "videoOffset": 0.15 }
```

Offsets are seconds relative to the clip's nominal start. Positive values delay that stream; negative values advance it. `audioOffset < 0` makes audio lead the video (the incoming side of an L cut); `audioOffset > 0` makes audio lag the video (the outgoing side of a J cut). `videoOffset` shifts the picture independently. The source needs enough handle media for a negative offset.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" multicam <slug> [--file <json>] [--render] [--update-plan]
```

The command reads `plan.multicam` (or a JSON file), normalizes cameras/cuts, and writes `edit/multicam.json` with segments, gaps, and warnings. `--render` cuts and concatenates the camera segments into `assets/generated/multicam.mp4`; `--update-plan` points `plan.source` at it. Review the cut list before building.

## `buildMulticamPlan`

```js
import { buildMulticamPlan } from "<skill>/scripts/features/multicam.mjs";

const plan = buildMulticamPlan({
  cameras: [
    { id: "cam-a", src: "assets/source/cam-a.mp4", angle: "wide" },
    { id: "cam-b", src: "assets/source/cam-b.mp4", angle: "close" }
  ],
  cuts: [
    { id: "switch-1", start: 0, end: 8, camera: "cam-a" },
    { id: "switch-2", start: 8, end: 12, camera: "cam-b" },
    { id: "switch-3", start: 12, end: 15, camera: "cam-a" }
  ],
  duration: 15
});
```

It returns `rooster.multicam/v1`:

```json
{
  "schema": "rooster.multicam/v1",
  "duration": 15,
  "segments": [
    { "id": "seg-001", "start": 0, "end": 8, "camera": "cam-a", "source": "cut", "derived": false },
    { "id": "seg-002", "start": 8, "end": 12, "camera": "cam-b", "source": "cut", "derived": false },
    { "id": "seg-003", "start": 12, "end": 15, "camera": "cam-a", "source": "cut", "derived": false }
  ],
  "gaps": [],
  "warnings": []
}
```

Cuts are sorted. Overlaps are trimmed to the previous cut. Gaps are filled with the previous camera (or the first camera before the first cut), marked `derived: true`, and listed in `gaps`. Adjacent segments with the same camera are merged. `duration` is optional; without it, the last cut ends the plan. Unknown camera references in cuts, non-numeric times, and fully covered cuts produce warnings instead of throwing; invalid camera definitions (missing id or src) throw.

## `speedFilter`

```js
import { speedFilter } from "<skill>/scripts/features/multicam.mjs";

const fast = speedFilter({ speed: 1.25, fps: 30 });
```

```json
{
  "video": "setpts=(PTS-STARTPTS)/1.25",
  "audio": "atempo=1.25",
  "videoFilter": "setpts=(PTS-STARTPTS)/1.25,fps=30",
  "audioFilter": "atempo=1.25",
  "atempo": [1.25],
  "warnings": []
}
```

Apply the fragments with FFmpeg:

```bash
ffmpeg -i input.mp4 -filter_complex \
  "[0:v]setpts=(PTS-STARTPTS)/1.25,fps=30[v];[0:a]atempo=1.25[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -c:a aac output.mp4
```

`atempo` preserves pitch. Speeds outside the common `0.5–2.0` range are chained, so `0.25x` becomes `atempo=0.5,atempo=0.5`. Output duration is roughly input duration divided by speed.

A linear `speedRamp` cannot be represented by one `atempo` stage. Split the ramp into short windows, apply `speedFilter` to each window, and concatenate; or use an engine with native time remapping. Keep audio and video segments aligned.

## `jlCutOffsets`

```js
import { jlCutOffsets } from "<skill>/scripts/features/multicam.mjs";

const offsets = jlCutOffsets({
  clip: { start: 10, end: 14, audioOffset: -0.4, videoOffset: 0.15 }
});
// audioOffset: -0.4, videoOffset: 0.15
// audioStart: 9.6, videoStart: 10.15
// mode: "custom", audioLeads: true
```

Offsets are clamped to the clip duration when `start`/`end`, `in`/`out`, or `duration` is known; the result records `clamped.audio` and `clamped.video`. `mode` is `L` for an audio lead, `J` for an audio lag, `custom` when both offsets are non-zero, `video-only`, or `none`.

## Integration

- Add `multicam` to `edit/plan.json` and keep the camera/cut ids stable.
- Put `speed`, `speedRamp`, `audioOffset`, and `videoOffset` on timeline clips or plan elements.
- FFmpeg: split the source at every camera segment, apply each segment's in/out and speed filter, then `concat`. For J/L cuts, keep audio on its own `atrim`/`adelay`/`amix` path so picture and sound can move independently.
- HyperFrames/Remotion: render one video sequence per camera segment and a separate audio sequence for offset audio. There is no native multicam switch node.
- `multicam <slug>` normalizes the plan into `edit/multicam.json`; current `build` still handles one base source and does not yet cut between camera sources or apply speed/J-L fields automatically.
- Show the multicam plan and speed choices for approval before building. Camera selection is editorial.

## Limitations

- No automatic sync, waveform alignment, timecode matching, face detection, or angle scoring. Cameras must share a usable timebase and be pre-aligned if they drift.
- Gaps are filled with the previous or first camera; these segments are marked `derived`. Overlapping cuts are trimmed, not split.
- `speedFilter` handles constant speed only. Ramps must be chunked, and each chunk adds edit boundaries.
- `atempo` preserves pitch but extreme speeds still sound unnatural. There is no optical-flow interpolation; `fps` may duplicate or drop frames.
- Captions, subtitles, and element timings must be retimed when speed changes duration.
- J/L offsets are clamped to the known clip duration; they cannot invent handle media or repair a source that is too short.
- The helpers never execute FFmpeg or touch media files. Verify the final filtergraph with a short draft render.
