# First run and workspace onboarding

Use this after the skill is installed and before the first project. The goal is to configure the workspace once, with a few sensible defaults, so every project starts faster.

## Rule

If the workspace was just created, **do not start a video project yet**. Ask a short onboarding batch, save the answers, show a summary, and stop. The user can then ask for the first video.

If the user says "just start" or "use the defaults", create the workspace with defaults and tell them what was chosen. Do not block.

## The onboarding batch

Ask these in one message, with defaults in parentheses:

1. **Workspace location** — where should `rooster/` live? (default: current project)
2. **Default language** — `pt-BR`, `en`, or another? (default: `pt-BR`)
3. **Default format** — `16:9` YouTube, `9:16` Shorts/Reels, `1:1`, or ask per project? (default: `16:9`)
4. **Default style** — built-in profile (`minimal`, `tech-neon`, `3d-cartoon`), create from your brand, or ask per project? (default: `minimal`)
5. **Assets policy** — only user files, authorized links, library, generated media, mixed, or none? (default: `mixed`)
6. **Engine** — `auto`, HyperFrames, or Remotion? (default: `auto`)
7. **Autonomy** — `guided` (stops at plan/preview), `auto` (no stops), or `manual`? (default: `guided`)
8. **Voice** — your own voice, TTS, or no voice? (default: none until the project says otherwise)
9. **Brand assets** — optional logo, fonts, colors, or a folder to use as a profile.

Do not ask all nine if the user already gave some. Confirm only the expensive-to-change choices: language, format, assets policy, engine, autonomy.

## Saving the answers

Create the workspace:

```bash
node "<skill>/scripts/rooster.mjs" init
```

Then write the defaults with `config set`:

```bash
node "<skill>/scripts/rooster.mjs" config set defaults.language pt-BR
node "<skill>/scripts/rooster.mjs" config set defaults.aspect 16:9
node "<skill>/scripts/rooster.mjs" config set defaults.profile minimal
node "<skill>/scripts/rooster.mjs" config set defaults.engine auto
node "<skill>/scripts/rooster.mjs" config set defaults.autonomy guided
node "<skill>/scripts/rooster.mjs" config set assets.strategy mixed
node "<skill>/scripts/rooster.mjs" config set assets.allowDownload true
node "<skill>/scripts/rooster.mjs" config set assets.allowGenerate false
node "<skill>/scripts/rooster.mjs" config set assets.licensePolicy strict
node "<skill>/scripts/rooster.mjs" config set tts.provider auto
node "<skill>/scripts/rooster.mjs" config set tts.language pt-BR
```

Show the result:

```bash
node "<skill>/scripts/rooster.mjs" config show
```

Then summarize in plain language:

> Workspace configurado em `./rooster`. Padrão: português, 16:9, perfil minimal, engine auto, autonomia guided, assets mistos (seus arquivos + links autorizados; sem geração automática). Quando quiser, me mande o vídeo ou a ideia.

## Asset strategies

| Strategy | Meaning |
|---|---|
| `user` | Only files the user provides. No downloads or generation. |
| `link` | User provides authorized URLs; the agent may download them with `yt-dlp`. |
| `library` | Use the workspace/global library (music, SFX, fonts, overlays, b-roll). |
| `generated` | Agent may generate images/TTS through configured providers. |
| `none` | No external assets; text and motion graphics only. |
| `mixed` | All of the above, with explicit permission per action. |

Read `references/assets.md` before downloading or generating anything.

## Changing later

The user can change any default at any time:

```bash
node "<skill>/scripts/rooster.mjs" config set defaults.aspect 9:16
node "<skill>/scripts/rooster.mjs" config set assets.strategy user
```

For a single project, put the override in `project.json` instead of changing the workspace default.

## What not to do

- Do not create a project before the onboarding summary.
- Do not install tools without permission.
- Do not assume the user wants TTS, music, or downloaded assets.
- Do not ask the same questions again in the first project; use the saved defaults and confirm only what changed.
