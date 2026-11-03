# Talking head

Use this playbook for interviews, presenters, teachers, and any video whose spine is a person speaking to camera.

## When to use

- the user has footage of a person talking;
- the value is in the speech, not in generated visuals;
- the edit is mostly selecting, trimming, and supporting the story.

## Intake specifics

- How many speakers, and who are they?
- Is there a transcript or captions?
- What must be included or excluded?
- Do you want to keep the original audio or replace it?
- Is there b-roll, screen recording, or archival material?
- What is the target platform and duration?

## Structure

| Beat | Goal | Typical duration |
|---|---|---|
| Hook | Best line or surprising claim | 0–3 s |
| Setup | Who, what, why | 3–10 s |
| Body | 2–4 story beats | 10–70% |
| Turn | The insight or conflict | 70–85% |
| Payoff | Resolution or proof | 85–95% |
| CTA | What to do next | 95–100% |

For a 90-second edit, aim for 12–20 cuts. For a 10-minute interview, aim for 40–80 cuts and use chapters or lower thirds to orient the viewer.

## Editing rules

- Start from the transcript. Mark the best lines before touching the timeline.
- Cut for meaning, not for silence alone. A pause can be powerful.
- Remove filler words and false starts, but do not make the speaker sound robotic.
- Use J-cuts and L-cuts to keep the audio flowing across picture changes.
- Cover jump cuts with b-roll, a punch-in, a graphic, or a different angle.
- Keep the speaker's eyeline consistent.
- Do not overuse zooms; use them to emphasize, not to hide every cut.
- Put lower thirds on screen long enough to read, and keep them out of the face.
- Let the strongest line land without music or graphics fighting it.

## B-roll

- Use b-roll to illustrate a concrete noun, action, or place, not to decorate.
- Match the b-roll to the words; do not show a generic office if the speaker is describing a lab.
- Keep b-roll shots long enough to register (1.5–4 s).
- Use a consistent grade; mixed sources should be normalized.
- Avoid b-roll that contradicts the audio.

## Captions

- Burn captions for social; sidecar for YouTube if the user prefers.
- Max two lines, 32–42 characters per line.
- Keep captions inside the title-safe area.
- Do not cover the mouth or key gestures.
- Fix names and jargon in the transcript before generating captions.

## Audio

- Remove background noise with a gentle denoiser; do not over-process.
- EQ: high-pass around 80–100 Hz, tame harshness around 2–4 kHz, add presence if needed.
- Compress lightly for consistency; avoid pumping.
- Normalize to the target loudness (-14 LUFS for YouTube, -16 for podcasts).
- Keep true peak below -1 dBFS.
- Duck music under speech.
- Check for clipping, plosives, and room tone jumps between cuts.

## Visual

- Color-correct for skin tones first.
- Keep the grade consistent across angles and b-roll.
- Use a subtle vignette or grain only if it supports the profile.
- Lower thirds: name, role, and maybe a small logo. Keep them simple.
- End card: CTA, subscribe, or next video. Do not hold it too long.

## Engine

- **FFmpeg**: best for simple cuts, captions, audio, and assembly.
- **Remotion**: best when the video needs animated lower thirds, data overlays, or a React-based review page.
- **HyperFrames**: best when the video needs HTML motion graphics over the footage.

## QA

- [ ] The best line is in the first 3 seconds.
- [ ] No accidental jump cuts without coverage.
- [ ] B-roll matches the audio.
- [ ] Captions are in sync and readable.
- [ ] Audio levels are consistent across cuts.
- [ ] Music does not fight the voice.
- [ ] Lower thirds are readable and not covering the face.
- [ ] The ending has a clear CTA.
- [ ] The video works on mobile.

## Example

A 90-second interview edit:

1. Hook: "Eu perdi o emprego no dia em que meu filho nasceu." (0–3 s)
2. Setup: who the speaker is and what happened. (3–12 s)
3. Body: three beats — the loss, the decision, the first client. (12–65 s)
4. Turn: the insight about risk. (65–78 s)
5. Payoff: the result. (78–86 s)
6. CTA: "Se você está nesse momento, comece por aqui." (86–90 s)

B-roll: family photo, empty office, laptop, first invoice. Music: low ambient bed, ducked under voice. Captions: burned, bottom, two lines.
