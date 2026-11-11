# NLE handoff

RoosterEdit does not build a full NLE. It can hand the approved cuts to one: DaVinci Resolve, Premiere, Final Cut, or any tool that imports EDL/FCPXML. It can also build an editable FilmCraft project as an optional target. The editor keeps `edit/plan.json` and `edit/timeline.json` as the source of truth; the handoff is a convenience, not a new edit.

There are two independent handoff paths:

| Path | Command | Output | Carries |
|---|---|---|---|
| EDL/FCPXML | `export <slug> --format both` | `edit/export/cuts.edl`, `timeline.fcpxml` | cuts only |
| FilmCraft | `build <slug> --target filmcraft` | `engine/filmcraft/<slug>.fcproj` | base, mix, element clips, markers, captions |

Neither replaces the other. Use `export` for a cuts-only interchange file; use the FilmCraft target when the user wants an editable assembly with the visual elements already in place.

## When to use

- The user wants to finish color, audio, or captions by hand in DaVinci/Premiere.
- The user wants to see the cut on an editable timeline before committing to an engine.
- The user already has an NLE and does not want a code-only assembly.
- The user wants an editable FilmCraft timeline with the base cut, audio mix, elements, markers, and captions already assembled.

Do not use the export to skip the plan approval. Export after the plan is stable and the user asks for an NLE handoff.

## Command

```bash
node "<skill>/scripts/rooster.mjs" export <slug> --format both
```

Options:

- `--format edl` — cuts only, CMX 3600.
- `--format fcpxml` — basic FCPXML 1.10 with the same cuts on one video track.
- `--format both` — default.
- `--fps <n>` — override the timecode frame rate; defaults to the plan/project fps.

Output:

```text
edit/export/
├── cuts.edl
├── timeline.fcpxml
└── README.md
```

## What each file carries

`cuts.edl` is a CMX 3600 edit list. It carries the keep segments, source in/out, record in/out, reel name, and clip name. It does not carry overlays, music, captions, effects, or speed changes. It is the most compatible path and the easiest to relink.

`timeline.fcpxml` is a minimal FCPXML 1.10 document with the source asset and one `asset-clip` per keep segment. It is useful for a quick import and for tools that prefer XML over EDL. It does not include the full overlay/music/caption graph; those are still in `edit/plan.json` and `edit/timeline.json`.

The plan's elements are intentionally not baked into the FCPXML. Overlays depend on the engine and the profile; exporting them as generic clips would produce a worse result than rebuilding them in the NLE or in HyperFrames/Remotion.

## DaVinci Resolve

1. Create a timeline with the same frame rate as the project.
2. File > Import > Timeline, or drag the EDL/FCPXML into the media pool.
3. Relink the source file if the path changed.
4. Add the visual elements, music, captions, and color from the plan and the timeline.
5. Render from DaVinci, or send the result back for `deliver <slug>`.

The free version of DaVinci imports EDL/XML manually. The paid Studio version is only required if the user wants an external MCP connector or advanced automation.

## Premiere Pro

1. File > Import and select the EDL or FCPXML.
2. Relink the source if needed.
3. Rebuild overlays and audio from the plan.

## FilmCraft timeline

FilmCraft is optional and opt-in: `--target filmcraft` on `build` or `new`. It is not the default and not required for HyperFrames, Remotion, or `export`. The CLI (`filmcraft-cli`) does the deterministic build; the MCP server is for interactive editing and is not needed for `build`.

### Build

```bash
node "<skill>/scripts/rooster.mjs" new meu-video --channel en-tech --target filmcraft
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine hyperframes
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --engine remotion
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --if-needed
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --force
node "<skill>/scripts/rooster.mjs" build meu-video --target filmcraft --rebuild-media
node "<skill>/scripts/rooster.mjs" timeline meu-video --open
```

- `--engine hyperframes|remotion` selects the element renderer; `auto` uses HyperFrames, because registry blocks and the generated plan only run there. Pass `--engine remotion` when the project has a hand-written React/Three element. FFmpeg is rejected here because it builds the base, not the element clips.
- `new --target filmcraft` records `timeline: "filmcraft"` in `project.json`; later `build` calls with no target keep using FilmCraft.
- `build --target filmcraft` runs FFmpeg for the base cut and audio mix, renders each element as a transparent clip, and assembles the `.fcproj`.
- HyperFrames elements are MOV ProRes 4444 with alpha, one composition per element. Remotion elements are ProRes 4444 with PNG frames and `yuva444p10le`, one composition per element. Remotion needs a one-time `npm install` in `engine/filmcraft/remotion`; the build reports that path when the CLI is missing.
- `--if-needed` skips when the plan, base, renderer, and format state key is unchanged.
- `--force` archives the previous `.fcproj` under `engine/filmcraft/archive/` and rebuilds.
- `--rebuild-media` forces the base and element re-renders.

### What the project contains

- V1: source video clips only, one clip per keep.
- A1: the mixed base audio from FFmpeg.
- V2+: one element clip per renderable element, packed into the first free lane.
- Program markers for chapters, elements, and cut boundaries.
- Captions imported from `edit/captions/*.srt` or `.vtt` when present.

`zoom` and overlay `transition` elements are not standalone clips: they apply to the base, so the build fails by default. Use `--target hyperframes`/`remotion`, replace them with PIP/split b-roll and punch-ins, or pass `--allow-skipped-elements` when the omission is deliberate.

### Files and state

```text
engine/filmcraft/
├── <slug>.fcproj
├── assets/          # base media
├── elements/        # one MOV per element
├── hyperframes/     # element compositions, when used
├── remotion/        # element compositions, when used
└── archive/         # previous .fcproj after --force
work/filmcraft.json  # schema rooster.filmcraft/v1
cache/elements/<hash>.mov
```

### Incremental updates

- Unchanged element clips are reused from `cache/elements`.
- A changed element with the same time window uses `clip.replaceFromBin`; a changed window deletes and re-places only that clip.
- A changed base (cuts, voice, or music) re-places only V1/A1. User clips on other tracks are preserved.
- Removed elements have their clips deleted.
- Markers and captions are created on the first build; later builds preserve them, including manual markers. Add captions in FilmCraft after the first build, or rebuild with `--force` to import them again.
- Manual edits to a managed clip (V1, A1, or a Rooster element clip) are overwritten when that clip changes. Edits to other clips and tracks are preserved. V1 and A1 are managed as a pair: if you re-cut V1 by hand, the A1 mix does not follow; change the plan and rebuild, or re-mix in FilmCraft.

### Render and export

`render <slug> --draft|--final` detects `timeline: "filmcraft"` and exports H.264 through FilmCraft. Draft uses 0.5 scale; final uses full size. It writes `renders/draft.mp4` or `renders/final.mp4` and `renders/render-<quality>.json`, and is cache-aware.

FilmCraft export is CPU-bound for grading and keying; H.264 encoding can use hardware.

### Detection and MCP

```bash
node "<skill>/scripts/rooster.mjs" filmcraft status --json
node "<skill>/scripts/rooster.mjs" filmcraft setup --client opencode
node "<skill>/scripts/rooster.mjs" filmcraft setup --client opencode --write
node "<skill>/scripts/rooster.mjs" filmcraft mcp-config --client claude --json
```

`doctor --json` includes `filmcraft: { installed, cli, app, source, version, mcp }`. `filmcraft status --json` adds `prompt` with `kind` (`connect-mcp`, `install`, `install-cli`, `ready`). `mcp-config` prints only the snippet; `setup` prints it and can write it. `setup --write` merges the entry into the project config (`opencode.json` or `.mcp.json`) and keeps a `.bak` backup of an existing file; it never writes without `--write`. Restart the agent after connecting. `timeline <slug> --json` reports the project file, sequence, element count, and `updatedAt`; `filmcraft open <slug>` is an alias for `timeline <slug> --open`. `ROOSTER_FILMCRAFT_CLI` overrides the CLI path. The onboarding question is in `references/onboarding.md`.

### Live co-editing (MCP bridge)

The MCP is how the agent edits the same timeline the user has open. There are two modes:

| Mode | Config entry | What the agent sees |
|---|---|---|
| Headless | `command: [cli, "mcp"]` | its own copy of the project; the open app is not involved |
| Bridge | `command: [cli, "mcp", "--bridge", "127.0.0.1:<port>"]` | the document the user has open in the app |

Setup:

```bash
filmcraft --control 8790
node "<skill>/scripts/rooster.mjs" filmcraft setup --client opencode --bridge 8790 --write
```

`--write` keeps a `.bak` of the existing config; restart the agent afterward. Use the same port in both commands.

Tools exposed by the server (FilmCraft 0.19):

| Group | Tools | Use |
|---|---|---|
| Read | `doc_inspect`, `project_inspect`, `sequence_inspect`, `command_list` | the current state, before every edit |
| Edit | `command_run`, `command_batch`, `media_import` | commands by id: `timeline.place`, `clip.replaceFromBin`, `markers.add`, `file.exportMedia`, and the rest of `command_list` |
| Frames | `render_frame`, `render_preview` | one frame from the active sequence at a timecode |
| Live UI | `ui_inspect`, `ui_elements`, `ui_screenshot`, `ui_click`, `ui_drag`, `ui_key`, `ui_type`, `ui_control` | the shared window; only works with `--bridge` |

Rules:

- Inspect before every edit. The user moves clips while the agent thinks; re-read `sequence_inspect` after any user action.
- One change per call, announced with its track and timecode. Never tidy, realign, rename, or reorder what the user did.
- Prefer `command_run` over `ui_*`: commands are deterministic, while UI actions depend on selection, zoom, and panel layout.
- Do not run `build`, `timeline --open`, or the CLI `render` while the app is open. They open a headless copy, and `--force` archives the live document. Export inside the session with `command_run` and `file.exportMedia`.
- The plan is frozen while the session lasts: the `.fcproj` is the source of truth. `check`, `preview`, and `qa` still read `edit/plan.json`, so say which file you mean when reporting.
- If the bridge drops (app closed or restarted), the command and `ui_*` tools fail. Ask the user to reopen the app with `--control` and the same port; do not retry in a loop.

Recovery: after the session, save in the app and run `timeline <slug> --json` for the recorded state. Folding the manual edits back into `edit/plan.json` is a manual step; there is no automatic read-back yet. If the edit has to live in the plan, rebuild from the plan and redo the manual changes deliberately.

### Caveats

- FilmCraft is still alpha (about 86% feature breadth and 56% ready for real work by its own README). Windows is less tested.
- It is MIT OR Apache-2.0 and runs natively on Windows, macOS, and Linux.
- The `.fcproj` stores absolute media paths. Moving the project folder breaks links; relink in FilmCraft.
- Only one writer at a time: close FilmCraft while `build` updates the project.
- Element renders are ProRes 4444 MOV and can be large; cache GC applies.
- The MCP bridge is optional; `build` uses the CLI only.
- The `export` EDL/FCPXML path still works independently.

## Limits

These limits apply to the EDL/FCPXML export; FilmCraft has its own caveats above.

- EDL is cuts-only and has no overlay, caption, or music information.
- FCPXML here is deliberately minimal; complex effects remain engine-side.
- Non-integer frame rates and drop-frame timecode need manual review.
- File paths are absolute in the FCPXML; if the project moves, relink.
- The export does not replace the plan, the timeline, or the QA gate.

## Relation to the guardrails

The skill still does not implement an NLE. It exports an interchange file for DaVinci/Premiere, or builds an optional FilmCraft project when the user asks for that target. The final authority for editorial decisions stays in `edit/plan.json`.
