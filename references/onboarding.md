# First run and channel onboarding

Use this after installation and before the first project. The goal is to configure a **channel** once, with sensible defaults, then create projects inside it.

## Concept

```text
Workspace → Channel → Project
```

- **Workspace** = the `rooster/` folder. Infrastructure and shared library.
- **Channel** = stable production standard for a brand, audience, or operation. Defaults for content, language, format, profile, assets, engine, autonomy, and voice.
- **Profile** = visual identity. Shared or channel-specific.
- **Project** = one video inside a channel. Inherits the channel and can override anything.

A channel example: "EN Tech" (English, 16:9, tech-neon profile, TTS) and "PT Criador" (pt-BR, 1:1, minimal profile, user voice).

There is no separate category concept. The channel's `content` field records what it produces, and each project defines its own structure in `brief.md`, `script.md`, and `edit/plan.json`.

## Handoff after installation

Installation is not onboarding. After cloning and running `doctor`, report the result in at most about 8 lines and ask:

> "Quer configurar o workspace agora? Eu crio a pasta `rooster/` e o primeiro canal com você."

If the answer is no, stop. Do not create the workspace, a channel, or a project. If the answer is yes, follow the first-run batch below and keep the final summary short.

## Rule

If the workspace was just created, **do not create a video project yet**. Create the first channel (or confirm the `default` one), show a summary, and stop.

If the user says "just start" or "use the defaults", keep the `default` channel and tell them what it uses.

## Do not ask where the workspace lives

The workspace is `./rooster` in the current project. Only ask for a custom path if the user explicitly wants one. "Where does `rooster/` go?" is not an onboarding question.

## Quick setup (default)

After the user says yes, ask one question:

> "O que esse canal vai produzir? Uma frase basta — por exemplo: 'shorts de tecnologia em português' ou 'entrevistas de 90s para o YouTube'."

Use the answer and the conversation to infer the rest. A channel here is a production standard, not a YouTube channel.

Audio identity includes both music and SFX. If the style is tech, ads, motion graphics, or high-energy, plan SFX for transitions, UI, impacts, and emphasis. If it is documentary or minimal, use them sparingly. If you cannot tell, ask before planning the audio layer.

| Field | Inference |
|---|---|
| name | kebab-case from the content |
| content | the user's sentence |
| language | the language of the conversation |
| format | 9:16 for Shorts/Reels/TikTok, 1:1 for feed/square, 16:9 otherwise |
| source | live for footage/interview/podcast, generated for faceless/explainer, hybrid if mixed |
| profile | tech-neon for tech/AI, 3d-cartoon for 3D/cartoon, minimal otherwise |
| assets | mixed; user for personal footage; generated for faceless |
| engine | auto |
| autonomy | guided |
| voice | tts for faceless, user for footage, none for music-only |
| brand assets | none for now |

Show one line and ask for confirmation:

> "Vou criar `pt-tech` com: pt-BR · 9:16 · tech-neon · TTS · assets mixed · engine auto · guided. Está bom ou quer ajustar algo?"

If the user confirms, run `init` and `channel new`. If they correct one item, apply it and confirm again. Do not ask the twelve fields.

Start with `guided` for the first one to three videos. When the style is stable and the user trusts the preview, offer `channel set <id> autonomy auto`; do not switch silently.

Before the first plan, run `styleproof <slug>` and approve the three frames. The look is cheaper to change there than after the build.

## Duration is per project

A channel does not define how many seconds a video has. Duration belongs to each project and can change from video to video. When creating a project, ask for the target duration or infer it from the brief, then pass `--duration`.

## Advanced setup (only if requested)

Only when the user asks for full control, or when the content is too ambiguous to infer a safe default. Ask in groups of at most three:

1. Identity: name, content, language.
2. Output: format, source.
3. Look and sound: profile, assets, voice.
4. Production: engine, autonomy, brand assets.

Never send all fields at once. Duration is asked when creating the project, not here.

## Save it

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --content "English tech explainers" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
```

Show it:

```bash
node "<skill>/scripts/rooster.mjs" channel show en-tech
```

Change a default later:

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech format 9:16
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel use en-tech
```

## Creating a project

Ask:

1. Which channel?
2. What is the target duration for this video?
3. Follow the channel defaults, or is this a differentiated video?

If differentiated, show only the overrides:

- format;
- profile;
- voice;
- engine;
- autonomy;
- assets strategy;
- language.

Duration is not an override: every video has its own target duration.

Create:

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel en-tech --duration 60
# differentiated example
node "<skill>/scripts/rooster.mjs" new video-special --channel en-tech \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

The project JSON records `channel` and `overrides` so the inheritance is traceable.

## Precedence

```text
project > channel > workspace/global > built-in
```

The project can override any channel default. The channel is the stable context; there is no category layer.

## Summary to show

> Canal `en-tech` criado. Padrão: inglês, 16:9, perfil tech-neon, assets mixed, engine auto, autonomia guided, voz TTS. Os projetos herdam isso e podem sobrescrever; a duração é definida em cada vídeo. Quer criar o primeiro vídeo?

## What not to do

- Do not create a project outside a channel, except for legacy workspaces.
- Do not ask the workspace location unless the user wants a custom path.
- Do not send the twelve-field form by default; use the one-question quick setup.
- Do not ask for a channel duration; duration is per project.
- Do not repeat channel questions for every project.
- Do not assume a channel is only YouTube; it can be a client, brand, or show.
- Do not ignore a project override because it differs from the channel.
- Do not introduce a category, preset, or recipe layer.
