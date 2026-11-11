# Install prompt

Paste this into your agent. It installs the skill with npm and validates the environment.

---

Install **RoosterEdit** in this project.

1. Ask me first: local to this project (recommended) or global.
2. Run `npx rooster-edit@latest install` for a local install, or `npx rooster-edit@latest install --global` for a global one. Add `--harness claude` or `--harness agents` when that is the agent I am using.
3. Run `npx rooster-edit@latest doctor` and show only what is ready and what is missing, in at most 6 lines.
4. Ask permission before installing Node.js, FFmpeg, FFprobe, Python 3, Whisper, or HyperFrames.
5. Do not create a workspace, channel, or project yet. End with one question: "Do you want to create your first channel now?"

---

If the agent cannot find the skills folder, point it to [`docs/INSTALL.md`](../docs/INSTALL.md). Expected costs are in [`docs/COSTS.md`](../docs/COSTS.md).
