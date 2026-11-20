# Engines

RoosterEdit is engine-agnostic in its plan, but it ships **one creative engine**: HyperFrames. FFmpeg is the media utility. FilmCraft is an optional timeline target. Blender is an optional 3D technique, not an engine.

Remotion was removed in 0.3. Keeping two React/HTML engines duplicated the plan adapter, the build, the render wrapper, and the tests, and it made `auto` pick an engine that was usually not installed. HyperFrames covers HTML/CSS/GSAP, canvas scenes, charts, and WebGL/Three.js; Blender covers heavy 3D.

## Decision tree

```text
Did the user explicitly choose an engine?
├─ Yes → hyperframes, or explain that Remotion was removed
└─ No
   ├─ Does the video need a hand-edited timeline (FilmCraft)?
   │  ├─ Yes → --target filmcraft; HyperFrames renders the element clips
   │  └─ No
   │     ├─ No Node or no FFmpeg?
   │     │  └─ Produce the plan; explain that the render needs Node/FFmpeg
   │     ├─ Is the core job cutting real footage?
   │     │  ├─ Simple cuts, captions, audio → FFmpeg
   │     │  └─ Overlays, graphics, data, 3D → FFmpeg base + HyperFrames
   │     ├─ Is it HTML/CSS/GSAP, kinetic type, charts, maps, canvas?
   │     │  └─ HyperFrames
   │     ├─ Is it 3D/WebGL that can run in a browser?
   │     │  └─ HyperFrames + a Three.js block or a local scene
   │     └─ Is it heavy 3D, simulation, or photoreal?
   │        └─ Blender, rendered as a clip and placed as b-roll
```

`auto` means "choose from what is available", not "pick a different engine". The engine is always HyperFrames; the *techniques* vary. Read `references/techniques.md`.

## Ask before building

`auto` is a safe default, not a silent decision. Before the first build, ask once per project:

> "The plan needs a cleanup cut (FFmpeg) and motion graphics (HyperFrames). Build those now, or do you want a hand-edited FilmCraft timeline?"

- Match the question to `techniques --json`, `doctor --json`, and `filmcraft status --json`. Do not claim something is missing when it is installed.
- Skip the question when the user already chose an engine or asked for `auto`.
- **FilmCraft:** it needs the CLI; the MCP is optional and only for interactive editing. Ask before writing MCP config; the user must restart the agent for the tools to appear.
- **Blender:** ask before installing or rendering; it is not an engine and does not change the build target.
- Record the choice in `project.json` (`engine`, `timeline`, `techniques`) and in `review.md`.

## Per-element engines

The engine is not a project-wide lock, but there is only one engine to choose from. Every element may carry `engine`, and anything without it inherits the project engine. Accepted values are `hyperframes` and `auto`.

- `--target hyperframes`: one composition draws every element.
- `--target filmcraft`: HyperFrames renders each element as its own transparent clip, and FilmCraft assembles them.
- A plan with `"engine": "remotion"` fails with a clear message. Use a Three.js block or a Blender render instead.

A FilmCraft build costs time and disk: every element is a ProRes 4444 clip with alpha. Keep the single-engine path when the timeline does not need to be edited by hand.

## Build from the plan

Once the plan is approved:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine hyperframes
```

The build:

- validates `edit/plan.json`;
- applies the plan's cuts with FFmpeg, or reuses a cached base when the source, keeps, format, and mix are unchanged;
- remaps element and chapter timings to the cut timeline;
- copies the base media and element assets into the engine project;
- writes a working HyperFrames composition;
- runs `hyperframes check --json` with the binary resolved on disk and prints a one-line summary plus the first findings (skip with `--no-check`; fail on errors with `--strict`);
- writes `work/build-state.json` and updates `project.json` with the engine and `preview` status.

`--encoder auto` (the default) uses the best hardware H.264 for the base when `doctor` reports one, and the build retries on libx264 if the hardware encoder fails. Delivery renders stay on libx264 unless the user names a hardware encoder.

| Flag | Effect |
|---|---|
| `--sample <n>` | Short montage around `n` elements, for approval before the full build |
| `--strict` | Fail when the HyperFrames check reports an error |
| `--no-check` | Skip the post-build HyperFrames check |
| `--force` | Rebuild an existing engine project (archives the FilmCraft project first) |
| `--if-needed` | Skip when the build state key is unchanged |
| `--rebuild-media` | Re-run FFmpeg and the element renders |
| `--no-cuts` | Ignore `plan.cuts` and use the original source |
| `--strict-plan` | Refuse the build on any `plan --check` warning |
| `--allow-cut-only` | Accept a plan with no visual elements |
| `--allow-download` | Fetch a missing 3D/registry block into `style/blocks/` once |
| `--allow-no-music` | Accept a plan with no music decision |
| `--allow-skipped-elements` | Build even when the target cannot render an element |
| `--cut-punch <scale>` / `--cut-fade <s>` | Tune the punch-in and the audio micro-fade at each cut |

`plan <slug> --check` reports the warnings the build refuses under `--strict-plan`: density gaps, long silence jumps without b-roll or a transition, orphan reactions, b-roll without `covers`/`intent`/`sourceTime`, b-roll taken from a later scene, on-screen text that does not match the transcript, and element types the target cannot render. Read `references/edit-plan.md`.

`template: "custom"` is the escape hatch when the built-in motion graphics are not enough: the plan carries `html`, `css`, and a GSAP `animation`, or a reusable `component` from `style/components/<name>/`.

Render through the CLI so the cache key, quality tier, workers, frame cache, and probe are consistent:

```bash
node "<skill>/scripts/rooster.mjs" render meu-video --draft
node "<skill>/scripts/rooster.mjs" render meu-video --final
node "<skill>/scripts/rooster.mjs" render meu-video --draft --print
```

`--force` re-renders even when the key matches. HyperFrames accepts `--workers`, `--gpu`/`--no-gpu`, `--resume`, and `--frames-cache-dir`. The CLI enables `--gpu` automatically when a GPU is detected and retries on the CPU if the GPU render fails.

`render --target filmcraft` (or `--engine filmcraft`) exports through FilmCraft when the `.fcproj` exists, even on a project without it. The reverse is not allowed: a project whose `timeline` is `filmcraft` always renders through FilmCraft, because manual timeline edits exist only there. Delete `timeline` from `project.json` and rebuild if the user wants the MP4 straight from the engine instead.

## HyperFrames

HyperFrames renders HTML/CSS/media to deterministic MP4 by seeking a paused timeline frame by frame. It is a strong fit for motion graphics, kinetic typography, charts, maps, camera scenes, overlays, captions, and HTML-based 3D.

### When to use

- faceless explainers and social shorts;
- kinetic type and text-heavy scenes;
- data visualization, charts, maps;
- HTML overlays on footage;
- 3D scenes inside an HTML composition;
- projects where the user wants the HyperFrames Studio editing surface.

### Commands

```bash
npx hyperframes init <dir>
npx hyperframes preview
npx hyperframes check --json
npx hyperframes snapshot --review
npx hyperframes timeline --json
npx hyperframes render --quality draft -o draft.mp4
npx hyperframes render --quality delivery -o final.mp4
```

The CLI wrapper keeps the engine directory and the project slug together:

```bash
node "<skill>/scripts/rooster.mjs" hyperframes catalog --query "glitch transition" --json
node "<skill>/scripts/rooster.mjs" hyperframes add <name> --project <slug> --json
node "<skill>/scripts/rooster.mjs" hyperframes snapshot <slug> --at 1,3 --review
node "<skill>/scripts/rooster.mjs" hyperframes timeline <slug> --json
node "<skill>/scripts/rooster.mjs" hyperframes history <slug> --since mine --who <you>
```

If the `hyperframes` skill is installed, load it and follow its contract. If not, use the commands above and the render contract below. Do not assume the CLI version; check `npx hyperframes --version` or `npx hyperframes doctor`.

### Project shape

```text
engine/hyperframes/
├── index.html              # root composition and variables
├── compositions/           # one scene per sub-composition
├── assets/                 # media and fonts
├── frame.md                # optional design system
└── out/                    # renders
```

### Generated project

The adapter writes one `compositions/el-<n>.html` per visual element and mounts each one from `index.html` with `data-composition-src`. Registry blocks are the exception: their own `compositions/<name>.html` is copied and mounted directly. Every scene registers its own paused timeline, so the root only holds the base media, scene hosts, zooms, and transitions. The main text, kicker, and subtitle of chapter/title and parallax scenes are declared as composition variables and bound with `data-var-text`, so the Studio Variables panel can edit them. Text and media use the profile tokens (`--display`, `--body`, `--mono`, `--radius`, `--space`); sizes are expressed in short-side units (`--u`), so 9:16 and 1:1 keep readable type instead of the 16:9 pixel layout. `npx hyperframes check` runs after the build unless `--no-check` is passed.

Before hand-building a named effect, search the registry:

```bash
npx hyperframes catalog --query "glitch transition" --json
npx hyperframes add <name> --json
```

### Render contract

- Every timed element has `class="clip"`, `data-start`, and `data-duration` in seconds.
- The root's `data-duration` is the video length.
- Each composition registers a paused timeline: `window.__timelines["<id>"] = tl`.
- No `Date.now()`, unseeded `Math.random()`, timers, network fetches, or `repeat: -1`.
- Do not tween `display`, `visibility`, or `autoAlpha` on a `.clip`; animate a child.
- Do not mix CSS transforms and GSAP transforms on the same element.
- Never call `play()`, `pause()`, or seek media inside the composition.
- Asset paths are relative to the project: `assets/...`.
- Use the registry for named transitions, captions, charts, and cards before hand-building them.

### 3D in HyperFrames

- Prefer a registry block (`hyperframes catalog --tag three-js`) over hand-writing Three.js. See `techniques/three-js.md`.
- Use a paused Three.js clock driven by the GSAP timeline, not real time.
- Keep geometry low-poly and lighting simple.
- Avoid post-processing unless the render budget allows it.
- Snapshot midpoints of every 3D scene; a blank or tiny object usually means a mount defect.
- Prefer deterministic procedural motion over physics unless the physics is seeded.

### Registry blocks

`build` can turn a plan element into a registry block:

```json
{ "type": "scene", "template": "block", "block": "extruded-logo",
  "vars": { "text": "ROOSTER" }, "start": 12, "end": 17 }
```

- `hyperframes catalog --tag three-js|webgl` lists candidates.
- The block lives in `<project>/style/blocks/<name>/compositions/`.
- A missing block stops the build with the exact `hyperframes add` command; `--allow-download` fetches it once and keeps the copy in the project, so `build --force` does not delete it.
- The block's native `data-width`/`data-height` should match the plan. `build` warns when they differ; a 1920 block in a 1280 project can crop the scene.
- Official blocks import Three.js from a CDN. The first build/render needs network or a warm browser cache; do not promise an offline render without testing.
- A custom 3D scene is also a block: save it as `style/blocks/<name>/compositions/<name>.html`.

### Pitfalls

- Layout overflow; use `data-layout-allow-overflow` only when intentional.
- Fonts that are not bundled; use `@font-face` with a file in `assets/fonts`.
- Media that autoplays or seeks; keep media paused and time it with the timeline.
- Render duration mismatch; check the root `data-duration` against the final FFprobe.
- Trying to edit the same element from both CSS and GSAP transforms.

## FFmpeg

FFmpeg is the universal fallback and the best tool for cutting real footage, burning captions, mixing audio, and assembling clips.

### When to use

- talking-head and interview edits;
- simple cuts, trims, speed changes, fades;
- burned or sidecar captions;
- audio normalization and ducking;
- assembling engine-rendered clips;
- environments without Node.

### Project shape

```text
engine/ffmpeg/
├── edl.json
├── build.sh or build.ps1
├── filtergraph.txt
└── out/
```

### EDL to filter graph

Keep `edit/edl.json` as the source of truth:

```json
{
  "clips": [
    { "src": "assets/source/interview.mp4", "in": 12.4, "out": 18.2, "start": 0 },
    { "src": "assets/source/broll.mp4", "in": 2.0, "out": 5.5, "start": 5.8 }
  ]
}
```

Generate a filter graph with `trim`, `setpts`, `concat`, overlays, and audio mixing. Prefer a script that reads the EDL over a hand-written monster command.

### Hardware encoding

`doctor --json` reports the GPU and the encoders the local FFmpeg was built with. `--encoder auto` picks the hardware H.264 for drafts and intermediates. Delivery stays on libx264 because hardware quality is not validated for final delivery. If a hardware encode fails, the build retries on libx264 instead of losing the render.

### Captions

- Burned: `subtitles=captions.srt:force_style='FontName=Inter,FontSize=42,...'`.
- Sidecar: deliver SRT/VTT; do not burn.
- Always check line length, reading speed, and safe area.

### Audio

- Normalize voice to the target loudness; use `loudnorm`.
- Duck music under voice with `sidechaincompress` or a volume automation envelope.
- Keep a headroom of about -1 dBFS true peak.
- For YouTube, -14 LUFS integrated is a common target.

### Pitfalls

- Re-encoding everything; use `-c copy` for simple cuts when possible.
- Frame-accurate cuts need keyframes; use `-ss` before `-i` for speed, after `-i` for accuracy.
- Variable frame rate sources; normalize to constant frame rate before editing.
- Filter graphs that are impossible to debug; write them to a file and keep them readable.
- Audio/video drift; use the same timebase and verify with FFprobe.

## FilmCraft (optional timeline target)

FilmCraft is opt-in with `--target filmcraft` on `build` or `new`; the default target stays `auto`. The full set is `--target auto|hyperframes|filmcraft`. The build is hybrid:

1. FFmpeg builds the base cut and audio mix, as it does for the other targets.
2. HyperFrames renders each visual element as its own transparent clip: MOV ProRes 4444 with alpha, one composition per element.
3. FilmCraft assembles an editable `.fcproj`: source on V1 (video only), the mixed audio on A1, element clips on V2+ (greedy non-overlapping lanes), markers for chapters/elements/cuts, and captions when an SRT or VTT exists.

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --if-needed
node "<skill>/scripts/rooster.mjs" timeline meu-video --open
node "<skill>/scripts/rooster.mjs" render meu-video --draft
```

The CLI is used for deterministic builds; the MCP server is for interactive editing and is not required for `build`. The project records `timeline: "filmcraft"` and `engine: "hyperframes"`.

FilmCraft cannot animate the base clip or apply overlay transitions. A plan with `zoom` or `transition` fails the FilmCraft build instead of silently dropping the motion; use `--target hyperframes`, replace those layers with punch-ins and PIP/split b-roll, or pass `--allow-skipped-elements` if the omission is deliberate.

FilmCraft is MIT OR Apache-2.0 and still alpha; Windows is less tested. Read `references/nle-handoff.md` for the project layout, incremental builds, render, and caveats; read `references/timeline.md` for the adapter mapping.

## Adapter contract

Every engine adapter receives:

- `project.json`;
- `edit/timeline.json`;
- `assets/manifest.json`;
- `style.md` / resolved profile;
- the engine project directory.

It produces:

- a runnable project;
- a preview command or URL;
- a draft render;
- a final render;
- a render report with duration, resolution, fps, and audio info.

The adapter must not invent editorial decisions. If the timeline is ambiguous, ask or fix the timeline first.

FilmCraft is a build target, not an adapter in this sense: it consumes the same plan through FFmpeg and HyperFrames, so the contract above still applies.

## Hybrid pipelines

Mixing techniques is allowed; mixing engines is not.

- render a 3D scene in Blender, composite it with footage in HyperFrames or FFmpeg;
- render motion graphics in HyperFrames, use FFmpeg for the final audio mix;
- use FFmpeg to create proxies and HyperFrames for the final composition;
- build a FilmCraft target: FFmpeg base plus HyperFrames element clips, assembled into `.fcproj`.

Document the pipeline in `project.json` under `pipeline` and keep intermediate files in `renders/intermediate/`.

## Version checks

Before using an engine API, check the installed version:

```bash
node --version
npx hyperframes --version
filmcraft-cli --version
blender --version
ffmpeg -version
```

If the version is unknown, use the most conservative API and test with a still frame.
