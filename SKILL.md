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
  Best with Node.js 22+, FFmpeg/ffprobe, and a browser. The skill degrades to
  brief, script, storyboard, and edit plan when those tools are missing.
metadata:
  version: "0.2.0"
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

## Where to install the skill

Install with npm. Do not clone the repository unless the user is developing RoosterEdit.

```bash
npx rooster-edit@latest install              # local to the project (recommended)
npx rooster-edit@latest install --global     # every project on the machine
npx rooster-edit@latest install --harness claude
```

Ask whether the install should be **local to the project (recommended)** or **global** before running it. Pass the harness the user is actually running: `--harness` accepts `opencode` (default), `claude`, or `agents`. The command copies the skill into that harness's skills folder and prints the path; it does not create a workspace.

If the user is developing the skill, cloning into the skills folder is fine. This choice is about where the skill lives, not where the video workspace lives (`./rooster`).

### Reporting

End-of-task replies are short by default: 5-10 lines or one compact table. Include only what the user needs to act:

- what was done or found;
- the paths or links to the result;
- what is missing or blocked, if anything;
- one clear next question.

Do not repeat the brief, paste logs, list every command, or explain the whole skill unless the user asks. Put details in workspace files or link the reference docs. A plan, QA report, or delivery package can be longer only because the user must review its contents.

Installation and workspace setup are separate steps. After installing and running `doctor`, do not start onboarding or write a guide. Summarize the environment in a few lines and ask whether the user wants to configure the workspace now. Wait for a yes before creating `rooster/` or a channel.

### Progress updates

Use a compact step marker in status updates and at every approval gate. Keep one 8-step tracker for the project:

1. Environment and workspace
2. Brief and intake
3. Assets and transcript
4. Edit plan
5. Storyboard and timeline
6. Engine choice and build
7. Preview and QA
8. Render and delivery

Examples:

- `Step 3/8 — Transcript complete. 42 segments, 10:12 long.`
- `Step 4/8 — Plan ready at edit/plan.html. Can I continue with the timeline?`
- `Step 6/8 — Plan approved. HyperFrames, Remotion (install), or FilmCraft (connect the MCP)?`
- `Step 6/8 — Build complete. Can I open the preview and run QA?`
- `Step 8/8 — Preview approved. Can I render the final?`

Skip steps that do not apply and say why. Do not print the full checklist on every message; show the current step, what changed, and the next gate. Do not combine timeline and final render in one approval: preview and QA sit between them. Step 6 starts with the engine/timeline question; do not build before the user answers or explicitly delegates the choice.

## Subagent-first execution

The main agent is the director, not the worker. It talks to the user, owns the brief and the decisions, runs the approval gates, and looks at the final frames. The noisy work goes to a stage subagent: transcript analysis, research, script drafts, plan drafts, style and storyboard, build and fixes, QA sweeps, render and packaging. Each subagent has its own context, which is discarded when the stage ends, so raw material never accumulates in the main thread.

Delegate by default whenever the harness has a subagent tool. Keep the stage inline when it is one cheap command, when it is the conversation itself (intake, approvals), or when it is the final visual judgment.

| Stage | Subagent | Main agent receives |
|---|---|---|
| Brief | `producer` | one-paragraph brief + open questions |
| Research | `researcher` | 5 findings + sources + license flags |
| Transcript | `transcript-analyst` | duration, topics, 10–20 beats, flags |
| Script | `scriptwriter` | hook + beat summary |
| Plan | `editor` | plan summary + risks |
| Style/storyboard | `art-director` | tokens + scene count + asset needs |
| Timeline | `editor` | duration math + markers |
| Audio | `audio-director` | voice/music/mix decisions |
| Build | `engineer` | status + artifact paths + blocker |
| QA | `qa` | verdict + top issues + frame paths |
| Render | `engineer` | final path + probe stats |

Spawn with a short prompt: role file path, project path, one task sentence, input paths, constraints. Pass paths, never the brief, transcript, logs, or plan contents. If the input is the conversation itself, write the answers to `work/intake.md` first. Ask for the handoff described in `references/subagents.md` and nothing else. Use the harness's general-purpose or worker agent for stages that write files or run commands; a read-only or research type is fine for research. This is a capability, not a tool name: if the harness cannot start a fresh agent with file and command access, or a spawn fails twice, run the stage inline and keep the file boundaries.

The handoff is the only thing that enters the main context:

```text
status: ok | needs-decision | blocked
artifacts: paths that exist
summary: <= 5 lines
decisions: what the main agent must confirm
blockers: what stops the stage
next: next stage or exact question
```

The main agent may read the brief, script, style, `review.md`, and handoffs, and may view `plan.html` and 3–5 frames. It must not read the raw transcript, full plan JSON, generated code, build/render logs, or a contact sheet of dozens of frames. If a detail is missing, send a follow-up to the same subagent instead of opening the raw file.

Nothing here is a dependency. The artifacts and gates are the same when a stage runs inline; you lose the context isolation, not the workflow.

Approval gates never move to a subagent. The subagent proposes; the user and the main agent decide.

## First run after installation

If the workspace does not exist yet, do a short onboarding before creating any project. The workspace is created as part of the channel step; do not ask where it lives.

**First ask (one message):** "Do you want to create your first channel now? Think of it as the project folder: it holds the videos, the style, and the brand or client files. If yes, tell me the channel name and what it will produce?"

If the answer is no, stop and create nothing. If they answer only one part, ask for the missing name or content.

If the answer is yes:

1. Use the name the user gave (slugified) as the channel id. If they described the content but gave no name, propose a short kebab-case name and confirm it.
2. Use the content sentence verbatim and infer language, format, source, assets, engine, autonomy, and voice. Keep the profile at `minimal` for now; the identity step defines it. Do not infer a visual style from the topic. Do not ask for a duration.
3. Show the inferred defaults in one compact line and ask "Does that look right, or do you want to adjust anything?" Ask a follow-up only when a field is genuinely ambiguous, such as the platform or whether the source is real footage.
4. On confirmation, run `init`, then `channel new <id> ...` with the answers.
5. Create the channel identity: ask three questions (palette, typography, motion/audio) and run `channel design <id> ...`. This writes `channels/<id>/profiles/<id>/profile.json` + `STYLE.md` and sets `channel.profile`. Show a short summary and stop.

During first-run, run `filmcraft status --json` once. If `prompt.kind` is `connect-mcp` or `install`, ask the question in `prompt` before creating the first project:

- CLI found, MCP not registered: "I found FilmCraft <version> on your PC. Do you want to connect its MCP now? After connecting, you must restart the program/agent so it can see the tools." (Connect MCP / Not now)
- FilmCraft not found: "I did not find FilmCraft on your PC. Do you want to continue with HyperFrames/Remotion, or install FilmCraft and connect its MCP?" (Continue with HyperFrames/Remotion / Install FilmCraft + connect MCP)

If the user declines, continue with HyperFrames/Remotion and do not ask again for that project. If the MCP is already registered, mention that a restart may still be needed if the tools are not visible. Never install FilmCraft or write MCP config without explicit permission. Read `references/onboarding.md` for the CLI-missing and already-registered cases.

Duration is an outcome of the edit, not a channel default and not a project default. Trimming silence and cuts change the length. `--duration` exists only for a target the user explicitly declares; otherwise the plan and the media define the final length. The full twelve-field setup is an opt-in advanced path. If the user asks to customize everything, ask in groups of at most three, never all at once.

A channel is the stable group for a brand, audience, or operation (for example "Studio A" or "Client B"). It owns the creative defaults: language, format, profile, assets policy, engine, autonomy, and voice. Every project belongs to a channel and can override any of those defaults. Duration comes from the edit; a channel or project only carries a target when the user declares one.

Do not start a video in the same turn unless the user explicitly asks. Read `references/onboarding.md` for the exact questions, defaults, and commands. Read `references/assets.md` before downloading or generating any asset.

## Fast path: the 6-step video workflow

When the user wants the simplest route from raw footage to a finished video, follow the same six steps as the reference workflow, adapted to the RoosterEdit workspace:

1. **Prepare the machine** — FFmpeg, Node.js LTS, Python 3, HyperFrames, and Whisper (or HyperFrames' Parakeet/whisper.cpp). Ask before installing anything.
2. **Create or resolve the project** — `rooster new ...`; raw media goes in `assets/source/`.
3. **Write the style guide** — `art-director` writes `style.md` and resolves the profile. Run `styleproof <slug>` and approve the three sample frames before planning.
4. **Transcribe and plan** — `transcript-analyst` writes `edit/transcript.json`, `edit/digest.md`, and `edit/analysis.json`; `editor` writes `edit/plan.json` from the analysis and `style.md`. Show `plan.html` with transcript context and wait for approval.
5. **Create the visual elements** — `engineer` builds letreiros, graphics, lists, zooms, parallax scenes, b-roll, lower thirds, music, and SFX when the channel style calls for them. A cut-only draft is not a finished video unless the user explicitly asked for a clean cut.
6. **Assemble, review, export** — `engineer` runs `build` to generate the HyperFrames or Remotion project from the approved plan; use `--sample 3` before the full build. `qa` inspects `preview/index.html` and the frames, then `engineer` renders to `renders/`; `export` writes an EDL/FCPXML handoff when the user wants DaVinci or Premiere.

Read `references/video-pipeline.md` for the exact commands and the mapping from the reference video's folders to ours. The rest of this skill is the broader studio mode; the fast path is the default for single-video jobs.

## Operating principles

- **Direct before generating.** A clear brief, script, and shot list save more time than any prompt tweak. Spend the first part of the work understanding the video.
- **Inspect, don't assume.** Read the files, probe the media, look at frames, and check the tools. Never claim a render or an asset exists because the code looks right.
- **Keep the edit editable.** Prefer named scenes, variables, and readable components over one-off scripts. The user should be able to change a color, a line, or a clip without rewriting the project.
- **Review with eyes.** Use the browser preview, screenshots, or rendered stills to judge composition, pacing, and captions. Code review alone is not enough.
- **Respect provenance.** Record where every asset came from and its license. A beautiful video with an unlicensed track is a liability.
- **Degrade gracefully.** The harness may not have subagents, a browser, Node, FFmpeg, or TTS. Offer the best path available and say what is missing.
- **Delegate the heavy stages.** The main agent directs; stage subagents do the noisy work and return a short handoff. Transcripts, build logs, generated code, and QA sweeps should not pass through the main context. Read `references/subagents.md`.
- **Report short.** End every task with the result, the paths, and one next question. Do not narrate the whole process or dump commands unless the user asks.
- **Finish the creative layer.** Cuts alone are not a video. Plan overlays, b-roll, music, SFX, or captions unless the user explicitly asked for a clean cut.
- **Ask when uncertain.** If a choice changes the cut, the look, the audio, or the cost, ask at the current `Etapa X/8`. Do not guess silently.
- **Protect the context.** Video work is token-heavy. Redirect engine logs to files, read only the tail, use `digest` instead of the full transcript, and inspect a few key frames instead of every frame. Read `references/token-discipline.md`.

## Step 0 - Find the workspace

Look for a `rooster/` directory in the current project first, then use `ROOSTER_WORKSPACE` if it is set. The default is `./rooster`; only ask for a custom path when the user wants one.

If neither exists and the user has already asked to make a video, creating the workspace is implied; run:

```bash
node "<skill>/scripts/rooster.mjs" init
```

If the user just installed the skill or is only exploring, do not create it silently: follow "First run after installation" and ask first.

The workspace is where **channels**, projects, profiles, and the asset library live. Keep it out of the skill directory; the skill is reusable, the workspace belongs to the user's video project.

If the workspace exists but has no channel, create one before creating a project. Every project belongs to a channel; a `default` channel covers one-off videos.

If the user is only asking a question or exploring an idea, answer it without creating a workspace. A question is not a request to build.

## Step 1 — Check capabilities

Run:

```bash
node "<skill>/scripts/rooster.mjs" doctor --json
```

This reports Node, npm, Python, FFmpeg, FFprobe, Git, GPU, detected engines, TTS providers, `yt-dlp`, Whisper, the HyperFrames CLI, and the optional FilmCraft CLI and MCP status. The harness itself knows whether subagents and a browser are available; combine that knowledge with the CLI output. For costs, read `docs/COSTS.md`; never call a paid provider without explicit permission.

If Remotion is not installed or the FilmCraft MCP is not configured, say so in one line and defer the install/connect question to the build gate (Step 6). Do not install packages or write MCP config during discovery.

Read `references/harness.md` when something is missing. The short version:

- No Node: use FFmpeg directly for cuts and audio, but you cannot run HyperFrames or Remotion.
- No FFmpeg: you can still plan, script, and storyboard, but you cannot probe or render locally.
- No browser: render stills or frames and inspect them as images.
- No TTS: use the user's voice, captions only, or a local TTS tool if present.
- No `yt-dlp`: ask the user for the file, or install it only with permission.
- No subagents: do the work inline, in sequence, and keep raw output in files. Do not pretend work is running in parallel.

## Step 2 — Intake

Ask only the questions that change the output. Read `references/intake.md` for the full set and defaults. The essential dimensions are:

| Dimension | Values |
|---|---|
| Source | `live` (real footage), `generated` (code/AI), `hybrid` |
| Voice | `user`, `tts`, `none` |
| Style | `user`, `profile`, `ai`, `reference` |
| Autonomy | `auto`, `guided`, `manual` |
| Edit mode | `cleanup` (default), `condensed` |
| Platform / aspect | YouTube 16:9, Shorts/Reels/TikTok 9:16, square 1:1, custom |
| Length | Short (<60s), mid (1–5 min), long (>5 min) |
| Engine | `auto`, `hyperframes`, `remotion`, `ffmpeg` |

Do not interrogate the user with all of them at once. Infer sensible defaults from the brief and confirm the ones that are expensive to change later (aspect ratio, edit mode, profile, voice, engine). Default to `cleanup`; a `condensed` highlight needs explicit approval. Do not ask for a duration unless the user declares a target.

## Step 3 - Resolve the channel and profile

A project belongs to a **channel** and uses a **profile** (how it looks and sounds).

```text
channel  = production standard: content, language, format, profile, assets, engine, voice
profile  = visual identity: colors, type, motion, captions, audio, components
project  = channel + profile + overrides + duration + assets + timeline + engine
```

Read `references/profiles.md` for the schemas and resolution order. The short version:

1. Project overrides in `project.json`.
2. Channel defaults in `channels/<id>/channel.json` and channel-scoped profiles.
3. Workspace profiles in `rooster/profiles`.
4. Global profiles in `~/.rooster/profiles`.
5. Built-ins shipped with the skill in `templates/profiles`.

The project can override anything it inherits from the channel. There is no separate category concept: the channel's `content` field describes what it produces, and the project's brief and plan define the structure of each video.

If the user has no channel, create one first. If they have no profile, offer three paths: use a built-in, create one from their brand assets, or derive one from a reference. A channel should get its own profile with `channel design <id>`, which writes it under `channels/<id>/profiles/<id>/` and points `channel.profile` at it. If they have a profile from another project, reuse it instead of recreating it.

After the profile resolves, run `styleproof <slug>` and show the three frames. Do not plan or build until the look is approved.

## Step 4 — Plan before building

Produce, in order:

1. `brief.md`, `script.md`/`script.json`, and `style.md` — the goal, the words, and the look.
2. `storyboard/storyboard.json` and `edit/timeline.json` — the scene plan and the edit decision list.
3. `edit/plan.json` — the fast-path plan the user approves before the build.

Read `references/workflow.md` for the full pipeline and the approval gates. For the fast path, the plan lives at `edit/plan.json` and must be approved before any engine project is created; read `references/edit-plan.md` for the schema and heuristics. Run `plan <slug>` to write `edit/plan.md`, `edit/plan.html`, and `qa/plan-review.md`, display the HTML artifact in the harness's preview pane or browser when available, then ask for approval. Delegate the draft to `editor`; review the HTML with the user instead of building the JSON by hand in the main thread. For advanced layers (captions, motion, audio, reframe, delivery, color, b-roll, charts, TTS, multicam), read `references/professional-elements.md` and load only the feature you need.

If the user asked for `auto`, log the decisions and keep moving; if they asked for `guided`, stop at the gates that matter (brief, script, style/storyboard, rough cut, final).

A useful plan answers these questions before any engine code is written:

- What is the hook in the first three seconds?
- How many scenes, and how long is each one?
- What is on screen while the voice speaks?
- Where are the captions, and what is the safe area?
- What does the viewer see when there is no voice?
- What is the exact output format?

## Step 5 — Ingest assets

When the user says they will provide their own footage, do not ask "where is the file?" first. Create the project if needed, run `open <slug>` to show and open `assets/source/`, and tell them to put the files there. If they give a path instead, ingest it.

Put user files in `assets/source`, generated media in `assets/generated`, and licensed stock in `assets/licensed`. When the user provides a video link (YouTube, Vimeo, etc.) as source material, use `yt-dlp` to fetch it into `assets/source/<slug>/` together with its info JSON, thumbnail, subtitles, and chapters. Read `references/link-ingest.md` before downloading: only fetch content the user owns or is authorized to use, keep cookies out of the repository, and never bypass DRM or paywalls.

Build `assets/manifest.json` with:

- stable id, path, type, hash;
- dimensions, duration, fps, codec, audio presence;
- source and license;
- tags that help the editor find the asset later.

Never delete or overwrite the user's originals. Prefer copying or linking into the workspace. If a file is missing, say so before building around it.

For footage-driven projects, run transcription and analysis through `transcript-analyst` (HyperFrames/Parakeet, whisper.cpp, or the Whisper CLI). It writes `edit/transcript.json`, `edit/digest.md`, and `edit/analysis.json`, and returns duration, topics, beats, and flags. Then have `editor` write `edit/plan.json` from the analysis, `style.md`, and the brief; get approval before opening the engine. Default to `editMode: "cleanup"`: keep the full story and use `cuts`, with `tighten <slug> --json` as the baseline. `tighten` reads the audio, keeps a natural beat (0.4 s), leaves 100 ms before the next line, snaps each cut to speech, and never touches a span in `plan.protect`. Use the legacy `silence` command only when the audio cannot be analyzed. Use `keeps` only when the user approved a condensed or highlight version and the plan says `editMode: "condensed"`. Silence removal, filler-word removal, and b-roll placement are editorial decisions; they belong in `edit/plan.json`, `edit/edl.json`, and `edit/timeline.json`, not buried in a render script.

## Step 6 — Choose and drive the engine

### Engine and timeline gate (ask before building)

Before creating any engine project, ask once per project:

> "How do you want to build this video? HyperFrames is the default and already works. Remotion is better for React/3D, but it is not installed. FilmCraft opens the timeline for manual editing, but the MCP is not configured yet. Which do you prefer?"

Adapt the sentence to what `doctor --json` and `filmcraft status --json` reported. Only mention a limitation that is actually true.

- If the channel or project already has an explicit engine chosen by the user, skip the question and confirm the choice in one line.
- If the user says "auto", "use the default", or "you decide", do not ask; choose from the matrix below and state the choice.
- **Remotion:** if selected and missing, ask permission before `npm install` inside `engine/remotion`. Never install silently. If the user declines, fall back to HyperFrames and say so.
- **FilmCraft:** if selected, run `filmcraft status --json` and ask the matching question before writing MCP config (`connect-mcp`, `install`, or `install-cli`). The user must restart the agent before the MCP tools appear. FilmCraft is a timeline target, not an engine: still pick HyperFrames or Remotion for the element clips.
- Record the choice in `project.json` (`engine`, `timeline`) and in `review.md`.

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

Scaffold only the engine you are going to use. Keep the engine project inside `channels/<channel>/projects/<slug>/engine/<engine>/`. Keep the source of truth for editorial decisions in `edit/timeline.json` (or `edit/plan.json` in the fast path); let the engine adapter translate it.

Once the plan is approved, build the engine project:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

`build` reads `edit/plan.json`, applies the plan's cuts with FFmpeg, mixes `plan.music` under the voice, remaps the element timings to the cut timeline, copies the base media and element assets, and writes a working engine project. After a HyperFrames build it runs `npx hyperframes check --json` and prints a summary; `--strict` fails on an error and `--no-check` skips it. Use `--force` to rebuild and `--no-cuts` to ignore the cuts. A cut-only plan or a plan with no music decision is refused unless `notes` records the exception; pass `--allow-cut-only` or `--allow-no-music` only when the user explicitly asked for that. For HyperFrames it also runs the engine's deterministic contract; for Remotion it generates the composition and data files.

Run `plan <slug> --check` before the build and read `qa/plan-review.md`. It reports visual gaps over 45 seconds, long silence jumps without b-roll or a transition, orphan reactions, b-roll without `covers`/`intent`/`sourceTime`, b-roll extracted from a later scene, on-screen text that does not match the transcript, and element types the target engine cannot render. Fix the top warnings or pass `--strict-plan` to make the build refuse them. The build applies a 35 ms audio micro-fade and an alternating punch-in on uncovered silence cuts; use `--cut-punch` / `--cut-fade` to tune or disable them. FilmCraft cannot animate `zoom` or overlay `transition`; use HyperFrames/Remotion for those, or replace them with PIP/split b-roll and punch-ins. `build` fails on unsupported elements unless you pass `--allow-skipped-elements`.

Use `template: "custom"` when the built-in motion graphics are not enough: the plan carries `html`, `css`, and a GSAP `animation` (or a reusable `component` from `style/components/<name>/`). Components are the channel's growing visual library; see `references/edit-plan.md` and `references/profiles.md`. HyperFrames renders custom elements; Remotion does not execute custom HTML/JS.

Run the build through `engineer`. It owns the generated code, the logs in `work/logs/`, and the fixes, and returns status, artifact paths, and any blocker. The main agent does not run the command above directly; it passes the approved plan and the engine. If a fix changes the story, the engineer returns `needs-decision` instead of editing the plan.

Before the full build, use `build <slug> --sample 3`. It builds three representative elements over the real cuts so the user can approve motion, type, and density without paying for the whole video. Rebuild with `--force` after approval.

### Optional FilmCraft timeline

FilmCraft is an optional, opt-in timeline target (`--target filmcraft` on `build` or `new`), not a third creative engine and not the default. FFmpeg builds the base cut and audio mix, HyperFrames or Remotion renders each element as a transparent ProRes 4444 clip, and FilmCraft assembles an editable `.fcproj` with the source on V1, the mix on A1, and elements on V2+. `--engine hyperframes|remotion` picks the element renderer; `auto` uses Remotion for 3D and HyperFrames otherwise.

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --if-needed
node "<skill>/scripts/rooster.mjs" timeline meu-video --open
```

Read `references/timeline.md` for the adapter and `references/nle-handoff.md` for incremental builds, caveats, and the difference from the `export` EDL/FCPXML path. The existing HyperFrames, Remotion, and `export` workflows are unchanged.

For the fast path, Option 1 is automatic assembly in HyperFrames for HTML/CSS/GSAP motion. Option 2 is Remotion for React, data-driven scenes, and 3D. FFmpeg remains a utility for cuts, proxies, captions, and audio. Both engines start from the same approved plan.

## Step 7 — Preview and review

Offer a preview before rendering:

- HyperFrames: `npx hyperframes preview` (or the bundled adapter).
- Remotion: `npx remotion studio`.
- FFmpeg: render a low-resolution draft and show it in the review page.
- Unified review: `node "<skill>/scripts/rooster.mjs" preview <slug>` writes `preview/index.html` with the player, plan, timeline, captions, audio, validation, and QA checklist. Open it with `--open` when the harness has a browser.
- FilmCraft: `timeline <slug> --open` opens the `.fcproj`. `preview <slug>` also points to the FilmCraft timeline when it exists.

Read `references/timeline.md` for the timeline contract and the review page. When a browser is available, use it: open the preview, take screenshots, check console errors, and inspect the timeline. When it is not, render stills at key beats and read them as images. `qa` can open the preview, capture the screenshots and console errors, and write the report; look at 3–5 of its frames yourself before deciding.

The review page should make these obvious:

- every scene and its duration;
- the clips on each track;
- captions and their timing;
- audio tracks and music;
- missing assets or render errors;
- a checklist of QA items.

## Step 8 — QA

Read `references/qa.md` for the full checklist. Run `captions <slug>` first when the project needs caption sidecars, and `textcheck <slug>` to list every on-screen text with its timecode. Spawn `qa` with the checklist, the render path, and the plan; it returns the verdict, blocking issues with evidence, and frame paths. At minimum, verify:

- resolution, aspect ratio, fps, and duration match the plan;
- no unintended black frames, freeze frames, or gaps;
- audio is not clipping, is at the target loudness, and has no long silences;
- captions are in sync, readable, inside the safe area, and correctly spelled;
- key text and logos are inside the title-safe area;
- every asset exists and has a recorded license;
- the hook lands in the first three seconds;
- the pacing matches the channel and the plan;
- no stretch longer than 45 seconds without a visual beat;
- every b-roll shows the line it covers and is not from a later scene;
- no reaction survives without its setup and no clip from a later scene sits in the middle;
- the brand profile is applied consistently;
- no cut starts or ends inside a word, and every cut boundary was checked by ear;
- every on-screen text in `qa/text-review.md` was proofread;
- the full draft was watched once, not only sampled frames.

Fix the cheap issues before rendering. A technical QA pass on a draft is faster than re-rendering a final. Send fixes back to `engineer`; do not rebuild by hand in the main thread.

## Step 9 — Render and deliver

Use `engineer` in render mode: run `render <slug> --draft`, inspect 3–5 frames, then `render <slug> --final`. The wrapper resolves the engine directly, applies the quality/worker/frame-cache settings, skips unchanged renders, and writes `renders/render-<quality>.json` with probe stats. When the project's timeline is FilmCraft, `render` exports H.264 through FilmCraft instead: draft at 0.5 scale, final at full size. The engineer then runs `deliver <slug>` to write `renders/thumbnail.jpg` and `renders/metadata.json`. It returns the final path and the probe stats, not the log.

If the user wants to finish in DaVinci Resolve or Premiere, run `export <slug> --format both` after the plan is stable. It writes `edit/export/cuts.edl` and `timeline.fcpxml`; these are handoffs, not a replacement for the plan.

Deliver `renders/final.mp4`, `renders/draft.mp4`, `captions.srt`/`.vtt`, `thumbnail.jpg`, `metadata.json`, and the project archive. `metadata.json` should include title, description, tags, chapters, aspect ratio, duration, and any platform-specific fields. Do not upload anywhere without explicit permission.

## Step 10 — Learn

If the user liked a look or a component, offer to save it:

- `rooster profile fork` to create a reusable profile;
- move a component into `profiles/<id>/components`;
- update the channel defaults if the change should apply to future videos;
- record decisions and feedback in `review.md`.

Reuse is the point of the workspace. A project that cannot inform the next one is a missed opportunity.

## Step 11 - Feedback

After delivery, if a command failed, a render had validation warnings, or the user hit friction, ask once:

> "How did the process go? Did you hit any difficulty (build, render, captions, FilmCraft, audio)? May I open an issue in the RoosterEdit repository with the technical details for the developer? You review the draft before anything is sent."

If the user says yes, draft the issue with `feedback <slug> --json`, show the title and body, and ask for explicit confirmation. Then create it with `feedback <slug> --create --yes`. If `gh` is missing or not authenticated, print the draft and the repository URL so the user can open it manually. Never create an issue without `--yes`.

Never include media, frames, transcripts, cookies, tokens, or API keys. The command redacts home/workspace/project paths and common secret patterns, but the user must review the draft. Read `references/feedback.md`.

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
├── channels/<channel>/
│   ├── channel.json
│   ├── projects/<slug>/
│   │   ├── project.json
│   │   ├── brief.md
│   │   ├── script.md
│   │   ├── style.md
│   │   ├── style/proof/
│   │   ├── storyboard/
│   │   ├── assets/{source,generated,licensed}/
│   │   ├── edit/{transcript.json,digest.md,analysis.json,plan.json,plan.md,plan.html,timeline.json,edl.json,captions/,audio/,export/}
│   │   ├── engine/{hyperframes|remotion|ffmpeg|filmcraft}/
│   │   ├── work/{handoffs,logs,scratch,notes}/
│   │   ├── preview/
│   │   ├── renders/
│   │   ├── qa/{report.md,text-review.md,frames/}
│   │   └── review.md
│   ├── profiles/<id>/
│   ├── assets/
│   └── library/
├── profiles/<id>/
├── library/{music,sfx,fonts,overlays,luts,broll,images}/
└── cache/
```

New projects belong inside `channels/<channel>/projects/`. The root `projects/` folder is legacy; only keep it for old workspaces.

If the user already has a different structure, adapt to it and record the mapping in `project.json` instead of forcing a migration.

## Guardrails

- Do not render with missing assets. A placeholder is a bug, not a style.
- Do not cover the footage with a full-screen panel or card unless the user explicitly asks for it. Prefer lower-thirds, captions, corner labels, and overlays that leave the video visible. A mismatched slide is not an invitation to cover the screen.
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
| `references/subagents.md` | When and how to delegate, the handoff contract, and the stage playbook |
| `references/onboarding.md` | First-run workspace setup and defaults |
| `references/feedback.md` | Post-run issue drafts, privacy, and GitHub CLI |
| `references/assets.md` | Asset strategies, sources, licensing, and adjustment |
| `references/token-discipline.md` | Log suppression, transcript digest, and context budget |
| `references/video-pipeline.md` | The 6-step workflow inspired by the reference video, adapted to our workspace |
| `references/edit-plan.md` | `edit/plan.json` schema, cuts, elements, approval gate |
| `references/intake.md` | Questions, defaults, and mode detection |
| `references/engines.md` | Engine decision matrix and adapter contracts |
| `references/profiles.md` | Profile schemas and resolution |
| `references/timeline.md` | Timeline JSON, FilmCraft adapter, review page, and browser QA |
| `references/qa.md` | Technical and editorial checklists |
| `references/professional-elements.md` | Index of advanced layers and feature references |
| `references/nle-handoff.md` | FilmCraft timeline, EDL/FCPXML export, and DaVinci/Premiere import |
| `references/harness.md` | Capability detection and degradation |
| `references/link-ingest.md` | Downloading video links with yt-dlp, metadata, subtitles, and licensing |
| `references/schemas.md` | JSON schemas for project, channel, profile, transcript, analysis, timeline, manifest |

## Quick commands

```bash
# Workspace
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" doctor --json

# Channel
node "<skill>/scripts/rooster.mjs" channel new studio-a --language en-US --format 16:9 --profile minimal --voice tts
node "<skill>/scripts/rooster.mjs" channel design studio-a --from minimal --accent "#22d3ee" --motion calm

# Project
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a --duration 30  # only with a declared target
node "<skill>/scripts/rooster.mjs" open studio-a/video-x
node "<skill>/scripts/rooster.mjs" paths en-tech/video-x
node "<skill>/scripts/rooster.mjs" ingest en-tech/video-x --url "https://www.youtube.com/watch?v=..." --confirm-rights
node "<skill>/scripts/rooster.mjs" transcribe en-tech/video-x --quality fast --language en
node "<skill>/scripts/rooster.mjs" digest en-tech/video-x --from 0 --to 60
node "<skill>/scripts/rooster.mjs" styleproof en-tech/video-x --open
node "<skill>/scripts/rooster.mjs" plan en-tech/video-x
node "<skill>/scripts/rooster.mjs" motions en-tech/video-x
node "<skill>/scripts/rooster.mjs" hyperframes catalog --query "glitch transition" --json
node "<skill>/scripts/rooster.mjs" hyperframes snapshot en-tech/video-x --at 1,3 --review
node "<skill>/scripts/rooster.mjs" tighten en-tech/video-x --json
node "<skill>/scripts/rooster.mjs" silence en-tech/video-x --min 0.8
node "<skill>/scripts/rooster.mjs" textcheck en-tech/video-x
# Advanced layers: see references/professional-elements.md
node "<skill>/scripts/rooster.mjs" check en-tech/video-x

# Review and handoff
node "<skill>/scripts/rooster.mjs" build en-tech/video-x --sample 3
node "<skill>/scripts/rooster.mjs" build en-tech/video-x --if-needed
node "<skill>/scripts/rooster.mjs" filmcraft status --json
node "<skill>/scripts/rooster.mjs" build en-tech/video-x --target filmcraft --engine hyperframes
node "<skill>/scripts/rooster.mjs" timeline en-tech/video-x --open
node "<skill>/scripts/rooster.mjs" preview en-tech/video-x --open
node "<skill>/scripts/rooster.mjs" frames en-tech/video-x --count 12
node "<skill>/scripts/rooster.mjs" export en-tech/video-x --format both
node "<skill>/scripts/rooster.mjs" render en-tech/video-x --draft
node "<skill>/scripts/rooster.mjs" render en-tech/video-x --final
node "<skill>/scripts/rooster.mjs" cache gc --max-size 20GB

# Feedback (only after the user approves the draft)
node "<skill>/scripts/rooster.mjs" feedback en-tech/video-x --title "Build failed in FilmCraft" --json
node "<skill>/scripts/rooster.mjs" feedback en-tech/video-x --create --yes
```

If a command is not implemented yet, do the equivalent manually and tell the user what you did. Do not pretend the CLI succeeded.

## What good looks like

A good RoosterEdit session feels like working with a director who also knows the tools:

- the user explains the idea in a few sentences;
- the agent asks two or three sharp questions, not twenty;
- the plan appears as a brief, a script, and a storyboard the user can react to;
- the style is consistent because it comes from a profile, not from vibes;
- three style-proof frames and three sample elements are approved before the full build;
- the preview is visible in the browser before the expensive render;
- every on-screen text is proofread and every cut boundary was checked by ear;
- the final package includes the video, captions, thumbnail, and metadata;
- the next video starts faster because the profile or component was saved and the channel already holds the defaults.
