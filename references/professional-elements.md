# Professional elements

These are the layers that separate a cut-only edit from a finished video. Load only the reference for the layer you need; do not put all of this in `SKILL.md`.

| Layer | Reference | What it adds |
|---|---|---|
| Captions | `features/captions.md` | SRT/VTT, readable cues, burn-in, accessibility |
| Motion | `features/motion.md` | Real zooms, parallax scenes, fades, dips, slides |
| Audio | `features/audio.md` | Music ducking, SFX, loudness |
| Reframe | `features/reframe.md` | 16:9 to 9:16/1:1/4:5 crop and focus |
| Delivery | `features/delivery.md` | Thumbnail, metadata, chapters, package |
| NLE handoff | `nle-handoff.md` | EDL/FCPXML for DaVinci/Premiere |
| Color | `features/color.md` | LUT, contrast, temperature, denoise, stabilization |
| B-roll | `features/broll.md` | Local discovery, ranking, placement suggestions |
| Charts | `features/charts.md` | Real bar/line/pie graphics |
| TTS | `features/tts.md` | Script to voiceover |
| Multicam | `features/multicam.md` | Camera selection, J/L cuts, speed ramps |

## Progress and questions

Every layer starts with the current `Etapa X/8` marker. If a choice would change the cut, the look, the audio, or the cost, ask before proceeding instead of guessing.

## Status

- Wired into `build`: music/SFX ducking, TTS voiceover from `edit/voiceover.json`, zoom/transitions (HyperFrames/Remotion), charts, structured templates (`chapter`, `diagram`, `counter`, `list`, `emphasis`, `callout`, `terminal`, `end-card`), custom HTML/CSS/GSAP elements, PIP/split b-roll, and cut smoothing (audio micro-fade + punch-in).
- Structured templates are fully rendered in HyperFrames (including the FilmCraft element path). Remotion uses the card/text fallback with the template's data, not the animated layout; use HyperFrames when the motion design is the point.
- CLI layer: captions (including burn-in), delivery, reframe, b-roll, color (including two-pass stabilization), multicam (including speed/J-L and camera concat), plan quality review.
- Still manual: final color pass into the build (`color --update-plan` first), multicam into the build (`multicam --render --update-plan` first), and provider approval for TTS generation.

## CLI commands

```bash
node "<skill>/scripts/rooster.mjs" captions <slug>
node "<skill>/scripts/rooster.mjs" deliver <slug>
node "<skill>/scripts/rooster.mjs" reframe <slug> --format 9:16 [--update-plan]
node "<skill>/scripts/rooster.mjs" broll <slug> [--write]
node "<skill>/scripts/rooster.mjs" audio <slug>
node "<skill>/scripts/rooster.mjs" color <slug> [--update-plan]
node "<skill>/scripts/rooster.mjs" tts <slug> [--generate]
node "<skill>/scripts/rooster.mjs" multicam <slug> [--render] [--update-plan]
node "<skill>/scripts/rooster.mjs" export <slug> [--format edl|fcpxml|both]
```
`zoom`, `transition` and chart elements are part of `edit/plan.json` and are consumed by `build`.

## Order of work

1. Captions and motion: highest impact on retention and perceived quality.
2. Audio and reframe: music ducking, SFX, and vertical delivery.
3. Delivery: thumbnail, metadata, captions sidecars, package.
4. Color, b-roll, charts, TTS and multicam: use when the brief needs them.

## Rules

- Keep `edit/plan.json` as the source of truth. A layer is approved in the plan before build.
- A layer that is not in the plan is not in the video.
- Do not cover the footage with a full-screen layer unless the user asks for it.
- Record licenses for music, SFX, b-roll, fonts and stock.
- If a layer is omitted, record why in `notes`.
- Do not grow `SKILL.md` with feature details. Add them to the matching feature reference.
