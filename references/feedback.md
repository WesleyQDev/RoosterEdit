# Feedback and issue reports

RoosterEdit is developed in the open. When a video run fails, a render has warnings, or the user hits friction that is not their fault, offer to open an issue for the developer. The user decides; never create an issue silently.

Repository: <https://github.com/WesleyQDev/RoosterEdit/issues>

## When to ask

Ask once at the end of a run when at least one of these is true:

- a command failed (build, render, transcribe, captions, audio, FilmCraft);
- the render probe reported issues, or QA found a defect that looks like a tool bug;
- the user had to work around a limitation, repeated a step, or said the process was hard;
- the same error happened more than once.

Do not ask after a clean run with no friction. Do not ask again for the same problem in the same session.

## The question

Ask in the user's language, with the technical details kept for the draft:

> "How did the process go? Did you hit any difficulty (build, render, captions, FilmCraft, audio)? May I open an issue in the RoosterEdit repository with the technical details for the developer? You review the draft before anything is sent."

If the user says yes, collect their description and draft the issue. If they say no, stop; do not create a file or an issue unless they ask for a local copy.

## Draft the issue

```bash
node "<skill>/scripts/rooster.mjs" feedback <slug> \
  --title "Build failed in FilmCraft" \
  --notes "The build stopped after the element render; the user retried once." \
  --command "build meu-video --target filmcraft" \
  --error "<short error>" \
  --json
```

The command collects:

- RoosterEdit, OS, Node, FFmpeg, HyperFrames, Remotion, FilmCraft and `gh` versions;
- project engine, timeline, format, duration and status;
- plan and timeline validation errors/warnings;
- the last render probe and validation issues;
- the tail of the latest log in `work/logs/` (unless `--no-logs`).

It writes a draft to `work/notes/feedback-<timestamp>.md` and prints the Markdown. Paths and secrets are redacted, but the user must still review the draft.

Useful flags:

| Flag | Effect |
|---|---|
| `--title <text>` | Summary and issue title |
| `--notes <text>` | What happened, in the user's words |
| `--command <text>` | Command that failed |
| `--error <text>` | Error message |
| `--expected` / `--actual` | Expected and actual behavior |
| `--steps <text>` | Reproduction steps |
| `--log <path>` | Specific log file |
| `--no-logs` | Omit the log tail |
| `--no-diagnostics` | Omit environment, project, validation, render and logs |
| `--out <path>` | Write the draft somewhere else |
| `--repo <owner/repo>` | Target repository (default: `WesleyQDev/RoosterEdit`) |
| `--label <list>` | Comma-separated labels; only use labels the repository has |
| `--json` | Machine-readable draft |

## Review and create

Show the user the title and the draft. Ask for explicit confirmation, then:

```bash
node "<skill>/scripts/rooster.mjs" feedback <slug> --create --yes
```

`--create` requires `--yes` on purpose. It uses the GitHub CLI:

1. `gh` must be installed (<https://cli.github.com/>).
2. `gh auth login` must have been run.
3. The body is sent from a temporary file, then the temporary file is deleted.

The command prints the issue URL. It also appends the URL to the draft in `work/notes/`.

If `gh` is missing or not authenticated, the command fails with the install/login instructions and does not send anything. The user can copy the draft and open the issue manually at the repository URL.

## Privacy rules

- Never include media, frames, transcripts, `plan.json`, `timeline.json`, cookies, tokens or API keys.
- Redact the home, workspace and project paths; the draft uses `~`, `<workspace>` and `<project>`.
- Redact `gh[pousr]_`, `github_pat_`, `sk-`, `xox*`, `Bearer` tokens and `token=`, `api_key=`, `secret=`, `password=` values.
- The user reviews the draft before `--create --yes`. If they are unsure, use `--no-diagnostics` or `--out` and edit the Markdown.
- Do not attach files unless the user explicitly asks and the file is safe to share.

## Relation to the OpenCode report skill

The `report` skill is for OpenCode itself. This flow is for RoosterEdit issues. Do not send a RoosterEdit bug to the OpenCode tracker.
