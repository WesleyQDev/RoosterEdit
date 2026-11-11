# Bootstrap prompt

Prompt to prepare the environment and start a video with the workflow inspired by the reference video, but using the RoosterEdit structure. Paste it into the agent (OpenCode, Codex, Claude Code, etc.) and adjust the paths.

---

I want to edit my videos with AI using RoosterEdit. Prepare this computer and this project:

1. Install RoosterEdit and validate the environment:
   ```
   npx rooster-edit@latest install
   npx rooster-edit@latest doctor
   ```
   If something is missing, install FFmpeg, Node.js LTS, and Python 3. Ask my permission before each installation.
2. Install Whisper for free local transcription and test it with a short audio clip.
3. Install the HyperFrames skill:
   ```
   npx skills add heygen-com/hyperframes
   ```
4. Create the folder and the first channel:
   ```
   node "<skill>/scripts/rooster.mjs" init
   node "<skill>/scripts/rooster.mjs" channel new my-channel --language en-US --format 16:9 --profile minimal
   node "<skill>/scripts/rooster.mjs" channel design my-channel --from minimal --accent "#22d3ee" --motion calm
   node "<skill>/scripts/rooster.mjs" new my-video --channel my-channel
   node "<skill>/scripts/rooster.mjs" open my-channel/my-video
   ```
   Before `channel design`, ask me about palette, typography, and motion/audio. Do not set a duration: the length comes from the edit.
   Open the `assets/source/` folder so I can add my raw footage.
5. Read my style guide at `rooster/channels/my-channel/projects/my-video/style.md` (if I do not have one, create it from my references).
6. Use the `transcript-analyst` subagent to transcribe and build the editorial map:
   ```
   node "<skill>/scripts/rooster.mjs" transcribe my-channel/my-video --model small --language en
   ```
   It writes `edit/transcript.json`, `edit/digest.md`, and `edit/analysis.json` and returns only duration, topics, beats, and flags. Do not read the whole transcript in the main context.
7. Use the `editor` subagent to create `edit/plan.json` from `edit/analysis.json`, `style.md`, and the brief, with:
   - cuts for long pauses, repetitions, false starts, and retakes;
   - the best take to keep;
   - titles, graphics, lists, zooms, and b-roll, with start, end, and description.
8. **Always show me the plan before creating anything.** Only create the timeline, the visuals, or the render after my OK.
9. After the OK, use the `engineer` subagent to generate the project and build the timeline:
   ```bash
   node "<skill>/scripts/rooster.mjs" build my-channel/my-video --engine hyperframes
   ```
   If I choose React, data, or 3D, use Remotion:
   ```bash
   node "<skill>/scripts/rooster.mjs" build my-channel/my-video --engine remotion
   ```
10. Use `qa` for the review and `engineer` for the final render. At the end, give me a short summary (up to 8 lines) of what was done and the next step. Do not write a long guide.

---

## Notes

- Subagent roles are in `agents/`. The main agent must pass paths, not content, and read only the handoff from `work/handoffs/`.
- If the environment has no Node/FFmpeg, do not fake the render: generate the plan and explain that HyperFrames/Remotion need Node.
- Do not download third-party content without permission.
- Use `style.md` as the source of truth for the visuals; a profile, if present, complements it.
- The plan is the most important gate: no build before approval.
- Without subagent support, do the steps inline, but keep writing the files and reading only summaries.
