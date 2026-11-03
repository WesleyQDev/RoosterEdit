# NLE handoff

RoosterEdit does not build a full NLE. It can hand the approved cuts to one: DaVinci Resolve, Premiere, Final Cut, or any tool that imports EDL/FCPXML. The editor keeps `edit/plan.json` and `edit/timeline.json` as the source of truth; the export is a convenience, not a new edit.

## When to use

- The user wants to finish color, audio, or captions by hand in DaVinci/Premiere.
- The user wants to see the cut on an editable timeline before committing to an engine.
- The user already has an NLE and does not want a code-only assembly.

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

## Limits

- EDL is cuts-only and has no overlay, caption, or music information.
- FCPXML here is deliberately minimal; complex effects remain engine-side.
- Non-integer frame rates and drop-frame timecode need manual review.
- File paths are absolute in the FCPXML; if the project moves, relink.
- The export does not replace the plan, the timeline, or the QA gate.

## Relation to the guardrails

The skill still does not create a full NLE. It exports an interchange file and tells the user how to import it. The final authority for editorial decisions stays in `edit/plan.json`.
