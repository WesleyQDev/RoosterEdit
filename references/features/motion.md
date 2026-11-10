# Motion: real zooms and transitions

`scripts/features/motion.mjs` turns the `zoom` and `transition` element types into real motion. It is pure and dependency-free: helpers return CSS, HTML, GSAP, or interpolation values, and never write files or import `rooster.mjs`. Wire them into `renderHyperFramesHtml`, `renderHyperFramesElement`, or `renderRemotionTsx` after the module is reviewed.

## See what is planned

`plan.html` and `plan.md` include a **Motions** section: each resolved template, how many elements use it, the timecodes, a sample, and a small visual preview. The elements table also has a `Motion` column. This is the fastest way to review the motion language before the build.

To list it from the CLI:

```bash
node "<skill>/scripts/rooster.mjs" motions <slug>
node "<skill>/scripts/rooster.mjs" motions <slug> --json
```

It shows:

- **Planned motions** grouped by resolved template (`title`, `chapter`, `diagram`, `counter`, `list`, `lower-third`, `emphasis`, `terminal`, `end-card`, `callout`, `broll`, `parallax`, `zoom`, `transition`, `custom`);
- **Reusable components** found under `style/components/` (project, channel, or profile scope), with their paths;
- the **built-in template catalog**, including what each one does.

`custom` means the element references a reusable component folder with `element.html`, `element.css`, and `element.js`. If the plan says `custom` but the components list is empty, the plan is pointing at a motion that does not exist yet.

## Plan shapes

### Zoom

```json
{
  "id": "el-003",
  "type": "zoom",
  "start": 52.0,
  "end": 55.0,
  "scale": 1.18,
  "originX": 0.5,
  "originY": 0.4,
  "description": "Slow punch-in on the speaker at the key insight"
}
```

| Field | Required | Meaning |
|---|---|---|
| `start`, `end` | yes | Seconds. The zoom ramps in at `start`, holds, and returns to `1` by `end`. |
| `scale` | no | Target scale, default `1.12`. Clamped to `0.5–4`; values below `1` zoom out. |
| `originX`, `originY` | no | Transform origin as `0–1` fractions of the target. Default `0.5, 0.5`. |
| `release` | no | Default `true`. Set `false` to hold the scale at `end` instead of returning to `1`. |
| `rampIn`, `rampOut` | no | Seconds for the in/out ramp. Defaults are capped at half the element duration. |
| `ease`, `easeOut` | no | GSAP ease names. Defaults: `power2.out` and `power2.inOut`. |

### Transition

```json
{
  "id": "el-004",
  "type": "transition",
  "start": 12.1,
  "end": 12.7,
  "kind": "dip",
  "direction": "left",
  "description": "Dip to black over the chapter cut"
}
```

| Field | Required | Meaning |
|---|---|---|
| `start`, `end` | yes | Seconds. The cut belongs at the midpoint (`start + (end - start) / 2`). |
| `kind` | yes | `fade`, `dip`, or `slide`. |
| `direction` | slide only | Direction of travel: `left`, `right`, `up`, or `down`. `left` enters from the right. |
| `color` | no | Overlay color. `dip` defaults to black; `fade` and `slide` default to `theme.bg`. |
| `opacity` | no | Peak opacity for `fade`/`dip`. Default `0.8` for fade and `1` for dip. |
| `easeIn`, `easeOut` | no | GSAP ease names for the two halves. Slide defaults to `power2.inOut` on both. |

`fade` is a soft fade through a color. `dip` goes fully to a solid color, usually black. `slide` is a solid panel that enters from one edge, covers the cut, and leaves through the opposite edge. It is not a push of the footage.

## API

| Export | Returns |
|---|---|
| `normalizeZoom(element, options)` | Normalized times, scale, origin, ramp, and input/output ranges. |
| `normalizeTransition(element, options)` | Normalized times, kind, direction, color, midpoint, and peak opacity. |
| `hyperframesZoom(element, selector, options)` | `{ selector, css, tween, values }`. |
| `hyperframesTransition(element, theme, options)` | `{ id, selector, html, css, tween, values }`. |
| `hyperframesZoomCss`, `hyperframesZoomTween` | The individual CSS or GSAP string. |
| `hyperframesTransitionHtml`, `hyperframesTransitionCss`, `hyperframesTransitionTween` | The individual HTML, CSS, or GSAP string. |
| `remotionZoomValues`, `remotionTransitionValues` | Frame ranges, output ranges, and `styleAt(frame)`. |
| `remotionZoomSnippet`, `remotionTransitionSnippet` | Copy-paste Remotion statements. |

## HyperFrames

```js
import {
  hyperframesZoom,
  hyperframesTransition,
} from "./features/motion.mjs";

// Zoom: target a dedicated wrapper, not the base ken-burns element.
const zoom = hyperframesZoom(zoomElement, "#zoom-layer");
// Append zoom.css to the page <style>.
// Append zoom.tween to the GSAP timeline.

// Transition: markup, CSS, and tween in one bundle.
const transition = hyperframesTransition(transitionElement, theme);
// The default id is "rooster-transition-<element id>".
// Insert transition.html with the other elements.
// Append transition.css to <style> and transition.tween to the timeline.
```

The GSAP snippets expect a paused timeline named `tl`. Pass `{ timeline: "master" }` if the integration uses another name. The helpers do not assume an element id beyond the selector argument.

Wrap the base media in a zoom layer when the existing base tween already animates `scale`. Two GSAP tweens writing `scale` to the same element will fight, and the last one wins. If a wrapper is not possible, pass `#base` and disable the base scale tween while a zoom is active.

## Remotion

```js
import {
  remotionZoomValues,
  remotionTransitionValues,
} from "./features/motion.mjs";

const z = remotionZoomValues(zoomElement, fps);
const scale = interpolate(frame, z.inputRange, z.outputRange, {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
// <div style={{ transform: `scale(${scale})`, transformOrigin: z.transformOrigin }}>

const t = remotionTransitionValues(transitionElement, fps, { theme });
const opacity = interpolate(frame, t.inputRange, t.outputRange, {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
// <div style={{ position: "absolute", inset: 0, background: t.color, opacity, pointerEvents: "none" }} />
```

`remotionZoomSnippet(element, { fps })` and `remotionTransitionSnippet(element, { fps, theme })` return copy-paste statements when editing the generated TSX by hand. `styleAt(frame)` on either values object returns the same style inline, which is easier to use inside a mapped element component.

## Custom elements: freedom with a contract

`template: "custom"` is the escape hatch. The agent may write any HTML/CSS/GSAP
the HyperFrames renderer can execute; the catalog does not cap it. These checks
do not judge the design. They only catch code that cannot render, before an
expensive build.

Rules:

- Animate the shared `tl`. Do not call `gsap.timeline()`; a private timeline is
  not seeked by the composition.
- The script receives `root`, `start`, `duration`, and `tl`.
- No `import`, `require`, `fetch`, `XMLHttpRequest`, or `Worker`. The
  composition is offline and self-contained.
- Put code in `element.js`/`animation`, not in a `<script>` inside the HTML.
- Use `root.querySelector(...)`, not global selectors.
- Local assets only. Remote CSS, fonts, and images are not copied.
- Keep inline HTML/CSS/animation small. A reusable look belongs in
  `style/components/<name>/`.
- Remotion cannot execute custom HTML/JS. Use HyperFrames for a custom element,
  or a Remotion component when Remotion is the engine.

`plan <slug> --check` reports a private timeline, imports/fetch, oversized
inline code, and missing `tl` usage. Fix those before `build`.

Token-cheap loop:

1. Write the smallest version that shows the idea.
2. Run `plan <slug> --check` and fix the reported errors.
3. Build a sample and render three stills at the element's in, hold, and out.
4. Read the stills, change one thing, re-render.
5. When it works, save it as a component. The next video does not pay again.

```json
{
  "id": "el-020",
  "type": "custom",
  "template": "custom",
  "start": 120.0,
  "end": 124.0,
  "html": "<div class=\"glow\"><span class=\"ring\"></span><strong>novo</strong></div>",
  "css": ".glow { position:absolute; inset:0; display:grid; place-items:center; } .ring { width:180px; height:180px; border:6px solid var(--accent); border-radius:50%; position:absolute; }",
  "animation": "tl.fromTo(root.querySelector('.ring'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(1.7)' }, start + 0.1);",
  "description": "One-off glow; save as a component if it fits the channel"
}
```

## Cut smoothing

The cut pass is separate from the plan's `zoom`/`transition` elements. It makes silence cuts feel less dry without extra footage:

- **Audio micro-fade**: 35 ms in/out at every join. It removes clicks and softens hard consonants. `--cut-fade 0` disables it.
- **Punch-in**: an uncovered silence cut toggles a 3.5% scale (center crop) on the following clip, so consecutive shots read as wide/tight instead of a hard jump. A b-roll or transition that overlaps the join suppresses the punch. `--cut-punch 1` disables it; `--cut-punch 1.06` makes it stronger.
- **Coverage report**: `plan --check` lists long jumps with no visual cover. Add a `broll` with `layout: "pip"` or `"split"`, or a `transition`, at the join.

FilmCraft limitation: FilmCraft does not animate the base clip's scale, so `zoom` and overlay `transition` elements are not rendered by the FilmCraft target. `build` now fails with a clear message unless you pass `--allow-skipped-elements`. Use HyperFrames or Remotion when the plan needs real zooms/transitions, or replace them with `punch-in` coverage.

## Build integration

`build` now reads `zoom` and `transition` elements from `edit/plan.json`:

- HyperFrames gets the transition overlay HTML/CSS and the GSAP zoom/transition tweens; a base scale tween is disabled while a zoom is active.
- Remotion gets `motion.inputRange` / `motion.outputRange` data in `src/data/plan.ts`; the generated component applies the zoom to the base wrapper and renders the transition overlay.

Preview both engines at delivery resolution. The generated code is deterministic, but the plan still owns timing and placement.

## Timing rules

- Put the cut at the transition midpoint. A 0.6 s transition starts 0.3 s before the cut and ends 0.3 s after it.
- Keep transitions between about 0.25 s and 0.8 s. Longer is a scene device, not a cut.
- A zoom should reach its target quickly (0.4–0.6 s), hold through the insight, and release before the next visual beat.
- Do not overlap two zooms on the same selector. Do not stack a transition over another full-screen transition.
- Remotion frame ranges come from seconds and are clamped to whole frames. Very short effects below one frame collapse to one frame per step.

## QA

- Scrub the whole effect: no snap at `start`, no snap at the release, and no scale left applied afterward.
- Check the origin keeps the face or action inside frame, especially after reframing to `9:16`.
- Confirm the transition midpoint matches the cut; a frame of the old shot under a fade means the cut and the overlay are misaligned.
- Confirm the transition is fully off-screen or transparent after `end`; a lingering overlay is a full-screen color wash.
- Check at delivery resolution, not only in the preview pane.
- Watch for competing motion: base scale, zoom, and a slide overlay should not fight.

## Limitations

- Zoom is a 2D scale on one target. It is not a 3D camera, parallax, or depth effect.
- Transitions are overlays. There is no true cross-dissolve between two clips, no push of the footage, and no per-pixel wipe. Use FFmpeg `xfade` or an engine transition when the edit needs those.
- `slide` moves a solid panel, not the incoming shot.
- `release: false` leaves the target scaled. Reset it with a later tween, a cut, or a `scale: 1` statement.
- The helpers do not edit `rooster.mjs`; the render functions must import and call them.
- Selectors are trusted strings. Do not build a selector from untrusted plan text.
