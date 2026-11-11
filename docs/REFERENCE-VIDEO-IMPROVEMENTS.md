# Improvements from the reference video

Video: [Como editar vídeos com IA usando o Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE), by Marcos Lemos.

Transcript analyzed: pt-BR auto-generated captions (16:55). The video validates our 6-step fast path and the plan gate; the items below cover what it does better or what our base still lacks.

## Checklist

### 1. Style proof + sample build

- [x] `styleproof <slug>` command generates `style/proof/index.html` with 3 frames (hook, data, caption/lower third) using the profile.
- [x] `build <slug> --sample 3` generates only 3 representative elements before the full build.
- [x] `style/proof/` is part of the workspace contract.
- [x] `art-director` and `engineer` document the style gate and the sample build.
- [x] `SKILL.md` and docs updated.
- [x] Test in a temporary workspace.

### 2. Unified preview

- [x] `preview <slug>` writes `preview/index.html` with player, plan, timeline, captions, audio, missing assets, and a QA checklist.
- [x] Clickable timecodes in the player.
- [x] Keeps the shortcut to the engine's native preview.
- [x] `references/timeline.md` and `SKILL.md` updated.
- [x] Test in a temporary workspace.

### 3. NLE handoff

- [x] `export <slug> --format edl|fcpxml|both` command generates `edit/export/`.
- [x] CMX 3600 EDL with cuts and clip names.
- [x] FCPXML with tracks/asset clips for DaVinci/Premiere.
- [x] `edit/export/README.md` with import instructions and limitations.
- [x] `references/nle-handoff.md` reference and layer index.
- [x] Test in a temporary workspace.

### 4. Plan + text/audio QA

- [x] `plan.html` shows transcript context per cut/element, player, and a list of texts to review.
- [x] `textcheck <slug>` command generates `qa/text-review.md` with texts, timecodes, and alerts.
- [x] `check` warns when a cut starts/ends in the middle of a word.
- [x] QA requires watching the entire draft and reviewing text/audio.
- [x] Docs updated.
- [x] Test in a temporary workspace.

### 5. Onboarding + costs

- [x] `paths <slug>` command shows the simple view (`bruto`, `estilo`, `trabalho`, `final`).
- [x] `docs/COSTS.md` with required, optional, and free costs.
- [x] Single setup prompt: skill + dependencies + workspace, with permission.
- [x] README: "you don't need to run commands", costs link, `guided` → `auto`, style proof.
- [x] Docs updated.
- [x] Help/command test.

## What we will not copy

- Dependence on Claude Code or a paid NLE.
- A hidden timeline with no visual inspection.
- A plan as a loose list, with no JSON/timeline.
- The user managing folders and commands by hand.
- MCP as a requirement for editing.

## Status

All five items were implemented in the CLI and in the documentation: `styleproof`, `build --sample`, `preview`, `textcheck`, `export`, and `paths`. The smoke test is in [`docs/TESTING.md`](TESTING.md).

