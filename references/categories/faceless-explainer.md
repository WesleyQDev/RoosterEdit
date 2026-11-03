# Faceless explainer

Use this playbook for narrated explainers, educational shorts, and any video where the visuals are generated or assembled rather than filmed.

## When to use

- no presenter or footage;
- the value is in the explanation;
- TTS, kinetic type, diagrams, charts, and stock/AI visuals carry the video.

## Intake specifics

- What is the core question or argument?
- Who is the audience, and what do they already know?
- TTS or text-only with music?
- Language and accent?
- What visual style: clean, tech, editorial, playful, cinematic?
- Do you have images, screenshots, charts, or brand assets?
- What is the target platform and duration?

## Structure

| Beat | Goal | Typical duration |
|---|---|---|
| Hook | A question, paradox, or surprising fact | 0–4 s |
| Context | Why this matters | 4–15 s |
| Explain | 3 blocks, each with one idea | 15–70% |
| Proof | Example, number, or visual demonstration | 70–85% |
| CTA | What to do with the knowledge | 85–100% |

A 45-second explainer usually has 8–12 scenes. A 90-second explainer has 12–20. Each scene should make one point.

## Script

- Write for the ear, not the page. Short sentences. One idea per sentence.
- The first line must work as a hook on its own.
- Use concrete nouns and verbs; avoid abstractions.
- Repeat the key term at least twice so the viewer remembers it.
- End with a clear takeaway, not a vague "and that's why it's important".
- Keep the script within the target duration at a natural speaking rate (about 140–160 words per minute in Portuguese, 150–170 in English).

## Visual grammar

- **Kinetic type**: one phrase at a time, large, high contrast, synced to the voice.
- **Diagrams**: build one element at a time; do not show the full diagram before the explanation.
- **Charts**: one insight per chart; label the axis and the takeaway.
- **Icons**: use a consistent set; do not mix styles.
- **Stock/AI images**: use them to illustrate a concrete noun, not as wallpaper.
- **Motion**: fast enough to feel alive, slow enough to read. Avoid constant movement.
- **Transitions**: use cuts by default; use wipes/zooms only to signal a change in idea.
- **Background**: keep it quiet; the text is the star.

## TTS

- Choose a voice that matches the audience and the profile.
- Generate per scene or per sentence, not one giant file; this makes timing and re-generation easier.
- Measure each clip's duration and use it to time the scene.
- Add small pauses between ideas; do not let the voice run without breathing room.
- Fix pronunciation of names and jargon with a lexicon or phonetic spelling.
- Do not use TTS to fake a real person's voice without consent.
- Check the provider's license for commercial use.

## Music and SFX

- Music supports the pace; it does not replace the script.
- Duck music under voice.
- Use SFX for transitions, reveals, and UI-like moments, not for every word.
- Keep a consistent palette; do not jump genres.
- End with a deliberate fade or button, not an abrupt stop.

## Captions

- Burn captions for social; sidecar for platforms that support them.
- Keep the caption style consistent with the profile.
- Highlight key words if the style allows, but do not make every word a different color.
- Captions should be readable without the voice.

## Engine

- **HyperFrames**: default for HTML/CSS/GSAP explainers, kinetic type, charts, and maps.
- **Remotion**: when the project needs React components, data, or complex state.
- **FFmpeg**: when the explainer is mostly images + voice + simple captions.
- **3D**: use `3d-cartoon` or a hybrid pipeline if the explainer needs 3D visuals.

## QA

- [ ] The hook works in the first 3 seconds.
- [ ] Each scene makes one point.
- [ ] The voice is intelligible at mobile volume.
- [ ] Captions are in sync and readable.
- [ ] The visuals match the words.
- [ ] No scene is longer than it needs to be.
- [ ] The music is ducked and licensed.
- [ ] The CTA is clear.
- [ ] The video works without sound (captions) and with sound (voice).

## Example

A 45-second explainer: "Como um LLM prevê a próxima palavra"

1. Hook: "Quando você digita 'o gato subiu no', o modelo já sabe o que vem depois." (0–4 s)
2. Context: next-token prediction is the core mechanic. (4–12 s)
3. Explain 1: tokens, not words. (12–22 s)
4. Explain 2: probabilities, not thoughts. (22–32 s)
5. Proof: a small probability table with three candidates. (32–40 s)
6. CTA: "É por isso que a qualidade do prompt importa." (40–45 s)

Visuals: dark background, cyan/magenta accents, one sentence per scene, a token probability chart, a subtle grid. Voice: TTS pt-BR. Music: low synth bed.
