# Token discipline

Video work is naturally expensive: transcripts, frames, plans, render logs, and generated code. The goal is not to reduce quality; it is to keep noisy data out of the model context and reserve tokens for creative decisions.

## Rule 0 — Delegate the raw material

The cheapest token is one the main agent never reads. Send the stages that produce or consume raw material to a stage subagent: transcript analysis, research, script and plan drafts, style, build, QA, render. The subagent reads the file, writes the artifact, and returns a handoff of 15–25 lines. The main agent keeps the brief, the decisions, the gates, and the final visual judgment.

This is not only about speed. A transcript read in stage 3 is still occupying context in stage 8, and every later turn pays for it again. The handoff is paid once. The full protocol and the role files are in `references/subagents.md` and `agents/`.

If the harness has no fresh-context agent tool, or a spawn fails, keep the same file boundaries: write the raw output to `work/logs/` or `work/scratch/`, read only the summary, and do the stage inline.

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

Keep these files in `work/logs/` (or `../../work/logs/` from inside the engine directory) so they stay out of the main context and out of the project's editorial folders.

## Rule 2 — Use the transcript digest, not the raw JSON

`transcript.json` contains segments and word-level timestamps. Word-level data is useful for captions but expensive to read. Use:

```bash
node "<skill>/scripts/rooster.mjs" digest meu-video --from 60 --to 180
```

This prints only the segments in the range. Use `--json` when you need structure. Read the full transcript only when the task truly needs every line.

For a long transcript:

1. Run `digest` with `--json`.
2. Use `transcript-analyst` (or a subagent with the same role file) to propose 10–20 candidate beats, cuts, and elements.
3. Review the compact result in the main context.

## Rule 3 - Use `plan`, not the raw plan

`edit/plan.json` can be large. The human-readable summary is enough for approval:

```bash
node "<skill>/scripts/rooster.mjs" plan meu-video
```

Read the JSON only when editing specific fields or debugging validation.

## Rule 4 — Read only the reference section you need

The `references/` directory is a library, not a checklist. Use the reference map in `SKILL.md` and read only the file for the current phase. Use `rg`/grep to find a section instead of loading a 300-line file.

Examples:

- engine choice: `references/engines.md`
- plan schema: `references/edit-plan.md`
- social/vertical: `references/intake.md`
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
- Reuse profiles, components, and templates.

## Rule 8 — Delegate by artifact, not by reflex

Subagents are the default for heavy stages, and the main thread should receive only the handoff:

- transcript analysis into `edit/analysis.json` and a compact beat list;
- research and reference gathering into `work/research.md`;
- script and plan drafts into the real project files;
- art direction and storyboard into `style.md` and `storyboard.json`;
- build, fixes, and QA into artifacts plus evidence paths;
- render and packaging into a path and probe stats.

Give the subagent file paths, not pasted content. Ask for the handoff template. Do not delegate the final creative decision, the approval gate, or the license call. Parallelize only independent work; serialize writes to the same plan, timeline, or engine project.

The full cast and contract are in `references/subagents.md`. Do not spawn a subagent for a one-line question; the fixed cost of a fresh context only pays off when the stage has real raw material.

## Rule 9 — Keep the main context clean

- Do not paste full `index.html`, `Video.tsx`, or generated code unless debugging.
- Use `rg` to find the relevant lines.
- Keep decisions in `review.md` and refer to the file path.
- Summarize the user's feedback in one sentence before acting.

## Rule 10 — Budget by phase

| Phase | Owner | Main thread reads |
|---|---|---|
| Onboarding | main | 1 short message, no file reads |
| Intake | main + `producer` | the brief summary, no full assets |
| Transcript | `transcript-analyst` | handoff only, never `transcript.json` |
| Plan | `editor` | view `plan.html` + handoff; JSON only for a field edit |
| Build | `engineer` | status + artifact paths; no code or logs |
| Preview | `qa` + main | 3–5 frames + handoff |
| QA | `qa` | verdict + evidence paths, not a full log |
| Delivery | `engineer` | final path + probe stats |

## Rule 11 — Close with a short report

- End in 5–10 lines: what is done, the paths, any blocker, and one next question.
- Do not repeat the brief, dump commands, or paste the full doctor table.
- Put details in the workspace or link the docs.
- After installation, the only next question is whether to configure the workspace now.

## What not to optimize

- Do not skip the plan approval to save tokens.
- Do not skip frame inspection to save tokens.
- Do not use a smaller model for the final editorial review.
- Do not compress the transcript so much that the story is lost.

Save tokens on **noise**, not on **judgment**.
