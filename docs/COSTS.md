# Costs

AI video is not free, but you can separate what is required from what is optional. Prices vary by country, plan, and vendor; check the current price before subscribing.

## What is required

| Item | Cost | Note |
|---|---|---|
| An agent with access to files and commands | Subscription or API | Claude Pro, ChatGPT/Codex, Gemini, or another. It is the only cost truly required for the flow. |
| Node.js, FFmpeg, Python | Free | Local tools. |
| Whisper or faster-whisper | Free | Local transcription; uses CPU/GPU and time. |
| HyperFrames | Free and open source | Default engine for HTML/CSS/GSAP. |
| Remotion | Free for individuals and small teams; license for larger companies | Check the current license before using it commercially. |

## What is optional

| Item | Cost | When it makes sense |
|---|---|---|
| DaVinci Resolve Studio | Paid, one-time license | NLE handoff with more control; the free version imports EDL/FCPXML manually. |
| Paid TTS (ElevenLabs, OpenAI, etc.) | Per character/second | High-quality voice; Edge TTS and Piper are local/free alternatives. |
| Stock, music, and fonts | Variable | Only with a recorded license; never use without knowing the source. |
| OCR | Free | Native on Windows/macOS, Tesseract on Linux, or `tools install ocr-wasm` (~15 MB) into a user cache. |
| Cloud render | Per minute/machine | Long or 4K videos; local render is usually enough. |
| GPU | Hardware | Speeds up 3D and encodes; not required to start. |

## Invisible costs

- Repeated renders: every draft consumes time, disk, and, in the cloud, money.
- Style rework: redoing every element because the look was not approved first.
- Redone transcription: re-transcribing the same file with no need.
- Agent tokens: logs, transcripts, and code in the main context.

## How to spend less

1. Approve 3 style proof frames before the plan.
2. Build 3 sample elements (`build --sample 3`) before the full build.
3. Render a draft and review it; only then the final.
4. Use local Whisper/faster-whisper instead of paid transcription.
5. Use `digest` instead of the full transcript.
6. Reuse profiles, TTS, and projects; do not redo what did not change.
7. Delegate the heavy stages to subagents and read only the handoff.

## Golden rule

RoosterEdit does not call a paid API, a TTS provider, or cloud render without explicit permission. If the cost is unavoidable, it appears at the step gate with an estimate before running.

RoosterEdit itself is MIT. The cost belongs to the tools and services it orchestrates.

