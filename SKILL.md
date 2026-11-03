---
name: rooster-edit
description: >-
  Plan, edit, and render complete videos with AI agents. Use this skill whenever
  the user wants to create a video, edit footage, make a faceless or TTS
  explainer, animate a 3D scene with Three.js, build motion graphics with
  Remotion or HyperFrames, design or reuse a visual style/profile, generate
  captions or voiceover, or preview a video timeline in the browser. Also use
  it when the user mentions reels, Shorts, YouTube videos, product promos,
  trailers, documentaries, tutorials, music videos, or wants to turn a script
  and assets into a finished MP4, even if they do not explicitly say "video
  editing". RoosterEdit is the director: it organizes the workspace, picks the
  right engine, and drives the project from brief to delivery.
compatibility: >-
  Best with Node.js 20+, FFmpeg/ffprobe, and a browser. The skill degrades to
  brief, script, storyboard, and edit plan when those tools are missing.
metadata:
  version: "0.1.0"
---

# RoosterEdit

RoosterEdit is a video studio for agents. It does not replace Remotion, HyperFrames, or FFmpeg; it decides what to make, organizes the assets, writes the plan, drives the chosen engine, reviews the result, and delivers the package.

The most important rule: **do not render before the plan and the preview are approved**, unless the user explicitly asks for no stops. Rendering is the cheapest part of the pipeline and the most expensive mistake to undo.

### Running the CLI

This skill ships its CLI at `scripts/rooster.mjs` relative to the skill's base directory. Run it from the user's project directory, resolving the script against the skill base. In the examples below, `<skill>` means that base directory:

```bash
node "<skill>/scripts/rooster.mjs" doctor --json
```

Do not create a `scripts/` directory in the user's project just to satisfy the command. The workspace (`rooster/`) belongs to the project; the CLI belongs to the skill. If the shell's working directory is the skill directory, the CLI will create the workspace in the wrong place.

## Fast path: the 6-step video workflow

When the user wants the simplest route from raw footage to a finished video, follow the same six steps as the reference workflow, adapted to the RoosterEdit workspace:

1. **Prepare the machine** — FFmpeg, Node.js LTS, Python 3, HyperFrames, and Whisper (or HyperFrames' Parakeet/whisper.cpp). Ask before installing anything.
2. **Create or resolve the project** — `rooster new ...`; raw media goes in `assets/source/`.
3. **Write the style guide** — `style.md` plus the resolved profile.
4. **Transcribe and plan** — HyperFrames transcribe (Parakeet/whisper.cpp) or Whisper writes `edit/transcript.json`; read it with `style.md` and write `edit/plan.json`. Show the plan and wait for approval.
5. **Create the visual elements** — letreiros, graphics, lists, zooms, b-roll, lower thirds.
6. **Assemble, review, export** — run `build` to generate the HyperFrames or Remotion project from the approved plan; preview, QA, render to `renders/`.

Read `references/video-pipeline.md` for the exact commands and the mapping from the reference video's folders to ours. The rest of this skill is the broader studio mode; the fast path is the default for single-video jobs.

## Operating principles

- **Direct before generating.** A clear brief, script, and shot list save more time than any prompt tweak. Spend the first part of the work understanding the video.
- **Inspect, don't assume.** Read the files, probe the media, look at frames, and check the tools. Never claim a render or an asset exists because the code looks right.
- **Keep the edit editable.** Prefer named scenes, variables, and readable components over one-off scripts. The user should be able to change a color, a line, or a clip without rewriting the project.
- **Review with eyes.** Use the browser preview, screenshots, or rendered stills to judge composition, pacing, and captions. Code review alone is not enough.
- **Respect provenance.** Record where every asset came from and its license. A beautiful video with an unlicensed track is a liability.
- **Degrade gracefully.** The harness may not have subagents, a browser, Node, FFmpeg, or TTS. Offer the best path available and say what is missing.

## Step 0 — Find the workspace

Look for a `rooster/` directory in the current project first, then use `ROOSTER_WORKSPACE` if it is set. If neither exists, ask whether to create one with:

```bash
node "<skill>/scripts/rooster.mjs" init
```

The workspace is where projects, profiles, categories, and the asset library live. Keep it out of the skill directory; the skill is reusable, the workspace belongs to the user's video project.

If the user is only asking a question or exploring an idea, answer it without creating a workspace. A question is not a request to build.

## Step 1 — Check capabilities

Run:

```bash
node "<skill>/scripts/rooster.mjs" doctor --json
```

This reports Node, npm, Python, FFmpeg, FFprobe, Git, GPU, detected engines, TTS providers, `yt-dlp`, Whisper, and the HyperFrames CLI. The harness itself knows whether subagents and a browser are available; combine that knowledge with the CLI output.

Read `references/harness.md` when something is missing. The short version:

- No Node: use FFmpeg directly for cuts and audio, but you cannot run HyperFrames or Remotion.
- No FFmpeg: you can still plan, script, and storyboard, but you cannot probe or render locally.
- No browser: render stills or frames and inspect them as images.
- No TTS: use the user's voice, captions only, or a local TTS tool if present.
- No `yt-dlp`: ask the user for the file, or install it only with permission.
- No subagents: do the work inline, in sequence. Do not pretend work is running in parallel.

## Step 2 — Intake

Ask only the questions that change the output. Read `references/intake.md` for the full set and defaults. The essential dimensions are:

| Dimension | Values |
|---|---|
| Source | `live` (real footage), `generated` (code/AI), `hybrid` |
| Voice | `user`, `tts`, `none` |
| Style | `user`, `profile`, `ai`, `reference` |
| Autonomy | `auto`, `guided`, `manual` |
| Platform / aspect | YouTube 16:9, Shorts/Reels/TikTok 9:16, square 1:1, custom |
| Length | Short (<60s), mid (1–5 min), long (>5 min) |
| Engine | `auto`, `hyperframes`, `remotion`, `ffmpeg` |

Do not interrogate the user with all of them at once. Infer sensible defaults from the brief and confirm the ones that are expensive to change later (aspect ratio, duration, voice, engine).

## Step 3 — Resolve the recipe

A project is a combination of a **category** (what the video is) and a **profile** (how it looks and sounds).

```text
category = content recipe: beats, pacing, duration, required assets, defaults
profile  = visual identity: colors, type, motion, captions, audio, components
project  = category + profile + overrides + assets + timeline + engine
```

Read `references/profiles-and-categories.md` for the schemas and resolution order. The short version:

1. Project overrides in `project.json`.
2. Workspace profiles/categories in `rooster/profiles` and `rooster/categories`.
3. Global profiles/categories in `~/.rooster`.
4. Built-ins shipped with the skill in `templates/`.

If the user has no profile, offer three paths: use a built-in, create one from their brand assets, or derive one from a reference. If they have a profile from another project, reuse it instead of recreating it.

## Step 4 — Plan before building

Produce, in order:

1. `brief.md` — goal, audience, platform, duration, tone, CTA, references, constraints.
2. `script.md` / `script.json` — spoken lines, on-screen text, scene beats.
3. `style.md` — the resolved visual and audio direction.
4. `storyboard/storyboard.json` — scenes, frames, durations, transitions, overlays, 3D cues.
5. `edit/timeline.json` — the edit decision list in timeline form.

Read `references/workflow.md` for the full pipeline and the approval gates. For the fast path, the plan lives at `edit/plan.json` and must be approved before any engine project is created; read `references/edit-plan.md` for the schema, heuristics, and the summary to show the user.

If the user asked for `auto`, log the decisions and keep moving; if they asked for `guided`, stop at the gates that matter (brief, script, style/storyboard, rough cut, final).

A useful plan answers these questions before any engine code is written:

- What is the hook in the first three seconds?
- How many scenes, and how long is each one?
- What is on screen while the voice speaks?
- Where are the captions, and what is the safe area?
- What does the viewer see when there is no voice?
- What is the exact output format?

## Step 5 — Ingest assets

Put user files in `assets/source`, generated media in `assets/generated`, and licensed stock in `assets/licensed`. When the user provides a video link (YouTube, Vimeo, etc.) as source material, use `yt-dlp` to fetch it into `assets/source/<slug>/` together with its info JSON, thumbnail, subtitles, and chapters. Read `references/link-ingest.md` before downloading: only fetch content the user owns or is authorized to use, keep cookies out of the repository, and never bypass DRM or paywalls.

Build `assets/manifest.json` with:

- stable id, path, type, hash;
- dimensions, duration, fps, codec, audio presence;
- source and license;
- tags that help the editor find the asset later.

Never delete or overwrite the user's originals. Prefer copying or linking into the workspace. If a file is missing, say so before building around it.

For footage-driven projects, transcribe with HyperFrames (`npx hyperframes transcribe`, Parakeet or whisper.cpp) or the Whisper CLI, then write `edit/plan.json` and get approval before opening the engine. Silence removal, filler-word removal, and b-roll placement are editorial decisions; they belong in `edit/plan.json`, `edit/edl.json`, and `edit/timeline.json`, not buried in a render script.

## Step 6 — Choose and drive the engine

Read `references/engines.md` for the full decision matrix. The default is `auto`. HyperFrames and Remotion are the two creative engines; FFmpeg is a media utility for probing, cutting, captions, and audio, not a third creative engine.

| Situation | Prefer |
|---|---|
| Real footage, interview, talking head, simple cuts | `ffmpeg` for cuts/audio, plus HyperFrames or Remotion for overlays |
| HTML/CSS/GSAP, kinetic type, charts, maps, motion graphics | `hyperframes` |
| React components, data-driven scenes, `@remotion/three`, complex state | `remotion` |
| 3D characters or product scenes with React | `remotion` + `@remotion/three` |
| 3D in an HTML composition | `hyperframes` + Three.js |
| No Node or FFmpeg | Produce the plan and explain that rendering needs Node/FFmpeg |

Respect an explicit engine request. If the requested engine cannot do something the user needs, explain the tradeoff and propose an alternative instead of silently switching.

Scaffold only the engine you are going to use. Keep the engine project inside `projects/<slug>/engine/<engine>/`. Keep the source of truth for editorial decisions in `edit/timeline.json` (or `edit/plan.json` in the fast path); let the engine adapter translate it.

Once the plan is approved, build the engine project:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

`build` reads `edit/plan.json`, applies the plan's cuts with FFmpeg, remaps the element timings to the cut timeline, copies the base media and element assets, and writes a working engine project. Use `--force` to rebuild and `--no-cuts` to ignore the cuts. For HyperFrames it also runs the engine's deterministic contract; for Remotion it generates the composition and data files.

For the fast path, Option 1 is automatic assembly in HyperFrames for HTML/CSS/GSAP motion. Option 2 is Remotion for React, data-driven scenes, and 3D. FFmpeg remains a utility for cuts, proxies, captions, and audio. Both engines start from the same approved plan.

## Step 7 — Preview and review

Offer a preview before rendering:

- HyperFrames: `npx hyperframes preview` (or the bundled adapter).
- Remotion: `npx remotion studio`.
- FFmpeg: render a low-resolution draft and show it in the review page.
- Unified review: `node "<skill>/scripts/rooster.mjs" preview <slug>`.

Read `references/timeline.md` for the timeline contract and the review page. When a browser is available, use it: open the preview, take screenshots, check console errors, and inspect the timeline. When it is not, render stills at key beats and read them as images.

The review page should make these obvious:

- every scene and its duration;
- the clips on each track;
- captions and their timing;
- audio tracks and music;
- missing assets or render errors;
- a checklist of QA items.

## Step 8 — QA

Read `references/qa.md` for the full checklist. At minimum, verify:

- resolution, aspect ratio, fps, and duration match the plan;
- no unintended black frames, freeze frames, or gaps;
- audio is not clipping, is at the target loudness, and has no long silences;
- captions are in sync, readable, inside the safe area, and correctly spelled;
- key text and logos are inside the title-safe area;
- every asset exists and has a recorded license;
- the hook lands in the first three seconds;
- the pacing matches the category;
- the brand profile is applied consistently.

Fix the cheap issues before rendering. A technical QA pass on a draft is faster than re-rendering a final.

## Step 9 — Render and deliver

Render a draft, inspect it, then render the final. Validate the output with FFprobe: duration, resolution, fps, audio channels, and loudness.

Deliver a package:

```text
renders/
├── final.mp4
├── draft.mp4
├── captions.srt
├── captions.vtt
├── thumbnail.png
├── metadata.json
└── project-archive.zip
```

`metadata.json` should include title, description, tags, chapters, aspect ratio, duration, and any platform-specific fields. Do not upload anywhere without explicit permission.

## Step 10 — Learn

If the user liked a look, a component, or a category, offer to save it:

- `rooster profile fork` to create a reusable profile;
- `rooster category fork` to create a reusable recipe;
- move a component into `profiles/<id>/components`;
- record decisions and feedback in `review.md`.

Reuse is the point of the workspace. A project that cannot inform the next one is a missed opportunity.

## Modes

| Mode | Behavior |
|---|---|
| `auto` | Make sensible decisions, log them, stop only for missing assets, license issues, or render failures |
| `guided` | Stop at brief, script, style/storyboard, rough cut, and final approval |
| `manual` | The user provides the script, EDL, or assets; execute precisely and ask before changing creative decisions |

Source, voice, and style are independent flags. A real-footage video can use TTS narration; a generated video can use the user's voice; a 3D video can have no voice at all.

## Workspace contract

The skill expects this shape:

```text
rooster/
├── workspace.json
├── config.json
├── projects/<slug>/
│   ├── project.json
│   ├── brief.md
│   ├── script.md
│   ├── style.md
│   ├── storyboard/
│   ├── assets/{source,generated,licensed}/
│   ├── edit/{timeline.json,edl.json,captions/,audio/}
│   ├── engine/{hyperframes|remotion|ffmpeg}/
│   ├── preview/
│   ├── renders/
│   ├── qa/
│   └── review.md
├── profiles/<id>/
├── categories/<id>/
├── library/{music,sfx,fonts,overlays,luts,broll,images}/
└── cache/
```

If the user already has a different structure, adapt to it and record the mapping in `project.json` instead of forcing a migration.

## Guardrails

- Do not render with missing assets. A placeholder is a bug, not a style.
- Do not use unlicensed music, fonts, or footage. If the license is unknown, ask.
- Do not download third-party video from a link unless the user owns it or has permission; respect platform terms and copyright. Never bypass DRM, paywalls, or access controls.
- Do not upload, publish, or send files to external services without explicit consent.
- Do not run destructive shell commands on the user's source media.
- Do not hide a failure behind a lower-quality render. Report it.
- Do not claim a feature is supported because a library exists; check the installed version and the actual adapter.
- Do not create a full NLE, a video-generation model, or a cloud render service as part of the v1 scope. Keep the core focused and pluggable.

## Reference map

| Read this | When |
|---|---|
| `references/workflow.md` | Full pipeline, gates, and artifact list |
| `references/video-pipeline.md` | The 6-step workflow inspired by the reference video, adapted to our workspace |
| `references/edit-plan.md` | `edit/plan.json` schema, cuts, elements, approval gate |
| `references/intake.md` | Questions, defaults, and mode detection |
| `references/engines.md` | Engine decision matrix and adapter contracts |
| `references/profiles-and-categories.md` | Profile/category schemas and resolution |
| `references/timeline.md` | Timeline JSON, review page, and browser QA |
| `references/qa.md` | Technical and editorial checklists |
| `references/harness.md` | Capability detection and degradation |
| `references/link-ingest.md` | Downloading video links with yt-dlp, metadata, subtitles, and licensing |
| `references/schemas.md` | JSON schemas for project, profile, category, timeline, manifest |
| `references/categories/<id>.md` | Category-specific playbooks |

## Quick commands

```bash
# Workspace
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" doctor --json

# Project
node "<skill>/scripts/rooster.mjs" new meu-video --category faceless-explainer --profile tech-neon --format 9:16
node "<skill>/scripts/rooster.mjs" ingest meu-video --url "https://www.youtube.com/watch?v=..." --confirm-rights
node "<skill>/scripts/rooster.mjs" list
node "<skill>/scripts/rooster.mjs" check meu-video

# Review (planned)
node "<skill>/scripts/rooster.mjs" preview meu-video
node "<skill>/scripts/rooster.mjs" render meu-video --draft
node "<skill>/scripts/rooster.mjs" render meu-video --final
```

If a command is not implemented yet, do the equivalent manually and tell the user what you did. Do not pretend the CLI succeeded.

## What good looks like

A good RoosterEdit session feels like working with a director who also knows the tools:

- the user explains the idea in a few sentences;
- the agent asks two or three sharp questions, not twenty;
- the plan appears as a brief, a script, and a storyboard the user can react to;
- the style is consistent because it comes from a profile, not from vibes;
- the preview is visible in the browser before the expensive render;
- the final package includes the video, captions, thumbnail, and metadata;
- the next video starts faster because the profile, category, or component was saved.
