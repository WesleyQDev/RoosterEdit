# Video-inspired 6-step workflow

This fast path borrows the **sequence** and the **approval discipline** from the reference video "Como editar vídeos com IA usando o Claude Code" by Marcos Lemos. It does **not** copy the video's folder names. RoosterEdit keeps its own workspace structure and maps the video's concepts into it.

## Reference video vs. RoosterEdit

| Reference video | RoosterEdit |
|---|---|
| `bruto/` | `channels/<canal>/projects/<slug>/assets/source/` |
| `estilo/ESTILO.md` | `channels/<canal>/projects/<slug>/style.md` + resolved profile |
| `trabalho/transcricao.json` | `channels/<canal>/projects/<slug>/edit/transcript.json` |
| `trabalho/plano.json` | `channels/<canal>/projects/<slug>/edit/plan.json` |
| `final/` | `channels/<canal>/projects/<slug>/renders/` |
| `estilo/` references | `channels/<canal>/projects/<slug>/style/` + `profiles/<id>/references/` |

The project structure stays:

```text
rooster/
├── channels/<canal>/
│   ├── channel.json
│   └── projects/<slug>/
│       ├── project.json
│       ├── brief.md
│       ├── style.md
│       ├── style/
│       ├── assets/source/
│       ├── edit/
│       │   ├── transcript.json
│       │   ├── digest.md
│       │   ├── analysis.json
│       │   ├── plan.json
│       │   ├── edl.json
│       │   ├── timeline.json
│       │   └── captions/
│       ├── engine/
│       ├── work/{handoffs,logs,scratch,notes}/
│       ├── preview/
│       ├── renders/
│       └── qa/
├── profiles/
└── library/
```

## Delegation

The steps map to the roles in `agents/`: `art-director` for Step 3, `transcript-analyst` for Step 4 transcription, `editor` for Step 4 plan, `engineer` for Steps 5–6 visual elements, build, and render, and `qa` for Step 6 review. The main agent keeps the plan approval gate and looks at the final frames.

Pass paths, not contents. The subagent writes the detail to the project and returns a handoff in `work/handoffs/`; logs go to `work/logs/`. Read `references/subagents.md` for the full protocol.

## Step 1 — Prepare the machine

Check and, if missing, install:

- FFmpeg
- Node.js LTS
- Python 3
- Whisper (local, free transcription)
- HyperFrames (via its skill or CLI)

Ask for permission before each installation. Test Whisper with a short audio file before relying on it.

```bash
ffmpeg -version
node --version
python --version
whisper --help
npx skills add heygen-com/hyperframes
```

If the user only wants planning, do not install anything. Explain what is missing and continue with the plan.

## Step 2 — Create or resolve the project

Create the channel first if it does not exist, then the project:

```bash
node "<skill>/scripts/rooster.mjs" new meu-video \
  --channel meu-canal \
  --profile minimal \
  --source live \
  --voice user
```

Put raw media in `channels/meu-canal/projects/meu-video/assets/source/`. If the user says they will provide the footage and has not sent a path, create the project and run `open <slug>` so the source folder opens in the file manager. If the user already has a project, resolve its channel/profile instead of creating a new one.

## Step 3 — Write the style guide

Write `channels/<canal>/projects/<slug>/style.md` and resolve the profile. The video uses a single `ESTILO.md`; RoosterEdit separates the human-readable guide (`style.md`) from the reusable identity (`profiles/<id>/profile.json`).

The style guide should include:

- tone and references;
- palette and typography;
- motion and transitions;
- caption style;
- music and SFX palette;
- what to avoid;
- examples of frames or links.

## Step 4 — Transcribe and plan

### Transcribe

Prefer HyperFrames transcribe. It uses Parakeet for English and whisper.cpp for other languages, and writes word-level timestamps:

```bash
npx hyperframes transcribe channels/meu-canal/projects/meu-video/assets/source/video.mp4 \
  --language pt \
  --model small \
  --json \
  --to srt \
  -o channels/meu-canal/projects/meu-video/edit/captions/transcript.srt
```

Or use Whisper locally:

```bash
whisper channels/meu-canal/projects/meu-video/assets/source/video.mp4 \
  --model small \
  --language pt \
  --output_format json \
  --output_dir channels/meu-canal/projects/meu-video/edit
```

Save the result as `edit/transcript.json` (and optionally `.srt`). The transcript must include the start and end time of each sentence or segment.

The RoosterEdit CLI wraps both paths:

```bash
node "<skill>/scripts/rooster.mjs" transcribe meu-video --language pt --model small
```

It prefers HyperFrames when available and falls back to the OpenAI Whisper CLI.

### Plan

Work from `edit/analysis.json` and `style.md`, not from the raw transcript. Understand the subject and write `edit/plan.json`:

- cuts for long pauses, repetitions, false starts, and retakes;
- the strongest take to keep;
- overlays: letreiros, graphics, lists, zooms, b-roll;
- music: `src`, `gainDb`, and license, or a note explaining why there is none;
- start, end, and description for every cut and element;
- a short summary and chapter markers.

A cut-only plan is incomplete unless the user explicitly asked for a clean cut. Include at least one visual element and a music decision before showing the plan.

Read `references/edit-plan.md` for the schema and heuristics.

### Show the plan before building

Always show the user a readable summary of `edit/plan.json` and wait for approval. `plan <slug> --show` also writes `edit/plan.md` and `edit/plan.html`; display the HTML artifact in the harness's preview pane or browser when available. Do not create the HyperFrames project, the timeline, or the final render before the plan is approved. This is the most important gate in the workflow.

## Step 5 — Create the visual elements

Turn the approved plan into scenes:

- **Letreiros**: short titles, names, key phrases.
- **Gráficos**: diagrams, charts, numbers, comparisons.
- **Listas**: steps, checklist items, rankings.
- **Zooms**: punch-ins on faces, products, or details.
- **B-roll**: footage or images that illustrate the words.
- **Lower thirds**: names and roles.

Choose the engine:

- HyperFrames for HTML/CSS/GSAP motion and automatic assembly;
- Remotion for React, data-driven scenes, and 3D;
- FFmpeg for simple cuts, captions, and audio.

## Step 6 — Assemble, review, export

### Option 1 — Automatic assembly

Build a HyperFrames project from the approved plan:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
```

The build applies the plan's cuts with FFmpeg, remaps the element timings, copies the media, and writes a working composition. Preview it in the browser. Review the cuts, captions, overlays, and audio. Render to `renders/final.mp4`.

### Option 2 — Remotion

Build a Remotion project from the approved plan when the video needs React components, data-driven scenes, interaction, or 3D via `@remotion/three`:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

Preview in Remotion Studio, then render to `renders/final.mp4`.

### Review and export

Run the QA sweep through `qa` and the fixes through `engineer`:

- Watch the draft with the user.
- Fix timing, captions, audio, and visual issues.
- Render the final.
- Validate with FFprobe.
- Deliver `renders/final.mp4`, `edit/captions/captions.srt`, `renders/thumbnail.png`, and `renders/metadata.json`.

## What we keep from the video

- The 6-step sequence.
- The idea of a single visual style guide.
- Local Whisper transcription with timestamps.
- An edit plan with cuts and visual elements.
- A hard approval gate before building.
- Two assembly paths: HyperFrames for HTML/GSAP motion, Remotion for React/3D/data.
- A final review and export step.

## What we adapt

- Folder names: we use `channels/<canal>/projects/<slug>/` instead of `bruto/estilo/trabalho/final`.
- The style guide is split into `style.md` and a reusable profile.
- The plan is `edit/plan.json`, not `trabalho/plano.json`.
- The plan feeds an engine-agnostic timeline (`edit/timeline.json`), not only one engine.
- Channels and profiles make the workflow reusable across videos.
- QA, licenses, captions, and delivery are first-class.

## Anti-patterns

- Copying the video's folder names literally when the project already has a structure.
- Building before the plan is approved.
- Skipping the style guide and improvising the look.
- Treating automatic captions as final.
- Creating overlays for every sentence instead of for the moments that need them.
- Rendering before watching the preview.
- Trying to force HyperFrames into a React/3D project instead of using Remotion.
