# Workspace

The workspace is the user's local studio. It lives in the video project, not in the skill repository.

> **CLI path:** the commands below assume you are at the root of the RoosterEdit repository. When using the skill in a video project, run from the project and resolve the script through the skill directory: `node "<skill>/scripts/rooster.mjs" ...`.

## Structure

```text
rooster/
├── workspace.json
├── config.json
├── channels/
│   └── <channel>/
│       ├── channel.json
│       ├── projects/
│       │   └── <slug>/
│       │       ├── project.json
│       │       ├── brief.md
│       │       ├── script.md
│       │       ├── style.md
│       │       ├── style/{proof/,components/,blocks/}
│       │       ├── storyboard/
│       │       ├── assets/{source,generated,licensed}/
│       │       ├── edit/{transcript.json,digest.md,analysis.json,plan.json,plan.md,plan.html,edl.json,timeline.json,captions/,audio/,export/}
│       │       ├── engine/
│       │       │   ├── hyperframes/
│       │       │   ├── remotion/
│       │       │   └── filmcraft/
│       │       │       ├── <slug>.fcproj
│       │       │       ├── assets/
│       │       │       ├── hyperframes/
│       │       │       ├── remotion/
│       │       │       ├── elements/
│       │       │       └── archive/
│       │       ├── work/
│       │       │   ├── handoffs/
│       │       │   ├── logs/
│       │       │   ├── scratch/
│       │       │   ├── notes/
│       │       │   └── filmcraft.json
│       │       ├── preview/
│       │       ├── renders/
│       │       ├── qa/{qa.json,qa-report.md,report.md,text-review.md,plan-review.md,frames/,vision/,ocr/}
│       │       └── review.md
│       ├── profiles/
│       ├── assets/
│       └── library/
├── profiles/       # shared
├── library/{music,sfx,fonts,overlays,luts,broll,images}/
└── cache/          # includes cache/elements/ (ProRes 4444 clips)
```

The workspace is created with:

```bash
node scripts/rooster.mjs init
```

`init` creates a `default` channel for standalone videos. Real channels are created afterward.

## Channels

A channel is the stable production standard for a brand, audience, or operation. It stores:

- what it produces (`content`);
- language;
- default format (`16:9`, `9:16`, `1:1`, or `auto`);
- visual profile;
- asset policy;
- engine;
- autonomy;
- voice/TTS;
- brand kit;
- its own library.

```bash
node scripts/rooster.mjs channel new studio-a \
  --name "Studio A" \
  --content "<what the channel produces>" \
  --language en-US \
  --format 16:9 \
  --profile minimal \
  --voice tts \
  --assets mixed
```

The channel starts with a base profile. After creating it, define its visual and sonic identity:

```bash
node scripts/rooster.mjs channel design studio-a \
  --from minimal \
  --bg "#0b0f19" \
  --fg "#f8fafc" \
  --accent "#22d3ee" \
  --display Inter \
  --body Inter \
  --motion calm \
  --music ambient \
  --sfx subtle \
  --style "clean editorial, generous negative space" \
  --negative "clutter, heavy gradients"
```

The command writes `channels/studio-a/profiles/studio-a/profile.json` and `STYLE.md`, and points `channel.profile` at the new profile. Use `--force` to redo it later.

```bash
node scripts/rooster.mjs channel list
node scripts/rooster.mjs channel show studio-a
node scripts/rooster.mjs channel set studio-a format 9:16
node scripts/rooster.mjs channel use studio-a
node scripts/rooster.mjs profile show studio-a --channel studio-a
```

## Creating a project

Duration is a result of the edit, not a default of the channel or the project. Only pass `--duration` when you have declared an explicit target:

```bash
node scripts/rooster.mjs new video-x --channel studio-a
# optional, only with a declared target
node scripts/rooster.mjs new video-x --channel studio-a --duration 30
node scripts/rooster.mjs open studio-a/video-x
```

`open` shows and opens `assets/source/` so you can drop the files in. The project inherits the channel and can override:

```bash
node scripts/rooster.mjs new video-special --channel studio-a \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

`new --target filmcraft` already creates the project with `timeline: "filmcraft"`; `--target hyperframes|remotion` pins the creative engine. Without `--target`, the project inherits the channel engine.

`project.json` records:

- `channel`;
- `profile`;
- `format`;
- `language`;
- `engine` (creative renderer or the element renderer in FilmCraft);
- `timeline` (`none` or `filmcraft`);
- `mode` (source, voice, style, autonomy);
- `assets` (strategy, permissions, license);
- `overrides` (what came from the project, not the channel).

## Precedence

```text
project > channel > workspace/global > built-in
```

The project can override any channel default. There is no category layer.

## Subagents and handoffs

The main agent does not need to load the raw material. Each heavy stage can run in a subagent defined in `agents/`; it writes the detail to disk and returns a short handoff.

```text
work/
├── handoffs/   # one summary per stage, e.g. 03-transcript.md
├── logs/       # raw output from build, render, FFmpeg, transcription
├── scratch/    # drafts and intermediate files
└── notes/      # detail produced by subagents for the next stage
    └── feedback-<timestamp>.md  # reviewed issue draft
```

The main agent reads the handoffs, looks at `plan.html` and 3–5 frames. The full transcript, the generated code, and the logs stay out of the main context. The protocol is in [`references/subagents.md`](../references/subagents.md) and the return contract in [`agents/_handoff.md`](../agents/_handoff.md).

## Review and handoff

| Artifact | Command | Purpose |
|---|---|---|
| `style/proof/index.html` | `styleproof <slug>` | 3 sample frames of the style before the plan |
| `edit/plan.html` | `plan <slug>` | Plan with player, transcript context, time in the raw footage and in the final cut |
| `qa/plan-review.md` | `plan <slug>` | Visual gaps, hard cuts, unsupported text, b-roll without `covers`, and layout collisions |
| `preview/index.html` | `preview <slug>` | Player, timeline, validation, assets, and QA checklist |
| `qa/text-review.md` | `textcheck <slug>` | All on-screen text with timecodes and warnings |
| `qa/qa.json`, `qa/qa-report.md` | `qa <slug>` | Machine QA: loudness, peak, silence, cuts, faces, engine check |
| `qa/vision/` | `qa <slug> --vision` | At most five frames at the flagged times |
| `qa/ocr/` | `ocr <slug> --at <s>` | Text and boxes from a frame (screen recordings, slides) |
| `style/blocks/<name>/` | `build --allow-download` | Installed 3D/registry block, kept across `--force` builds |
| `edit/export/` | `export <slug> --format both` | EDL/FCPXML for DaVinci or Premiere |
| `engine/filmcraft/<slug>.fcproj` | `timeline <slug> --open` | Editable timeline in FilmCraft (optional) |

`preview` and `styleproof` are static HTML files; they work without a server. `export` is a handoff, it does not replace `edit/plan.json`.

## FilmCraft timeline (optional)

FilmCraft is an opt-in timeline target. It does not replace HyperFrames or Remotion and is not required for the normal flow.

```bash
node scripts/rooster.mjs build video-x --target filmcraft
node scripts/rooster.mjs timeline video-x --open
node scripts/rooster.mjs render video-x --draft
```

`timeline <slug> --json` prints the path of the `.fcproj`, the sequence, and the element count.

The build is hybrid:

- FFmpeg assembles the cut and the audio mix in `engine/filmcraft/assets/`;
- HyperFrames or Remotion render each element in `engine/filmcraft/elements/` (ProRes 4444 MOV with alpha);
- FilmCraft assembles `<slug>.fcproj` with the source in V1 (video only), the mixed audio in A1, and the elements in V2+, on non-overlapping tracks.

`--engine hyperframes|remotion` chooses the element renderer; `auto` uses Remotion when there is a 3D element and HyperFrames otherwise. `work/filmcraft.json` stores the state (items, clips, hashes, and windows) for incremental builds.

- `--if-needed` skips when the plan, base, renderer, and format have not changed.
- Unchanged elements are reused from `cache/elements/`.
- A changed element uses `clip.replaceFromBin` when the window is the same; a different window deletes and repositions only that clip.
- A changed base repositions only V1/A1; user clips on the other tracks are preserved.
- `--force` archives the previous `.fcproj` in `engine/filmcraft/archive/` and rebuilds.
- `--rebuild-media` forces the base and the elements to re-render.

Caveats:

- `zoom` does not become a clip; it applies to the base and is skipped with a warning.
- Markers and captions are created on the first build; later builds preserve them.
- The `.fcproj` stores absolute paths: moving the folder breaks the links.
- Only one process writes at a time; close FilmCraft during `build`.
- ProRes 4444 takes up space; the cache GC applies.
- FilmCraft export is CPU-bound for grading/keys; H.264 can use hardware.

The EDL/FCPXML `export` remains available and is independent of FilmCraft.

`doctor --json` reports `filmcraft: { installed, cli, app, source, version, mcp }`. `filmcraft status --json` shows detection, MCP, and an onboarding prompt (`prompt.kind`: `connect-mcp`, `install`, `install-cli`, or `ready`). `filmcraft setup [--client opencode|claude] [--write]` prints the snippet and, with `--write`, merges it into `opencode.json` or `.mcp.json`, creating a `.bak` backup when the file already exists; `filmcraft mcp-config [--client ...] [--json]` only shows the snippet. Nothing is installed or written without explicit permission. Link: https://getartcraft.com/apps/filmcraft.

Onboarding flow (the agent asks, it does not decide on its own):

- FilmCraft found, MCP not registered: "FilmCraft was found on this PC. Connect its MCP now? After connecting, you must restart the program/agent so it can see the tools." Options: Connect MCP / Not now.
- FilmCraft not found: "FilmCraft was not found on this PC. Continue with HyperFrames/Remotion, or install FilmCraft and connect its MCP?" Options: Continue with HyperFrames/Remotion / Install FilmCraft + connect MCP.
- App found without a CLI: ask to install the CLI or set `ROOSTER_FILMCRAFT_CLI`.
- MCP already registered: warn that the agent may still need a restart.
- Never install or write MCP config without explicit permission.
- The full prompt comes from `node "<skill>/scripts/rooster.mjs" filmcraft status --json`.

## Profiles

```text
profiles/<id>/
├── profile.json
├── STYLE.md
├── assets/
├── components/
└── examples/
```

Profiles can be:

- **channel** — inside `channels/<channel>/profiles`;
- **workspace** — shared in `rooster/profiles`;
- **global** — `~/.rooster/profiles`;
- **built-in** — `templates/profiles`.

`components/<name>/` stores reusable in-house animations (`element.html`, `element.css`, `element.js`). The build looks for the component first in the project (`style/components/<name>/`), then in the channel, the profile, and the templates. Use `component: "<name>"` in the plan's `custom` element. When a new visual works, save it to the profile or the channel so the next video can reuse it.

```bash
node scripts/rooster.mjs profile list
node scripts/rooster.mjs profile show minimal
node scripts/rooster.mjs profile fork minimal --as my-brand
```

## Library

```text
library/
├── music/
├── sfx/
├── fonts/
├── overlays/
├── luts/
├── broll/
└── images/
```

Every asset must have a license and provenance. Do not commit heavy media to the skill repository.

## Video links

```bash
node scripts/rooster.mjs ingest studio-a/video-x \
  --url "https://www.youtube.com/watch?v=..." \
  --confirm-rights
```

Read `references/link-ingest.md` before downloading. The command only works with `--confirm-rights`, and it respects the channel/workspace `assets.allowDownload`.

## Quick flow

1. `init` — creates the workspace + `default` channel.
2. `channel new` — creates the real channel.
3. `new --channel` — creates the project.
4. `ingest` — adds assets.
5. `transcribe` — generates `edit/transcript.json` (via `transcript-analyst`).
6. `digest` — reads the transcript in parts; the main agent receives only the handoff.
7. `plan` - approves the plan (via `editor`).
8. `build --target` — generates HyperFrames/Remotion (`--target hyperframes|remotion`) or, optionally, a FilmCraft timeline (`--target filmcraft`), via `engineer`.
9. `preview`/`render` — review and delivery (via `qa` + `engineer`).
