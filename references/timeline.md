# Timeline and preview

The timeline is the engine-agnostic source of truth for editorial decisions. Engine code is an implementation detail; the timeline is what the user reviews and approves.

## Schema

```json
{
  "schema": "rooster.timeline/v1",
  "project": "meu-video",
  "format": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 60
  },
  "tracks": [
    {
      "id": "v1",
      "kind": "video",
      "clips": [
        {
          "id": "clip-1",
          "src": "assets/source/interview.mp4",
          "in": 12.4,
          "out": 18.2,
          "start": 0,
          "end": 5.8,
          "speed": 1,
          "transitionIn": "cut",
          "transitionOut": "cut",
          "effects": []
        }
      ]
    },
    {
      "id": "ov1",
      "kind": "overlay",
      "clips": []
    },
    {
      "id": "cap1",
      "kind": "captions",
      "clips": []
    },
    {
      "id": "a1",
      "kind": "voice",
      "clips": []
    },
    {
      "id": "m1",
      "kind": "music",
      "clips": []
    },
    {
      "id": "s1",
      "kind": "sfx",
      "clips": []
    }
  ],
  "scenes": [],
  "markers": []
}
```

All times are in seconds, not frames or milliseconds. This keeps the timeline readable and engine-agnostic. Convert to frames only at the adapter boundary.

## Track kinds

| Kind | Purpose |
|---|---|
| `video` | Main footage or base visuals |
| `overlay` | Text, logos, callouts, lower thirds, graphics |
| `captions` | Subtitle cues |
| `voice` | Narration or interview audio |
| `music` | Background music |
| `sfx` | Sound effects |
| `3d` | 3D scene renders or live 3D layers |

A timeline can have multiple tracks of the same kind. Use stable ids like `v1`, `v2`, `ov1`, `a1`, `m1`.

## Clip fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable id, unique in the timeline |
| `src` | yes | Path relative to the project root, or a scene id |
| `in` | for media | Source in-point in seconds |
| `out` | for media | Source out-point in seconds |
| `start` | yes | Timeline start in seconds |
| `end` | yes | Timeline end in seconds |
| `speed` | no | Playback speed (1 = normal) |
| `transitionIn` | no | `cut`, `fade`, `wipe`, `slide`, or a component id |
| `transitionOut` | no | Same as above |
| `volume` | no | Linear gain for audio |
| `opacity` | no | 0–1 for overlays |
| `effects` | no | Array of effect ids/props |
| `scene` | no | Scene component id |
| `props` | no | Scene props |

For a still image, `in`/`out` can be omitted and `end - start` defines the duration. For a generated scene, use `scene` and `props` instead of `src`.

## Scenes

A scene is a higher-level unit that can span clips and tracks:

```json
{
  "id": "scene-03",
  "title": "How an LLM predicts the next token",
  "start": 12,
  "end": 22,
  "engine": "hyperframes",
  "component": "token-probability",
  "props": {
    "prompt": "The cat sat on the",
    "tokens": ["mat", "sofa", "roof"],
    "highlight": "mat"
  },
  "beats": ["explain"],
  "assets": ["assets/generated/llm-diagram.png"]
}
```

Scenes are the bridge between the storyboard and the engine. The storyboard describes what the viewer sees; the scene describes which component renders it.

## Captions

```json
{
  "id": "cap-001",
  "start": 0.4,
  "end": 3.2,
  "text": "A maioria dos modelos de linguagem não pensa como você imagina.",
  "speaker": "narrator",
  "style": "profile",
  "position": "bottom"
}
```

Rules:

- one idea per cue;
- max 2 lines, about 32–42 characters per line depending on aspect;
- reading speed around 15–20 characters per second;
- keep cues inside the title-safe area;
- do not cover faces, logos, or key visuals;
- use the profile's caption style unless the scene needs a variant.

## Audio

```json
{
  "voice": {
    "src": "assets/generated/voice/scene-03.wav",
    "start": 12,
    "end": 21.6,
    "volume": 1,
    "loudnessLufs": -16
  },
  "music": {
    "src": "library/music/ambient-01.mp3",
    "start": 0,
    "end": 60,
    "volume": 0.18,
    "duckUnderVoice": true
  },
  "sfx": [
    { "src": "library/sfx/whoosh-02.wav", "start": 11.8, "volume": 0.5 }
  ]
}
```

The adapter should mix audio with a target loudness and true-peak limit. If the engine cannot duck automatically, compute a volume envelope and bake it into the timeline.

## Markers

Markers are useful for review and QA:

```json
[
  { "time": 0, "label": "hook", "kind": "beat" },
  { "time": 3, "label": "first caption", "kind": "qa" },
  { "time": 58, "label": "CTA", "kind": "beat" }
]
```

## Adapters

### HyperFrames

- Translate each clip into an element with `class="clip"`, `data-start`, `data-duration`.
- Use `data-track-index` only for the Studio lane; paint order is `z-index`.
- Use the registry for captions, transitions, charts, and cards.
- Run `npx hyperframes check --json` and `npx hyperframes timeline --json`.

### Remotion

- Translate clips into `<Sequence from={...} durationInFrames={...}>`.
- Put shared timing in `src/data/timeline.ts`.
- Use `<Audio>` for voice/music and `<Video>`/`<Img>` for media.
- Use `useCurrentFrame()` for animation; never real time.

### FFmpeg

- Translate `video` clips into `trim`/`setpts`/`concat`.
- Translate overlays into `overlay` filters with `enable='between(t,...)'`.
- Translate captions into the `subtitles` filter or a sidecar file.
- Translate audio into `amix`, `volume`, `sidechaincompress`, and `loudnorm`.

### FilmCraft

FilmCraft is an optional timeline target (`build --target filmcraft`), not a third creative engine. The adapter writes an editable project at `engine/filmcraft/<slug>.fcproj`:

- **V1**: source video clips only, one clip per keep, in cut-timeline order.
- **A1**: the mixed base audio (voice plus music) from FFmpeg.
- **V2+**: one transparent element clip per renderable plan element, packed into the first free lane (greedy, non-overlapping).
- **Markers**: chapters, elements, and cut boundaries.
- **Captions**: imported from `edit/captions/*.srt` or `.vtt` on the first build.

`zoom` elements are not standalone clips; they apply to the base and are skipped with a note. Track state lives in `work/filmcraft.json`, and element clips are cached in `cache/elements/<hash>.mov`.

Incremental builds update only what changed: unchanged element clips are reused, a changed element is replaced in place when its time window is the same, and a changed base re-places only V1/A1. User clips on other tracks stay untouched. `--force` archives the previous `.fcproj` under `engine/filmcraft/archive/` before rebuilding.

Open the result with `timeline <slug> --open`; `preview <slug>` points to the `.fcproj` when it exists. Read `references/nle-handoff.md` for export, caveats, and the difference from the EDL/FCPXML path.

## Review page

`node "<skill>/scripts/rooster.mjs" preview <slug>` writes `preview/index.html` and prints the path. `--open` opens it when the harness has a browser. The page works without a build step or a server; it is a single HTML file with vanilla JS/CSS.

When a FilmCraft timeline exists, `preview` also prints the `.fcproj` path and the `timeline <slug> --open` command. The review page stays the HTML summary; FilmCraft is the editable timeline.

It includes:

- **Player**: draft MP4, final MP4, or the source video. Timecodes in the plan seek the player.
- **Plan**: summary, cuts, elements, chapters, and validation warnings.
- **Timeline**: tracks and clips from `edit/timeline.json`.
- **Assets and audio**: manifest count, missing files, music, voiceover lines, captions, renders.
- **QA**: checklist with the items that matter before the final render.
- **Approval**: a copy button for the approval message; the actual gate stays in the chat.
- **Links**: `qa/report.md` and `style/proof/index.html` when they exist.

The page should work without a build step. Keep it readable and fast; this is a review tool, not a full NLE.

### JSON endpoints

The static page does not need endpoints. If the page grows into a server-backed review tool, add:

| Endpoint | Returns |
|---|---|
| `/api/project` | `project.json` |
| `/api/timeline` | `timeline.json` |
| `/api/manifest` | `assets/manifest.json` |
| `/api/status` | derived status, missing assets, render state |

### Browser automation

- Add `data-testid` to timeline clips, scene cards, QA items, and buttons.
- Expose a deterministic `?scene=<id>` or `#t=<seconds>` deep link.
- Support `--static <path>` to write a standalone HTML file for headless environments.
- Log errors to the page and the console; browser agents can read both.

## Validation

Before build:

- `format.duration` is greater than zero.
- Every clip has `start < end`.
- No unintended overlaps on the same track.
- Every `src` exists or is a known scene id.
- Every scene has a component or a documented placeholder.
- Captions fit the duration and the reading speed.
- Audio clips have valid in/out points.
- The timeline covers the full target duration.

Run `node "<skill>/scripts/rooster.mjs" check <slug>` and fix errors before opening the engine.
