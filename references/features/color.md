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

`colorArgs({ input, output, color })` returns complete arguments for a graded encode. It does not resolve paths; pass paths valid from the FFmpeg `cwd`. LUT and transforms paths are escaped for Windows drive letters.

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

With no active filters, `colorArgs` falls back to stream copy. With filters, it re-encodes the first video stream as H.264 (`yuv420p`, CRF 18, `medium`) and copies the first audio stream. Use MP4, MOV, or MKV for the output container.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" color <slug> [--input <path>] [--out <path>] [--update-plan] [--skip-stabilize]
```

The command writes `assets/generated/graded.mp4`; `--update-plan` points `plan.source` at the graded file before build. When `plan.color.stabilize` is true, the command runs the two vidstab passes automatically unless `--skip-stabilize` is passed.

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
- `colorArgs` ignores `color.stabilize`; the `color` command runs `buildStabilizePasses` before the grade, or use `--skip-stabilize`.
- `colorArgs` copies the audio stream. An incompatible audio codec/container combination will fail.
- Plan validation checks that a declared LUT exists and warns when `stabilize` needs the two-pass flow; it does not validate every numeric range.
- `build` does not call `colorArgs` or `buildStabilizePasses` yet; run the `color` command with `--update-plan` before building.
