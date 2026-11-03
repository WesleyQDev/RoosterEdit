# Token discipline

Video work is naturally expensive: transcripts, frames, plans, render logs, and generated code. The goal is not to reduce quality; it is to keep noisy data out of the model context and reserve tokens for creative decisions.

## Rule 1 — Never paste long logs

HyperFrames, Remotion, FFmpeg, and Whisper can print thousands of lines. Redirect them to a log file and read only the tail or the JSON summary.

```bash
# HyperFrames render
npx hyperframes render --quiet -o ../../renders/draft.mp4 > render.log 2>&1
tail -n 20 render.log
```

```powershell
# Windows
npx hyperframes render --quiet -o ../../renders/draft.mp4 *> render.log
Get-Content render.log -Tail 20
```

```bash
# HyperFrames check
npx hyperframes check --json > check.json 2>&1
node -e "const d=require('./check.json'); console.log({ok:d.ok, errors:d.lint?.errorCount, warnings:d.lint?.warningCount})"
```

```bash
# Remotion
npx remotion render src/index.ts RoosterVideo out.mp4 --log=error
```

```bash
# FFmpeg
ffmpeg -v error -i input.mp4 ...
```

If a command fails, read the `Fix:` line, the JSON error, or the last 30 lines. Do not read the full log unless the summary is insufficient.

## Rule 2 — Use the transcript digest, not the raw JSON

`transcript.json` contains segments and word-level timestamps. Word-level data is useful for captions but expensive to read. Use:

```bash
node "<skill>/scripts/rooster.mjs" digest meu-video --from 60 --to 180
```

This prints only the segments in the range. Use `--json` when you need structure. Read the full transcript only when the task truly needs every line.

For a long transcript:

1. Run `digest` with `--json`.
2. Ask a subagent to propose 10–20 candidate beats, cuts, and elements.
3. Review the compact result in the main context.

## Rule 3 — Use `plan --show`, not the raw plan

`edit/plan.json` can be large. The human-readable summary is enough for approval:

```bash
node "<skill>/scripts/rooster.mjs" plan meu-video --show
```

Read the JSON only when editing specific fields or debugging validation.

## Rule 4 — Read only the reference section you need

The `references/` directory is a library, not a checklist. Use the reference map in `SKILL.md` and read only the file for the current phase. Use `rg`/grep to find a section instead of loading a 300-line file.

Examples:

- engine choice: `references/engines.md`
- plan schema: `references/edit-plan.md`
- social/vertical: `references/categories/social-short.md`
- asset policy: `references/assets.md`

## Rule 5 — Inspect a few frames, not every frame

Use 3–5 representative frames per review:

- hook/first frame;
- a middle scene;
- a caption-heavy scene;
- a transition;
- the end card.

Use a contact sheet for broad coverage. Read individual frames only when the contact sheet raises a question.

## Rule 6 — Draft once, final once

- Render a low-quality draft for review.
- Fix the plan/style before re-rendering.
- Render the final only after approval.
- For text-only changes, use a still/snapshot instead of a full video render.

## Rule 7 — Reuse what is already done

- Do not re-transcribe the same file.
- Do not rebuild the engine project if only the plan text changed; update the plan and rebuild.
- Cache TTS per line and reuse unchanged audio.
- Reuse profiles, categories, components, and templates.

## Rule 8 — Delegate the right work to subagents

Subagents are useful when the work is independent and the raw input is large:

- transcript analysis into compact beats;
- research/reference gathering;
- technical QA on rendered frames;
- parallel scene implementation.

Give the subagent file paths, not pasted content. Ask for a compact JSON/markdown result. Do not delegate the final creative decision or the timeline contract.

## Rule 9 — Keep the main context clean

- Do not paste full `index.html`, `Video.tsx`, or generated code unless debugging.
- Use `rg` to find the relevant lines.
- Keep decisions in `review.md` and refer to the file path.
- Summarize the user's feedback in one sentence before acting.

## Rule 10 — Budget by phase

| Phase | Context budget |
|---|---|
| Onboarding | 1 short message, no file reads |
| Intake | 1 message, no full assets |
| Transcript | `digest` only; full JSON only if needed |
| Plan | `plan --show`; JSON only for edits |
| Build | CLI output only; no generated code unless debugging |
| Preview | 3–5 frames or a screenshot |
| QA | probe JSON + summary, not a full log |
| Delivery | final path + stats |

## What not to optimize

- Do not skip the plan approval to save tokens.
- Do not skip frame inspection to save tokens.
- Do not use a smaller model for the final editorial review.
- Do not compress the transcript so much that the story is lost.

Save tokens on **noise**, not on **judgment**.
