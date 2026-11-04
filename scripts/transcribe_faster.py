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

SAMPLE_RATE = 16000
F32LE_ITEM_SIZE = 4


def _decode_audio_pipe(source: Path) -> np.ndarray:
    """Decode the media to mono 16 kHz float32 through an FFmpeg pipe."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(message or "ffmpeg failed to decode the input")

    raw = result.stdout
    usable = len(raw) - (len(raw) % F32LE_ITEM_SIZE)
    # frombuffer keeps a zero-copy view over the FFmpeg output, so only one
    # float32 buffer is alive. astype is a no-op on little-endian hosts.
    audio = np.frombuffer(raw[:usable], dtype="<f4")
    return audio.astype(np.float32, copy=False)


def _decode_audio_temp_wav(source: Path) -> np.ndarray:
    """Fallback decoder: write a temporary 16-bit WAV and read it back."""
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
                str(SAMPLE_RATE),
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
        return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    finally:
        Path(temp_path).unlink(missing_ok=True)


def load_audio(source: Path) -> np.ndarray:
    """Decode any media to a 16 kHz mono float32 array with FFmpeg.

    Passing a numpy array to faster-whisper avoids PyAV's decoding path, which
    is useful when the installed PyAV version is newer than faster-whisper
    expects. Samples come from an FFmpeg pipe (f32le), so there is no temporary
    WAV and no int16 intermediate copy. If the pipe fails for any reason, the
    temp WAV path is used and a warning is printed to stderr.
    """
    try:
        return _decode_audio_pipe(source)
    except Exception as error:  # Any pipe failure must fall back, not abort.
        print(
            f"FFmpeg pipe decode failed ({error}); falling back to a temporary WAV.",
            file=sys.stderr,
        )
        return _decode_audio_temp_wav(source)


def split_audio(audio: np.ndarray, max_audio_minutes: float) -> list[tuple[float, np.ndarray]]:
    """Split decoded audio into (start_seconds, samples) chunks.

    Chunks are fixed length and non-overlapping; callers add the start offset
    to every timestamp so the transcript stays absolute. A non-positive limit
    returns the whole audio as a single chunk.
    """
    if max_audio_minutes <= 0:
        return [(0.0, audio)]
    chunk_samples = max(int(max_audio_minutes * 60 * SAMPLE_RATE), SAMPLE_RATE)
    total = int(audio.shape[0])
    if total <= chunk_samples:
        return [(0.0, audio)]
    return [
        (start / SAMPLE_RATE, audio[start : start + chunk_samples])
        for start in range(0, total, chunk_samples)
    ]


def resolve_device(requested: str) -> str:
    """Map device=auto to cuda when CTranslate2 reports a CUDA device."""
    if requested != "auto":
        return requested
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:  # No CTranslate2/CUDA runtime: CPU is the safe default.
        pass
    return "cpu"


def resolve_compute_type(requested: str, device: str) -> str:
    """Map compute-type=auto to float16 on cuda and int8 on cpu."""
    if requested != "auto":
        return requested
    return "float16" if device == "cuda" else "int8"


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe with faster-whisper")
    parser.add_argument("--input", required=True, help="Audio or video file")
    parser.add_argument("--output", required=True, help="Transcript JSON path")
    parser.add_argument("--language", default="pt", help="Language code (default: pt)")
    parser.add_argument("--model", default="small", help="Whisper model (default: small)")
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda"),
        default="auto",
        help="Inference device (default: auto = cuda when available)",
    )
    parser.add_argument(
        "--compute-type",
        choices=("auto", "int8", "float16", "float32", "int8_float16"),
        default="auto",
        help="CTranslate2 compute type (default: auto = float16 on cuda, int8 on cpu)",
    )
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size (default: 5)")
    parser.add_argument(
        "--words",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Emit word timestamps (default: enabled)",
    )
    parser.add_argument(
        "--vad",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Filter silence with VAD (default: enabled)",
    )
    parser.add_argument(
        "--vad-min-silence-ms",
        type=int,
        default=500,
        help="VAD minimum silence duration in milliseconds (default: 500)",
    )
    parser.add_argument(
        "--cpu-threads",
        type=int,
        default=0,
        help="CTranslate2 CPU threads (default: 0 = auto)",
    )
    parser.add_argument(
        "--max-audio-minutes",
        type=float,
        default=0.0,
        help="Split audio into chunks of this many minutes, keeping absolute "
        "timestamps (default: 0 = no chunking)",
    )
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

    device = resolve_device(args.device)
    compute_type = resolve_compute_type(args.compute_type, device)
    print(
        f"Device {device} / compute type {compute_type} "
        f"(requested {args.device}/{args.compute_type})",
        file=sys.stderr,
    )

    print(f"Loading model {args.model} ({device}/{compute_type})...", file=sys.stderr)
    try:
        model = WhisperModel(
            args.model,
            device=device,
            compute_type=compute_type,
            cpu_threads=args.cpu_threads,
        )
    except Exception as error:
        print(f"Failed to load model {args.model}: {error}", file=sys.stderr)
        return 1

    print(f"Decoding {source.name} with FFmpeg...", file=sys.stderr)
    try:
        audio = load_audio(source)
    except Exception as error:
        print(f"Failed to decode {source}: {error}", file=sys.stderr)
        return 1

    chunks = split_audio(audio, args.max_audio_minutes)
    if audio.shape[0] == 0:
        print("Decoded audio has zero samples; writing an empty transcript.", file=sys.stderr)
    elif len(chunks) == 1:
        print(f"Transcribing {source.name}...", file=sys.stderr)
    else:
        print(
            f"Transcribing {source.name} in {len(chunks)} chunks of up to "
            f"{args.max_audio_minutes:g} min...",
            file=sys.stderr,
        )

    segment_rows: list[dict] = []
    word_rows: list[dict] = []
    detected_language: str | None = None
    language_probability = 0.0
    info_captured = False
    for chunk_index, (offset, chunk) in enumerate(chunks):
        if chunk.shape[0] == 0:
            continue
        if len(chunks) > 1:
            print(
                f"Chunk {chunk_index + 1}/{len(chunks)}: {offset:.1f}s to "
                f"{offset + chunk.shape[0] / SAMPLE_RATE:.1f}s",
                file=sys.stderr,
            )
        segments, info = model.transcribe(
            chunk,
            language=args.language,
            beam_size=args.beam_size,
            word_timestamps=args.words,
            vad_filter=args.vad,
            vad_parameters={"min_silence_duration_ms": args.vad_min_silence_ms},
        )
        if not info_captured:
            info_captured = True
            detected_language = getattr(info, "language", None)
            language_probability = round(
                float(getattr(info, "language_probability", 0.0) or 0.0), 4
            )
        for segment in segments:
            start = offset + float(segment.start)
            end = offset + float(segment.end)
            text = (segment.text or "").strip()
            segment_rows.append(
                {
                    "id": len(segment_rows),
                    "start": round(start, 3),
                    "end": round(end, 3),
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
                        "start": round(offset + float(word.start), 3),
                        "end": round(offset + float(word.end), 3),
                    }
                )
            if args.verbose:
                print(
                    f"[{start:7.2f} -> {end:7.2f}] {text}",
                    file=sys.stderr,
                )

    text = " ".join(row["text"] for row in segment_rows).strip()
    payload = {
        "schema": "rooster.transcript/v1",
        "source": source.name,
        "language": detected_language or args.language,
        "language_probability": language_probability,
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
