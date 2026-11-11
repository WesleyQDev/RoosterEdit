# Templates

Templates the CLI uses to create workspaces, projects, profiles, and engine starters.

## Built-in profiles

```text
templates/profiles/
├── minimal/
├── tech-neon/
└── 3d-cartoon/
```

Each profile has `profile.json` (machine-readable contract) and `STYLE.md` (human direction).

## Other templates

| File | Use |
|---|---|
| `style.md` | Style guide template for `channels/<channel>/projects/<slug>/style.md` |
| `plan.example.json` | Example `edit/plan.json` with cuts and elements |
| `install-prompt.md` | Install prompt via npm + environment validation |
| `bootstrap-prompt.md` | Setup prompt inspired by the reference video, adapted to RoosterEdit |

## Engine starters (planned)

```text
templates/engines/
├── hyperframes/
├── remotion/
└── ffmpeg/
```

Starters should be minimal and functional: one composition, one test asset, one preview command, and one render command.

## How the CLI uses them

`node scripts/rooster.mjs init` copies the built-in profiles into the user workspace if they do not exist yet. The workspace is the local source of truth; templates are only the starting point.

## Rules

- Do not include heavy media in templates.
- Do not include fonts without a license.
- Do not include API keys.
- Keep JSON files valid and IDs in kebab-case.
