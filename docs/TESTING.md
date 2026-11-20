# Workflow tests

Date: 2026-11-03

Environment: Windows, Node.js 24.14, FFmpeg 8.1, HyperFrames 0.9.8, Python 3.13. Remotion was removed in 0.3 and is no longer part of the workflow.

## 1. Transcription with HyperFrames

Test file: the public `jfk.wav` sample from the whisper.cpp repository.

```bash
node "<skill>/scripts/rooster.mjs" transcribe demo --language en --model small
```

Result:

- `edit/transcript.json` with schema `rooster.transcript/v1`;
- 3 segments and 22 words with timestamps;
- `edit/captions/transcript.srt` generated;
- engine used: `hyperframes` (Parakeet);
- recognized text: “And so, my fellow Americans, ask not what your country can do for you. Ask what you can do for your country.”

## 2. Edit plan

`edit/plan.json` created with:

- 1 cut (`long-pause`, 4.24–5.2s);
- 3 elements (`letreiro`, `caption-emphasis`, `caption-emphasis`);
- 1 chapter.

```bash
node "<skill>/scripts/rooster.mjs" plan demo
```

Result: `0 error(s), 0 warning(s)`. The command shows the summary and reminds you that the plan needs approval before the build.

## 3. HyperFrames

```bash
npx hyperframes init demo-hf --non-interactive --skip-transcribe --skip-skills --resolution landscape
npx hyperframes check --json
npx hyperframes render --quality draft -o out.mp4
```

Result:

- 10.64s composition, 1920×1080, 30 fps, with audio;
- `check`: 0 errors, 0 warnings after adjusting the first frame and the footer size;
- render: MP4 H.264/AAC, 10.66s, 1920×1080, ~599 KB;
- frames at 1s and 6s inspected visually.

## 4. Automatic build

```bash
node "<skill>/scripts/rooster.mjs" build demo --engine hyperframes --force
```

Result:

- HyperFrames: 9.44s (the 4.24–5.2s cut was applied), 1920×1080, 30 fps, H.264/AAC, ~464 KB.
- The build applied the cuts with FFmpeg, remapped the element times, generated the engine project, and rendered frames that were inspected visually.
- The theme came from the `minimal` profile (light background, dark typography, terracotta accent).

## 6. Test with real footage (product pitch)

Input video: `pitch.mp4` (8:57, 1920×1080, 60 fps, 416 MB).

- Transcription with faster-whisper `base` (`small` was replacing accents with `?`): 74 segments.
- Initial highlight plan (88s) rejected by the user: the panel covered the screen and the cuts were too aggressive.
- Corrected plan: full video (537.13s), no cuts, only small lower thirds at the key moments.
- HyperFrames render: 8:57.1, 1920×1080, 30 fps, H.264/AAC, ~86.4 MB.
- Audio normalized in post-processing: -14.07 LUFS, true peak -1.37 dBFS.
- `npx hyperframes check`: 0 errors, 0 warnings.
- Frames inspected: original slide/timer visible, no panel covering the screen; lower thirds readable on a dark background.
- Render time: ~11m55s with 6 workers.

Lesson: for real footage with a static slide, do not cover the screen with a panel. Use only small lower thirds/captions and keep the video continuous. `layout: speaker-left-panel` is still available for cases where the user explicitly asks for it.

## 7. Subagent handoff (smoke test)

Test in a temporary workspace with the `agents/producer.md` role:

- the subagent read the role and wrote `brief.md` and `work/handoffs/02-producer.md`;
- it returned a 17-line handoff, with no transcript, log, or JSON;
- it pointed out a real inconsistency: the intake asked for pt-BR TTS, but `project.json` had `mode.voice: none`;
- the main agent received only the handoff and the artifact path.

The test confirms the return contract and the context isolation. The full chain (transcript → plan → build → QA → render) with subagents in a real project still needs testing.

## 8. Style proof, preview, textcheck, export, and sample build

Test in a 10s temporary project, with one cut and four elements:

- `styleproof` generated `style/proof/index.html` with the three frames and `proof.json`.
- `preview` generated `preview/index.html` with player, plan, timeline, validation, assets, and checklist.
- `textcheck` generated `qa/text-review.md` with 4 texts and 0 alerts; adding a storyboard with duplicate text produced 1 alert.
- `export` generated `edit/export/cuts.edl` and `timeline.fcpxml`; the FCPXML passed Python's XML parser.
- `check` warned that the cut started in the middle of the word "importante".
- `build --sample 3` generated 3 of the 4 elements; the HyperFrames check passed.
- `build --force` generated the full project; the check passed.
- `paths` showed the source/style/work/final view.

Testing in a real project, with long media, burned-in captions, and FCPXML import in DaVinci, still needs to happen.

## 9. FilmCraft (manual smoke test)

Smoke test in a temporary workspace. This is not a benchmark; record the result when you run it.

Requires FilmCraft and `filmcraft-cli` installed (check with `doctor --json`).

```bash
node "<skill>/scripts/rooster.mjs" doctor --json
node "<skill>/scripts/rooster.mjs" build demo --target filmcraft
node "<skill>/scripts/rooster.mjs" timeline demo
node "<skill>/scripts/rooster.mjs" render demo --draft
# edit an element in edit/plan.json
node "<skill>/scripts/rooster.mjs" build demo --if-needed
```

What to check:

- `doctor --json` returns `filmcraft.installed`, `cli`, `app`, `version`, and `mcp`.
- the build creates `engine/filmcraft/demo.fcproj`, `work/filmcraft.json`, and clips in `engine/filmcraft/elements/`.
- `timeline demo` shows the `.fcproj` path; `--open` opens it in FilmCraft.
- `render --draft` exports H.264 at half scale (`renders/draft.mp4`).
- after editing an element, `build --if-needed` re-renders only that element; the others come from cache and the user clips on other tracks stay where they were.

If FilmCraft is not installed, use `filmcraft status --json` to see the onboarding prompt. Do not install anything or write MCP config without permission.

## 10. Feedback issue (manual smoke test)

Test without creating a real issue:

```bash
node "<skill>/scripts/rooster.mjs" feedback demo --title "Teste de feedback" --notes "Descrição do usuário" --json
```

What to check:

- the JSON returns `title`, `body`, `repo`, `gh`, `draftPath`, and `issueUrl: null`;
- the body has Summary, What happened, Environment, Project, Validation, and Privacy;
- local paths become `~`, `<workspace>`, and `<project>`; common tokens and keys are removed;
- the draft is written to `work/notes/feedback-<timestamp>.md`;
- `--no-diagnostics` removes environment, project, validation, and logs;
- `--create` without `--yes` fails on purpose and sends nothing;
- do not run `--create --yes` in an automated test; real creation requires user approval.

If `gh` is not installed or authenticated, the command fails with instructions and keeps the local draft. The user can open the issue manually at <https://github.com/WesleyQDev/RoosterEdit/issues>.

## 11. Structured templates and cut smoothing (manual smoke test)

Test run in a temporary workspace with a 6 s source:

```powershell
$env:ROOSTER_WORKSPACE = "$env:TEMP\rooster-structured"
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new demo --language pt-BR --format 16:9 --profile tech-neon
node "<skill>/scripts/rooster.mjs" new teste --channel demo --duration 6
# write edit/plan.json with chapter, diagram, counter, emphasis, and broll layout:pip
node "<skill>/scripts/rooster.mjs" plan teste --check
node "<skill>/scripts/rooster.mjs" plan teste
node "<skill>/scripts/rooster.mjs" build teste --target filmcraft --engine hyperframes --strict-plan --force --rebuild-media
node "<skill>/scripts/rooster.mjs" render teste --draft --force
```

What to check:

- `plan.html` shows two columns: `No bruto` (player) and `No corte` (final time).
- `qa/plan-review.md` lists visual gaps, dry cuts, text with no grounding, b-roll without `covers`, and layout collisions.
- `plan --check` flags two cards in the same corner and a b-roll without `covers`.
- `build --strict-plan` refuses the plan with a warning; after the fix, it passes.
- The MOVs in `engine/filmcraft/elements/` show chapter, diagram with nodes/arrows, counter, struck-through emphasis, and PIP.
- `build` fails with `zoom` in FilmCraft and explains how to proceed; `--allow-skipped-elements` lets you skip it on purpose.
- The draft renders the elements in the right position and the PIP does not cover the face.
- The build log lists the skipped elements by id and type.

## 12. Custom component (manual smoke test)

In the same 6 s workspace:

```powershell
# create style/components/glow-ring/{element.html,element.css,element.js}
# in plan.json: { "id":"el-006", "type":"custom", "template":"custom", "component":"glow-ring", "start":0.5, "end":1.4 }
node "<skill>/scripts/rooster.mjs" plan teste --check
node "<skill>/scripts/rooster.mjs" build teste --engine hyperframes --force
node "<skill>/scripts/rooster.mjs" render teste --draft --force
node "<skill>/scripts/rooster.mjs" build teste --target filmcraft --engine hyperframes --force
```

What to check:

- `plan --check` resolves the component in the project, channel, profile, or templates.
- The HyperFrames `index.html` contains the markup, the CSS, and the `tl.fromTo` from `element.js`.
- The draft shows the animated ring/circle at the right time.
- The FilmCraft build renders the component as a ProRes clip with alpha.
- A missing component becomes an error with the list of folders it searched.
- `--target filmcraft --engine hyperframes` renders a custom element as a clip with alpha.

## What worked

- `doctor` detects Node, FFmpeg, yt-dlp, the HyperFrames CLI, and Whisper (when installed).
- `transcribe` uses HyperFrames/Parakeet and normalizes the result to `edit/transcript.json`.
- `plan` validates `edit/plan.json` and shows cuts, elements, and chapters.
- `build` generates HyperFrames projects from the plan, applies cuts, and copies the assets.
- HyperFrames renders a real MP4 from an HTML/GSAP composition.

## 2026-11-11 — machine QA, blocks, OCR, face focus

Environment: Windows, Node.js 24.14, FFmpeg 8.1, HyperFrames 0.9.33.

Test workspace: temporary channel `demo`, project `test-video`, 12 s synthetic source with burned-in text, a plan with a `letreiro` and a `scene` block.

Results:

- `plan --check` validates the `scene` block and reports missing descriptions.
- `build --engine hyperframes` installs the local block from `style/blocks/`, copies `compositions/extruded-logo.html`, and mounts it with `data-composition-src` and `data-variable-values`.
- `build --force` with a missing block fails before deleting the previous engine; the exact `hyperframes add` command is printed.
- `hyperframes check` loads the page with the 3D block and reaches the sample/craft pass.
- `qa` measures -21.8 LUFS, true peak -13.9 dBTP, zero clipping, no cuts, and writes `qa/qa.json` + `qa/qa-report.md`; it also surfaces the HyperFrames findings.
- `qa --vision` writes three frames at the flagged times.
- `qa --fix-audio` writes a corrected copy; measured result -13.0 LUFS, no clipping.
- `reframe --format 9:16 --focus auto` measures 16 frames; with no face it warns and falls back to center.
- `ocr --at 1` on Windows returns `rooster.ocr/v1` with word boxes via WinRT, no Python and no download.
- `tools install ocr-wasm --approve` installs tesseract.js 6.0.1 outside the package; `ocr --provider wasm` returns text and boxes.

Not tested here: a real face video for `--focus auto` (the synthetic source has no face), macOS Vision, a system Tesseract install, and a full 3D render with network disabled.

## 2026-11-16 - canvas scenes (manual smoke test)

Environment: Windows, Node.js 24.14, FFmpeg 8.1, Chrome headless for the visual proof.

- `plan --check` on `templates/plan.example.json` (which now carries a `canvas` element) returns `ok: true`; only the example's missing media is reported.
- Breaking the scene on purpose (unknown preset, card on an unknown slot, annotation and camera pointing at a ghost card) returns three errors plus the preset warning instead of a silent fallback.
- `build --engine hyperframes --allow-no-music --no-check` on a 12 s synthetic source writes `compositions/el-0.html` with the `fx-canvas` root, the preset custom properties, the cards, the annotation and the GSAP camera stops.
- The same scene data rendered with `archival-dark` and `modern-black` gives the two expected looks: grid, paper prints and a red ellipse versus a black stage with a cyan ellipse. Frames at 1.5 s, 4.2 s and 9.2 s; assets in `.scratch/canvas-proof/` while the work was open.

Not tested here: a full HyperFrames render of a canvas scene and the FilmCraft clip for a canvas.

## 2026-11-19 - GPU detection and technique catalog (manual smoke test)

Environment: Windows, Node.js 24.14, FFmpeg 8.1, AMD Radeon RX 6600, HyperFrames 0.9.34.

- `doctor --json` now reports `hardware.vendor: "amd"`, `hardware.recommended.h264: "h264_amf"`, and `h264_amf`/`hevc_amf`/`av1_amf` as available. Before this change it reported `gpu: null` because it only probed `nvidia-smi`.
- `build --encoder auto` on a 6 s synthetic source prints `Encoder: h264_amf (AMD Radeon RX 6600, GPU)` and writes `work/build-state.json` with `encoder: "h264_amf"`.
- A second build with a cut exercises the concat filter graph and still uses `h264_amf`; the result probes as 5.4 s, 1280×720, H.264/AAC.
- `color --quality fast` prints `h264_amf · veryfast · crf 20` and writes a valid 6 s MP4.
- `techniques --need 3d,audio --json` returns `three` (available), `blender` (missing), `audio-mix` (available), `tts` (missing) and `ears` (missing), with the install hint for each missing tool.
- `new --engine remotion` and `channel new --engine remotion` fail with a clear removal message instead of silently falling back.
- `doctor --json` invalidates a cache created by another CLI version, so the version and the new fields are never stale.

Not tested here: an NVIDIA/Intel/Apple machine, a real Blender install, earshot installed, and a HyperFrames render with `--gpu` on the AMD card (the CLI falls back to CPU if it fails).

## What has not been tested yet

- Portuguese transcription with whisper.cpp: this environment used Parakeet (English). For Portuguese, you need to install whisper.cpp or the Whisper CLI.
- Downloading a YouTube link with `yt-dlp`: YouTube blocks this environment with a bot check. The code and the rights gate are implemented, but the real download needs to be tested on an authorized machine or network.
- Build v1 covers title cards, caption-emphasis, cards, and cuts. Structured templates (chapter, diagram, counter, list, emphasis, callout, terminal, end-card), canvas scenes, b-roll in PIP/split, and cut smoothing are implemented; the Three.js and Blender techniques are documented but not yet smoke-tested end to end.
- Unified preview in the browser and the CLI render wrapper.

## Reproduce

1. Create a workspace and a channel:
   ```bash
   node "<skill>/scripts/rooster.mjs" init
   node "<skill>/scripts/rooster.mjs" channel new demo --language pt-BR --format 16:9 --profile minimal
   node "<skill>/scripts/rooster.mjs" new meu-video --channel demo
   ```
2. Put an audio/video file in `rooster/channels/demo/projects/meu-video/assets/source/`.
3. Run `transcribe`, write `edit/plan.json`, and run `plan`.
4. Use `build`, `preview`, and `render`; HyperFrames assembles the composition.
