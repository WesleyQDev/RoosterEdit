# Schemas

These are the contracts for the files RoosterEdit reads and writes. They are intentionally lightweight: validate the fields the pipeline depends on, and allow extra fields for future use.

## project.json

```json
{
  "schema": "rooster.project/v1",
  "slug": "meu-video",
  "name": "Meu Vídeo",
  "channel": "en-tech",
  "profile": "tech-neon",
  "engine": "auto",
  "language": "en",
  "overrides": ["format", "voice"],
  "mode": {
    "source": "generated",
    "voice": "tts",
    "style": "profile",
    "autonomy": "guided"
  },
  "format": {
    "aspect": "16:9",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 60
  },
  "assets": {
    "strategy": "mixed",
    "allowDownload": true,
    "allowGenerate": false,
    "licensePolicy": "strict",
    "sources": []
  },
  "audio": {
    "loudnessLufs": -14,
    "music": true
  },
  "captions": {
    "enabled": true,
    "mode": "burned"
  },
  "status": "intake",
  "pipeline": ["script", "tts", "timeline", "hyperframes", "render"],
  "createdAt": "2026-11-03T00:00:00.000Z",
  "updatedAt": "2026-11-03T00:00:00.000Z"
}
```

Required: `schema`, `slug`, `name`, `channel`, `profile`, `format`, `status`.

Enums:

- `engine`: `auto`, `hyperframes`, `remotion`, `ffmpeg`
- `mode.source`: `live`, `generated`, `hybrid`
- `mode.voice`: `user`, `tts`, `none`
- `mode.style`: `user`, `profile`, `ai`, `reference`
- `mode.autonomy`: `auto`, `guided`, `manual`
- `status`: `intake`, `planning`, `assets`, `building`, `preview`, `qa`, `rendering`, `done`, `blocked`
- `format.aspect`: `16:9`, `9:16`, `1:1`, `4:5`, `custom`

## profile.json

```json
{
  "schema": "rooster.profile/v1",
  "id": "tech-neon",
  "name": "Tech Neon",
  "description": "Dark tech, cyan/magenta, grid, kinetic type",
  "extends": null,
  "scope": "workspace",
  "tokens": {
    "colors": {
      "bg": "#060913",
      "fg": "#f8fafc",
      "muted": "#94a3b8",
      "accent": "#22d3ee",
      "accent2": "#f472b6"
    },
    "typography": {
      "display": { "family": "Space Grotesk", "weight": 700 },
      "body": { "family": "Inter", "weight": 400 },
      "mono": { "family": "JetBrains Mono", "weight": 500 }
    },
    "radius": 12,
    "spacing": 8,
    "motion": { "ease": "power3.out", "fast": 0.18, "normal": 0.35, "slow": 0.6 }
  },
  "captions": {
    "mode": "burned",
    "font": "Inter",
    "weight": 700,
    "size": 42,
    "color": "#ffffff",
    "stroke": "#000000",
    "position": "bottom",
    "maxCharsPerLine": 32
  },
  "audio": { "loudnessLufs": -14, "music": "synthwave", "sfx": "digital" },
  "prompts": {
    "style": "dark tech, cyan and magenta rim light, volumetric fog, clean geometry",
    "negative": "clutter, warm tones, handwritten type"
  },
  "engines": {
    "preferred": "hyperframes",
    "supported": ["hyperframes", "remotion"]
  }
}
```

Required: `schema`, `id`, `name`, `tokens.colors`, `tokens.typography`, `captions`, `audio`, `engines.preferred`.

`scope`: `project`, `workspace`, `global`.

## transcript.json

```json
{
  "schema": "rooster.transcript/v1",
  "source": "assets/source/video.mp4",
  "language": "pt",
  "text": "full transcript text",
  "segments": [
    { "id": 0, "start": 0.0, "end": 2.4, "text": "first sentence" }
  ],
  "createdAt": "2026-11-03T00:00:00.000Z"
}
```

Required: `schema`, `source`, `segments`. Each segment needs `start`, `end`, `text`.

## analysis.json

The compact editorial map produced by `transcript-analyst`. It is the input for the script and the plan; the main agent reads the handoff, not this file.

```json
{
  "schema": "rooster.analysis/v1",
  "source": "assets/source/video.mp4",
  "language": "pt-BR",
  "durationSec": 612.4,
  "topics": [
    { "start": 0, "end": 42.5, "label": "Opening" }
  ],
  "beats": [
    { "id": "b01", "in": 0, "out": 12.4, "label": "Hook", "why": "strongest claim" }
  ],
  "hooks": [
    { "text": "exact quote", "in": 0, "out": 3.1 }
  ],
  "cuts": [
    { "in": 12.4, "out": 18.2, "reason": "silence" }
  ],
  "broll": [
    { "after": 18.2, "idea": "office wide shot" }
  ],
  "claims": [
    { "text": "claim to verify", "status": "verify" }
  ],
  "speakers": [
    { "id": "s1", "label": "Host" }
  ]
}
```

Required: `schema`, `durationSec`, `topics`, `beats`. Each beat needs `id`, `in`, `out`, `label`. `cuts`, `broll`, `claims`, and `speakers` are optional.

## plan.json

```json
{
  "schema": "rooster.plan/v1",
  "source": "assets/source/video.mp4",
  "style": "style.md",
  "language": "pt-BR",
  "duration": 612.4,
  "summary": "What the video is about",
  "music": {
    "src": "assets/licensed/music/theme.mp3",
    "gainDb": -18,
    "license": "licensed",
    "attribution": "Track name - Artist"
  },
  "cuts": [
    { "id": "cut-001", "start": 12.4, "end": 18.2, "reason": "long-pause", "confidence": 0.9 }
  ],
  "keeps": [],
  "elements": [
    { "id": "el-001", "type": "letreiro", "start": 3.0, "end": 6.0, "text": "A virada", "description": "Title card" }
  ],
  "chapters": [
    { "start": 0, "title": "Introdução" }
  ],
  "notes": []
}
```

Required: `schema`, `source`, `style`, `duration`, `cuts`, `elements`.

`music` is optional; when present, `src` is required and is relative to the project. `gainDb` defaults to `-18`.

Optional advanced fields: `sfx`, `color`, `multicam`, and `chart` on `grafico`/`lista` elements. See `references/professional-elements.md` for the feature references.

Cut reasons: `long-pause`, `repetition`, `false-start`, `retake`, `filler`, `mistake`, `off-topic`, `manual`.

Element types: `letreiro`, `grafico`, `lista`, `zoom`, `broll`, `lower-third`, `caption-emphasis`, `transition`, `end-card`.

Read `references/edit-plan.md` for the full schema, heuristics, and approval gate.

## timeline.json

```json
{
  "schema": "rooster.timeline/v1",
  "project": "meu-video",
  "format": { "width": 1920, "height": 1080, "fps": 30, "duration": 60 },
  "tracks": [
    {
      "id": "v1",
      "kind": "video",
      "clips": [
        {
          "id": "clip-1",
          "src": "assets/source/interview.mp4",
          "in": 12.4,
          "out": 18.2,
          "start": 0,
          "end": 5.8,
          "speed": 1,
          "transitionIn": "cut",
          "transitionOut": "cut",
          "effects": []
        }
      ]
    }
  ],
  "scenes": [],
  "markers": []
}
```

Required: `schema`, `format`, `tracks`.

Validation:

- `format.duration > 0`;
- every clip has `start < end`;
- `in < out` for media clips;
- no unintended overlaps on the same track;
- every `src` exists or is a scene id;
- `tracks` includes at least one visual track.

## manifest.json

```json
{
  "schema": "rooster.manifest/v1",
  "assets": [
    {
      "id": "asset-001",
      "path": "assets/source/interview.mp4",
      "type": "video",
      "hash": "sha256:...",
      "bytes": 123456789,
      "probe": {
        "width": 1920,
        "height": 1080,
        "fps": 29.97,
        "duration": 2400.5,
        "codec": "h264",
        "audio": true
      },
      "source": "user",
      "origin": "file",
      "license": "owned",
      "attribution": "",
      "tags": ["interview", "portrait"],
      "addedAt": "2026-11-03T00:00:00.000Z"
    }
  ]
}
```

Required: `schema`, `assets`; each asset needs `id`, `path`, `type`, `source`, `license`.

`source`: `user`, `generated`, `stock`, `url`, `library`.

`license`: `owned`, `cc0`, `cc-by`, `cc-by-sa`, `licensed`, `unknown`.

For URL assets, add:

```json
{
  "origin": "url",
  "url": "https://www.youtube.com/watch?v=...",
  "author": "Channel name",
  "downloadedAt": "2026-11-03T00:00:00.000Z"
}
```

## channel.json

```json
{
  "schema": "rooster.channel/v1",
  "id": "en-tech",
  "name": "EN Tech",
  "content": "English tech explainers",
  "language": "en",
  "format": "16:9",
  "profile": "tech-neon",
  "source": "generated",
  "voice": "tts",
  "engine": "auto",
  "autonomy": "guided",
  "assets": {
    "strategy": "mixed",
    "allowDownload": true,
    "allowGenerate": false,
    "licensePolicy": "strict"
  },
  "audio": { "loudnessLufs": -14, "music": true },
  "captions": { "enabled": true, "mode": "burned" },
  "brand": { "logo": null, "fonts": [], "colors": [] },
  "createdAt": "2026-11-03T00:00:00.000Z"
}
```

Required: `schema`, `id`, `name`, `language`, `format`, `profile`, `voice`, `engine`, `autonomy`, `assets`.

`format` can be `16:9`, `9:16`, `1:1`, `4:5`, or `auto`. `content` is a short description of what the channel produces. Duration is not a channel field; each project sets `format.duration`.

## workspace.json

```json
{
  "schema": "rooster.workspace/v1",
  "version": "0.1.0",
  "createdAt": "2026-11-03T00:00:00.000Z",
  "defaultChannel": "default",
  "defaults": {
    "profile": "minimal",
    "engine": "auto",
    "aspect": "16:9",
    "fps": 30,
    "loudnessLufs": -14,
    "language": "pt-BR",
    "autonomy": "guided",
    "assets": "mixed"
  }
}
```

## config.json

```json
{
  "schema": "rooster.config/v1",
  "tts": {
    "provider": "auto",
    "voice": null,
    "language": "pt-BR"
  },
  "render": {
    "draftScale": 0.5,
    "draftCrf": 28,
    "finalCrf": 18
  },
  "browser": {
    "openPreview": true
  }
}
```

Keep provider keys in environment variables, never in `config.json`.

## Validation rules

- All ids are lowercase kebab-case.
- All paths are relative to the project root, unless explicitly external.
- All colors are 3- or 6-digit hex.
- All durations are seconds, not frames.
- All configs include a `schema` field.
- Unknown fields are allowed and preserved.

## Evolution

When a schema changes:

1. add a new `schema` version;
2. keep a migration note in `docs/`;
3. make the CLI read old and new versions;
4. never silently rewrite user files.
