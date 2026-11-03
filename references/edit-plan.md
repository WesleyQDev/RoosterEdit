# Edit plan

The edit plan is the bridge between the transcript and the build. It is the artifact the user approves before any engine project is created. It lives at `projects/<slug>/edit/plan.json`.

## Schema

```json
{
  "schema": "rooster.plan/v1",
  "source": "assets/source/video.mp4",
  "style": "style.md",
  "language": "pt-BR",
  "duration": 612.4,
  "summary": "Interview about starting a business after losing a job.",
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
      "text": "3 decisões",
      "description": "Three-step diagram appears one item at a time"
    },
    {
      "id": "el-003",
      "type": "zoom",
      "start": 52.0,
      "end": 55.0,
      "description": "Slow punch-in on the speaker's face at the key insight"
    }
  ],
  "chapters": [
    { "start": 0, "title": "Introdução" },
    { "start": 45, "title": "O problema" }
  ],
  "notes": [
    "Keep the original audio; no music under the first 5 seconds."
  ]
}
```

## Cut reasons

Use consistent values so the plan can be reviewed and automated:

| Reason | Meaning |
|---|---|
| `long-pause` | Silence longer than the threshold |
| `repetition` | The same idea is said again |
| `false-start` | The speaker restarts the sentence |
| `retake` | A later take is better |
| `filler` | "um", "é", "tipo", "you know" |
| `mistake` | Factual error or slip |
| `off-topic` | Does not serve the story |
| `manual` | User requested a cut |

A cut is a removal from the source. If the plan instead describes what to keep, use `keeps`. Do not mix the two models in the same plan; pick one and state it in `notes`.

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

Each element needs `start`, `end`, and `description`. `text` is optional but encouraged for anything with words.

## Heuristics

### Cuts

- Remove pauses longer than 0.7–1.0 s, unless the pause is dramatic.
- Remove repeated takes; keep the last or strongest one.
- Remove false starts and self-corrections when they do not add personality.
- Remove filler words, but do not make the speaker sound unnatural.
- Keep breaths and reactions that carry emotion.
- Do not cut every pause; rhythm needs air.

### Elements

- Add a letreiro when the speaker introduces a new chapter or a key phrase.
- Add a graphic when the speaker cites a number, a comparison, or a process.
- Add a list when the speaker enumerates steps or items.
- Add a zoom when the speaker lands an insight or a punchline.
- Add b-roll when the speaker describes a concrete noun or action.
- Do not add an element to every sentence; the video becomes noise.
- Match the element style to `style.md` and the resolved profile.

### Chapters

- Use the transcript to find natural topic changes.
- A chapter should start on a sentence boundary and make sense on its own.
- Keep chapters at least 20–30 seconds apart for long videos.

## Showing the plan

Before building, show a readable summary:

```md
# Plano de edição

Fonte: assets/source/video.mp4 (10:12)
Estilo: style.md

## Cortes (12)
- 00:12–00:18 — pausa longa
- 00:41–00:46 — take repetido; o próximo é melhor
...

## Elementos (8)
- 00:03–00:06 — letreiro: "A virada"
- 00:32–00:38 — gráfico: "3 decisões"
- 00:52–00:55 — zoom no rosto
...

## Capítulos
- 00:00 Introdução
- 00:45 O problema
...

Aprovar este plano? Só vou criar a timeline e os visuais depois do seu OK.
```

Wait for an explicit approval. If the user changes the plan, update `edit/plan.json` and show it again.

## Validation

`node "<skill>/scripts/rooster.mjs" plan <slug> --check` should verify:

- `schema` is `rooster.plan/v1`;
- `source` exists;
- `style` exists;
- every cut has `start < end` and a `reason`;
- every element has `start < end`, `type`, and `description`;
- no element extends past the source duration;
- no duplicate ids;
- chapters are sorted by start time.

`--show` prints the human-readable summary.

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

Do not skip the plan. A bad plan costs minutes to fix; a bad render costs hours.
