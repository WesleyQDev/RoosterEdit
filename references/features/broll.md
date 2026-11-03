# B-roll

`scripts/features/broll.mjs` finds local video and image files, ranks them against the transcript, and proposes plan-compatible b-roll elements. It is a keyword helper, not a stock search.

> **Licensing:** this module only sees files on disk. It cannot detect or verify a license, attribution, or model release. The agent must confirm the rights for every suggested clip and record them in `assets/manifest.json` before publishing.

## Purpose

- Scan project and library folders for usable video/image files.
- Rank candidates by transcript keywords and explicit tags.
- Suggest `broll` elements with transcript-based timing.
- Keep the process local: no API keys, network calls, downloads, or external services.

## Inputs and outputs

### `listMediaFiles(dirs)`

Accepts one directory, an array of directories, or a media file path. Recursively collects video and image extensions, returns absolute paths sorted for deterministic output, and skips missing directories, permission errors, symlinks, and common non-media folders (`node_modules`, `.git`, `cache`, `.opencode`).

Video: `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.m4v`, `.mts`, `.m2ts`. Image: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.avif`, `.tif`, `.tiff`.

### `rankBroll({ files, transcriptText, tags })`

`files` accepts paths from `listMediaFiles` or objects such as manifest entries:

```js
{ path: "assets/source/office.mp4", tags: ["office", "client"], src: "assets/source/office.mp4" }
```

`transcriptText` accepts a string, a transcript object, or a segment array. `tags` accepts a string or array and is treated as extra target keywords, not as a filter.

Score weights:

| Match | Points |
|---|---|
| Requested tag in filename, folder, or file tags | +6 |
| Multi-word requested tag found as a phrase | +4 |
| Filename or file-tag keyword in the transcript | +3 |
| Folder keyword in the transcript | +1 |

Repeated words count once. Accents are folded and common English/Portuguese/Spanish stopwords are ignored. Returns all valid media files, highest score first:

```js
{
  path: "C:\\project\\assets\\source\\office.mp4",
  name: "office.mp4",
  type: "video",              // "video" | "image"
  score: 9,
  matches: ["client"],
  src: null,                  // preserved when the input object had src
  tags: []
}
```

A score of `0` means no keyword overlap, not bad footage.

### `suggestBrollElements({ files, transcript, max })`

Returns plan-compatible elements sorted by start time:

```js
{
  id: "el-004",
  type: "broll",
  start: 58,
  end: 64,
  src: "assets/source/broll-office.mp4",
  description: "B-roll office.mp4 over \"the first client meeting\" (matches: client)"
}
```

| Option | Default | Meaning |
|---|---|---|
| `max` | `3` | Maximum suggestions |
| `baseDir` | `null` | Project root used to make absolute paths relative |
| `idPrefix` | `"el"` | Element id prefix |
| `startIndex` | `1` | First id suffix (`el-001`) |
| `minDuration` | `2` | Skip shorter transcript segments |
| `maxDuration` | `6` | Cap each suggestion's length |

Timing comes from transcript segments: the suggestion starts at the segment start and ends at the segment end or `maxDuration`, whichever is earlier. Files are matched against each segment's text. The function never reuses a file and never returns overlapping intervals. It returns an empty array when there are no segments, no valid files, or no keyword overlap.

## Plan fields

Merge the returned objects into `edit/plan.json`:

```json
{
  "elements": [
    {
      "id": "el-004",
      "type": "broll",
      "start": 58,
      "end": 64,
      "src": "assets/source/broll-office.mp4",
      "description": "B-roll office.mp4 over \"the first client meeting\" (matches: client)"
    }
  ]
}
```

`src` is relative to the project root. If you call the function without `baseDir`, absolute paths are returned; pass `baseDir` or supply an object with a relative `src` to keep the plan portable. For licensed footage, prefer `assets/licensed/` and add `license`, `attribution`, and `source` to `assets/manifest.json`.

## Commands

Run the CLI:

```bash
node "<skill>/scripts/rooster.mjs" broll <slug> [--dir <path>] [--tags office,client] [--max 3] [--limit 10] [--write]
```

It writes `edit/broll-suggestions.json`. `--write` appends the suggestions to `edit/plan.json`; review them with `plan --show` before building.

```js
import { listMediaFiles, rankBroll, suggestBrollElements } from "./scripts/features/broll.mjs";

const files = listMediaFiles(["assets/source", "assets/licensed", "library/broll"]);
const transcript = JSON.parse(fs.readFileSync("edit/transcript.json", "utf8"));

const ranked = rankBroll({
  files,
  transcriptText: transcript,
  tags: ["office", "client"],
});

const elements = suggestBrollElements({
  files,
  transcript,
  max: 3,
  baseDir: process.cwd(),
});

console.log(JSON.stringify({ top: ranked.slice(0, 5), elements }, null, 2));
```

Review the output, merge the elements into `edit/plan.json`, then validate and show the plan:

```bash
node "<skill>/scripts/rooster.mjs" plan <slug> --check
node "<skill>/scripts/rooster.mjs" plan <slug> --show
```

Use `plan --show` as the approval gate. Do not build from suggestions you have not reviewed.

## Integration

- Run after transcription and before the plan is approved.
- Pass manifest objects with `tags` and `src` when available; filename-only matching is weaker.
- Renumber `id` values if the plan already uses them, and check overlaps with existing elements, music cues, and captions.
- Place approved files in `assets/source/` or `assets/licensed/`, record the license and attribution, and keep the plan `src` pointing at the final location.
- HyperFrames and Remotion already render `type: "broll"` elements as images or muted videos with object-fit cover, so approved elements can be built without a new element type.

## Limitations

- **Local suggestion only.** No stock search, network call, download, generation, or catalog UI. It only sees the directories passed to it.
- **No vision or semantics.** No ML scene detection, object recognition, embeddings, or synonym matching. "Car" does not match "automobile"; exact keyword and tag overlap drives the score.
- **File names matter.** A generic name such as `clip-001.mp4` has nothing to match. Add tags in manifest objects or rename files descriptively.
- **Licensing is out of scope.** The module cannot tell whether a file is owned, licensed, CC, or unknown. The agent must confirm rights and attribution before use.
- **No media probing.** Duration, resolution, fps, codec, and audio presence are not checked. Verify a short clip with `ffprobe`; otherwise the engine may freeze, loop, or crop it awkwardly.
- **Segment-level timing only.** It uses transcript boundaries, not shot changes, beats, or visual continuity. Suggestions may start or end mid-action.
- **No overlap awareness outside the call.** It prevents duplicates and overlaps among its own output, but does not read the existing plan or timeline. Merge carefully.
- **Heuristic confidence.** Scores are relative ranking aids, not probabilities or editorial judgment. Review every suggestion with eyes and ears before approval.
- **No writes.** The module returns data. It does not edit `edit/plan.json`; the agent owns the merge and the approval step.
