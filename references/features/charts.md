# Charts: real data graphics

`scripts/features/charts.mjs` renders `grafico` elements as real SVG charts instead of placeholder cards. It is pure and dependency-free: input is a plan element and a theme, output is a self-contained string or a validation result. It never imports `rooster.mjs`, opens files, or fetches anything.

## Plan shape

```json
{
  "id": "el-002",
  "type": "grafico",
  "start": 32.0,
  "end": 38.0,
  "text": "Receita por trimestre",
  "description": "Bars build left to right while the speaker explains growth",
  "chart": {
    "kind": "bar",
    "values": [120, 80, 95, 140],
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "unit": "R$",
    "title": "Receita por trimestre"
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `bar`, `line`, or `pie`. |
| `values` | yes | Array of finite numbers. Bar and line allow negatives; pie requires non-negative values that add up to more than zero. |
| `labels` | recommended | One label per value. Missing labels use `1`, `2`, `3` in the render and produce a validation warning. |
| `unit` | no | Unit label shown in the top-right badge and appended to values on short series. Common currencies (`$`, `€`, `£`, `¥`, `₹`, `R$`, `US$`) are prefixed; `%` attaches without a space. |
| `title` | recommended | Chart title. Falls back to the element's `text` field. |

`start`, `end`, `type`, and `description` still follow the plan rules. The chart is static SVG; animate the wrapper in the engine if the chart should build in.

## API

```js
import { renderChartSvg, chartSummary, validateChart } from "./features/charts.mjs";
```

### `renderChartSvg(element, theme)`

Returns one self-contained SVG:

- fixed `1200x600` viewBox with `width` and `height` attributes;
- background, foreground, muted text, and series colors from `theme` (`bg`, `fg`, `muted`, `accent`, `accent2`); additional series colors come from a small fallback palette;
- title, labels, values, gridlines, and a zero baseline where relevant;
- `role="img"`, an `aria-label` that describes the chart and its values, and a `<title>` child;
- all plan text XML-escaped;
- no external fonts, images, scripts, or CSS.

`theme` is normally the object returned by `themeFromProfile(profile)`. Missing fields fall back to the dark defaults.

### `chartSummary(element)`

Returns one plain-text line for `plan.md`, `plan.html`, or the CLI. It is not HTML-escaped, so escape it at the HTML boundary.

```text
Bar chart "Receita por trimestre" — 4 values: Q1: R$ 120, Q2: R$ 80, Q3: R$ 95, Q4: R$ 140
```

### `validateChart(element)`

Returns `{ errors, warnings, ok }`, the same shape as `validatePlan`. Key checks:

- element type is `grafico` and `chart` is an object;
- `kind` is one of `bar`, `line`, `pie`;
- `values` is a non-empty array of finite numbers;
- labels are strings or numbers and match the value count;
- `unit` and `title` are strings when present;
- pie values must be non-negative with a positive total (errors); more than 8 slices or zero-value slices produce warnings;
- bar/line warn above 24 points or when every value is zero;
- a missing title or label list produces a warning.

## Build integration

Current `build` integration:

- **HyperFrames:** `renderHyperFramesElement` now receives `theme` and renders `renderChartSvg(element, theme)` inside a `.chart` wrapper with `data-layout-allow-overlap` and `data-layout-ignore`.
- **Remotion:** `buildRemotion` precomputes `chartSvg` into `src/data/plan.ts`; the generated `Element` uses `dangerouslySetInnerHTML`.

The reference below shows the same pattern if you are editing the adapters manually.

### HyperFrames

Render the SVG inside an absolutely positioned wrapper. `renderHyperFramesElement` receives `theme`; pass it to `renderChartSvg`.

```js
case "grafico":
  if (element.chart) {
    return `<div ${common("chart")}>${renderChartSvg(element, theme)}</div>`;
  }
  // fall back to the existing card
```

```css
.chart {
  position: absolute;
  left: 360px;
  top: 240px;
  width: 1200px;
  height: 600px;
}
.chart svg { width: 100%; height: 100%; display: block; }
```

Those coordinates center a `1200x600` chart in a `1920x1080` frame. Recompute them for other formats, or use a full-frame `inset` wrapper for a chart-led scene.

### Remotion

Either write the SVG to `public/charts/<id>.svg` during the build and use `<Img src={staticFile(...)} />`, or precompute the string in `renderRemotionTsx`, inline it into `src/data/plan.ts`, and render it with `dangerouslySetInnerHTML` on an absolutely positioned wrapper. The output is escaped by the renderer; still treat it as build-generated content, not something to accept from a live editor.

```jsx
// chartSvg is generated at build time by renderChartSvg(element, theme).
<div
  style={{ position: "absolute", left: 360, top: 240, width: 1200, height: 600 }}
  dangerouslySetInnerHTML={{ __html: chartSvg }}
/>
```

Do not import `charts.mjs` into the browser bundle just to render on every frame. The SVG is static; generate it once per build.

### Validation and summaries

In the `validatePlan` element loop:

```js
if (element.type === "grafico" && element.chart) {
  const result = validateChart(element);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}
```

In `printPlanSummary` and `planMarkdown`, replace the generic `grafico` line with `chartSummary(element)` when `element.chart` exists.

## QA

- Check every number against the source. Do not invent or round values silently; state the source and period.
- Read the chart at delivery size. Axis labels truncate with an ellipsis and expose the full label in an SVG `<title>` tooltip, but a 24-point chart is still crowded.
- Confirm the unit is visible in the badge, correctly prefixed or suffixed, and not repeated in a way that crowds dense charts.
- Check bar and line charts with negative values; the zero baseline must be visible.
- Check pie charts: slices must add to a meaningful total, zero-value slices are omitted, and small slices are still in the legend.
- Check contrast against the actual footage or background. `theme.bg` is drawn behind the chart, so an overlay chart is a card, not transparent text.
- Verify the `aria-label` names the chart and includes values, not just the title.
- Search the generated SVG for `NaN`, `undefined`, and `[object Object]`.

## Limitations

- Static SVG only. Bar growth, line draw-on, and pie reveals need a wrapper animation in HyperFrames or Remotion.
- One series per chart. Grouped bars, stacked bars, multi-line comparisons, dual axes, log scales, and smoothed curves are out of scope.
- Layout is fixed at `1200x600`. It scales cleanly, but very long labels truncate and very dense data needs a different visual.
- No locale-aware number formatting; the renderer groups thousands with commas and uses a dot decimal separator.
- `unit` is a single suffix or a common currency prefix. There is no per-point formatting, compact notation, or `%` scaling.
- Pie charts require non-negative values; bar and line charts allow negatives.
- `chartSummary` is plain text and can be long for many values; it shows at most 8 items before an ellipsis.
- The module does not change `rooster.mjs`; the render and validation functions must call it.
