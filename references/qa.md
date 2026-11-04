# QA

QA has two jobs: catch technical defects before the user sees them, and catch editorial problems before the render budget is spent. Do both on a draft, not on the final.

Watch the draft end to end at least once before the final render. Sampling frames catches composition and safe-area issues; it does not catch a cut in the middle of a word, a caption that flashes, or a music cue that lands late. Run `textcheck <slug>` and review `qa/text-review.md` before approving.

## Technical checklist

### Format

- [ ] Resolution matches the plan (1920×1080, 1080×1920, 1080×1080, etc.).
- [ ] Aspect ratio matches the platform.
- [ ] FPS matches the plan and is constant.
- [ ] Duration is within the target range.
- [ ] No black frames longer than 0.5 s unless intentional.
- [ ] No freeze frames longer than 1 s unless intentional.
- [ ] No unintended gaps or overlapping clips.
- [ ] First frame is not blank.
- [ ] Last frame is not a black frame or an abrupt cut.

### Visual

- [ ] Text is inside the title-safe area (80%).
- [ ] Key action is inside the action-safe area (90%).
- [ ] Every on-screen text in `qa/text-review.md` was proofread.
- [ ] No placeholder, duplicate, or truncated text remains.
- [ ] Contrast is readable at mobile size.
- [ ] Fonts are loaded and licensed.
- [ ] Logos are not distorted.
- [ ] Overlays do not cover faces, captions, or key visuals.
- [ ] Colors are consistent with the profile.
- [ ] Motion is smooth; no jitter or accidental jump cuts.
- [ ] Transitions are intentional, not decorative noise.

### Audio

- [ ] Voice is intelligible and centered.
- [ ] No clipping; true peak below -1 dBFS.
- [ ] Integrated loudness matches the target (-14 LUFS for YouTube, -16 for podcasts, -23 for broadcast).
- [ ] Music is ducked under voice.
- [ ] No long silences or abrupt audio cuts.
- [ ] No cut starts or ends inside a word.
- [ ] Every cut boundary was checked by ear.
- [ ] SFX are not louder than the voice.
- [ ] Stereo/mono layout is correct.
- [ ] No sample-rate mismatch or drift.

### Captions

- [ ] Captions are in sync.
- [ ] Reading speed is comfortable.
- [ ] Max two lines per cue.
- [ ] Text is inside the safe area.
- [ ] No overlapping cues.
- [ ] Spelling and punctuation are correct.
- [ ] Speaker changes are clear.
- [ ] Captions do not cover key visuals.
- [ ] Sidecar files are valid SRT/VTT.

### Assets and licenses

- [ ] Every asset exists.
- [ ] Every asset has a license/provenance entry.
- [ ] Music and fonts are licensed for the intended use.
- [ ] Downloaded links were authorized.
- [ ] No placeholder assets remain.
- [ ] No missing fonts fallback silently.

### Render

- [ ] FFprobe duration matches the timeline.
- [ ] FFprobe resolution and fps match the plan.
- [ ] Audio stream exists and is not silent.
- [ ] File size is sane.
- [ ] The file plays in a standard player.
- [ ] Decoded frames at the start, middle, and end look correct.

## Editorial checklist

- [ ] The draft includes the planned visual elements, b-roll, and music; cuts alone are not a finished video.
- [ ] Every element in the plan is visible in the draft, and every music track is audible under the voice.
- [ ] If elements, b-roll, or music were omitted, the plan or review records why.
- [ ] No stretch longer than 45 seconds without a visual beat.
- [ ] Every b-roll shows the line it covers and is not from a later scene.
- [ ] No reaction survives without its setup, and no clip from a later scene sits in the middle.
- [ ] No flash-length keep (< 0.8 s) without a deliberate reason.
- [ ] No two cards fight for the same corner at the same time.
- [ ] The punch-in and audio micro-fade at cuts are not distracting.
- [ ] The hook lands in the first three seconds.
- [ ] The promise is clear before the first 10% of the video.
- [ ] Each scene earns its duration.
- [ ] The middle does not repeat the same idea.
- [ ] The CTA is specific and visible.
- [ ] The tone matches the audience.
- [ ] The video works without sound (captions/text) if the platform requires it.
- [ ] The video works with sound only (voice/music) if the platform requires it.
- [ ] The pacing matches the channel and the plan.
- [ ] The ending is not abrupt.

## Accessibility

- [ ] Captions are available.
- [ ] Contrast ratio is at least 4.5:1 for body text.
- [ ] No rapid flashing that could trigger photosensitivity.
- [ ] Important information is not conveyed by color alone.
- [ ] Text is large enough for mobile.
- [ ] Audio has no sudden loud spikes.

## Platform specs

| Platform | Aspect | Duration | Notes |
|---|---|---|---|
| YouTube | 16:9 | 8–15 min typical | Thumbnail, chapters, end screen |
| YouTube Shorts | 9:16 | ≤60 s | Hook in 1 s, captions |
| Instagram Reels | 9:16 | ≤90 s | Safe zones for UI |
| TikTok | 9:16 | 15–60 s | Captions, fast pacing |
| LinkedIn | 1:1 or 16:9 | 30–120 s | Captions, professional tone |
| Website hero | 16:9 | 15–30 s | Muted autoplay, text overlays |

## Commands

```bash
# Probe
ffprobe -v error -show_entries format=duration,size,bit_rate \
  -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,channels \
  -of json final.mp4

# Black frames
ffmpeg -i final.mp4 -vf blackdetect=d=0.5:pix_th=0.10 -an -f null -

# Freeze frames
ffmpeg -i final.mp4 -vf freezedetect=n=0.003:d=1.0 -an -f null -

# Loudness
ffmpeg -i final.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -

# Extract stills
ffmpeg -i final.mp4 -vf "select='eq(n,0)+eq(n,90)+eq(n,180)'" -vsync 0 frame-%02d.png
```

## Report template

Write `qa/report.md`:

```md
# QA Report — <project>

## Summary
- Status: pass / pass with warnings / fail
- Duration:
- Resolution:
- FPS:
- Loudness:
- Captions: yes/no

## Blocking issues
- [ ] ...

## Warnings
- [ ] ...

## Evidence
- Frames: `qa/frames/`
- Probe: `qa/probe.json`
- Loudness: `qa/loudness.json`
- Text review: `qa/text-review.md`
- Preview: `preview/index.html`

## Editorial notes
- Hook:
- Pacing:
- CTA:

## Sign-off
- Reviewed by:
- Date:
```

## Common fixes

| Problem | Fix |
|---|---|
| Audio too quiet | Normalize with `loudnorm`, raise voice gain, then re-check true peak |
| Music fights voice | Duck with `sidechaincompress` or a volume envelope |
| Captions too fast | Split cues, shorten text, or slow the scene |
| Text outside safe area | Move to the 80% title-safe box |
| Black frame between clips | Check clip boundaries and transition handles |
| Render duration mismatch | Check the root duration and the timeline's last clip |
| Missing font | Bundle the font or use a system-safe fallback |
| 3D scene flickers | Remove real-time randomness; drive everything from the frame |
| Video looks flat | Add contrast, color, or lighting through the profile, not random filters |
| Hook is weak | Rewrite the first line and the first visual; do not add more effects |
