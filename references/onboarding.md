# First run and channel onboarding

Use this after installation and before the first project. The goal is to configure a **channel** once, with sensible defaults, then create projects inside it.

## Concept

```text
Workspace → Channel → Project
```

- **Workspace** = the `rooster/` folder. Infrastructure and shared library.
- **Channel** = stable group for a brand, audience, or operation. Defaults for language, format, profile, category, assets, engine, autonomy, and voice.
- **Category** = content recipe. Structure, duration, required assets, suggestions.
- **Profile** = visual identity. Shared or channel-specific.
- **Project** = one video inside a channel. Inherits the channel and can override anything.

A channel example: "EN Tech" (English, 16:9, tech-neon, faceless explainer, TTS) and "PT Criador" (pt-BR, 1:1, minimal, talking head, user voice).

## Rule

If the workspace was just created, **do not create a video project yet**. Create the first channel (or confirm the `default` one), show a summary, and stop.

If the user says "just start" or "use the defaults", keep the `default` channel and tell them what it uses.

## Do not ask where the workspace lives

The workspace is `./rooster` in the current project. Only ask for a custom path if the user explicitly wants one. "Where does `rooster/` go?" is not an onboarding question.

## Use the harness form when available

If the harness exposes a question/form tool, use it for the onboarding and for channel/project creation. Otherwise ask in chat. Do not build a rigid CLI wizard.

In OpenCode, use the `question` tool. In another harness, use the equivalent form tool; if none exists, ask conversationally.

## First-run batch

Ask in one form/message:

1. **Channel name** — e.g., "EN Tech", "PT Criador", "Cliente X".
2. **Language** — `pt-BR`, `en`, etc.
3. **Default format** — `16:9`, `9:16`, `1:1`, or `auto`.
4. **Visual profile** — `minimal`, `tech-neon`, `3d-cartoon`, or create from brand assets.
5. **Default category** — `talking-head`, `faceless-explainer`, `3d-cartoon`, or custom.
6. **Assets policy** — `user`, `link`, `library`, `generated`, `none`, or `mixed`.
7. **Engine** — `auto`, `hyperframes`, `remotion`.
8. **Autonomy** — `guided`, `auto`, `manual`.
9. **Voice** — user, TTS, or none.
10. **Brand assets** — optional logo, fonts, colors.

Use the channel name as the id in kebab-case.

## Save it

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --category faceless-explainer \
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
2. Which category?
3. Follow the channel defaults, or is this a differentiated video?

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
project > channel > category (suggestion) > workspace/global > built-in
```

The channel wins over the category because it is the stable brand/audience context. The category supplies structure, duration, required assets, and suggestions. The project overrides anything.

## Summary to show

> Canal `en-tech` criado. Padrão: inglês, 16:9, perfil tech-neon, categoria faceless-explainer, assets mixed, engine auto, autonomia guided, voz TTS. Os projetos herdam isso e podem sobrescrever. Quer criar o primeiro vídeo?

## What not to do

- Do not create a project outside a channel, except for legacy workspaces.
- Do not ask the workspace location unless the user wants a custom path.
- Do not repeat channel questions for every project.
- Do not assume a channel is only YouTube; it can be a client, brand, or show.
- Do not ignore a project override because it differs from the channel.
