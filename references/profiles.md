# Profiles

A project belongs to a **channel** and uses a **profile** (how it looks and sounds). The channel holds the production defaults; the profile holds the visual identity. Any channel can use any profile, and a project can override either.

## Resolution order

1. Project overrides in `project.json`.
2. Channel defaults in `channels/<id>/channel.json` and channel-scoped profiles in `channels/<id>/profiles`.
3. Workspace `rooster/profiles`.
4. Global `~/.rooster/profiles`.
5. Built-ins in the skill's `templates/profiles`.

If two profiles share an id, the higher-precedence one wins. Record the resolved source in `project.json` or a `resolved.json` artifact so the decision is traceable.

## Profile schema

```json
{
  "schema": "rooster.profile/v1",
  "id": "tech-neon",
  "name": "Tech Neon",
  "description": "Dark tech, cyan/magenta, grid, kinetic type",
  "extends": "base",
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
    "motion": {
      "ease": "power3.out",
      "fast": 0.18,
      "normal": 0.35,
      "slow": 0.6
    }
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
  "audio": {
    "loudnessLufs": -14,
    "music": "synthwave",
    "sfx": "digital"
  },
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

### Required fields

- `schema`, `id`, `name`;
- `tokens.colors`, `tokens.typography`;
- `captions`, `audio`;
- `engines.preferred`.

### Optional fields

- `extends`, `scope`, `description`, `prompts`;
- `assets` (logo, fonts, textures, LUTs);
- `components` (engine-specific snippets);
- `examples` (reference frames).

### Profile folder

```text
profiles/<id>/
├── profile.json
├── STYLE.md
├── assets/
│   ├── logo.svg
│   ├── fonts/
│   ├── textures/
│   └── luts/
├── components/
│   └── <name>/
│       ├── element.html
│       ├── element.css
│       └── element.js
└── examples/
```

`STYLE.md` is the human-readable art direction: what the profile feels like, what to avoid, and how to apply it to a new scene. The JSON is the machine-readable contract.

Each `components/<name>/` folder is a reusable custom motion graphic. `element.html` is the markup, `element.css` is injected into the composition, and `element.js` holds GSAP statements that receive `root`, `start`, `duration`, and `tl`. A plan references it with `component: "<name>"` on a `custom` element. When a new animation proves itself, save it here instead of rebuilding it from scratch next time.

## Inheritance

`extends` can point to:

- another profile in the same scope;
- a global id;
- a built-in id.

Merge rules:

- objects merge recursively;
- arrays replace, unless the key is `tags` or `supported`, which union;
- `null` removes a key;
- the child wins on conflicts.

Keep inheritance shallow. A profile that extends three levels is hard to reason about.

## Creating a profile

### From brand assets

1. Ask for logo, colors, fonts, and 2–3 reference posts/videos.
2. Extract a palette and type scale.
3. Write `profile.json` and `STYLE.md`.
4. Run `styleproof <slug>` and review the three frames: hook, data/graphic, and caption/lower third.
5. Save it in `rooster/profiles/<id>`.

### From a reference video

1. Extract 6–12 frames across the video.
2. Describe the palette, type, motion, texture, and pacing in concrete terms.
3. Separate what is style from what is content.
4. Rebuild the style with original assets; do not copy copyrighted frames or music.
5. Validate with `styleproof` before reusing the profile.

### From the user's existing project

1. Read the project's `style.md` and `project.json`.
2. Copy the tokens and component references into a new profile.
3. Remove project-specific copy and assets that do not belong in a reusable profile.
4. Name it after the visual identity, not the project.

## Style proof

The three-frame proof is the cheapest place to reject a look. Run:

```bash
node "<skill>/scripts/rooster.mjs" styleproof <slug> --open
```

It writes `style/proof/index.html` and `style/proof/proof.json` with a hook frame, a data/graphic frame, and a caption/lower-third frame, using the resolved profile tokens. Approve the look before the plan or the build. Change colors, type, density, and motion here, not after the full render.

## Forking

```bash
node "<skill>/scripts/rooster.mjs" profile fork tech-neon --as my-brand
```

Forking copies the source into the current scope and rewrites the id. It does not modify the original.

## Validation rules

- `id` is lowercase kebab-case and matches the folder.
- `schema` is present and known.
- Colors are valid hex values.
- Fonts exist in `assets/fonts` or are system-safe.
- `extends` points to an existing id.
- `engines.supported` contains only known engines.
- Caption sizes fit the target aspect at the chosen resolution.
- Audio loudness is within a sane range (-23 to -9 LUFS).
- No asset is referenced without a license entry.

## Built-in profiles to ship

- `minimal` — clean, white, editorial, restrained motion.
- `tech-neon` — dark, cyan/magenta, grid, kinetic type.
- `warm-documentary` — film grain, warm tones, serif, slow.
- `brutalist` — bold type, black/white/red, hard cuts.
- `3d-cartoon` — rounded shapes, saturated colors, squash/stretch.
- `corporate-clean` — blue, sans, lower thirds, safe.
