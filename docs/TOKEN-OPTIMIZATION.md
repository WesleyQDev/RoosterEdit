# Token optimization

Video consumes tokens naturally: transcript, frames, plan, render logs, and generated code. The point is not to cut quality; it is to remove noise from the context and leave tokens for creative decisions.

## The biggest thieves

1. **Render/check logs** — HyperFrames and Remotion print thousands of lines. Redirect them to a file and read only the end.
2. **Full transcript with words** — use `digest` and read only the segments.
3. **Raw plan JSON** - use `plan`.
4. **Whole references** — read only the section you need.
5. **Too many frames** — 3 to 5 representative frames are enough.
6. **Re-rendering for a small change** — use still/snapshot or a draft.

## The biggest saving: subagents per stage

Clipping logs and using `digest` helps, but the big gain comes from not bringing the raw material into the main agent. It drives: it talks to the user, keeps the brief, makes the decisions, and opens the gates. Each heavy stage runs in a subagent with its own context, which dies at the end of the stage. The subagent reads the transcript, runs the build, scans the QA, and returns a 15–25 line handoff. The transcript and the analysis stay in `edit/`; logs and drafts stay in `work/`, outside the main context.

| Stage | Subagent | What the main agent receives |
|---|---|---|
| Brief | `producer` | one paragraph + open questions |
| Research | `researcher` | 5 findings + sources + licenses |
| Transcription | `transcript-analyst` | duration, topics, beats, flags |
| Script | `scriptwriter` | hook + summary of the beats |
| Plan | `editor` | plan summary + risks |
| Style/storyboard | `art-director` | tokens + scenes + assets |
| Timeline | `editor` | duration + markers + risks |
| Audio | `audio-director` | voice, music, and mix |
| Build | `engineer` | status + paths + blocker |
| QA | `qa` | verdict + evidence + frames |
| Render | `engineer` | final path + probe |

The rule of thumb: if a step reads or produces more than one screen of raw material, delegate it. Do not delegate the intake conversation, the approval gate, the license decision, or the final visual judgment. The main agent reads the handoff, sees `plan.html` and 3–5 frames; never the full transcript, the generated code, or the render log.

The full protocol, the spawn template, and the handoff contract are in [`references/subagents.md`](../references/subagents.md) and in the roles under [`agents/`](../agents/README.md).

This is a capability, not a tool name: each harness calls the subagent something different (OpenCode, Claude Code, Codex, etc.). If the harness has no agent with a fresh context, or if the spawn fails, run the stage inline and keep the files; do not block the project waiting for a delegation.

## Commands

```bash
# Noisy render
npx hyperframes render --quiet -o ../../renders/draft.mp4 > ../../work/logs/render.log 2>&1
tail -n 20 ../../work/logs/render.log

# Check
npx hyperframes check --json > ../../work/logs/check.json 2>&1
node -e "const d=require('../../work/logs/check.json'); console.log({ok:d.ok, errors:d.lint?.errorCount, warnings:d.lint?.warningCount})"

# Remotion
npx remotion render src/index.ts RoosterVideo out.mp4 --log=error

# FFmpeg
ffmpeg -v error -i input.mp4 ...

# Compact transcript
node "<skill>/scripts/rooster.mjs" digest meu-video --from 0 --to 60
```

## Context rules

- Do not paste logs into the chat; read the `Fix:` or the last 30 lines.
- Use `digest` instead of `transcript.json`.
- Use `plan` instead of reading `plan.json`; the command also generates `edit/plan.html` and `qa/plan-review.md` for review.
- Read only the reference for the current phase.
- Inspect 3–5 frames per review.
- Render the draft once; the final only after approval.
- Reuse transcript, TTS, and projects; do not redo what did not change.
- For a long transcript, use `transcript-analyst`: it writes `edit/analysis.json` and returns only the beats and flags.
- For build and render, use `engineer`: logs stay in `work/logs/` and the main agent receives only status and paths.
- `styleproof` and `preview` generate HTML; open it in the browser instead of pasting the HTML into the chat.
- `textcheck` writes `qa/text-review.md`; read only the alerts and the texts, not the JSON.
- Close the task in 5–10 lines: result, paths, and one next question. Details stay in the files.

## What not to cut

- Plan approval.
- Visual frame inspection.
- Editorial review of the result.
- Final render quality.

Save on noise, not on judgment.
