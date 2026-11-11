# Color — grading, LUT, denoise, stabilization

Use this layer when footage looks flat, mixed cameras do not match, or handheld shots need stabilization. It maps the optional `plan.color` object to FFmpeg video filters and a two-pass vidstab flow.

The helpers live in `scripts/features/color.mjs`. They build filters and argument arrays; they never spawn FFmpeg or touch the workspace.

## Plan fields

`plan.color` is optional. All fields are optional; identity values are omitted from the filter chain.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `lut` | string | — | Path to a `.cube` or `.3dl` LUT. |
| `brightness` | number | `0` | `eq` brightness, -1..1. |
| `contrast` | number | `1` | `eq` contrast, 0..4. |
| `saturation` | number | `1` | `eq` saturation, 0..3. |
| `temperature` | number | `0` | -100 (cool) to 100 (warm). |
| `denoise` | boolean, number, string, object | `false` | `hqdn3d` or `nlmeans` settings. |
| `stabilize` | boolean | `false` | Run the two-pass vidstab flow. |

Denoise accepts `true`, a strength number, `"light"`, `"medium"`, `"strong"`, `"nlmeans"`, `"hqdn3d:<strength>"`, `"nlmeans:<strength>"`, or `{ "filter": "hqdn3d" | "nlmeans", "strength": ... }`.

```json
{
  "color": {
    "lut": "assets/licensed/luts/film.cube",
    "brightness": 0.02,
    "contrast": 1.08,
    "saturation": 1.12,
    "temperature": 12,
    "denoise": "light",
    "stabilize": true
  }
}
```

Keep the grade subtle. A LUT plus strong `eq` plus a temperature shift easily crushes skin tones or clips highlights. Review stills before rendering.

## Filter order

`buildColorFilters(color)` returns an array of strings in this order:

1. **Denoise** — `hqdn3d` or `nlmeans`. Do this before sharpening or grading.
2. **LUT** — `lut3d=file='...'`.
3. **EQ** — `eq=brightness=...:contrast=...:saturation=...`.
4. **Temperature** — `colorbalance` in shadows, midtones, and highlights.

```text
hqdn3d=2:1.5:3:2.25,
lut3d=file='assets/licensed/luts/film.cube',
eq=brightness=0.02:contrast=1.08:saturation=1.12,
colorbalance=rs=0.018:bs=-0.018:rm=0.018:bm=-0.018:rh=0.018:bh=-0.018
```

Join the array with commas for `-vf`; do not join these fragments with semicolons. `colorArgs()` performs the join for you.

Temperature is an approximation, not a Kelvin white balance: `+100` warms by +0.15 red and -0.15 blue; `-100` does the reverse. Use a LUT or a proper color-managed workflow when exact white balance matters.

Denoise presets:

| Value | Filter |
|---|---|
| `light` | `hqdn3d=2:1.5:3:2.25` |
| `medium` / `true` | `hqdn3d=4:3:6:4.5` |
| `strong` | `hqdn3d=6:4:9:6` |
| `nlmeans` | `nlmeans=s=3:r=15:p=7` |

`nlmeans` is much slower and can smear fine texture. Use it only when `hqdn3d` is not enough.

## Stabilization

Stabilization is a two-pass operation and is not a single `-vf` filter:

1. **Detect** motion and write `transforms.trf`.
2. **Transform** the input using that file, with auto-zoom to hide the borders.

`<skill>` below is the RoosterEdit base directory.

```js
import { spawnSync } from "node:child_process";
import { buildStabilizePasses, colorArgs } from "<skill>/scripts/features/color.mjs";

const passes = buildStabilizePasses({
  input: "assets/source/handheld.mp4",
  workDir: "engine/tmp/stabilize",
});

let result = spawnSync("ffmpeg", passes.detect, { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr);

result = spawnSync("ffmpeg", passes.transform, { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr);

// Grade the stabilized intermediate in a second encode, or append the color
// filters to the transform pass to encode once.
const grade = colorArgs({
  input: passes.output,
  output: "renders/graded.mp4",
  color: plan.color,
});
```

`passes.detect` and `passes.transform` are ready-to-spawn argument arrays. `passes.transformsFile` is the detection file; `passes.output` defaults to `<workDir>/stabilized.mp4`. The caller must create `workDir` first.

Run both passes on the same input and dimensions. If the clip is trimmed or resized between passes, rerun detection. To combine stabilization and color in one encode, append `buildColorFilters(plan.color).join(",")` after `vidstabtransform=...` in the transform filter.

## FFmpeg integration

`colorArgs({ input, output, color, ... })` returns complete arguments for a graded encode. It does not resolve paths; pass paths valid from the FFmpeg `cwd`. LUT and transforms paths are escaped for Windows drive letters.

The build applies `plan.color` while cutting: the filters join the `trim`/`concat` chain, so they run once, only on the keeps, and the graded result is the base media. That is the default path; do not grade the whole source before building.

`color` remains for two cases: stabilization, which needs continuous motion and a two-pass vidstab flow over the full source, and a standalone graded master (`--out`). After a `color --update-plan` pass the plan's `color` block is cleared, because the new source already carries it and the build would apply it twice.

`colorArgs` accepts `quality`, `preset`, `crf`, `encoder`, `scale`, and `filterThreads`, so a standalone pass uses the same fast intermediate defaults and the same hardware mapping as the build.

```js
import { spawnSync } from "node:child_process";
import { colorArgs } from "<skill>/scripts/features/color.mjs";

const args = colorArgs({
  input: "assets/source/interview.mp4",
  output: "renders/interview-graded.mp4",
  color: {
    lut: "assets/licensed/luts/film.cube",
    contrast: 1.08,
    saturation: 1.12,
    temperature: 12,
    denoise: "light",
  },
});

const result = spawnSync("ffmpeg", args, {
  cwd: projectDir,
  encoding: "utf8",
  windowsHide: true,
});
if (result.status !== 0) throw new Error(result.stderr);
```

With no active filters, `colorArgs` falls back to stream copy. With filters or a scale, it re-encodes the first video stream as H.264 (`yuv420p`) and copies the first audio stream. Use MP4, MOV, or MKV for the output container.

Defaults target an intermediate, because the build re-encodes the graded file: `veryfast` with CRF 20. Pass `quality: "final"` (or explicit `preset`/`crf`) only when the output is a master. `encoder`, `scale`, and `filterThreads` are optional; `colorArgs` uses the same encoder mapping as the build.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" color <slug> [--input <path>] [--out <path>] \
  [--quality fast|final] [--preset <id>] [--crf <n>] [--encoder <id>] \
  [--scale <W:H>] [--filter-threads <n>] [--no-progress] [--print] \
  [--update-plan] [--skip-stabilize]
```

The command writes `assets/generated/graded.mp4`; `--update-plan` points `plan.source` at the graded file and clears `plan.color` (the new source already carries the grade). Use it for a standalone master or after stabilization. When `plan.color.stabilize` is true, the command runs the two vidstab passes automatically unless `--skip-stabilize` is passed. For a normal edit, skip this command: the build applies `plan.color` while cutting.

## Cost and speed

Grading is a full re-encode. A 17-minute 1080p source takes about as long as its duration on a 6-core CPU with `veryfast` plus denoise; a delivery-grade `medium`/CRF 18 pass is slower. Keep the intermediate cheap:

- Leave the default `fast` quality (`veryfast`/CRF 20). The build re-encodes anyway; `--quality final` is for a graded master.
- Do not put grain (`noise`), vignette, or light leaks in the intermediate. They multiply bitrate and encode time; add them in the engine, in the final render, or as an overlay.
- Denoise only what needs it, and prefer `light`. Denoise and grain filters are partly serial, so a CPU sitting below 60% usually means the filter chain, not x264, is the limit. `--filter-threads` helps the rest.
- Use the hardware encoder when `doctor` detects one: `--encoder h264_nvenc|h264_amf|h264_qsv`. It is fastest when the encode, not the filter, is the bottleneck.
- Grade after the cut when the project removes a lot: point `--input` at the cut result, so the pass does not spend time on footage the build will discard.
- Do not hand-write the FFmpeg command for this step. The CLI streams progress, ETA, the encoder in use, and the elapsed time; a raw command hides all of it and usually skips the flags above.

`--print` shows the exact FFmpeg arguments without running them.

## QA

- Skin tones stay natural; compare before/after stills at 100%.
- Highlights are not clipped and shadows are not crushed.
- Contrast and saturation match the profile, not just the reference video.
- The LUT file exists, loads, and is licensed for delivery.
- Denoise did not erase texture or create waxiness.
- Stabilization has no black borders, warped edges, or excessive crop.
- Camera motion still feels intentional; auto-zoom is not pumping.
- Consecutive shots match in color and exposure.
- Audio is still in sync after the re-encode.
- `ffprobe` confirms resolution, fps, duration, pixel format, and audio stream.

## Limitations

- This is a lightweight grade, not a color-managed pipeline. There is no HDR, log conversion, gamut mapping, or per-shot matching.
- `eq` and `colorbalance` are approximations; a LUT or a dedicated grade is better for precise looks.
- Stabilization needs two passes, a writable work directory, and an FFmpeg build with the `vidstab` filters. It cannot fix rolling shutter, motion blur, or a shot with no stable frame.
- `colorArgs` ignores `color.stabilize`; the `color` command runs `buildStabilizePasses` before the grade, or use `--skip-stabilize`. The build warns and skips stabilization; run `color` once for it.
- `colorArgs` copies the audio stream. An incompatible audio codec/container combination will fail.
- Plan validation checks that a declared LUT exists and warns when `stabilize` needs the two-pass flow; it does not validate every numeric range.
- The build applies `plan.color` with the cuts. A separate `color` pass is optional; after `--update-plan` the `color` block is cleared to avoid applying the grade twice.
