# Workflow

This is the full RoosterEdit pipeline. Read it once at the start of a project, then return to the relevant phase when needed. The phases are ordered, but real projects loop: a QA finding can send you back to the storyboard, and a missing asset can change the script.

## Phase 0 — Discover

1. Find the workspace (`rooster/` or `ROOSTER_WORKSPACE`). If none exists, ask before creating one.
2. Run `node "<skill>/scripts/rooster.mjs" doctor --json`.
3. Read `references/harness.md` if a capability is missing.
4. Inspect any existing project files. Do not overwrite user work.
5. Ask only the intake questions that change the output (`references/intake.md`).

Exit criteria: you know what the user wants, what tools are available, and whether a workspace exists.

## Fast path (video-inspired)

For a single video with real footage, the shortest route is:

1. Prepare FFmpeg, Node, Python, Whisper, HyperFrames (with permission).
2. Create/resolve the project and put raw media in `assets/source/`.
3. Write `style.md` and resolve the profile.
4. Transcribe with Whisper to `edit/transcript.json`; write `edit/plan.json`; show the plan and wait for approval.
5. Build the visual elements from the plan.
6. Assemble in HyperFrames or Remotion; preview, QA, render to `renders/`.

Read `references/video-pipeline.md` for the full mapping. This is the default for single-video jobs; the rest of this document is the broader studio pipeline.

## Progress and gates

Keep a compact 8-step tracker and show the current step in every update: environment, intake, assets/transcript, plan, timeline, build, preview/QA, render/delivery. At each gate, name the next action and ask before continuing, for example `Etapa 4/8 — Plano pronto. Posso seguir com a timeline?` Do not print the whole checklist every time, and do not combine timeline and final render in one approval; preview and QA sit between them.

## Phase 1 — Intake

Capture:

- goal and audience;
- platform and aspect ratio;
- target duration;
- source mode (`live`, `generated`, `hybrid`);
- voice mode (`user`, `tts`, `none`);
- style mode (`user`, `profile`, `ai`, `reference`);
- existing assets and links;
- autonomy (`auto`, `guided`, `manual`);
- hard constraints (deadline, brand rules, legal restrictions).

Do not ask twenty questions. Infer what you can from the brief and confirm the expensive-to-change decisions.

Exit criteria: a short, written intake summary the user can correct.

## Phase 2 — Research and references

Only when the video depends on facts, a visual reference, or a style the user cannot describe.

- Collect 3–5 visual references and note what specifically to borrow (palette, type, pacing, transitions).
- For factual content, verify claims and keep a source list.
- For a reference video, extract frames and describe the style in concrete terms, not adjectives.
- For a link source, read `references/link-ingest.md` and confirm rights before downloading.

Exit criteria: enough context to write a brief and a style direction without guessing.

## Phase 3 — Brief

Write `brief.md`:

```md
# <Project name>

## Goal
## Audience
## Platform and format
## Duration
## Tone
## Key message
## Call to action
## References
## Constraints
## Success criteria
```

A good brief is one page. If it is longer, the idea is not clear yet.

Exit criteria: the user agrees with the goal, format, and duration.

## Phase 4 — Script and beats

Write `script.md` and `script.json`.

The script should include:

- spoken lines (if voice is used);
- on-screen text;
- scene beats with approximate durations;
- visual notes for each beat;
- the hook and the CTA.

For a faceless explainer, the script is the spine. For a talking-head video, the transcript is the spine and the script is a paper edit. For a 3D short, the script may be a narration track plus a shot list.

Exit criteria: the user approves the story, or the `auto` mode logs the decision and moves on.

## Phase 5 — Style

Write `style.md` with:

- palette and contrast rules;
- typography and type scale;
- motion language and transitions;
- caption style;
- audio palette (music, SFX, voice);
- do/don't examples;
- AI style prompts, if images will be generated.

Resolve a profile if one exists. If not, create one from brand assets, from references, or from scratch. Keep the style specific enough to make decisions, but not so specific that every scene looks the same.

Exit criteria: the user can look at `style.md` and say "that's the video".

## Phase 6 — Assets

1. Ingest files into `assets/source`, `assets/generated`, or `assets/licensed`.
2. Download authorized links with `yt-dlp` into `assets/source/<slug>/`.
3. Probe every media file with FFprobe.
4. Build or update `assets/manifest.json`.
5. Generate proxies and thumbnails.
6. Flag missing assets, unknown licenses, and incompatible formats.

Do not build around an asset that might not exist. A placeholder is a bug.

Exit criteria: every scene has the assets it needs, or a documented fallback.

## Phase 7 — Storyboard

Write `storyboard/storyboard.json` and generate frames if possible.

Each scene should include:

- id, title, duration;
- visual description;
- camera/motion notes;
- on-screen text;
- voice line;
- audio/music cue;
- asset references;
- transition in/out;
- engine hints (2D, 3D, footage, overlay).

The storyboard is where pacing problems are cheapest to fix. A 20-scene storyboard that reads well is better than a beautiful render with a boring middle.

Exit criteria: the user approves the storyboard, or `auto` logs it.

## Phase 8 — Timeline and EDL

Translate the storyboard into `edit/timeline.json` and, for footage, `edit/edl.json`.

The timeline is the engine-agnostic source of truth for editorial decisions. It should include:

- format (width, height, fps, duration);
- tracks (video, overlay, captions, voice, music, SFX);
- clips with source in/out and timeline start/end;
- scenes with component/props references;
- markers for beats and QA;
- caption cues and audio cues.

Read `references/timeline.md` for the schema and adapters.

Exit criteria: the timeline adds up to the target duration, has no overlaps or gaps that are not intentional, and covers every scene.

## Phase 9 — Build

1. Choose the engine (`references/engines.md`).
2. Scaffold inside `channels/<channel>/projects/<slug>/engine/<engine>/`.
3. Implement scenes, components, captions, audio, and 3D.
4. Keep assets referenced from the project's `assets` directory.
5. Keep the code readable and editable.
6. Run the engine's lint/check command after structural changes.

For HyperFrames, follow its render contract: `class="clip"`, `data-start`, `data-duration`, deterministic timelines, no real-time clocks. For Remotion, use `useCurrentFrame()` and `Sequence`; avoid real-time side effects. For FFmpeg, generate a readable filter graph and keep the EDL as the source of truth.

Exit criteria: the project builds and renders at least one still or short draft.

## Phase 10 — Preview

Offer a preview before the final render:

- native studio (`npx hyperframes preview`, `npx remotion studio`);
- unified review page (`node "<skill>/scripts/rooster.mjs" preview <slug>`);
- draft render for FFmpeg projects.

Use a browser when available. Take screenshots at key beats, inspect console errors, and check the timeline. Without a browser, render stills and read them as images.

Exit criteria: the user has seen the video (or representative frames) and approved, or `auto` has performed the review and logged it.

## Phase 11 — QA

Run the checklist in `references/qa.md`.

At minimum:

- technical: resolution, aspect, fps, duration, black/freeze frames, audio loudness, clipping, silence, captions sync, safe areas;
- editorial: hook, clarity, pacing, CTA, brand consistency;
- legal: asset licenses, music, fonts, source rights;
- platform: aspect, duration, caption style, thumbnail, metadata.

Write `qa/report.md` with pass/fail and evidence. Fix cheap issues before the final render.

Exit criteria: no blocking issues.

## Phase 12 — Render and deliver

1. Render a draft.
2. Inspect the draft with FFprobe and by looking at frames.
3. Render the final.
4. Validate the final.
5. Package: MP4, captions, thumbnail, metadata, project archive.
6. Tell the user where everything is.

Do not upload or publish without explicit permission.

Exit criteria: a verified final file and a complete package.

## Phase 13 — Learn

- Save the profile or component if it is reusable.
- Record decisions and feedback in `review.md`.
- Promote a local profile to global if the user wants it.
- Update the channel defaults if a pattern should apply to future videos.

Exit criteria: the next project starts faster.

## Gates

| Gate | When | In `auto` |
|---|---|---|
| Brief | After intake | Log and proceed unless the goal is ambiguous |
| Script | After script/beats | Log and proceed unless facts or claims are risky |
| Style + storyboard | Before build | Log and proceed unless assets are missing |
| Rough cut / preview | Before final render | Review and proceed unless the user asked for approval |
| Final | Before delivery | Validate and deliver |

In `guided` mode, stop at every gate and wait. In `manual` mode, ask before changing any creative decision.

## Artifacts

| Artifact | Purpose |
|---|---|
| `project.json` | Project configuration and overrides |
| `brief.md` | Goal, audience, constraints |
| `script.md` / `script.json` | Spoken lines, text, beats |
| `style.md` | Visual and audio direction |
| `storyboard/storyboard.json` | Scene plan |
| `assets/manifest.json` | Asset inventory and provenance |
| `edit/timeline.json` | Engine-agnostic timeline |
| `edit/edl.json` | Footage cut list |
| `edit/captions/` | SRT/VTT and caption data |
| `engine/<engine>/` | Implementation |
| `preview/` | Review page and screenshots |
| `qa/report.md` | QA evidence |
| `renders/` | Draft, final, thumbnail |
| `review.md` | Decisions, feedback, lessons |

## Anti-patterns

- Building the engine before the script and storyboard are clear.
- Rendering before the user has seen a preview.
- Hardcoding colors, fonts, or durations that belong in a profile.
- Downloading a link without confirming rights.
- Treating automatic captions as final.
- Using a 4K source when 1080p is enough.
- Adding background music because "videos have music" instead of because the story needs it.
- Calling a render successful without probing the file and looking at frames.
