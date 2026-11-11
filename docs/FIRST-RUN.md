# First run

After installing, the best next step is to create **a channel**. The `rooster/` folder is created with it; you do not need to choose where it lives or configure the workspace first.

The installation ends with a short summary and a question that already explains what the channel is and asks for the two things it needs: **the name and what it will produce**. Only after your yes does the agent create the `rooster/` folder and the channel. If you say no, nothing is created.

## The concept

```text
Workspace → Channel → Project
```

- **Workspace** = the `rooster/` folder. Infrastructure and shared library. It is created implicitly.
- **Channel** = the folder for that project, brand, or client. It holds the videos, the style, the assets, and the defaults for that group.
- **Profile** = visual and audio identity.
- **Project** = one video inside a channel. It inherits the defaults and can override anything.

Example: channel **Studio A** (en-US, 16:9, its own profile, TTS) and channel **Client B** (English, 1:1, minimal, user voice).

There is no separate category. The channel's `content` field records what it produces, and each project defines its own structure in `brief.md`, `script.md`, and `edit/plan.json`.

In practice, the channel is the folder that groups the videos of that brand or client:

```text
rooster/                      workspace (everything)
└── channels/
    └── <channel>/            a brand, client, or project
        ├── channel.json
        ├── projects/
        │   └── <video>/      one video
        ├── profiles/
        │   └── <channel>/    visual and audio identity
        ├── assets/
        └── library/
```

A channel is not a YouTube channel. It is the folder that keeps, for example, the videos of a brand, a client, or a show.

## What the agent asks

After your "yes", the agent asks **one simple question**, with no jargon:

> **"Do you want to create your first channel now? Think of it as the folder for that project: it holds the videos, the style, and the files for the brand or client. If so, tell me the channel name and what it will produce."**

The topic is yours. The agent must not suggest "tech shorts", "interviews", or "promos" as an answer. If you give only the content, it proposes a short name and confirms; if you give only the name, it asks what the channel produces.

With your answer, it infers the rest (language, format, voice, etc.) and shows a short summary:

> **"I will create `studio-a`: English, 16:9, minimal look, and TTS voice. Is that good, or would you like to adjust something?"**

If you confirm, it creates the channel. If you want to change something, just say so. The advanced fields remain available, but they are not asked all at once.

## Channel identity

After creating the channel, the agent asks in a single block:

1. **Palette:** do you have brand colors? If not, how would you describe the visual mood?
2. **Typography:** any font or style in mind?
3. **Motion and audio:** how should the motion, the music, and the SFX be?

With the answers, it creates a profile for the channel itself:

```bash
node "<skill>/scripts/rooster.mjs" channel design studio-a \
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

This writes `channels/studio-a/profiles/studio-a/profile.json` and `STYLE.md`, and points `channel.profile` to it. If you have no preference, the base profile is kept and you can change it later with `channel design studio-a --force`.

Before the first plan, the agent can run `styleproof <slug>` and open `style/proof/index.html` with three sample frames (hook, data, and caption). Approve the look at this stage: changing color and typography after the build is expensive.

## Duration

Duration **is not a channel or project default**. Cutting silence, removing filler words, and shortening the raw footage change the final length; duration is the result of the edit.

The agent does not ask for a duration by default. The `--duration` flag exists only for a target you explicitly declared, for example "I want exactly 30 seconds". With no declared target, the plan and the media define the length.

## Advanced setup (only if you ask)

If you want to control everything, the agent asks in groups of at most three:

1. Identity: name, content, and language.
2. Output: format and source.
3. Look and sound: profile, assets, and voice.
4. Production: engine, autonomy, and brand assets.

Duration is not part of this form.

The agent writes with:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new studio-a \
  --name "Studio A" \
  --content "<your sentence>" \
  --language en-US \
  --format 16:9 \
  --profile minimal \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
node "<skill>/scripts/rooster.mjs" channel design studio-a --from minimal --accent "#22d3ee"
node "<skill>/scripts/rooster.mjs" channel show studio-a
```

Then it shows the short summary and stops. It does not create a video yet.

## Creating a project inside the channel

Duration comes from the edit. Only pass `--duration` if you declared a target:

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a
# optional, only with a declared target
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a --duration 30
node "<skill>/scripts/rooster.mjs" open studio-a/video-x
```

If you are going to provide your own files, the agent creates and opens the `assets/source/` folder.

If the project differs from the channel default:

```bash
node "<skill>/scripts/rooster.mjs" new video-special --channel studio-a \
  --format 9:16 \
  --profile studio-a \
  --voice user
```

`project.json` records `channel` and `overrides`, so you can see what came from the channel and what was a project decision. `format.duration` stays `null` until you declare a target or until the plan/media defines the length.

## Plan and progress

Before creating the timeline, the agent writes `edit/plan.json` and runs `plan <slug>`, which generates `edit/plan.md`, `edit/plan.html`, and `qa/plan-review.md`. If the harness can display files, it opens the HTML in the preview; if not, it shows the summary in chat. The approval request comes with the stage marker, for example: **"Step 4/8 - Plan ready. Can I continue with the timeline?"**

By default the plan uses `editMode: "cleanup"`: it keeps the whole video and cuts only silence, filler words, false starts, and abandoned retakes. The `tighten <slug>` command proposes those cuts from the audio, keeps a natural 0.4 s breath, leaves 100 ms before the next line, and respects `plan.protect`. `silence <slug>` remains the fallback when the audio cannot be analyzed. A shortened version (`condensed`, with `keeps`) happens only if you ask for it explicitly.

The eight steps are: environment, intake, assets/transcript, plan, timeline, build, preview/QA, render/delivery. The agent shows the current step and asks before moving on; timeline and final render are not approved in the same question. Start in `guided` for the first videos and switch to `auto` once the style is stable.

At step 6, before creating the engine project, the agent asks how to assemble it: **HyperFrames** (default, ready to use), **Remotion** (React/3D; requires `npm install` with your permission), or **FilmCraft** (editable timeline; requires connecting the MCP and restarting the agent). If you already chose an engine, it only confirms; if you said "auto", it decides and explains. Nothing is installed or configured without your authorization.

The plan must include the creative layer: visual elements, b-roll, and music, or an explicit justification for omitting them. **Cuts alone do not count as a final video.** `build` refuses a plan that only cuts or has no music decision; record the exception in `notes` or use `--allow-cut-only` / `--allow-no-music` when it is intentional.

Before the full build, ask for `build <slug> --sample 3`: the agent builds only three representative elements so you can approve the motion and the typography. After the OK, run the full build with `--force`.

In the final review, open `preview/index.html` (run `preview <slug>`) and run `textcheck <slug>` to list every on-screen text. Watch the whole draft once and check the audio cuts before the final render.

The advanced layers — captions, motion, audio, reframe, delivery, color, b-roll, charts, TTS, and multicam — are indexed in [`references/professional-elements.md`](../references/professional-elements.md). `SKILL.md` only points to that index.

## Precedence

```text
project > channel > workspace/global > built-in
```

The project overrides everything. The channel is the stable context; there is no category layer.

## What not to ask

- "Where does rooster live?" — the default is `./rooster`; the folder is created along with the channel.
- "Do you want to configure the workspace now?" — the workspace is an implementation detail; ask about the channel.
- Asking only what the channel produces — ask for the name and the content together, in the same message that explains the folder.
- Ready-made topic examples or options in the channel question — let the user describe it.
- A questionnaire with 12 fields — ask only what the channel produces and infer the rest.
- Channel duration or a default project duration — duration is an outcome of the edit.
- Turning the video into a highlight without you asking — the default is cleanup (silence and filler only).
- Category, preset, or recipe — that concept does not exist.
- The same channel questions in every project — inherit and confirm only what changed.

## Changing later

```bash
node "<skill>/scripts/rooster.mjs" channel set studio-a format 9:16
node "<skill>/scripts/rooster.mjs" channel set studio-a assets.strategy user
node "<skill>/scripts/rooster.mjs" channel design studio-a --force --accent "#e4572e"
node "<skill>/scripts/rooster.mjs" channel use studio-a
```

Or, per project, edit `project.json` and the overrides.
