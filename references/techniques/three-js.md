# Three.js

Three.js is the WebGL layer inside HyperFrames. It is the right technique when the shot needs a real 3D object, a shader background, particles, or a camera orbit, but the scene can be deterministic and does not need full CGI. For materials, lighting, simulation, and heavy renders, use Blender (`techniques/blender.md`).

## When to use

- a product orbit or an exploded view;
- 3D text, logos, or simple geometry;
- particles, star fields, grids, waves, shader transitions;
- a 3D background behind type or footage;
- a data scene where depth helps (bars in 3D, network graphs).

Do not use it for: characters, cloth, fluid, physics, photoreal materials, or anything that needs a lighting artist. Those are Blender jobs.

## Two ways to build a scene

### 1. Registry block (fastest)

```bash
node "<skill>/scripts/rooster.mjs" hyperframes catalog --tag three-js --json
node "<skill>/scripts/rooster.mjs" hyperframes add <name> --project <slug> --json
```

Then reference it from the plan:

```json
{
  "id": "el-3d",
  "type": "scene",
  "template": "block",
  "block": "<name>",
  "start": 4,
  "end": 9
}
```

A missing block stops the build with the exact command; `--allow-download` fetches it once into `style/blocks/<name>/`. Official blocks import Three.js from a CDN, so the **first** build needs network or a warm browser cache. Keep the block in the project; `build --force` does not delete it.

### 2. Local scene (no registry, no network)

Copy a block into `style/blocks/<name>/compositions/<name>.html` and edit it. A local block is a normal HyperFrames composition: it must register a paused timeline and use `data-start`/`data-duration`.

If the scene is one element of a larger composition, use a `custom` element with HTML/CSS/JS instead of inventing an element type.

## Render contract

- Drive the scene from the GSAP timeline, not from real time. Use a paused `THREE.Clock`; set the time from the timeline tick.
- No `requestAnimationFrame`, `Date.now()`, or unseeded `Math.random()`. A render must be reproducible frame by frame.
- Keep geometry low-poly and lights simple. Add shadows only when the scene is the point.
- Cap the pixel ratio: `renderer.setPixelRatio(1)` for deterministic output.
- Dispose geometries, materials, and textures when the scene unmounts.
- Do not load assets from the network at render time; put textures and models in `assets/` and use relative paths.

## GPU and performance

`doctor --json` reports the GPU and the hardware encoders. HyperFrames accepts `--gpu`; the CLI enables it automatically when a GPU is detected and retries on the CPU if the GPU render fails.

- A 3D scene is heavier than HTML; render a short sample first (`build --sample 3`).
- Reduce the frame rate for a draft, not the resolution of the final.
- A blank or tiny object in a snapshot usually means a mount or camera defect, not a bad model.
- If the scene renders on one machine and not another, check WebGL/ANGLE and the browser version before changing the scene.

## QA

- Snapshot the first, middle, and last frame of every 3D scene.
- Check that the object is inside the title-safe area at its largest.
- Check the background: a dark scene on a dark profile can swallow the object.
- Confirm the scene starts and ends on a stable frame; no pop from the previous shot.
- Confirm the clip has the expected duration after the build.

## Pitfalls

- Mixing CSS transforms and GSAP transforms on the same element.
- Tweening `display` or `visibility` on a `.clip`; animate a child instead.
- Treating the CDN import as offline-safe. It is not, on the first run.
- Using Three.js for a static logo that CSS could draw in one line.
