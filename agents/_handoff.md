# Handoff contract

Every RoosterEdit subagent ends with a handoff. It is the only part of your work that enters the main agent's context, so it must be complete enough to act on and short enough to keep.

You do not talk to the user and you do not wait for approval. If a choice needs the user, finish the artifact as far as you can and return `status: needs-decision` with the exact question in `decisions`.

Write the handoff to the path passed in the spawn prompt (default: `work/handoffs/<step>-<role>.md`) and return the same content as your final message. Create `work/handoffs/` and `work/logs/` if they do not exist. Your final message starts with `# Handoff` and ends with `next:`. No preamble, no closing, nothing after it.

```md
# Handoff — <step> <role>
status: ok | needs-decision | blocked
artifacts:
- path/relative/to/project
summary:
- outcome, not process
decisions:
- choice the main agent or user must confirm
blockers:
- what is missing and what you tried
next: <next step or the exact question>
```

## Status

- `ok` — the artifact is written, checked, and ready for the next stage.
- `needs-decision` — the artifact exists but a creative, legal, or cost choice needs the main agent or the user.
- `blocked` — you could not produce the artifact. Say what is missing, what you tried, and the smallest unblock.

## Limits

- 15 lines for mechanical stages (assets, build, render, research).
- 25 lines for plan, QA, and delivery.
- Five summary bullets maximum.
- Paths must exist. Do not list a planned or partial artifact as done.

## Never include

- Transcript text, word-level timings, or long quotes.
- Build, render, FFmpeg, or engine logs.
- Generated code, HTML, or full JSON.
- A file dump "for context".
- A decision you already made that changes the story, the look, the license, or the cost.

Full detail belongs in the project files: `edit/analysis.json`, `qa/report.md`, `work/logs/`, `work/notes/`. The next subagent can read those paths. The main agent should not have to.

Never commit, push, upload, or publish. Those are decisions for the main agent and the user.

## Before you return

1. Every `artifacts` path exists and is non-empty.
2. You ran the relevant check (plan validation, engine check, FFprobe, caption validation) and can name the result.
3. Any assumption is in `decisions`, not hidden in the summary.
4. The handoff fits the line limit.
5. Nothing after the handoff.
