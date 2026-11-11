# First run and channel onboarding

Use this after installation and before the first project. The goal is to configure a **channel** once, with sensible defaults, then create projects inside it.

## Concept

```text
Workspace → Channel → Project
```

- **Workspace** = the `rooster/` folder. Infrastructure and shared library. It is created implicitly; do not ask where it lives.
- **Channel** = stable production standard for a brand, audience, or operation. Defaults for content, language, format, profile, assets, engine, autonomy, and voice.
- **Profile** = visual identity. Shared or channel-specific.
- **Project** = one video inside a channel. Inherits the channel and can override anything.

A channel example: "Studio A" (en-US, 16:9, its own profile, TTS) and "Client B" (en, 1:1, minimal profile, user voice).

There is no separate category concept. The channel's `content` field records what it produces, and each project defines its own structure in `brief.md`, `script.md`, and `edit/plan.json`.

The folder layout makes the channel concrete:

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

A channel is not a YouTube channel. It is the folder that groups the videos of a brand, a client, a show, or an operation.

## Handoff after installation

Installation is not onboarding. After cloning and running `doctor`, report the result in at most about 8 lines and ask in one message:

> "Do you want to create your first channel now? Think of it as the project folder: it holds the videos, the style, and the brand or client files. If yes, tell me the channel name and what it will produce?"

Do not ask "Do you want to configure the workspace now?". The workspace is an implementation detail; the channel is the decision, and the folder explanation above is part of the question.

If the answer is no, stop. Do not create the workspace, a channel, or a project. If the answer is yes, follow the first-run batch below and keep the final summary short.

## Rule

If the workspace was just created, **do not create a video project yet**. Create the first channel, create its identity, show a summary, and stop.

If the user says "just start" or "use the defaults", create the `default` channel, tell them what it uses, and still offer the identity step.

## Name and content

The same message already asks for the two things the channel needs: **name** and **content**. Do not ask them again in a second turn. If the user gave only the content, propose a short kebab-case name and confirm it; if they gave only a name, ask what it produces.

> "What is the channel name, and what will it produce?"

Do not seed the topic with examples such as "tech shorts", "interviews", or "product promos". The user owns the topic; the agent only infers production defaults from what they wrote.

Use the answer and the conversation to infer the rest. A channel here is a production standard, not a YouTube channel.

Audio identity includes both music and SFX. If the style is ads, motion graphics, or high-energy, plan SFX for transitions, UI, impacts, and emphasis. If it is documentary or minimal, use them sparingly. If you cannot tell, ask in the identity step.

| Field | Inference |
|---|---|
| name | the name the user gave, slugified. Propose one only if they gave none |
| content | the user's sentence, verbatim |
| language | the language of the conversation |
| format | 9:16 for Shorts/Reels/TikTok, 1:1 for feed/square, 16:9 otherwise |
| source | live for footage/interview/podcast, generated for faceless/explainer, hybrid if mixed |
| profile | keep `minimal` for now; the identity step defines the real one. Do not infer a visual style from the topic |
| assets | mixed; user for personal footage; generated for faceless |
| engine | auto |
| autonomy | guided |
| voice | tts for faceless, user for footage, none for music-only |
| brand assets | none for now |

Show one line and ask for confirmation:

> "I will create `studio-a`: English, 16:9, minimal look, and TTS voice. Does that look right, or do you want to adjust anything?"

If the user confirms, run `init` and `channel new`. If they correct one item, apply it and confirm again. Do not ask the twelve fields.

Start with `guided` for the first one to three videos. When the style is stable and the user trusts the preview, offer `channel set <id> autonomy auto`; do not switch silently.

## Identity step (after `channel new`)

A channel is not ready until it has an identity. After creating the channel, ask three questions in one block — not twelve:

1. **Palette:** "Do you have brand colors? If not, describe the visual mood."
2. **Typography:** "Do you have a font or typography style in mind?"
3. **Motion and audio:** "How should motion, music, and SFX feel?"

Then create a channel-scoped profile:

```bash
node "<skill>/scripts/rooster.mjs" channel design <id> \
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

This writes `channels/<id>/profiles/<id>/profile.json` and `STYLE.md`, and sets `channel.profile = <id>`. Show the path and one line with the palette and fonts.

If the user has no preference, keep the base profile and say it can be changed later with `channel design <id> --force`. Do not invent brand colors.

Before the first plan, run `styleproof <slug>` and approve the three frames. The look is cheaper to change there than after the build.

## Duration is an outcome, not an input

A channel does not define how many seconds a video has, and a project does not get a default duration. Trimming silence, removing filler, and cutting dead air change the length; the final duration is whatever the edit produces.

`--duration` exists only for a target the user **explicitly declares**, for example "I want exactly 30 seconds" or "I need 15s for the ad". When creating a project, do not ask for a target by default. If the user volunteers one, pass it; otherwise omit the flag and let the plan and the media define the length.

## Advanced setup (only if requested)

Only when the user asks for full control, or when the content is too ambiguous to infer a safe default. Ask in groups of at most three:

1. Identity: name, content, language.
2. Output: format, source.
3. Look and sound: profile, assets, voice.
4. Production: engine, autonomy, brand assets.

Never send all fields at once. Duration is not part of this form.

## Save it

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new studio-a \
  --name "Studio A" \
  --content "<the user's sentence>" \
  --language en-US \
  --format 16:9 \
  --profile minimal \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
```

Then create the identity:

```bash
node "<skill>/scripts/rooster.mjs" channel design studio-a --from minimal --accent "#22d3ee"
```

Show it:

```bash
node "<skill>/scripts/rooster.mjs" channel show studio-a
node "<skill>/scripts/rooster.mjs" profile show studio-a --channel studio-a
```

Change a default later:

```bash
node "<skill>/scripts/rooster.mjs" channel set studio-a format 9:16
node "<skill>/scripts/rooster.mjs" channel set studio-a assets.strategy user
node "<skill>/scripts/rooster.mjs" channel design studio-a --force --accent "#e4572e"
node "<skill>/scripts/rooster.mjs" channel use studio-a
```

## Optional: FilmCraft

FilmCraft is an optional editable-timeline target. Do not install it, download it, or write MCP config without explicit permission. During first-run, run `filmcraft status --json` once and ask the question when `prompt.kind` is `connect-mcp` or `install`. If the user declines, continue with HyperFrames/Remotion and do not ask again for that project; the default HyperFrames/Remotion path does not need FilmCraft.

Get the current state and the prompt from the CLI:

```bash
node "<skill>/scripts/rooster.mjs" filmcraft status --json
```

The response includes `installed`, `cli`, `app`, `version`, `mcp`, and `prompt.kind`. Use `prompt.kind` to choose the question:

| `prompt.kind` | Question | Options |
|---|---|---|
| `connect-mcp` | "I found FilmCraft <version> on your PC. Do you want to connect its MCP now? After connecting, you must restart the program/agent so it can see the tools." | Connect MCP / Not now |
| `install` | "I did not find FilmCraft on your PC. Do you want to continue with HyperFrames/Remotion, or install FilmCraft and connect its MCP?" | Continue with HyperFrames/Remotion / Install FilmCraft + connect MCP |
| `install-cli` | "FilmCraft is installed, but the CLI was not found. Do you want to install the CLI or set ROOSTER_FILMCRAFT_CLI, then connect the MCP?" | Continue with HyperFrames/Remotion / Install the FilmCraft CLI |
| `ready` | "FilmCraft was found and the MCP is configured. If the tools are not visible yet, restart the agent." | — |

Rules:

- If the user chooses Not now or Continue with HyperFrames/Remotion, do not install or write anything. Keep the default engine path.
- If they choose Connect MCP, run `filmcraft setup --client opencode` (or `--client claude`) to print the snippet. Add `--write` only after they confirm the change; it merges into `opencode.json` or `.mcp.json` and keeps a `.bak` backup of an existing file. Restart the agent afterward.
- If FilmCraft is missing and they choose install, point them to https://getartcraft.com/apps/filmcraft. Do not download or run an installer for them.
- If the app is installed but the CLI is missing, they can install the CLI or set `ROOSTER_FILMCRAFT_CLI` to the `filmcraft-cli` path.
- If the MCP is already registered but the tools are not visible, tell them to restart; do not rewrite the config.
- FilmCraft is optional. The build target stays `--target filmcraft`; HyperFrames/Remotion remain the default.

The same FilmCraft check runs again at the build gate (Step 6) when the user chooses FilmCraft or changes their mind. Never write MCP config without explicit permission, and remind the user that the agent must be restarted before the MCP tools appear.

## Creating a project

Ask only:

1. Which channel?
2. Follow the channel defaults, or is this a differentiated video?

Do not ask for a duration. If the user declares a target, add `--duration`. If the video comes from existing footage, the source length and the cuts define the final length.

If differentiated, show only the overrides:

- format;
- profile;
- voice;
- engine;
- autonomy;
- assets strategy;
- language.

Create:

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a
# only when the user declared a target
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a --duration 30
# differentiated example
node "<skill>/scripts/rooster.mjs" new video-special --channel studio-a \
  --format 9:16 \
  --profile studio-a \
  --voice user
```

The project JSON records `channel` and `overrides` so the inheritance is traceable. `format.duration` stays `null` until the user declares a target or the plan/media defines it.

## Precedence

```text
project > channel > workspace/global > built-in
```

The project can override any channel default. The channel is the stable context; there is no category layer.

## Summary to show

> Channel `studio-a` created, with its own profile `studio-a`. Defaults: en-US, 16:9, assets mixed, engine auto, autonomy guided, TTS voice. Projects inherit these and can override them; duration comes from the edit, not from a default. Do you want to create the first video?

## What not to do

- Do not ask "where does the workspace live" or "shall we set up the workspace"; create it as part of the channel step.
- Do not ask only what the channel produces; the first message asks for the name and the content together, with the folder explanation.
- Do not create a project outside a channel, except for legacy workspaces.
- Do not seed the channel question with topic examples or preset options.
- Do not infer a visual profile from the topic (for example, tech → tech-neon). Ask for the identity.
- Do not send the twelve-field form by default; ask for the name and the content in one message, then run the identity step.
- Do not ask for or set a default duration; duration is an outcome of the edit.
- Do not repeat channel questions for every project.
- Do not assume a channel is only YouTube; it can be a client, brand, or show.
- Do not ignore a project override because it differs from the channel.
- Do not introduce a category, preset, or recipe layer.
