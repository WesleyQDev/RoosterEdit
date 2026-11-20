# Style libraries (lemo-opuscar and similar)

A style library is a catalog of looks with a written prompt per look. It is useful at the style gate, not at the build gate. RoosterEdit already has `profiles`; a library is a source of ideas and a starting point for a new profile, not a second profile system.

## lemo-opuscar: what it is and what it is not

[lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) ships 99 film styles, each with a `STYLE.md`, a demo film, and a full code pipeline (canvas/WebGL, TTS, original score). The **style prompts are the useful part**. The runtime duplicates HyperFrames, so RoosterEdit does not adopt it.

### License: read before copying

- The `STYLE.md` files and the guides are **CC BY-NC 4.0**.
- The author adds a permission for the people making a film (including commercial and client work) to read, follow, copy, and adapt the docs for that film.
- That permission does **not** cover redistributing the docs, adapted versions, or selling them. A commercial use of the docs needs a separate license.
- The demo films and stills are CC BY 4.0, but third-party footage, music, models, and trademarks keep their own terms. Some narration tracks are explicitly excluded.

Consequence: **never vendor lemo styles into RoosterEdit, the npm package, or the user's repository.** Do not copy a `STYLE.md` into a profile. Read the user's local copy as a reference, then write an original profile that describes the look in your own words and credits the inspiration.

## Workflow

1. The user installs the library with its own installer, or clones it. RoosterEdit does not install it.
2. The user names a style (for example "Swiss Motion Graphics" or "Risograph").
3. Read the style's `STYLE.md` from the user's local copy (`~/lemo-opuscar/styles/<style>/STYLE.md` or the clone). Do not paste it into the main context; extract only palette, type, composition, motion, and sound notes.
4. Run `channel design` or `profile fork` and write a **new** profile with RoosterEdit's own tokens and prose. Do not copy the text.
5. Record the inspiration and the license in `profile.json` (`description` or a `credits` field) and in `style.md`.
6. Run `styleproof <slug>` and approve the three frames before planning.

```bash
node "<skill>/scripts/rooster.mjs" profile fork minimal --as my-style
node "<skill>/scripts/rooster.mjs" channel design studio-a --from my-style --accent "#e4572e"
node "<skill>/scripts/rooster.mjs" styleproof studio-a/video-x --open
```

## What to keep from a library

- the **visual grammar**: grid, material, palette logic, camera grammar, type treatment;
- the **pace**: how long a shot holds, how often the frame changes;
- the **sound direction**: what kind of music and SFX the look implies;
- the **constraints**: what the style never does.

What not to keep: the demo's script, characters, logos, footage, music, or the style's name as the user's brand.

## Alternatives

- `style: reference` — derive a profile from a reference video or image the user owns.
- `profile fork <id>` — start from a built-in profile and change the tokens.
- `channel design` — answer three questions (palette, typography, motion/audio) and get a profile with `STYLE.md`.

A library is a shortcut to a direction, not a substitute for the style gate. The user still approves the frames.
