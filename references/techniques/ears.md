# earshot (hearing)

`earshot` gives the agent ears: it describes a sound in words, finds the best moment inside a recording, compares takes, critiques a launch film, and renders code-generated SFX. It is **optional**, local, and CPU-only.

Use it when the decision depends on listening, not only on numbers. Loudness, peak, and silence are already covered by `qa` and FFmpeg; earshot adds "which take sounds better", "does this whoosh land on the cut", "is this a real recording or a synth", and "what sound is this".

## Detect and install

`doctor --json` reports `earshot.installed` and the version. If it is missing:

```bash
uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"
earshot doctor --fetch     # downloads the two models (~1.1 GB)
```

Ask before installing: it downloads models and takes disk space. The CLI loads the models on each call (~20–40 s); the MCP server keeps them warm.

## What to run

| Question | Command |
|---|---|
| What does this sound like? | `earshot describe <file> --json` |
| Which candidate fits the brief? | `earshot rank "<description>" <files...> --json` |
| Where is the exact moment? | `earshot find <file> "<description>" --top 3 --json` |
| Which take is better? | `earshot ab <a> <b> --json` |
| Is this a real recording? | `earshot realness <file> --json` |
| What happens across the film? | `earshot timeline <audio> --video <video> --json` |
| Critique the sound design | `earshot critique <video> --json` |
| Make a sound effect | `earshot sfx render <id> -o <file.wav>` |
| Build a whole SFX kit | `earshot kit init --preset <name> -o audio/kit.json` |

Always prefer `--json`; the human summary is for the user, not for the agent's context.

## How it fits the workflow

1. **QA** — run the deterministic `qa` first. If the mix is technically correct but the sound design is weak, use `earshot timeline` and `critique`.
2. **Take selection** — when the user has several recordings of the same line, `earshot find`/`ab` picks the best; record the choice in `edit/analysis.json` or in the voiceover plan.
3. **SFX** — use the shipped bank (`sfx list`, `sfx render`, `kit`) instead of an unlicensed download. The bank is code-generated, so the license is clean.
4. **Sync** — `earshot timeline --video` reports where sound lands against picture cuts. Use it to move a hit or a whoosh by a few frames.
5. **Reference** — `earshot profile <refs...>` builds a profile from films the user admires; keep it in the project, not in the skill.

## Cost and privacy

- Local CPU only; no GPU is used.
- The models are downloaded from their authors under their own licenses (CLAP Apache-2.0, AST BSD-3-Clause).
- `earshot llm --yes-upload` sends audio to Gemini. Never use it without explicit consent and the user's own key.
- The optional MCP server is the better choice for a long session: models load once.

## Fallback

If earshot is not installed, or the user declines the install:

- use `ffmpeg` `loudnorm`, `ebur128`, and `silencedetect` for the objective pass;
- use the licensed music/SFX library and record the license in the manifest;
- say that semantic listening was skipped and why. Do not claim the sound design was reviewed by ear when it was not.

## Limits

earshot is a hint, not a judge of taste. It cannot tell you whether the music fits the emotion, whether the joke lands, or whether a voice sounds trustworthy. A human still makes the final call.
