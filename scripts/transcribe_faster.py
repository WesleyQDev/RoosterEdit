#!/usr/bin/env python3
"""
Transcribe audio/video with faster-whisper and write RoosterEdit JSON.

Usage:
  python scripts/transcribe_faster.py \
    --input path/to/audio.wav \
    --output path/to/edit/transcript.json \
    --language pt \
    --model small
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np


def load_audio(source: Path) -> tuple[np.ndarray, str]:
    """Decode any media to a 16 kHz mono float32 array with FFmpeg.

    Passing a numpy array to faster-whisper avoids PyAV's decoding path, which
    is useful when the installed PyAV version is newer than faster-whisper
    expects.
    """
    handle, temp_path = tempfile.mkstemp(suffix=".wav", prefix="rooster-asr-")
    os.close(handle)
    Path(temp_path).unlink(missing_ok=True)
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                "-acodec",
                "pcm_s16le",
                temp_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "ffmpeg failed to decode the input")

        with wave.open(temp_path, "rb") as wav:
            frames = wav.readframes(wav.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        return audio, temp_path
    finally:
        Path(temp_path).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe with faster-whisper")
    parser.add_argument("--input", required=True, help="Audio or video file")
    parser.add_argument("--output", required=True, help="Transcript JSON path")
    parser.add_argument("--language", default="pt", help="Language code (default: pt)")
    parser.add_argument("--model", default="small", help="Whisper model (default: small)")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--compute-type", default="int8", help="int8, float16, float32")
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size (default: 5)")
    parser.add_argument("--verbose", action="store_true", help="Print every segment")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster-whisper is not installed. Install it with:\n"
            "  python -m pip install --user -U faster-whisper",
            file=sys.stderr,
        )
        return 1

    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.exists():
        print(f"Input not found: {source}", file=sys.stderr)
        return 1

    output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading model {args.model} ({args.device}/{args.compute_type})...", file=sys.stderr)
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=0,
    )

    print(f"Decoding {source.name} with FFmpeg...", file=sys.stderr)
    audio, _ = load_audio(source)

    print(f"Transcribing {source.name}...", file=sys.stderr)
    segments, info = model.transcribe(
        audio,
        language=args.language,
        beam_size=args.beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=True,
    )

    segment_rows = []
    word_rows = []
    for index, segment in enumerate(segments):
        text = (segment.text or "").strip()
        segment_rows.append(
            {
                "id": index,
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
            }
        )
        for word in getattr(segment, "words", None) or []:
            word_text = (word.word or "").strip()
            if not word_text:
                continue
            word_rows.append(
                {
                    "id": f"w{len(word_rows)}",
                    "text": word_text,
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                }
            )
        if args.verbose:
            print(
                f"[{segment.start:7.2f} -> {segment.end:7.2f}] {text}",
                file=sys.stderr,
            )

    text = " ".join(row["text"] for row in segment_rows).strip()
    payload = {
        "schema": "rooster.transcript/v1",
        "source": source.name,
        "language": getattr(info, "language", args.language) or args.language,
        "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 4),
        "text": text,
        "segments": segment_rows,
        "words": word_rows,
    }

    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    duration = segment_rows[-1]["end"] if segment_rows else 0
    print(
        f"Wrote {output} ({len(segment_rows)} segments, {len(word_rows)} words, {duration:.2f}s)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
