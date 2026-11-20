# Techniques

RoosterEdit has one creative engine (**HyperFrames**) and a catalog of techniques around it. A technique is a job the video needs; the tool is whatever does that job best on this machine. Do not pick a tool by habit, and do not treat the engine as the answer to every problem.

`references/engines.md` explains how to drive HyperFrames and FFmpeg. This file explains how to choose.

## The three questions

Before the build gate, answer these three questions in one short line each. Write the answers to `project.json` (`techniques`) and to `review.md`.

1. **What must the viewer see and hear?** Cuts, captions, motion graphics, 3D, sound design, a hand-edited timeline, a delivery package.
2. **Which techniques produce that?** Name the layers, not the tool: cleanup cut, kinetic type, product orbit, audio critique, multicam.
3. **Which of those is available and cheapest here?** Run `techniques --json` and read `doctor --json`. Prefer a technique that is already installed; ask before installing anything.

If the answer is "HyperFrames for everything", check that the plan actually needs HTML/GSAP. A clean interview does not.

```bash
node "<skill>/scripts/rooster.mjs" doctor --json
node "<skill>/scripts/rooster.mjs" techniques --json
node "<skill>/scripts/rooster.mjs" techniques --plan en-tech/video-x
node "<skill>/scripts/rooster.mjs" techniques --need 3d
node "<skill>/scripts/rooster.mjs" techniques --need audio,voice
```

## Need → technique → tool

| The video needs | Technique | Best available tool | Fallback |
|---|---|---|---|
| Cut silence, filler, retakes; assemble footage | `cut` | FFmpeg (`tighten`, `build`) | none |
| Readable subtitles, burned or sidecar | `captions` | FFmpeg + the profile | none |
| Music under voice, broadcast loudness | `audio-mix` | FFmpeg (`loudnorm`, ducking) | none |
| A look, LUT, stabilization | `color` | FFmpeg | none |
| 9:16 or 1:1 from 16:9 | `reframe` | FFmpeg (face-aware crop) | manual crop |
| Several cameras, J/L cuts | `multicam` | FFmpeg | edit by hand in the NLE |
| Kinetic type, charts, maps, lower thirds, generated explainers | `motion` | HyperFrames | FFmpeg drawtext for one line |
| Layered stills with a camera move | `canvas` | HyperFrames canvas scene | `parallax` |
| Product orbit, particles, shaders, 3D text | `three` | HyperFrames + Three.js | Blender for a heavier scene |
| Real 3D, materials, lighting, simulation | `blender` | Blender headless (or the MCP for interactive work) | a Three.js block |
| Hear the mix, pick the best take, design SFX | `ears` | earshot | FFmpeg loudness only |
| Narration when there is no recorded voice | `tts` | edge-tts, HyperFrames, or a paid provider | captions only |
| Finish the cut by hand | `timeline` | FilmCraft | EDL/FCPXML |
| Deliver to Resolve or Premiere | `handoff` | EDL/FCPXML | FilmCraft |
| Thumbnail, metadata, chapters | `delivery` | RoosterEdit | none |

A plan can use several techniques. It cannot use two creative engines: HyperFrames is the only one. If a shot needs Blender, render it as a clip and place it as b-roll; do not try to mix engines inside one composition.

## What `techniques --json` returns

```json
{
  "schema": "rooster.techniques/v1",
  "needs": ["3d"],
  "techniques": [
    {
      "id": "three",
      "tool": "HyperFrames + Three.js",
      "available": true,
      "missing": [],
      "cost": "local; a registry block needs network once",
      "ref": "references/techniques/three-js.md"
    }
  ],
  "recommendation": [{ "need": "3d", "technique": { "id": "three" } }]
}
```

`available: false` means the machine lacks the requirement, not that the technique is forbidden. `missing` names the requirement and `install` gives the command. Installing is always an explicit decision: the agent asks, the user approves.

## Recording the choice

In `project.json`:

```json
{
  "techniques": [
    { "id": "cut", "tool": "ffmpeg", "why": "talking head, silence between answers" },
    { "id": "motion", "tool": "hyperframes", "why": "chapter cards and a chart" },
    { "id": "ears", "tool": "earshot", "why": "pick the better take and check the mix" }
  ]
}
```

In `edit/plan.json`, elements already carry `type` and `template`; do not add a second source of truth. The plan says what appears; `project.json` says which technique produces it.

## The build gate

Replace the old "HyperFrames or Remotion?" question with a proposal:

> "Step 6/8 — The plan is approved. It needs a cleanup cut (FFmpeg), kinetic type and a chart (HyperFrames), and a sound pass (earshot, not installed). Build with the first two now, or install earshot first?"

Rules:

- Say the choice is not permanent for the *element*; it is permanent for the *engine*, because there is only one.
- If the user says "you decide", choose the available technique with the lowest cost and state why in one line.
- If a needed technique is missing, say the exact install command and what degrades without it. Do not install without permission.
- If the user asks for Remotion, explain that it was removed: HyperFrames covers HTML/GSAP/WebGL, and Blender covers heavy 3D. Offer the closest path.

## Technique packs

| Read this | When |
|---|---|
| `techniques/three-js.md` | A WebGL/3D scene inside HyperFrames |
| `techniques/blender.md` | A real 3D scene, simulation, or heavy render |
| `techniques/ears.md` | Audio critique, SFX, sound design, "which take is better" |
| `techniques/style-library.md` | Importing a style from lemo-opuscar or another external library |
| `engines.md` | Driving HyperFrames, FilmCraft, and FFmpeg |
| `edit-plan.md` | Canvas scenes, element schemas, and plan warnings |

## Anti-patterns

- Using HyperFrames for a cut-only interview because it is the default.
- Installing Blender, earshot, or a model pack because it might be useful.
- Adding 3D because the plan has a `scene` element, when a chart would say it better.
- Treating `techniques --json` as a menu of everything; it is a list of what this machine can actually run.
- Choosing a technique that changes the cut, the look, the audio, or the cost without asking.
