# Captions

Turn a transcript into readable caption cues, SRT/VTT sidecars, and an optional FFmpeg burn-in. Captions are a separate layer: `build` does not burn them automatically in this version.

## Input and output

Input is `edit/transcript.json` in the `rooster.transcript/v1` schema:

```json
{
  "schema": "rooster.transcript/v1",
  "source": "assets/source/video.mp4",
  "language": "pt-BR",
  "duration": 612.4,
  "segments": [
    { "start": 12.4, "end": 18.2, "text": "This is what the speaker said." }
  ]
}
```

`writeCaptions({ transcriptPath, outDir })` writes:

- `captions.srt` — SubRip, UTF-8, LF, `HH:MM:SS,mmm`;
- `captions.vtt` — WebVTT, UTF-8, LF, `HH:MM:SS.mmm`;
- `captions.json` — derived cue data, `rooster.captions/v1`.

It does not modify the transcript. If `outDir` is omitted, it writes next to the transcript. A delivery pass can copy the files to `renders/`.

## Cue rules

Segments are cleaned, sorted, and clamped so cues never overlap. Long segments split at sentence and clause punctuation, then at word boundaries. Each cue holds at most two lines of about 42 characters. Timing is divided proportionally by visible characters inside the original segment; no time is invented outside it.

```js
import { buildCues, toSrt, toVtt, writeCaptions } from "./scripts/features/captions.mjs";

const cues = buildCues(transcript, { maxLineChars: 42, maxLines: 2 });
const srt = toSrt(cues);
const vtt = toVtt(cues);
const result = writeCaptions({
  transcriptPath: "rooster/channels/default/projects/demo/edit/transcript.json",
  outDir: "rooster/channels/default/projects/demo/edit/captions",
  maxLineChars: 42,
  maxLines: 2,
});
// result.files = { srt, vtt, json }
```

`captions.json`:

```json
{
  "schema": "rooster.captions/v1",
  "source": "assets/source/video.mp4",
  "language": "pt-BR",
  "transcript": "C:/.../edit/transcript.json",
  "generatedAt": "2026-11-03T00:00:00.000Z",
  "duration": 612.4,
  "options": { "maxLineChars": 42, "maxLines": 2 },
  "count": 180,
  "cues": [
    { "id": 1, "start": 0, "end": 2.4, "text": "First line.", "lines": ["First line."] }
  ]
}
```

## Burn-in

`burnArgs()` returns `{ args, command, filter }` and executes nothing. `burnCommand()` returns the printable string. The caller decides whether to run it.

```js
import { burnArgs } from "./scripts/features/captions.mjs";

const { args, command } = burnArgs({
  video: "renders/draft.mp4",
  srt: "edit/captions/captions.srt",
  out: "renders/final.mp4",
  style: { font: "Inter", size: 42, color: "#ffffff", stroke: "#000000", position: "bottom", marginV: 48 },
});
```

The filter quotes spaces and escapes Windows drive colons, brackets, commas, and semicolons. The args array is authoritative; the printable command is for review. Burn-in re-encodes video to H.264 and copies audio by default; use `crf`, `preset`, and `audio` to change that.

## Build integration

- Use `caption-emphasis` in `edit/plan.json` for a few on-screen key lines; use this module for full captions.
- Generate sidecars after `transcribe` and before final delivery.
- `build` does not burn captions automatically. Run `captions --burn` after the draft render, or add caption elements manually inside the engine.
- Do not claim captions in a delivery unless `captions.srt`, `captions.vtt`, or burned captions are actually present.

## Commands

```bash
node "<skill>/scripts/rooster.mjs" captions <slug> [--out <dir>] [--max-chars 42] [--max-lines 2]
node "<skill>/scripts/rooster.mjs" captions <slug> --burn renders/draft.mp4 [--out-video renders/captioned.mp4] [--dry-run]
```

The command writes the sidecars under `edit/captions/`. With `--burn`, it executes the FFmpeg burn and writes `renders/captioned.mp4` by default; `--dry-run` prints the command instead.

## QA

- Cues are in sync and never overlap.
- No cue exceeds two lines or roughly 42 characters per line.
- Reading speed is comfortable; split or shorten fast passages.
- Text stays inside the title-safe area when burned.
- SRT/VTT parse in a standard player and use UTF-8 without a BOM.
- Spelling, punctuation, and speaker changes are correct.
- Captions do not cover faces or key visuals.

## Limitations

- Cue splitting and timing are heuristic; review before delivery.
- No word-level karaoke, speaker diarization, translation, or automatic spellcheck.
- Punctuation determines clause breaks; unpunctuated transcripts fall back to word wrapping.
- A single word longer than the line limit cannot be split.
- Burn-in assumes an SRT file and H.264 output; complex or unusual paths should be previewed.
- Very short segments may receive millisecond-scale cues.
