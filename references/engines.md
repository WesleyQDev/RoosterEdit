# Engines

RoosterEdit is engine-agnostic. This document explains how to choose and drive each engine, and what the adapter contract looks like.

The two creative engines are **HyperFrames** and **Remotion**. FFmpeg is the media utility: it probes, cuts, burns captions, mixes audio, and assembles. It is not a third creative engine.

**FilmCraft** is an optional timeline target, not a creative engine. It receives the base cut and audio mix from FFmpeg and transparent element clips from HyperFrames or Remotion, then assembles an editable project. It is never the default and is never required.

## Decision tree

```text
Did the user explicitly choose an engine?
├─ Yes → use it, unless it cannot do the job; explain the tradeoff.
└─ No
   ├─ Does the user want an editable timeline to finish by hand (FilmCraft)?
   │  ├─ Yes → --target filmcraft; HyperFrames or Remotion renders the element clips
   │  └─ No
   │     ├─ No Node or no FFmpeg?
   │     │  └─ Produce the plan; explain that HyperFrames/Remotion need Node, and FFmpeg covers cuts/audio.
   │     ├─ Is the core job cutting real footage?
   │     │  ├─ Simple cuts, captions, audio → FFmpeg
   │     │  └─ Complex overlays, data, React components → Remotion
   │     ├─ Is it 3D?
   │     │  ├─ React project or needs @remotion/three → Remotion
   │     │  └─ HTML project or needs Three.js inside a web composition → HyperFrames
   │     ├─ Is it HTML/CSS/GSAP, kinetic type, charts, maps, motion graphics?
   │     │  └─ HyperFrames
   │     └─ Is it React, data-driven, or component-heavy?
   │        └─ Remotion
```

The default is `auto`. Respect the user's preference when they have one.

## Ask before building

`auto` is a safe default, not a silent decision. Before the first build, ask once per project:

> "How do you want to build this video? HyperFrames is the default and already works. Remotion is better for React/3D, but it is not installed. FilmCraft opens the timeline for manual editing, but the MCP is not configured yet. Which do you prefer?"

- Match the question to `doctor --json` and `filmcraft status --json`. Do not claim something is missing when it is installed.
- Skip the question when the user already chose an engine or explicitly asked for `auto`.
- **Remotion:** after the scaffold, it needs `npm install` inside `engine/remotion`. Ask before installing; never install silently. If the user declines, fall back to HyperFrames and say so.
- **FilmCraft:** it needs the CLI and the MCP. Ask before writing MCP config; the user must restart the agent for the tools to appear. FilmCraft is a timeline target, not an engine: still choose HyperFrames or Remotion for the element clips.
- Record the decision in `project.json` (`engine`, `timeline`) and in `review.md`.

## Per-element engines

The engine is not a project-wide lock. Every element may carry `engine` (`hyperframes`, `remotion`, or `auto`); anything without it inherits the project element engine. The build groups the elements by engine and renders each group separately.

| Target | Mixed plan | Why |
|---|---|---|
| `--target filmcraft` | works | one transparent clip per element, assembled on the timeline |
| `--engine hyperframes` or `remotion` | refused | one composition is written by one engine; `plan --check` and `build` name the mismatching elements |
| no element declares an engine | works | no mix: one engine draws everything |

Choose per element, not per project: a 3D product scene can go to Remotion while the chapter cards stay in HyperFrames, and a custom HTML element stays in HyperFrames even when the project default is Remotion. FilmCraft does not change the element engines; it only assembles their clips.

A mixed build costs time and disk: each group renders separately, and every element is a ProRes 4444 clip with alpha. Keep the single-engine path whenever every element can share one engine.

## Build from plan

Once the plan is approved, generate the engine project:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

The build:

- validates `edit/plan.json`;
- applies the plan's cuts with FFmpeg, or reuses a cached base when the source, keeps, format, and mix are unchanged;
- remaps element and chapter timings to the cut timeline;
- copies the base media and element assets into the engine project;
- writes a working composition for the chosen engine;
- runs `hyperframes check --json` with the binary resolved on disk after a HyperFrames build and prints a one-line summary plus the first findings. `--strict` fails the build on an error; `--no-check` skips it;
- writes `work/build-state.json` and updates `project.json` with the engine and `preview` status.

Use `--force` to rebuild an existing engine project, `--if-needed` to skip when the build state is unchanged, `--rebuild-media` to force FFmpeg again, and `--no-cache` to bypass the cache. `--sample 3` now builds a short montage around the selected elements instead of the whole timeline.

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

`plan <slug> --check` reports the warnings the build refuses under `--strict-plan`: density gaps, long silence jumps without b-roll or a transition, orphan reactions, b-roll without `covers`/`intent`/`sourceTime`, b-roll taken from a later scene, on-screen text that does not match the transcript, and element types the target engine cannot render. Read `references/edit-plan.md` for the heuristics behind them.

`template: "custom"` is the escape hatch when the built-in motion graphics are not enough: the plan carries `html`, `css`, and a GSAP `animation`, or a reusable `component` from `style/components/<name>/`. HyperFrames renders custom elements; Remotion does not execute custom HTML/JS.

Render through the CLI so the cache key, quality tier, workers, frame cache, and probe are consistent:

```bash
node "<skill>/scripts/rooster.mjs" render meu-video --draft
node "<skill>/scripts/rooster.mjs" render meu-video --final
node "<skill>/scripts/rooster.mjs" render meu-video --draft --print
```

`--force` re-renders even when the key matches. HyperFrames accepts `--workers`, `--gpu`, `--resume`, and `--frames-cache-dir`; Remotion accepts `--concurrency`, `--gl`, and `--frames`.

`render --target filmcraft` (or `--engine filmcraft`) exports through FilmCraft when the `.fcproj` exists, even on a project without it. The reverse is not allowed: a project whose `timeline` is `filmcraft` always renders through FilmCraft, because manual timeline edits exist only there. Delete `timeline` from `project.json` and rebuild if the user wants the MP4 straight from the engine instead.

## FilmCraft (optional timeline target)

FilmCraft is opt-in with `--target filmcraft` on `build` or `new`; the default target stays `auto`. The full set is `--target auto|hyperframes|remotion|filmcraft`. The build is hybrid:

1. FFmpeg builds the base cut and audio mix, as it does for the other engines.
2. HyperFrames or Remotion renders each visual element as its own transparent clip:
   - HyperFrames: MOV ProRes 4444 with alpha, one composition per element.
   - Remotion: ProRes 4444 with PNG frames and `yuva444p10le`, one composition per element.
   Remotion needs a one-time `npm install` in `engine/filmcraft/remotion`; ask before installing. The build reports that path when the CLI is missing.
3. FilmCraft assembles an editable `.fcproj`: source on V1 (video only), the mixed audio on A1, element clips on V2+ (greedy non-overlapping lanes), markers for chapters/elements/cuts, and captions when an SRT or VTT exists.

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine remotion
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --if-needed
node "<skill>/scripts/rooster.mjs" timeline meu-video --open
node "<skill>/scripts/rooster.mjs" render meu-video --draft
```

`--engine hyperframes|remotion` selects the element renderer; `auto` uses HyperFrames, because registry blocks and the generated plan only run there. Pass `--engine remotion` when the project has a hand-written React/Three element. The CLI is used for deterministic builds; the MCP server is for interactive editing and is not required for `build`. The project records `timeline: "filmcraft"` and `engine` as the element renderer.

FilmCraft cannot animate the base clip or apply overlay transitions. A plan with `zoom` or `transition` fails the FilmCraft build instead of silently dropping the motion; use `--target hyperframes`/`remotion`, replace those layers with punch-ins and PIP/split b-roll, or pass `--allow-skipped-elements` if the omission is deliberate.

FilmCraft is MIT OR Apache-2.0 and still alpha; Windows is less tested. Read `references/nle-handoff.md` for the project layout, incremental builds, render, and caveats; read `references/timeline.md` for the adapter mapping.

## HyperFrames

HyperFrames renders HTML/CSS/media to deterministic MP4 by seeking a paused timeline frame by frame. It is a strong fit for motion graphics, kinetic typography, charts, maps, overlays, captions, and HTML-based 3D.

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

- Prefer a registry block (`hyperframes catalog --tag three-js`) over hand-writing Three.js. See "Registry blocks" below.
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
- Blocks are HyperFrames-only; Remotion rejects the element with a clear message.
- The block's native `data-width`/`data-height` should match the plan. `build` warns when they differ; a 1920 block in a 1280 project can crop the scene.
- Official blocks import Three.js from a CDN. The first build/render needs network or a warm browser cache; do not promise an offline render without testing.
- A custom 3D scene is also a block: save it as `style/blocks/<name>/compositions/<name>.html`.

### Pitfalls

- Layout overflow; use `data-layout-allow-overflow` only when intentional.
- Fonts that are not bundled; use `@font-face` with a file in `assets/fonts`.
- Media that autoplays or seeks; keep media paused and time it with the timeline.
- Render duration mismatch; check the root `data-duration` against the final FFprobe.
- Trying to edit the same element from both CSS and GSAP transforms.

## Remotion

Remotion renders React compositions to video. It is a strong fit for component-heavy projects, data-driven scenes, complex state, and 3D with `@remotion/three`.

### When to use

- React/TypeScript projects;
- data-driven or interactive compositions;
- complex scene graphs and shared components;
- 3D via `@remotion/three`, `@react-three/fiber`, and `three`;
- projects that need the Remotion Player, Lambda, or a React preview.

### Commands

```bash
npx create-video@latest <dir>
npx remotion studio
npx remotion render <composition-id> out/final.mp4
npx remotion still <composition-id> out/frame.png --frame=120
npx remotion render <composition-id> out/draft.mp4 --scale=0.5 --crf=28
```

Check the installed Remotion version before using APIs that may have changed.

Remotion is free for individuals and teams of up to three people. Larger companies need a paid license; confirm it before a commercial delivery. See `docs/COSTS.md`.

### Project shape

```text
engine/remotion/
├── src/
│   ├── Root.tsx            # registerRoot + compositions
│   ├── Video.tsx           # main composition
│   ├── scenes/             # one component per scene
│   ├── components/         # shared UI, captions, overlays
│   ├── lib/                # timeline helpers, theme, audio
│   └── data/               # script, timeline, assets
├── public/assets/          # media and fonts
├── remotion.config.ts
└── out/
```

### Generated project

The adapter emits `Sequence` timing, `spring` entrances, `position`-aware placement, and template-aware cards for chapter, terminal, counter, diagram, and list. Transitions stay global overlays because their frame ranges are absolute. It does not emit `<Series>` or the wider Remotion ecosystem (`@remotion/transitions`, `@remotion/three`, `@remotion/lottie`, Player, Lambda). Use those when the project needs them, and keep the plan as the source of truth.

### Render contract

- Drive animation with `useCurrentFrame()` and `interpolate`/`spring`.
- Use `<Sequence>` and `<Series>` for timing; keep scene durations in one place.
- Avoid real-time side effects, timers, and unseeded randomness.
- Use `<Audio>` for voice/music and `<Img>`/`<Video>` for media.
- Use `staticFile()` for assets in `public/`.
- Keep the composition id stable; the render command depends on it.
- For 3D, use `@remotion/three` and drive the scene from the current frame; avoid `requestAnimationFrame`.

### 3D in Remotion

```tsx
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame } from "remotion";

export const Scene = () => {
  const frame = useCurrentFrame();
  const rotation = (frame / 30) * 0.4;
  return (
    <ThreeCanvas width={1920} height={1080} camera={{ position: [0, 0, 6], fov: 45 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <mesh rotation={[0, rotation, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#22d3ee" />
      </mesh>
    </ThreeCanvas>
  );
};
```

Keep geometry and materials simple enough to render reliably. Test one still before rendering the full video.

### Pitfalls

- Heavy 3D scenes that render slowly; reduce polygons, shadows, and post-processing.
- Media loading races; preload assets and avoid `useEffect`-driven timing.
- Fonts not loaded before the first frame; wait for `delayRender`/`continueRender`.
- Composition id mismatch; check `Root.tsx`.
- Unseeded randomness; use `random()` from Remotion with a fixed seed.

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

FilmCraft is a build target, not an adapter in this sense: it consumes the same plan through FFmpeg and the element renderers, so the contract above still applies to HyperFrames and Remotion.

## Hybrid pipelines

Mixing engines is allowed when it is the simplest path:

- render a 3D scene in Remotion, composite it with footage in FFmpeg;
- render motion graphics in HyperFrames, use FFmpeg for the final audio mix;
- use FFmpeg to create proxies and Remotion for the final composition;
- build a FilmCraft target: FFmpeg base plus HyperFrames/Remotion element clips, assembled into `.fcproj`.

Document the pipeline in `project.json` under `pipeline` and keep intermediate files in `renders/intermediate/`.

## Version checks

Before using an engine API, check the installed version:

```bash
node --version
npx hyperframes --version
npx remotion --version
filmcraft-cli --version
ffmpeg -version
```

If the version is unknown, use the most conservative API and test with a still frame.
