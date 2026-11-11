# Roadmap

## Phase 1 — Foundation (in progress)

- [x] `SKILL.md` draft in English.
- [x] Architecture and decisions documented.
- [x] Workspace, channel, and profile structure.
- [x] Base CLI: `doctor`, `init`, `new`, `list`, `check`.
- [x] Link ingest with `yt-dlp` (with a rights gate).
- [x] References: workflow, intake, engines, profiles, timeline, QA, harness, schemas, link ingest.
- [x] Initial profiles: minimal, tech-neon, 3d-cartoon.
- [x] Built-in profile templates.
- [x] Local sync to OpenCode.
- [x] Whisper detection and the `transcribe` command.
- [x] Schema and validation command for `edit/plan.json`.
- [x] 6-step flow inspired by the video, adapted to the RoosterEdit structure.
- [x] Bootstrap prompt in English.
- [x] Channel onboarding (`channel new/set`) and projects with overrides.
- [x] `channel`, `profile`, `digest` CLI.
- [x] Asset strategies per channel/project.
- [x] `digest` for compact transcription and token discipline.
- [x] Subagent roles in `agents/` and a per-stage handoff protocol.
- [x] Install via `npx rooster-edit install` (local, global, per harness).
- [ ] Publish the `rooster-edit` package to npm.
- [ ] Validate the skill with the skill-creator.

## Phase 2 — Media pipeline

- [x] Transcription via HyperFrames/Whisper, tested with a public sample.
- [x] `edit/plan.json` with validation and an approval gate.
- [x] Content-addressed cache for capabilities, probes, transcriptions, TTS, build, and render.
- [x] Per-language transcription: Parakeet/sherpa-onnx, faster-whisper, and whisper.cpp; defaults `fast` (base/beam 1).
- [x] `build --if-needed`, short sample, and per-stage media reuse.
- [x] Real `render` wrapper with quality, workers, resume, frame cache, and probe.
- [x] `cache info|path|clear|gc`, `frames` with contact sheet, and b-roll index.
- [ ] Cuts without re-encode in the engine (`data-media-start`/`trimBefore`).
- [ ] Hybrid FFmpeg + short overlay render.
- [ ] Fused audio pass and automatic hardware encode.
- [x] Automatic `cut-plan`: silences, filler words, rough cut.
- [x] TTS adapter (provider-agnostic).
- [x] Mix, loudness, and ducking.
- [x] Captions: SRT/VTT, sync, and burn-in.
- [ ] Manifest with hashes, licenses, and full provenance.
- [x] Machine QA: plan, engine check, loudness/peak/silence, cuts, faces (`qa`).
- [x] Optional OCR without Python: Windows/macOS/Tesseract, or `tools install ocr-wasm`.

## Phase 3 — Engines and timeline

- [x] HyperFrames adapter (smoke test: init, check, render).
- [x] Remotion adapter (smoke test: scaffold, still, render).
- [x] Automatic build of `edit/plan.json` for HyperFrames/Remotion (v1: cuts, elements, and base media).
- [x] Rich build: b-roll in PIP/split, structured graphics, lists, emphasis, callout, terminal, and end card.
- [x] Cut smoothing: audio micro-fade and alternating punch-in on uncovered jumps.
- [x] 3D graphics in the build via HyperFrames registry blocks (`scene` + `template: "block"`).
- [x] Face-aware vertical crop (`reframe --focus auto`).
- [ ] FFmpeg adapter (EDL → filtergraph).
- [x] Unified preview with timeline and QA.
- [x] NLE handoff with EDL/FCPXML.
- [x] 3-frame style proof and 3-element sample build.
- [x] Text review and validation of cuts in the middle of a word.
- [ ] `render` and `package`.

## Phase 4 — 3D and quality

- [ ] Three.js starter for a hand-written custom scene (blocks cover the registry path).
- [ ] More ready-made profiles: warm-documentary, brutalist, corporate-clean.
- [ ] Project examples.
- [ ] Evals with baseline and iteration.
- [ ] Skill description optimization.
- [x] Translate README, `AGENTS.md`, `docs/`, and `templates/` to English.
- [ ] Translate generated HTML previews and remaining CLI strings to English.
- [x] Re-render the demo with English narration and text.
- [ ] Packaging.

## Out of scope for v1

- Full NLE in the browser.
- Video generation by models (Veo/Kling/Runway) as core.
- Generated avatar/UGC.
- Object tracking frame by frame (face-aware crop and face boxes are supported).
- Cloud render.
- Automatic upload to YouTube/TikTok.
- Advanced color grading.
- Real-time collaborative editing.
