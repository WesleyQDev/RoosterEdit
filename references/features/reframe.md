# Reframe

`scripts/features/reframe.mjs` converts a fixed source frame to another delivery aspect ratio with FFmpeg. It builds filters and arguments only; it does not probe, execute, or write media.

Use it for a vertical cut of a 16:9 interview (Shorts, Reels, TikTok), a square post, or a 4:5 feed video. The plan and timeline stay the editorial source of truth; reframing is a delivery step.

## Purpose

- Map `16:9`, `9:16`, `1:1`, and `4:5` to delivery sizes.
- Crop the largest possible region at the target aspect, then scale to exact dimensions.
- Anchor the crop at the center, left, right, or a normalized focus point.
- Keep the operation deterministic, dependency-free, and testable without FFmpeg.

## Inputs and outputs

### `targetDimensions(format)`

Returns `{ width, height }`.

| Format | Size |
|---|---|
| `16:9` | 1920 × 1080 |
| `9:16` | 1080 × 1920 |
| `1:1` | 1080 × 1080 |
| `4:5` | 1080 × 1350 |

An object such as `{ width: 1080, height: 1350 }` is also accepted for custom sizes. Unknown strings throw.

### `buildReframeFilter(options)`

| Option | Default | Meaning |
|---|---|---|
| `sourceWidth`, `sourceHeight` | required | Display-oriented source dimensions |
| `targetWidth`, `targetHeight` | required | Output dimensions |
| `mode` | `"center"` | `center`, `left`, `right`, or `focus` |
| `focusX`, `focusY` | `0.5` | Normalized focus point for `focus` mode (0–1) |

Returns a single FFmpeg filter:

```text
crop=608:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1
```

The crop box is the largest rectangle at the target aspect. Crop sizes and offsets are rounded to even numbers for chroma-subsampled output. `center` centers the crop, `left`/`right` anchor horizontally and center vertically, and `focus` centers the normalized point. Out-of-range focus values are clamped.

### `reframeArgs(options)`

Takes `input`, `output`, `sourceWidth`, `sourceHeight`, `format`, `mode`, `focusX`, `focusY`, plus optional `crf` (default `18`) and `preset` (default `"medium"`).

Returns an argument array for FFmpeg, for example:

```js
[
  "-y", "-i", "base.mp4",
  "-map", "0:v:0", "-map", "0:a:0?",
  "-vf", "crop=608:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
  "base-vertical.mp4"
]
```

It drops subtitle/data streams, keeps optional audio as AAC, and does not execute anything.

## Plan fields

Aspect ratio is recorded in more than one place; keep them consistent:

| File | Field | Change |
|---|---|---|
| `project.json` | `format.aspect`, `format.width`, `format.height` | Target delivery format |
| `edit/plan.json` | `format.width`, `format.height` | Renderers read this; absent values default to 1920 × 1080 |
| `edit/timeline.json` | `format.width`, `format.height` | Review and timeline dimensions |
| `edit/plan.json` | `elements[]` positions and text widths | Re-check portrait safe areas after reframing |

`format.duration`, cuts, and element times do not change. Reframing crops the picture; it does not retime the edit.

## Commands

Run the CLI:

```bash
node "<skill>/scripts/rooster.mjs" reframe <slug> --format 9:16 [--mode center|left|right|focus] [--focus-x 0.5] [--focus-y 0.42] [--update-plan]
```

The output defaults to `assets/generated/reframed-<aspect>.mp4`. With `--update-plan`, `plan.source` points at the new file and `project.json`/`timeline.json` formats are updated to the target aspect; preview the crop before rendering.

Probe the source first:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 assets/source/interview.mp4
```

Build and run the command from a small script:

```js
import { spawnSync } from "node:child_process";
import { reframeArgs } from "./scripts/features/reframe.mjs";

const args = reframeArgs({
  input: "engine/hyperframes/assets/base.mp4",
  output: "renders/base-9x16.mp4",
  sourceWidth: 1920,
  sourceHeight: 1080,
  format: "9:16",
  mode: "focus",
  focusX: 0.5,
  focusY: 0.42,
});

const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (result.status !== 0) throw new Error("ffmpeg reframe failed");
```

The equivalent shell filter is:

```bash
ffmpeg -y -i base.mp4 -vf "crop=608:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k base-vertical.mp4
```

## Integration

1. Build the cut base first (`buildBaseMediaCore` does this in the CLI). Reframe the resulting `base.mp4`, not the raw source, so cut boundaries and audio normalization are preserved.
2. Set `plan.format`, `project.json.format`, and `timeline.json.format` to the target. HyperFrames and Remotion use `plan.format` for composition size.
3. Point the engine base at the reframed file. In HyperFrames that means the `<video>`/`<img>` `src`; in Remotion it means `base.path` in `src/data/plan.ts`.
4. Re-check overlays. The current generators position text and cards with fixed pixel values authored for 1920 × 1080. `object-fit: cover` on b-roll/base media does not relayout titles, lower-thirds, or captions.
5. For per-scene framing, reframe each clip with different `mode`/focus values, then assemble those clips in `edit/timeline.json`.

This module is not called by `build` yet. Treat the steps above as an adapter until the CLI wires it in.

## Limitations

- **No ML subject tracking.** There is no face detection, saliency model, or auto pan-and-scan. `center` is a geometric guess and can cut off a speaker.
- **Fixed focus.** `focus` uses one normalized point (`focusX`, `focusY`) for the entire clip. It does not follow movement or animate over time.
- **One framing per run.** Use separate runs and a timeline for different framings per scene.
- **Extreme crops lose area.** A centered 16:9 → 9:16 crop keeps only about 32% of the source width (608 of 1920 px). Review faces, hands, and on-screen text.
- **Rotation is not detected.** `probeMedia` reports coded dimensions, not display-matrix rotation. A phone clip flagged as landscape may need swapped dimensions; check `ffprobe` side data first.
- **Square pixels assumed.** Crop math uses pixel dimensions and ignores a non-1:1 sample aspect ratio. Normalize SAR before reframing if the source is anamorphic.
- **No layout update.** The module does not edit `project.json`, `plan.json`, `timeline.json`, or engine templates.
- **Only crop and scale.** No blurred/padded background, seam carving, object removal, or aspect-aware captions.
- **Codec scope.** The default args target H.264/AAC MP4/MOV. Other codecs and webm need different arguments. Keep custom target sizes even for `yuv420p`.
- **No validation of the input.** `reframeArgs` does not check that the file exists, that dimensions are correct, or that FFmpeg is installed.
