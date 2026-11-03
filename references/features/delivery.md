# Delivery

Build the package that accompanies the final render: `metadata.json`, a thumbnail, and the caption sidecars. Delivery is a separate step after build, render, and QA; nothing is uploaded automatically.

## Input and output

Inputs are the project, the approved plan, an optional render description or probe, and optional chapters:

```js
import { buildMetadata, thumbnailArgs, createThumbnail } from "./scripts/features/delivery.mjs";

const metadata = buildMetadata({
  project,                         // project.json
  plan,                            // edit/plan.json
  render: {
    video: "renders/final.mp4",
    probe: { width: 1920, height: 1080, fps: 29.97, duration: 57.2 },
    captions: {
      srt: "renders/captions.srt",
      vtt: "renders/captions.vtt",
      json: "renders/captions.json"
    },
    thumbnail: "renders/thumbnail.jpg"
  },
  chapters: plan.chapters          // optional; defaults to plan.chapters
});
```

`render` may also be a path string. Actual render probe values beat plan values, which beat `project.format`. `chapters` overrides plan/project chapters when passed, even as an empty array.

Output is a `rooster.metadata/v1` object:

```json
{
  "schema": "rooster.metadata/v1",
  "title": "Demo Video",
  "description": "A short demo.",
  "tags": ["demo", "tutorial"],
  "chapters": [
    { "start": 0, "end": 30, "title": "Intro", "timestamp": "0:00" },
    { "start": 30, "end": 57.2, "title": "Second", "timestamp": "0:30" }
  ],
  "aspectRatio": "16:9",
  "width": 1920,
  "height": 1080,
  "duration": 57.2,
  "fps": 29.97,
  "files": {
    "video": "renders/final.mp4",
    "captions": {
      "srt": "renders/captions.srt",
      "vtt": "renders/captions.vtt",
      "json": "renders/captions.json"
    },
    "thumbnail": "renders/thumbnail.jpg"
  },
  "language": "en",
  "slug": "demo-video",
  "generatedAt": "2026-11-03T00:00:00.000Z"
}
```

Titles fall back from `plan.title` to `project.title`, `project.name`, and the slug. Description uses `plan.description`, `plan.summary`, then `project.description`. Tags merge and deduplicate case-insensitively. Chapters are sorted, deduplicated, and given an `end` from the next chapter or the duration. File paths use forward slashes.

## Thumbnail

`thumbnailArgs({ video, out, time })` returns `{ args, command }` and executes nothing. `createThumbnail()` calls FFmpeg with `spawnSync`; it is opt-in, creates the output directory, overwrites the target, and returns `{ ok, status, out, bytes, error, ... }` instead of throwing on FFmpeg failure.

```js
const { args, command } = thumbnailArgs({
  video: "renders/final.mp4",
  out: "renders/thumbnail.jpg",
  time: 2.5,
  width: 1280
});

const result = createThumbnail({
  video: "renders/final.mp4",
  out: "renders/thumbnail.jpg",
  time: 2.5,
  width: 1280,
  height: 720
});
```

`out` must be `.jpg`, `.jpeg`, or `.png`. `time` accepts seconds or `HH:MM:SS(.ms)`. Width or height alone preserves aspect; both set an exact size. JPEG quality defaults to 2 (best) and accepts 2–31.

## Build integration

- Run delivery after the final render and after the caption sidecars exist.
- `metadata.json` belongs in `renders/` with `final.mp4`, `captions.srt`, `captions.vtt`, and `thumbnail.jpg`.
- The current `build` and `render` commands do not create these files or burn captions.
- Do not upload anywhere without explicit permission. Keep the render, caption, and license decisions in `qa/report.md` and `review.md`.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" deliver <slug> [--video <path>] [--thumb <path>] [--time 2.5]
node "<skill>/scripts/rooster.mjs" captions <slug> [--out <dir>]
```

`deliver` writes `renders/thumbnail.jpg` and `renders/metadata.json`, and references caption sidecars when they exist. It does not upload anything.

## QA

- Title, description, tags, and chapters match the approved plan.
- The first chapter starts at `0:00`; chapters are sorted and within the duration.
- Aspect ratio, width, height, fps, and duration match the render probe.
- Every path in `files` exists and uses the intended case and extension.
- Captions are present and valid, or the delivery records why they are absent.
- The thumbnail is from the intended moment, readable at small size, and not a black frame.
- No unlicensed music, footage, fonts, or thumbnails are included.
- Nothing is published without explicit user permission.

## Limitations

- No platform API upload, scheduling, or OAuth.
- No automatic thumbnail composition, text overlay, or A/B variants; this extracts one frame.
- No YouTube/TikTok field validation (title length, tag limits, chapter minimums).
- Without a render probe, duration falls back to the plan or project length, which may be the source duration rather than the cut result.
- Chapter ends are inferred; the module does not rewrite the video to create chapters.
- FFmpeg must be installed for `createThumbnail`; `thumbnailArgs` works without it.
- The metadata object is not written to disk by this module; the `deliver` command owns the file write.
