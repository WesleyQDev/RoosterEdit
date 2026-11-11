# Install

RoosterEdit is a skill: the whole repository is the payload, with no build step. The recommended install is npm, which copies the skill into the folder your agent already reads.

## Requirements

- Node.js 22+ (22 or 24 recommended)
- FFmpeg and FFprobe
- A browser (for the HyperFrames and Remotion preview/render)
- Optional: Whisper, `yt-dlp`, a GPU

`doctor` checks all of it:

```bash
npx rooster-edit@latest doctor
```

## Install with npx

Run this in the project where you will make videos:

```bash
npx rooster-edit@latest install
```

The command copies `SKILL.md`, `references/`, `scripts/`, `templates/`, `agents/`, and `docs/` into `.opencode/skills/rooster-edit` and prints the path. It does not create a workspace or a project.

Other harnesses:

```bash
npx rooster-edit@latest install --harness claude   # .claude/skills/rooster-edit
npx rooster-edit@latest install --harness agents   # .agents/skills/rooster-edit
```

Global install, for every project on the machine:

```bash
npx rooster-edit@latest install --global
```

| Harness | Local | Global |
|---|---|---|
| OpenCode | `.opencode/skills/rooster-edit` | `~/.config/opencode/skills/rooster-edit` |
| Claude Code | `.claude/skills/rooster-edit` | `~/.claude/skills/rooster-edit` |
| Agents / Codex | `.agents/skills/rooster-edit` | `~/.agents/skills/rooster-edit` |

Use `--dir <skills-folder>` when the harness reads a custom path. The folder `rooster-edit` is appended to it.

```bash
npx rooster-edit@latest install --dir ~/my-agent/skills
npx rooster-edit@latest install --dry-run
npx rooster-edit@latest install --json
```

The installer writes `.rooster-install.json` inside the skill folder. It refuses to overwrite a folder that does not contain that marker or a `SKILL.md`.

## Update and uninstall

```bash
npx rooster-edit@latest install --force
```

`--force` replaces the installed copy with the current package version. To uninstall, delete the `rooster-edit` folder; your `rooster/` workspace is separate and is not touched.

## Verify

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs doctor --json
```

Or, without the local path:

```bash
npx rooster-edit doctor --json
```

You should see Node, FFmpeg, FFprobe, the HyperFrames CLI, and the workspace if one exists.

## First use

Open the agent in the project and ask it to set up RoosterEdit. The agent installs nothing else without permission and ends with a short status.

Then create the first channel:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs init
node .opencode/skills/rooster-edit/scripts/rooster.mjs channel new my-channel \
  --language en-US \
  --format 16:9 \
  --profile minimal
node .opencode/skills/rooster-edit/scripts/rooster.mjs channel design my-channel \
  --from minimal \
  --accent "#22d3ee" \
  --motion calm
```

Create a project and open the source folder:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs new my-video --channel my-channel
node .opencode/skills/rooster-edit/scripts/rooster.mjs open my-channel/my-video
```

Put the footage in `rooster/channels/my-channel/projects/my-video/assets/source/` and ask the agent:

> Transcribe the video, read my `style.md`, write `edit/plan.json`, and show me the plan before building anything.

After approval:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs build my-channel/my-video --engine hyperframes
```

The full walkthrough is in [`FIRST-RUN.md`](FIRST-RUN.md).

## Manual install (development)

Clone the repository into a skills folder:

```bash
git clone https://github.com/WesleyQDev/RoosterEdit.git .opencode/skills/rooster-edit
```

On Windows:

```powershell
git clone https://github.com/WesleyQDev/RoosterEdit.git "$env:USERPROFILE\.config\opencode\skills\rooster-edit"
```

Update with `git pull` inside that folder. This path is for development; normal installs should use npm.

## Troubleshooting

| Problem | Fix |
|---|---|
| Skill does not appear | Confirm the file is `<skills-folder>/rooster-edit/SKILL.md` and the folder is not empty. Reload the agent. |
| Install says the folder exists | Run with `--force` to update, or delete the old folder if it was not installed by RoosterEdit. |
| `node` not found | Install Node.js 22+ and reopen the terminal. |
| `ffmpeg` not found | Install FFmpeg and add it to `PATH`. |
| HyperFrames is slow on first run | `npx hyperframes` downloads the package and Chrome once; later runs use the cache. |
| Remotion does not render | Run `npm install` inside `engine/remotion`. |
| Transcription fails in some languages | Install whisper.cpp or `openai-whisper`; Parakeet covers English. |
| YouTube blocks a download | Use `--cookies-from-browser` or download the file manually, respecting the rights. |
