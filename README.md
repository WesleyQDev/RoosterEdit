<h1 align="center">
  <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/logo.png" width="120" alt="RoosterEdit" />
  <br />
  RoosterEdit
</h1>

<p align="center">
  <strong>Turn the footage and assets you already have into a finished cut.</strong><br />
  Your coding agent plans the edit, asks for approval, and renders with HyperFrames, Remotion, or FFmpeg.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/rooster-edit"><img src="https://img.shields.io/npm/v/rooster-edit?style=flat-square&logo=npm" alt="npm: rooster-edit" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status: alpha" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" alt="License: MIT" /></a>
</p>

<p align="center">
  <sub><strong>English</strong> · <a href="README.pt-BR.md">Português (Brasil)</a></sub>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#documentation">Documentation</a>
</p>

RoosterEdit is a skill for coding agents. Give it a brief and your footage and assets; it returns a reviewable edit plan, an editable project, and a finished video.

The plan is a file, the project stays editable, and the renderer is a choice, not a lock-in.

## Demo

<p align="center">
  <a href="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-16x9.mp4">
    <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-16x9.gif" alt="Chat that becomes the documentary The City at 5 AM" width="76%" />
  </a>
  &nbsp;
  <a href="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-9x16.mp4">
    <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-9x16.gif" alt="Vertical cut of the same documentary" width="22%" />
  </a>
</p>

<p align="center">
  <sub><strong>16:9</strong> · 40 s · chat → documentary with parallax</sub>
  &nbsp;&nbsp;&nbsp;
  <sub><strong>9:16</strong> · 28 s · vertical cut of the same film</sub>
</p>

<p align="center">
  <sub>Previews autoplay; click either one for the full video.</sub><br />
  <sub>Photos: Unsplash (CC0), via Wikimedia Commons. Music synthesized for this demo.</sub>
</p>

## What RoosterEdit does

It edits the footage and assets you already have. Give it a brief and your material, and it returns a cut you can review, adjust, and keep.

- **Existing material first.** Talking heads, interviews, tutorials, demos, screen recordings, photo essays, and b-roll you already have. It cleans silence, filler, and abandoned takes before it adds anything.
- **Plan first.** Every cut starts as a reviewable `edit/plan.json`. You approve the plan, three style frames, and the browser preview before the expensive render.
- **One channel, one standard.** Language, format, style, voice, and asset policy live in a channel. New videos inherit the standard instead of restarting from a prompt.
- **Small on purpose.** Node.js and FFmpeg are the only required tools: no Python, no provider account, no cloud. The npm package is under 1 MB; optional tools such as OCR download to a user cache only when you approve it.
- **Cheap on context.** Heavy stages run in subagents and return a short handoff, so the main agent never reads the full transcript or build log.
- **Leaves the door open.** Export EDL/FCPXML for DaVinci Resolve or Premiere, or build an editable FilmCraft timeline. Your edit does not die inside the tool.

**Who it is for:** creators and small teams with existing footage who want a repeatable, reviewable edit inside the agent they already use. **Scope:** local, plan-first editing with a clean handoff to Resolve, Premiere, or FilmCraft.

## Install

```bash
npx rooster-edit@latest install
```

This copies the skill into the skills folder your agent already reads and prints the path. It works with OpenCode, Claude Code, Codex, and any harness that reads `SKILL.md`. Then open your agent and say:

> Set up RoosterEdit and check my environment.

Global install, another harness, or an update:

```bash
npx rooster-edit@latest install --global
npx rooster-edit@latest install --harness claude
npx rooster-edit@latest install --force
```

Check the machine:

```bash
npx rooster-edit@latest doctor
```

Requirements: **Node.js 22+**, **FFmpeg/FFprobe**, and a browser. Whisper, `yt-dlp`, and a GPU are optional. Full guide: [`docs/INSTALL.md`](docs/INSTALL.md).

## What you can make

- Talking-head edits with silence, filler, and retake cleanup.
- Interviews, tutorials, demos, and screen recordings cut into a tight story.
- Product promos, reels, Shorts, and vertical cuts from existing footage.
- Narrated explainers with TTS, captions, b-roll, and charts.
- Motion graphics, and 3D scenes from HyperFrames registry blocks (installed on demand) or a hand-written Three.js/Remotion scene.

## How it works

1. **Channel** — set the stable defaults once: language, format, style, voice, asset policy.
2. **Intake** — give the agent a brief and put the footage in the project.
3. **Plan** — the agent transcribes and proposes cuts, chapters, graphics, b-roll, and music in `edit/plan.json`.
4. **Approval** — review the plan, three style frames, and the browser preview.
5. **Build and render** — the chosen engine builds the project; `qa` checks the plan, audio, cuts, and faces, and extracts only the frames that need review before the final render.

The plan is the control point. If it is wrong, the video is wrong.

## Documentation

| Guide | What it covers |
|---|---|
| [Install](docs/INSTALL.md) | Local and global install, requirements, troubleshooting |
| [First video](docs/FIRST-RUN.md) | From empty workspace to the first render |
| [Architecture](docs/ARCHITECTURE.md) | How the pieces fit and why |
| [Workspace](docs/WORKSPACE.md) | Channels, projects, assets, and profiles |
| [Costs](docs/COSTS.md) | What is free, optional, or paid |
| [Roadmap](docs/ROADMAP.md) | What ships next |

All documentation is in English.

## Contributing

Bugs and ideas: open an issue. Code changes: run `npm install` once, then `npm run validate` and `npm test`.

## Credits

- [How to edit videos with AI using Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE), by Marcos Lemos — inspiration for the six-step workflow.
- [3D animation factory with Claude](https://www.youtube.com/watch?v=u6du22ySnC4), by diegokk — inspiration for the Three.js pipeline.
- [HyperFrames](https://github.com/heygen-com/hyperframes) and [Remotion](https://www.remotion.dev) — the render engines.

RoosterEdit does not copy those videos. It summarizes the workflows in its own skill.

## License

MIT. See [LICENSE](LICENSE).
