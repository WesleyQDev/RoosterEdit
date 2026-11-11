# Edit plan

The edit plan is the bridge between the transcript analysis and the build. It is the artifact the user approves before any engine project is created. It lives at `channels/<channel>/projects/<slug>/edit/plan.json`.

## Schema

```json
{
  "schema": "rooster.plan/v1",
  "source": "assets/source/video.mp4",
  "style": "style.md",
  "language": "en-US",
  "duration": 612.4,
  "summary": "Interview about starting a business after losing a job.",
  "music": {
    "src": "assets/licensed/music/theme.mp3",
    "gainDb": -18,
    "license": "licensed",
    "attribution": "Track name - Artist"
  },
  "cuts": [
    {
      "id": "cut-001",
      "start": 12.4,
      "end": 18.2,
      "reason": "long-pause",
      "confidence": 0.9
    },
    {
      "id": "cut-002",
      "start": 41.0,
      "end": 46.5,
      "reason": "retake",
      "note": "The next take is stronger",
      "confidence": 0.95
    }
  ],
  "keeps": [
    {
      "id": "keep-001",
      "start": 18.2,
      "end": 41.0,
      "reason": "strongest explanation of the problem"
    }
  ],
  "protect": [
    {
      "start": 88.0,
      "end": 91.5,
      "reason": "laugh"
    }
  ],
  "elements": [
    {
      "id": "el-001",
      "type": "letreiro",
      "start": 3.0,
      "end": 6.0,
      "text": "A virada",
      "description": "Title card with the video's core promise",
      "style": "bold uppercase, accent color"
    },
    {
      "id": "el-002",
      "type": "grafico",
      "start": 32.0,
      "end": 38.0,
      "text": "3 decisions",
      "description": "Three-step diagram appears one item at a time"
    },
    {
      "id": "el-003",
      "type": "zoom",
      "start": 52.0,
      "end": 55.0,
      "description": "Slow punch-in on the speaker's face at the key insight"
    },
    {
      "id": "el-004",
      "type": "broll",
      "start": 58.0,
      "end": 64.0,
      "src": "assets/source/broll-office.mp4",
      "description": "Office b-roll over the line about the first client"
    }
  ],
  "chapters": [
    { "start": 0, "title": "Introduction" },
    { "start": 45, "title": "O problema" }
  ],
  "notes": [
    "Keep the original audio; no music under the first 5 seconds."
  ]
}
```

## Edit mode

Set `editMode` at the top of the plan:

| Value | Use | Model |
|---|---|---|
| `cleanup` (default) | Keep the full story; remove silence, filler, false starts, and abandoned retakes. | `cuts` |
| `condensed` | Highlight or short version; select the best spans. Requires explicit user approval. | `keeps` |
| `manual` | The user supplied an EDL; do not add cuts. | either |

Do not mix `cuts` and `keeps` in one plan. `plan --check` rejects `keeps` without `editMode: "condensed"` and warns when cleanup removes more than 25% of the source.

## Cut reasons

Use consistent values so the plan can be reviewed and automated:

| Reason | Meaning |
|---|---|
| `long-pause` | Silence longer than the threshold |
| `repetition` | The same idea is said again |
| `false-start` | The speaker restarts the sentence |
| `retake` | A later take is better |
| `filler` | "um", "uh", "like", "you know" |
| `mistake` | Factual error or slip |
| `off-topic` | Does not serve the story |
| `manual` | User requested a cut |

A cut is a removal from the source. Cleanup uses `cuts`. A condensed edit uses `keeps`. Do not mix the two models in the same plan; pick one and state it in `editMode`.

## Element types

| Type | Use |
|---|---|
| `letreiro` | Title, key phrase, chapter card |
| `grafico` | Chart, diagram, comparison, number |
| `lista` | Steps, checklist, ranking |
| `zoom` | Punch-in, emphasis, reaction |
| `broll` | Footage or image over the voice |
| `lower-third` | Name, role, location |
| `caption-emphasis` | Highlight a word or phrase |
| `transition` | Wipe, slide, fade between ideas |
| `end-card` | CTA, subscribe, next video |
| `custom` | Agent-authored HTML/CSS/GSAP or a reusable component |

Each element needs `start`, `end`, and `description`. `text` is optional but encouraged for anything with words.

## Time base

`cuts` and `keeps` are **source** times. `elements` and `chapters` are **source** times too, because the build remaps them through the cuts. The `plan` command writes both values to `plan.md` and `plan.html`: the raw time and the final time after the cuts. Approve the final time; the raw time is only for finding the moment in the source.

## Structured templates

Do not rely on the generic card fallback. Pick a template and give it the data it needs. The renderer draws real motion for these; `description` is a production note and is never placed on screen.

| `template` | Use | `data` |
|---|---|---|
| `chapter` | Section card | `{ kicker, sub }` |
| `title` | Opening or key promise | `{ sub }` |
| `diagram` | Process, flow, comparison | `{ nodes: string[], caption, kicker }` |
| `counter` | Numbers, before/after, time saved | `{ rows: [{ value, label }], kicker }` |
| `list` | Steps, features, recap | `{ items: string[], title }` |
| `lower-third` | Name and role | `{ name, role }` |
| `emphasis` | Highlight or correction | `{ text, strike, tag }` |
| `callout` | Short corner label | `{ label, sub, icon }` |
| `terminal` | Command, file, technical detail | `{ command, note }` |
| `end-card` | CTA | `{ title, sub }` |
| `parallax` | A still or graphic built in layers, moved by a slow 2.5D camera | `{ kicker, sub, layers: [...], camera: { x, y, zoom } }` |
| `custom` | Agent-authored HTML/CSS/GSAP | inline `html`, `css`, `animation`, or a `component` |

Use `role: "chapter"` on a `letreiro` when it is a section card. Chapter cards are exempt from transcript grounding.

`position` is optional: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `center`, `center-left`. The default keeps the face visible.

`text` must be short, on-screen copy. Put the explanation in `description`, never in `text`.

## Custom components

The agent can author a motion graphic that is not in the built-in vocabulary. Use `template: "custom"` and either inline fields or a reusable component.

Inline, for a one-off:

```json
{
  "id": "el-020",
  "type": "custom",
  "template": "custom",
  "start": 120.0,
  "end": 124.0,
  "html": "<div class=\"glow\"><span class=\"ring\"></span><strong>novo</strong></div>",
  "css": ".glow { position:absolute; inset:0; display:grid; place-items:center; } .ring { width:180px; height:180px; border:6px solid #8b5cf6; border-radius:50%; position:absolute; }",
  "animation": "tl.fromTo(root.querySelector('.ring'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(1.7)' }, start + 0.1);"
}
```

Reusable, for the channel's visual language:

```json
{
  "id": "el-021",
  "type": "custom",
  "template": "custom",
  "component": "chapter-glow",
  "start": 240.0,
  "end": 244.0
}
```

The build looks for `chapter-glow` in this order:

1. `<project>/style/components/chapter-glow/`
2. `<workspace>/channels/<channel>/style/components/chapter-glow/`
3. `<workspace>/channels/<channel>/profiles/<profile>/components/chapter-glow/`
4. `<workspace>/profiles/<profile>/components/chapter-glow/`
5. `~/.rooster/profiles/<profile>/components/chapter-glow/`
6. `<skill>/templates/profiles/<profile>/components/chapter-glow/`
7. `<skill>/templates/components/chapter-glow/`

A component folder contains:

- `element.html` (or `index.html`) — the markup.
- `element.css` (or `style.css`) — optional CSS, injected once.
- `element.js` (or `animation.js` / `index.js`) — optional GSAP statements.

The animation runs inside the composition timeline with these variables:

- `root` — the wrapper element (`#el-<index>`).
- `start` — the element start in the final timeline, in seconds.
- `duration` — the element duration, in seconds.
- `tl` — the paused GSAP timeline that HyperFrames seeks.

Use `tl.fromTo(root.querySelector(...), ...)` and `start + 0.1`. Do not create a separate timeline; HyperFrames will not seek it. Put scripts in `element.js`/`animation`, not inline in `element.html`.

Custom elements are trusted local HTML/CSS/JS. They are supported by HyperFrames (including the FilmCraft element path), not by Remotion. FilmCraft + Remotion fails with a clear message. Custom components should use inline SVG/CSS; for media, use a `broll` element so the asset pipeline and license tracking still apply.

The first time the agent invents a look that works, save it as a component. The next video can reuse it, and the channel's visual language accumulates instead of starting from zero.

## Parallax scenes

`template: "parallax"` is a full-frame scene built in layers: background,
subject, foreground. A slow camera moves each layer at a different speed, so a
still or a flat graphic reads as a 2.5D space instead of a card. This is the
look of historical documentaries and product explainers. Use it when the line
describes a concept, a product, or a place; not for every beat.

```json
{
  "id": "el-010",
  "type": "parallax",
  "template": "parallax",
  "start": 32.0,
  "end": 38.0,
  "text": "3,6 GB",
  "covers": "os cinco rodam em 3,6 GB",
  "data": {
    "kicker": "o conjunto",
    "sub": "no GPU",
    "layers": [
      { "src": "assets/generated/scene-bg.png", "depth": 0.15 },
      { "src": "assets/generated/scene-icon.png", "depth": 0.55, "x": 8, "y": 10, "w": 44, "h": 60 },
      { "text": "3,6 GB", "depth": 0.9, "x": 62, "y": 18, "w": 30, "h": 24, "size": 120 }
    ],
    "camera": { "x": 30, "y": -12, "zoom": 0.07 }
  },
  "description": "Layered scene: background, icon, and number in 2.5D parallax"
}
```

- `depth` is 0-1: 0 is far and almost still, 1 is near and moves the most.
- A layer is an image/video (`src`), text (`text`), or a shape (`shape`).
  Text and shape layers need no asset file.
- `x`, `y`, `w`, `h` are percentages of the frame. Media layers default to
  `-6/-6/112/112`, so the camera never reveals an edge.
- `camera.x` and `camera.y` are the total pan in pixels; `camera.zoom` is the
  extra scale (`0.06` = 6%).
- Layers are capped at six. More layers read as a pile, not depth.
- The scene is full-frame and sits under other elements: lower-thirds,
  captions, and callouts can overlay it. Do not run two full-frame scenes at
  the same time.
- HyperFrames animates the camera; Remotion renders a static version with the
  same copy. Use HyperFrames when the movement matters.
- A `parallax` element needs at least one layer, or `src`/`data.bg` for the
  background. Put the explanation in `description`; on-screen words go in
  `text`.
- Reuse a layer composition across a chapter by saving it as a `custom`
  component once the first pass works.

## B-roll layout

`broll` accepts `layout`:

- `pip` — the b-roll sits in a large rounded card in the top-right; the speaker stays visible. This is the default and the right choice for talking-head footage.
- `split` — the b-roll takes the top 58% and leaves the lower part of the frame visible. Use it when the screen recording needs more width.
- `full` — only when the b-roll is the subject and the face does not need to stay on screen.

Every b-roll needs:

- `covers` — the exact line it is illustrating;
- `intent` — `evidence` (the actual UI or action is the proof), `texture` (visual variation), or `transition` (covers a cut);
- `sourceTime` — where in the raw the clip was extracted, in source seconds.

`plan --check` compares `sourceTime` with the placement. If the clip comes from a later scene (more than 30 s ahead) and it is not marked `evidence`, it warns: use a custom motion graphic or a same-context clip. Even an `evidence` clip gets a spoiler warning; the editor must confirm it does not reveal a demo that happens later.

B-roll is not a substitute for a designed beat. If the line is conceptual (an idea, a comparison, a promise), prefer a `diagram`, `counter`, `emphasis`, or `custom` element. Use b-roll when the real footage is the evidence.

## Visual rhythm

A cut-only plan is not a finished video. Before showing the plan, check:

- at least one visual beat every 20–40 seconds;
- no stretch longer than 45 seconds without a letreiro, graphic, list, b-roll, lower-third, or end card;
- alternate templates: a diagram, a counter, a list, a b-roll, an emphasis, a callout;
- a chapter card does not replace the need for beats inside the chapter;
- every long silence jump (6 s or more) has a PIP/split b-roll, a transition, or a deliberate punch-in;
- captions and graphics quote or paraphrase the line that is being spoken, and use `covers` when the connection is not obvious.

`plan <slug> --check` reports density gaps, unsupported element types, orphan cuts, ungrounded text, and b-roll without `covers`. `qa/plan-review.md` lists all of them. Fix the top warnings before building; use `build --strict-plan` when the plan should be clean.

## Cut smoothing

The build softens the cut pass automatically:

- a 35 ms audio micro-fade at every join (no clicks, no hard consonant cut);
- a small punch-in on uncovered silence cuts, alternating wide/tight so the eye reads two camera angles;
- `--cut-punch <scale>` changes the punch (default `1.035`; `1` disables it);
- `--cut-fade <seconds>` changes the audio fade (default `0.035`; `0` disables it).

Cuts proposed by `tighten` already leave 0.4 s of room tone and 100 ms before
the next line, so the smoothing pass is a safety net, not the rhythm.

Covered cuts (a b-roll or transition overlaps the join) are not punched. `plan --check` lists the long jumps that still have no visual cover, the orphan reactions, and keeps shorter than 0.8 seconds that will read as a flash.

## Advanced fields

| Field | Use | Reference |
|---|---|---|
| `music` | Music bed, ducking, gain, license | `features/audio.md` |
| `sfx` | Sound effects at timeline positions | `features/audio.md` |
| `color` | LUT, EQ, temperature, denoise, stabilize | `features/color.md` |
| `multicam` | Camera list and camera cuts | `features/multicam.md` |
| `zoom` / `transition` | Scale moves and overlay transitions | `features/motion.md` |
| `chart` on `grafico`/`lista` | Bar, line, or pie data visualization | `features/charts.md` |

## Creative minimum

A cut-only plan is incomplete unless the user explicitly asked for a clean cut. Before showing the plan, check:

- at least one visual element (letreiro, lower-third, graphic, list, zoom, b-roll, or end card);
- no stretch longer than 45 seconds without a beat (see **Visual rhythm** above);
- music, or a `notes` entry explaining why there is none;
- captions or on-screen text for key lines, or a `notes` entry explaining why there are none.

If one of these is missing, add it or ask the user. Do not present "no overlays, no music, no captions" as a finished creative draft.

Captions are not generated automatically by `build` in this version. If the video needs full captions, add a caption pass or `caption-emphasis` elements; do not claim captions in the delivery unless they are present in the draft.

`music` is optional but explicit:

```json
{
  "music": {
    "src": "assets/licensed/music/theme.mp3",
    "start": 0,
    "end": 60,
    "gainDb": -18,
    "license": "licensed",
    "attribution": "Track name - Artist"
  }
}
```

`src` is relative to the project. `gainDb` defaults to `-18`. The build mixes the track under the voice and fades it in/out.

## Heuristics

### Cuts

Cleanup is the default. Do not turn a long recording into a highlight unless the user explicitly asked for a shorter version and the plan says `editMode: "condensed"`.

- Remove pauses longer than 0.7–1.0 s, unless the pause is dramatic.
- Remove repeated takes; keep the last or strongest one.
- Remove false starts and self-corrections when they do not add personality.
- Remove filler words, but do not make the speaker sound unnatural.
- Keep breaths and reactions that carry emotion.
- Do not cut every pause; rhythm needs air.

### Tighten (default)

`tighten` is the default cleanup pass. It reads the audio instead of guessing
from the transcript, and it keeps the pause natural instead of deleting it:

```bash
node "<skill>/scripts/rooster.mjs" tighten <slug> --json
node "<skill>/scripts/rooster.mjs" tighten <slug> --write
```

One standard, no presets. The numbers are the editorial default:

| Rule | Default | Why |
|---|---|---|
| Shortest pause considered | 0.8 s | Shorter gaps are not worth a jump cut |
| Beat kept after the line | 0.4 s | The cut keeps real room tone, not digital silence |
| Lead-in before the next line | 0.1 s | Never clip the incoming consonant |
| Shortest cut | 0.35 s | A 0.1 s cut costs more than it saves |
| Silence threshold | -35 dB | Quiet room, not a noise gate |
| Audio silence minimum | 0.4 s | Ignore breaths and clicks |

The command runs FFmpeg `silencedetect`, snaps each boundary to the word
timestamps when they exist, subtracts `plan.protect`, and proposes `cuts` with
`reason: "long-pause"`. Leading and trailing dead air are removed entirely.
When the audio cannot be analyzed, it falls back to transcript gaps and says so.

Flags exist for edge cases, not as styles: `--min`, `--beat`, `--lead`,
`--min-cut`, `--noise`, `--audio-min`, `--no-audio`, and `--protect 12-18,1:02-1:05`.

- `--fillers` also cuts standalone filler words (`um`, `uh`, `hmm`…). A word is
  only removed when at least one side has a small gap, so the neighbour is
  never clipped. "mm hmm" as agreement stays.
- `--retakes` also cuts a short segment that is itself a retake cue ("deixa eu
  repetir"). Repeated takes are only **listed** in the JSON as
  `possibleRetakes`; the agent or the user decides which take stays.
- `--write` merges the new cuts into `edit/plan.json`, sets
  `editMode: "cleanup"`, and leaves non-silence cuts alone. `--replace`
  discards the existing cuts first; `--force` is required if the plan uses
  `keeps`.

### Protect

`plan.protect` is a list of source spans that must never be cut: a laugh, a
dramatic pause, an interview answer, a line the user asked to keep. `tighten`
subtracts them from every candidate cut, and `plan --check` warns when a cut
overlaps one.

```json
"protect": [
  { "start": 88.0, "end": 91.5, "reason": "laugh" },
  { "start": 210.0, "end": 216.0, "reason": "the answer the client asked to keep" }
]
```

### Silence (legacy)

`silence` still works and is the fallback when the audio cannot be analyzed.
It proposes cuts from transcript segment gaps only:

```bash
node "<skill>/scripts/rooster.mjs" silence <slug> --json
node "<skill>/scripts/rooster.mjs" silence <slug> --min 0.8 --pad 0.1
node "<skill>/scripts/rooster.mjs" silence <slug> --write
```

The default padding is 100 ms. It cannot see a pause inside a long segment, so
prefer `tighten` whenever FFmpeg can read the source.

### Elements

- Add a letreiro when the speaker introduces a new chapter or a key phrase.
- Add a graphic when the speaker cites a number, a comparison, or a process.
- Add a list when the speaker enumerates steps or items.
- Add a zoom when the speaker lands an insight or a punchline.
- Add b-roll when the speaker describes a concrete noun or action.
- Prefer `parallax` when the line describes a concrete scene, product, or place and there is a still or graphic to build on. It gives a flat image depth without a video; do not use it as a default background for every beat.
- Do not add an element to every sentence; the video becomes noise.
- Do not use a full-screen panel or card to hide a mismatched slide unless the user explicitly asks. Prefer small lower-thirds, corner labels, captions, and overlays. The video must remain visible.
- Match the element style to `style.md` and the resolved profile.

### Music

- Prefer `library/music/` or a track the user provided with a known license.
- If the user says the music is in a folder, search that folder and the project asset folders before declaring no music.
- Use `gainDb` around `-18` under voice; `-6` to `-12` for music-only.
- Use `start`/`end` to trim the track. The build loops and pads it to the video duration.
- If there is no track, add `notes: ["no music requested"]` and do not claim music in the delivery.
- Never use unlicensed music.

### Chapters

- Use the analysis to find natural topic changes.
- A chapter should start on a sentence boundary and make sense on its own.
- Keep chapters at least 20–30 seconds apart for long videos.

## Showing the plan

Before building, show a readable summary:

```md
# Edit plan

Source: assets/source/video.mp4 (10:12)
Style: style.md

## Cuts (12)
- 00:12–00:18 — long pause
- 00:41–00:46 — repeated take; the next one is better
...

## Elements (8)
- 00:03–00:06 — title card: "The Turn"
- 00:32–00:38 — chart: "3 decisions"
- 00:52–00:55 — zoom on the face
...

## Chapters
- 00:00 Introduction
- 00:45 The problem
...

Approve this plan? I will only build the timeline and visuals after your OK.
```

`node "<skill>/scripts/rooster.mjs" plan <slug>` writes the same summary to `edit/plan.md`, `edit/plan.html`, and `qa/plan-review.md`. If the harness can display a file or open a browser, show `edit/plan.html` in the review pane or browser. Otherwise, paste the summary in chat and give the file path. Ask for approval with the progress marker, for example: `Step 4/8 - Plan ready. Can I continue with the timeline?`

The HTML review includes a player, clickable timecodes, the transcript context for each cut and element, and a **Texts to review** table. The context is there so the user can approve a cut without opening the raw transcript.

Wait for an explicit approval. If the user changes the plan, update `edit/plan.json` and show it again. Run `textcheck <slug>` before the final approval to list every on-screen text.

## Validation

`node "<skill>/scripts/rooster.mjs" plan <slug> --check` should verify:

- `schema` is `rooster.plan/v1`;
- `source` exists;
- `style` exists;
- every cut has `start < end` and a `reason`;
- every element has `start < end`, `type`, and `description`;
- no element extends past the source duration;
- if `music` exists, `music.src` exists;
- the plan has at least one visual element unless `notes` records a clean-cut request;
- the plan has a music decision, or `notes` records that no music was requested;
- no duplicate ids;
- chapters are sorted by start time;
- every `protect` span has numeric `start < end`, and no cut overlaps one (warning);
- when `edit/transcript.json` has word-level timestamps, no cut starts or ends inside a word (warning).

The human-readable summary comes from `plan <slug>`; `--check` validates without printing the full summary.

## Mapping to the build

- Cuts -> applied by `build` with FFmpeg; element timings are remapped to the cut timeline.
- Elements -> generated as HyperFrames elements or Remotion components.
- Chapters -> markers and optional YouTube chapters.
- Style -> profile tokens or `style.md`.
- Approval -> the gate before `build`.

Run `build` only after the plan is approved:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

`build` refuses a cut-only plan or a plan with no music decision unless `notes` records the exception or you pass `--allow-cut-only` / `--allow-no-music` after the user explicitly asks for it.

Do not skip the plan. A bad plan costs minutes to fix; a bad render costs hours.
