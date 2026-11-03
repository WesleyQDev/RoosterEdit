# Assets

Assets are the raw material of the project. This reference explains the supported strategies, the folder contract, and how the user can change the source of truth.

## Strategies

| Strategy | Meaning | Current support |
|---|---|---|
| `user` | Only files the user provides | Yes (`ingest --file`) |
| `link` | Authorized URLs downloaded by the agent | Yes for video links via `yt-dlp`; direct image URLs are not robust yet |
| `library` | Workspace/global music, SFX, fonts, overlays, b-roll | Folders exist; no catalog UI yet |
| `generated` | AI-generated images, TTS, video, etc. | TTS can be delegated to HyperFrames/media-use or a provider; image/video generation is pluggable, not built in |
| `none` | No external assets | Yes; text/motion graphics only |
| `mixed` | All of the above, with permission | Yes, with explicit consent |

The strategy lives in the channel (`channels/<id>/channel.json`), with a workspace fallback in `rooster/config.json` and a project override in `project.json`:

```json
{
  "assets": {
    "strategy": "mixed",
    "allowDownload": true,
    "allowGenerate": false,
    "licensePolicy": "strict"
  }
}
```

A project can override it in `project.json`:

```json
{
  "assets": {
    "strategy": "user",
    "sources": ["user"],
    "licensePolicy": "strict"
  }
}
```

## Folder contract

```text
channels/<canal>/projects/<slug>/assets/
├── source/       files from the user
├── generated/    AI-generated images, audio, video
├── licensed/     stock, music, fonts, overlays with a recorded license
└── manifest.json inventory, hashes, probe data, license, provenance
```

The agent must never delete or overwrite the user's originals. Prefer copying or hard-linking into the project. The original stays where the user put it.

## Manifest

Every asset gets an entry with:

- stable id and relative path;
- type (`video`, `audio`, `image`, `font`, `other`);
- hash, bytes, and probe data;
- source (`user`, `url`, `generated`, `stock`, `library`);
- license (`owned`, `cc0`, `cc-by`, `cc-by-sa`, `licensed`, `unknown`);
- attribution and source URL, when applicable;
- tags that help the editor find it.

If the license is unknown, warn before publishing.

## User-provided assets

The user can:

- put files directly in `assets/source/`;
- pass a file path to `ingest --file`;
- put brand assets in a profile folder;
- replace a file and re-run `build`.

The agent should probe the file and update the manifest. If the user replaces a file with the same name, keep the old manifest entry or mark it stale; do not silently assume the old probe data is valid.

## Authorized links

Use `yt-dlp` only for content the user owns or has permission to use:

```bash
node "<skill>/scripts/rooster.mjs" ingest meu-video \
  --url "https://..." \
  --confirm-rights
```

Read `references/link-ingest.md` before downloading. Do not bypass DRM, paywalls, or access controls. Do not commit downloaded media to the skill repository.

## Library

`rooster/library/` holds reusable assets:

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

A global library can live in `~/.rooster/library/`. Record the license and attribution for each reusable asset. Do not assume a file is licensed because it is in the library.

## Generated media

Generation is pluggable. The skill can call:

- HyperFrames `tts` (local Kokoro) or `/media-use` for voice/music;
- an approved TTS provider (ElevenLabs, OpenAI, Gemini, Edge TTS);
- an image/video generation provider if the user configures one.

Generation requires explicit permission and, usually, an API key. Never generate a real person's voice or likeness without consent. Never send private media to a provider without permission.

## Internet search and stock

Current v1 does **not** search stock libraries or the open web automatically. The agent can:

- download a URL the user provides;
- suggest search terms and let the user choose;
- record the source and license.

A future adapter can add Pexels/Unsplash/Pixabay search, but it must keep the license metadata and attribution.

## Adjusting assets

Change the channel default:

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.allowDownload false
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.allowGenerate true
```

Or change the workspace fallback:

```bash
node "<skill>/scripts/rooster.mjs" config set assets.strategy user
node "<skill>/scripts/rooster.mjs" config set assets.allowDownload false
```

Or override per project in `project.json`:

```json
{
  "assets": {
    "strategy": "user",
    "sources": ["user"],
    "licensePolicy": "strict"
  }
}
```

After changing the strategy, tell the user what is now allowed and what is not. Re-run `build` only if the asset set or plan changed.

## Decision guide

- **User has footage** → `user` or `mixed`.
- **User has a YouTube reference** → `link`, after confirming rights.
- **Faceless explainer with no files** → `generated` or `none`; ask before generating.
- **Brand video** → `user` + a profile with logo/fonts.
- **No assets at all** → `none`; use motion graphics, type, and original audio/TTS if allowed.
- **Stock footage** → `library` or `licensed`; record license and attribution.

## Guardrails

- Do not download without permission.
- Do not generate a person's voice/likeness without consent.
- Do not use unlicensed music, fonts, or footage.
- Do not hide missing assets behind placeholders.
- Do not commit media, cookies, or API keys to the repo.
