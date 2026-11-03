# Intake

The intake is a short conversation, not a form. Ask the questions that change the output, infer the rest, and confirm the expensive decisions. If you are unsure about a creative, audio, or cost decision, ask one focused question at the current `Etapa X/8` instead of guessing.

## The seven dimensions

| Dimension | Question | Default |
|---|---|---|
| Goal | What should the viewer do or feel after watching? | Inform + retain |
| Audience | Who is this for? | General audience |
| Platform | Where will it be published? | YouTube 16:9 |
| Duration | How long should it be? | 60 seconds |
| Source | Real footage, generated, or hybrid? | Hybrid |
| Voice | User voice, TTS, or none? | User voice for live, TTS for faceless, none for 3D |
| Style | User guide, profile, AI-created, or reference? | Profile if one exists, otherwise AI-created |

Then confirm:

- aspect ratio and resolution;
- language and accent;
- autonomy (`auto`, `guided`, `manual`);
- any hard constraints (brand, legal, deadline, music licensing).

## Questions by situation

### The user has footage

- How much footage, and what is in it?
- Is there an interview, a presenter, or only b-roll?
- Do you want to keep the original audio or replace it with music/TTS?
- Are there parts that must be included or excluded?
- Do you have a transcript or captions?

### The user wants a faceless video

- What is the core argument or story?
- Do you have a script, or should I write one?
- TTS or text-only with music?
- What visual style: clean, tech, editorial, playful, cinematic?
- Do you have images, screenshots, or brand assets?

### The user wants 3D

- What is the subject: character, product, abstract scene, environment?
- What style: low-poly, clay, realistic, toy, sci-fi?
- Is there dialogue or narration, or only music and captions?
- Does it need a specific aspect ratio and duration?
- Is there a reference video or image?

### The user sends a link

- Do you own this video or have permission to use it?
- Do you want the whole video, a section, or only the audio/transcript?
- Should I use the existing captions or transcribe it?
- Is the source a reference for style, or material to edit?

Read `references/link-ingest.md` before downloading.

### The user is vague

Ask at most three questions:

1. What is the video about, and who is it for?
2. Where will it be published, and how long should it be?
3. Do you have footage/assets, or should everything be generated?

Then propose a default plan and ask for correction.

## Mode detection

| Signal | Mode |
|---|---|
| "Just make it", "surprise me", "no stops" | `auto` |
| "Show me before rendering", "I want to approve" | `guided` |
| "Here is my script/EDL, follow it" | `manual` |
| "I have 40 minutes of footage" | `live`, likely `guided` |
| "No recording, use TTS" | `generated`, `tts` |
| "Use my brand" | `style: user` or `profile` |
| "Make it look like this" + reference | `style: reference` |
| "I don't have Node/FFmpeg" | Degrade to plan only; no motion render |

## Defaults come from the channel

Do not infer format, voice, or engine from a content label. Read the project's channel and use its defaults:

- format and duration;
- profile;
- source and voice;
- engine and autonomy;
- assets strategy.

Ask only when the channel leaves a value as `auto`, or when the project needs an override. There is no category or preset layer.

## What not to ask

- Questions the user already answered in the brief.
- Technical choices they do not care about (codec, CRF) unless they affect delivery.
- A full list of every asset they own. Ask for the folder or the files that matter.
- Whether they want "good quality". Assume yes.
- Too many style adjectives. Ask for references or brand assets instead.

## Intake summary template

Write this at the end of the intake, before planning:

```md
## Intake summary

- Goal:
- Audience:
- Platform / aspect:
- Duration:
- Source:
- Voice:
- Style:
- Assets:
- Autonomy:
- Constraints:
- Open questions:
```

If the user corrects the summary, update it before moving on.
