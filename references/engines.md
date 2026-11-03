# Engines

RoosterEdit is engine-agnostic. This document explains how to choose and drive each engine, and what the adapter contract looks like.

The two creative engines are **HyperFrames** and **Remotion**. FFmpeg is the media utility: it probes, cuts, burns captions, mixes audio, and assembles. It is not a third creative engine.

## Decision tree

```text
Did the user explicitly choose an engine?
├─ Yes → use it, unless it cannot do the job; explain the tradeoff.
└─ No
   ├─ No Node or no FFmpeg?
   │  └─ Produce the plan; explain that HyperFrames/Remotion need Node, and FFmpeg covers cuts/audio.
   ├─ Is the core job cutting real footage?
   │  ├─ Simple cuts, captions, audio → FFmpeg
   │  └─ Complex overlays, data, React components → Remotion
   ├─ Is it 3D?
   │  ├─ React project or needs @remotion/three → Remotion
   │  └─ HTML project or needs Three.js inside a web composition → HyperFrames
   ├─ Is it HTML/CSS/GSAP, kinetic type, charts, maps, motion graphics?
   │  └─ HyperFrames
   └─ Is it React, data-driven, or component-heavy?
      └─ Remotion
```

The default is `auto`. Respect the user's preference when they have one.

## Build from plan

Once the plan is approved, generate the engine project:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

The build:

- validates `edit/plan.json`;
- applies the plan's cuts with FFmpeg;
- remaps element and chapter timings to the cut timeline;
- copies the base media and element assets into the engine project;
- writes a working composition for the chosen engine;
- updates `project.json` with the engine and `preview` status.

Use `--force` to rebuild an existing engine project and `--no-cuts` to keep the original source timeline.

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

- Use a paused Three.js clock driven by the GSAP timeline, not real time.
- Keep geometry low-poly and lighting simple.
- Avoid post-processing unless the render budget allows it.
- Snapshot midpoints of every 3D scene; a blank or tiny object usually means a mount defect.
- Prefer deterministic procedural motion over physics unless the physics is seeded.

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

## Hybrid pipelines

Mixing engines is allowed when it is the simplest path:

- render a 3D scene in Remotion, composite it with footage in FFmpeg;
- render motion graphics in HyperFrames, use FFmpeg for the final audio mix;
- use FFmpeg to create proxies and Remotion for the final composition.

Document the pipeline in `project.json` under `pipeline` and keep intermediate files in `renders/intermediate/`.

## Version checks

Before using an engine API, check the installed version:

```bash
node --version
npx hyperframes --version
npx remotion --version
ffmpeg -version
```

If the version is unknown, use the most conservative API and test with a still frame.
