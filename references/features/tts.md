# TTS and voiceover

## Purpose

Turn an approved script into a narration plan without silently spending money, cloning a voice, or inventing timings. The helper module plans commands and a manifest; it never generates audio. Generation always needs explicit user permission.

## Permission and privacy

- Ask before generating. State the provider, voice, language, estimated line count, and whether the provider is local, network-based, or paid.
- Never clone a real person's voice or generate their likeness without consent.
- Do not upload a private script or media to an API provider without permission.
- Keep API keys in environment variables. `detectTtsProviders()` reports only whether a key exists, never its value.
- If the project's voice mode is `user` or `none`, do not switch to TTS because a provider happens to be installed.

## Script splitting

`splitScript(text)` returns speakable blocks and preserves scene/line ids. Markdown headings become scenes; explicit `{#id}` anchors keep the id. Bullets, blank lines, and speaker labels start new blocks. Soft-wrapped lines are joined, and long blocks are split at sentence boundaries (default 280 characters), then at word boundaries if one sentence is still too long.

```md
## Hook (0–3s) {#hook}
**Most people** think AI is magic.

- First point
- Second point

## Body
NARRATOR: This is the line.
```

```json
[
  { "id": "hook-l1", "sceneId": "hook", "line": 1, "part": 1, "text": "Most people think AI is magic." },
  { "id": "hook-l2", "sceneId": "hook", "line": 2, "part": 1, "text": "First point" },
  { "id": "hook-l3", "sceneId": "hook", "line": 3, "part": 1, "text": "Second point" },
  { "id": "body-l1", "sceneId": "body", "line": 1, "part": 1, "speaker": "NARRATOR", "text": "This is the line." }
]
```

Structured input is also accepted. Explicit ids are kept, and missing line ids are generated:

```js
splitScript({
  scenes: [
    { id: "intro", title: "Intro", lines: [{ id: "intro-1", text: "Hello." }, { text: "World." }] }
  ]
});
// intro-1, intro-l2
```

## Provider detection

`detectTtsProviders()` checks `edge-tts`, `hyperframes`, optional `piper`, and environment-based API providers. It runs only local version/help probes. It makes no network calls, and `probe: false` skips even those probes.

```js
import { detectTtsProviders } from "<skill>/scripts/features/tts.mjs";

const result = detectTtsProviders();
// result.defaultProvider, result.available
// result.byId["edge-tts"].command, .args, .available
// result.byId.openai.envKeys -> ["OPENAI_API_KEY"]
```

Each provider returns `id`, `kind`, `available`, `version`, `command`, `args`, `stdin`, `requiresNetwork`, `envKeys`, `permissionRequired`, and a note. `args` entries use `{text}`, `{voice}`, `{out}`, `{rate}`, `{model}`, and `{language}` placeholders. API providers return `command: null`; use their SDK or REST API instead of assuming a shell command.

The default order is local `hyperframes`, `edge-tts`, `piper`, then `openai`, `elevenlabs`, and `gemini`. `ROOSTER_TTS_PROVIDER` can request a preferred available provider.

## Building a command

`buildTtsArgs()` returns a descriptor and does not execute it. The result includes `command`, `args`, `stdin`, `display`, `executed: false`, and notes.

```js
import { buildTtsArgs } from "<skill>/scripts/features/tts.mjs";

const edge = buildTtsArgs({
  provider: "edge-tts",
  text: "A maioria das pessoas não pensa assim.",
  voice: "pt-BR-FranciscaNeural",
  out: "assets/generated/voice/hook-l1.mp3",
  rate: 5
});
// edge.command === "edge-tts"
// edge.args: --text ... --voice ... --rate +5% --write-media ...
```

That corresponds to:

```bash
edge-tts --text "A maioria das pessoas não pensa assim." \
  --voice pt-BR-FranciscaNeural --rate "+5%" \
  --write-media "assets/generated/voice/hook-l1.mp3"
```

For another CLI, pass a provider object with a command template. A plain unknown provider string falls back to conventional `--text/--voice/--out` flags and adds a warning.

```js
buildTtsArgs({
  provider: {
    id: "my-tts",
    command: "my-tts",
    args: ["--text", "{text}", "--voice", "{voice}", "--out", "{out}", "--rate", "{rate}"]
  },
  text: "Hello.",
  voice: "default",
  out: "line.mp3"
});
```

`hyperframes` returns an `npx --no-install hyperframes tts ...` shape. Verify its flags with `npx --no-install hyperframes tts --help` before running; CLI flags can change between releases. Known API ids (`openai`, `elevenlabs`, `gemini`) return `command: null`; call their SDK or REST API after permission instead of building a shell command.

## Voiceover manifest

`buildVoiceoverPlan({ lines, outDir })` writes nothing. It returns a `rooster.voiceover/v1` manifest with deterministic audio paths and null timing placeholders. Optional fields include `provider`, `voice`, `rate`, `language`, and `ext`.

```json
{
  "schema": "rooster.voiceover/v1",
  "status": "planned",
  "outDir": "assets/generated/voice",
  "lines": [
    {
      "id": "hook-l1",
      "sceneId": "hook",
      "text": "Most people think AI is magic.",
      "audio": "assets/generated/voice/hook-l1.mp3",
      "start": null,
      "end": null,
      "duration": null,
      "measured": false
    }
  ],
  "totals": { "lines": 1, "duration": null, "measured": false }
}
```

Save it as `edit/voiceover.json`. The plan can reference it with an optional field because unknown fields are preserved:

```json
"voiceover": {
  "provider": "edge-tts",
  "voice": "pt-BR-FranciscaNeural",
  "manifest": "edit/voiceover.json"
}
```

## Commands

```bash
node "<skill>/scripts/rooster.mjs" tts <slug> [--script <path>] [--provider edge-tts] [--voice <id>] [--rate 1.1x] [--language pt-BR]
node "<skill>/scripts/rooster.mjs" tts <slug> --generate
```

Without `--generate`, the command writes `edit/voiceover.json` and prints the first TTS command for review. `--generate` runs the provider after explicit user approval and measures each file with FFprobe.

## Measure timing after generation

The null timings are intentional. TTS duration depends on voice, rate, punctuation, and provider. After the user authorizes generation, measure every file:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "assets/generated/voice/hook-l1.mp3"
```

Then fill `duration`, accumulate `start`/`end` in the order the lines appear, and set `measured: true` and `totals.duration`. Do not estimate timings and present them as measured. If lines overlap or use J/L cuts, place them explicitly instead of accumulating.

## Integration

- Use `tts <slug>` to write `edit/voiceover.json`; use `tts <slug> --generate` only after explicit user approval.
- Add each measured line to the timeline `a1` voice track as `{ id, src, start, end, volume }`.
- Run loudness normalization after assembly (target around `-14 LUFS` for web video).
- Cache per line and reuse unchanged audio. Regenerate only changed ids.
- `build` now reads measured lines from `edit/voiceover.json`, builds a voice track, and mixes it over the base audio before music/SFX. Lines without measured start/duration are ignored.

## Limitations

- `edge-tts` needs a network connection; local HyperFrames/Piper do not.
- API providers are detected by environment keys only; this module does not call them.
- HyperFrames TTS flags are version-dependent. Check `--help`.
- No SSML, phoneme control, voice cloning, translation, or automatic subtitle timing.
- `rate` is a percentage (`+10%`) or multiplier (`1.1x`); numeric values are treated as percent.
- Long lines are split heuristically; review names, acronyms, and numbers before generation.
- Timing placeholders are never a substitute for measuring the generated files.
