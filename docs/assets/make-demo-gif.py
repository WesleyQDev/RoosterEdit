"""Generate the minimalist README GIF for RoosterEdit + OpenCode.

The canvas is the chat window: no outer frame, no colors, no desktop chrome.
Requirements: Python 3, Pillow, FFmpeg.
"""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "opencode-demo.gif"
FRAMES = Path(tempfile.gettempdir()) / "rooster-readme-gif"

W, H = 960, 640
S = 2
FPS = 10
DURATION = 21.0

BG = (8, 8, 8, 255)
PANEL = (14, 14, 14, 255)
CHAT_BG = (10, 10, 10, 255)
BORDER = (42, 42, 42, 255)
BORDER_SOFT = (29, 29, 29, 255)
TEXT = (245, 245, 245, 255)
MUTED = (166, 166, 166, 255)
FAINT = (108, 108, 108, 255)
BUBBLE = (23, 23, 23, 255)
BUBBLE_BORDER = (45, 45, 45, 255)
PILL = (17, 17, 17, 255)
PILL_BORDER = (58, 58, 58, 255)
WHITE = (255, 255, 255, 255)
GRAY = (150, 150, 150, 255)
DOT = (112, 112, 112, 255)

HEADER_H = 52
INPUT_H = 48
CHAT_TOP = HEADER_H
CHAT_H = H - HEADER_H - INPUT_H - 14
CHAT_PAD = 28
LINE_H = 24
MSG_GAP = 18
USER_PAD_X = 16
USER_PAD_Y = 12
USER_MAX_W = 620
AGENT_MAX_W = 780
CARD_W = 360
CARD_H = 146


def sc(value: float) -> int:
    return int(round(value * S))


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, sc(size))


F_REG = font(r"C:\Windows\Fonts\segoeui.ttf", 16)
F_BOLD = font(r"C:\Windows\Fonts\segoeuib.ttf", 16)
F_SMALL = font(r"C:\Windows\Fonts\segoeui.ttf", 12)
F_SMALL_BOLD = font(r"C:\Windows\Fonts\segoeuib.ttf", 12)
F_TINY = font(r"C:\Windows\Fonts\segoeui.ttf", 10)
F_TINY_BOLD = font(r"C:\Windows\Fonts\segoeuib.ttf", 10)
F_MONO = font(r"C:\Windows\Fonts\consola.ttf", 10)
F_PLAY = font(r"C:\Windows\Fonts\segoeuib.ttf", 22)

MESSAGES = [
    {
        "role": "user",
        "text": "Instale a skill RoosterEdit e valide o ambiente.",
        "at": 1.0,
    },
    {
        "role": "agent",
        "text": "Skill instalada localmente. Node, FFmpeg e HyperFrames OK.",
        "at": 2.4,
        "typing": 0.8,
        "reveal": 1.4,
    },
    {
        "role": "agent",
        "text": "Quer configurar o workspace agora?",
        "at": 4.9,
        "typing": 0.7,
        "reveal": 1.1,
    },
    {
        "role": "user",
        "text": "Sim, por favor.",
        "at": 6.9,
    },
    {
        "role": "agent",
        "text": "Workspace criado. O que o canal vai produzir?",
        "at": 7.8,
        "typing": 0.8,
        "reveal": 1.6,
        "step": "1/8",
    },
    {
        "role": "user",
        "text": "Shorts de tecnologia em português.",
        "at": 10.4,
    },
    {
        "role": "agent",
        "text": "Canal pt-tech pronto: 9:16 · tech-neon · TTS · SFX leves.",
        "at": 11.2,
        "typing": 0.8,
        "reveal": 1.6,
        "step": "2/8",
    },
    {
        "role": "agent",
        "text": "Posso seguir com o primeiro vídeo?",
        "at": 13.6,
        "typing": 0.6,
        "reveal": 1.0,
    },
    {
        "role": "user",
        "text": "Sim.",
        "at": 15.2,
    },
    {
        "role": "agent",
        "text": "Plano pronto em edit/plan.html. Posso seguir com a timeline?",
        "at": 15.9,
        "typing": 0.7,
        "reveal": 1.5,
        "step": "4/8",
    },
    {
        "role": "agent",
        "text": "Render final concluído. O vídeo está pronto para revisão.",
        "at": 18.0,
        "typing": 0.7,
        "reveal": 1.4,
        "card": True,
    },
]


def text_width(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont) -> int:
    return int(draw.textlength(text, font=f))


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if text_width(draw, trial, f) <= max_w or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def measure_layouts() -> list[dict]:
    scratch = Image.new("RGBA", (10, 10))
    draw = ImageDraw.Draw(scratch)
    layouts = []
    y = 10
    for msg in MESSAGES:
        if msg["role"] == "user":
            lines = wrap(draw, msg["text"], F_REG, sc(USER_MAX_W - 2 * USER_PAD_X))
            width = max(text_width(draw, line, F_REG) for line in lines) // S + 2 * USER_PAD_X
            height = len(lines) * LINE_H + 2 * USER_PAD_Y
            layout = {**msg, "lines": lines, "width": width, "height": height, "y": y}
        else:
            lines = wrap(draw, msg["text"], F_REG, sc(AGENT_MAX_W))
            text_h = len(lines) * LINE_H
            height = 18 + 6 + text_h
            if msg.get("card"):
                height += 14 + CARD_H
            layout = {**msg, "lines": lines, "width": AGENT_MAX_W, "height": height, "y": y}
        layouts.append(layout)
        y += layout["height"] + MSG_GAP
    return layouts


LAYOUTS = measure_layouts()


def draw_round_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int, int] | None = None,
    outline: tuple[int, int, int, int] | None = None,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_header(draw: ImageDraw.ImageDraw) -> None:
    draw.rectangle((0, 0, sc(W), sc(HEADER_H)), fill=PANEL)
    draw.line((0, sc(HEADER_H), sc(W), sc(HEADER_H)), fill=BORDER_SOFT, width=sc(1))

    for i, shade in enumerate([74, 96, 120]):
        draw.ellipse(
            (sc(22 + i * 16), sc(20), sc(30 + i * 16), sc(28)),
            fill=(shade, shade, shade, 255),
        )

    draw.text((sc(78), sc(15)), "RoosterEdit", font=F_BOLD, fill=TEXT)
    draw.text((sc(174), sc(18)), "instalação", font=F_SMALL, fill=MUTED)


def draw_step_pill(draw: ImageDraw.ImageDraw, x: int, y: int, step: str) -> None:
    label = f"Etapa {step}"
    width = text_width(draw, label, F_TINY_BOLD) // S + 14
    draw_round_rect(
        draw,
        (sc(x), sc(y), sc(x + width), sc(y + 18)),
        sc(9),
        fill=PILL,
        outline=PILL_BORDER,
        width=sc(1),
    )
    draw.text((sc(x + 7), sc(y + 3)), label, font=F_TINY_BOLD, fill=TEXT)


def draw_typing(draw: ImageDraw.ImageDraw, x: int, y: int, t: float) -> None:
    width = sc(48)
    height = sc(28)
    draw_round_rect(
        draw,
        (sc(x), sc(y), sc(x + width), sc(y + height)),
        sc(12),
        fill=(18, 18, 18, 255),
        outline=BORDER,
        width=sc(1),
    )
    for i in range(3):
        phase = t * 5.0 + i * 0.9
        offset = math.sin(phase) * 1.4
        cx = x + 14 + i * 10
        cy = y + 14 + offset
        radius = 2.0 + 0.3 * math.sin(phase)
        draw.ellipse(
            (sc(cx - radius), sc(cy - radius), sc(cx + radius), sc(cy + radius)),
            fill=GRAY,
        )


def draw_video_card(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw_round_rect(
        draw,
        (sc(x), sc(y), sc(x + CARD_W), sc(y + CARD_H)),
        sc(12),
        fill=(15, 15, 15, 255),
        outline=BORDER,
        width=sc(1),
    )
    thumb_w, thumb_h = 72, 128
    draw_round_rect(
        draw,
        (sc(x + 10), sc(y + 9), sc(x + 10 + thumb_w), sc(y + 9 + thumb_h)),
        sc(8),
        fill=(26, 26, 26, 255),
        outline=(60, 60, 60, 255),
        width=sc(1),
    )
    draw.ellipse(
        (sc(x + 10 + 36 - 16), sc(y + 9 + 64 - 16), sc(x + 10 + 36 + 16), sc(y + 9 + 64 + 16)),
        outline=(220, 220, 220, 255),
        width=sc(1),
    )
    draw.polygon(
        [
            (sc(x + 10 + 31), sc(y + 9 + 55)),
            (sc(x + 10 + 31), sc(y + 9 + 73)),
            (sc(x + 10 + 46), sc(y + 9 + 64)),
        ],
        fill=WHITE,
    )
    draw.text(
        (sc(x + 98), sc(y + 18)),
        "Vídeo final",
        font=F_SMALL_BOLD,
        fill=TEXT,
    )
    draw.text(
        (sc(x + 98), sc(y + 40)),
        "30s · 9:16 · 1080×1920",
        font=F_TINY,
        fill=MUTED,
    )
    draw.text(
        (sc(x + 98), sc(y + 58)),
        "renders/final.mp4",
        font=F_MONO,
        fill=GRAY,
    )


def draw_agent_message(
    draw: ImageDraw.ImageDraw,
    msg: dict,
    y: int,
    t: float,
    scroll: float,
) -> None:
    screen_y = y - scroll
    avatar_x = CHAT_PAD
    avatar_y = screen_y + 1
    draw.ellipse(
        (sc(avatar_x), sc(avatar_y), sc(avatar_x + 24), sc(avatar_y + 24)),
        fill=(20, 20, 20, 255),
        outline=(60, 60, 60, 255),
        width=sc(1),
    )
    draw.text((sc(avatar_x + 7), sc(avatar_y + 3)), "R", font=F_TINY_BOLD, fill=TEXT)

    text_x = avatar_x + 36
    draw.text((sc(text_x), sc(screen_y)), "RoosterEdit", font=F_SMALL_BOLD, fill=MUTED)
    if msg.get("step"):
        draw_step_pill(draw, text_x + 82, screen_y - 1, msg["step"])

    typing = msg.get("typing", 0)
    reveal_start = msg["at"] + typing
    reveal = max(0.01, msg.get("reveal", 0.8))
    progress = max(0.0, min(1.0, (t - reveal_start) / reveal))
    has_text = t >= reveal_start
    text_y = screen_y + 22

    if not has_text and t >= msg["at"]:
        draw_typing(draw, text_x, text_y - 2, t)
        return
    if not has_text:
        return

    total_chars = int(round(len(msg["text"]) * progress))
    remaining = total_chars
    line_y = text_y
    last_part = ""
    for line in msg["lines"]:
        if remaining <= 0:
            break
        last_part = line[:remaining]
        draw.text((sc(text_x), sc(line_y)), last_part, font=F_REG, fill=TEXT)
        remaining -= len(line) + 1
        line_y += LINE_H

    if progress < 1.0 and total_chars > 0 and last_part:
        caret_x = text_x + text_width(draw, last_part, F_REG) // S + 2
        draw.rectangle(
            (sc(caret_x), sc(line_y - LINE_H + 4), sc(caret_x + 1.5), sc(line_y - 5)),
            fill=WHITE,
        )

    if msg.get("card") and progress >= 0.82:
        draw_video_card(draw, text_x, text_y + len(msg["lines"]) * LINE_H + 12)


def draw_user_message(draw: ImageDraw.ImageDraw, msg: dict, y: int, t: float, scroll: float) -> None:
    if t < msg["at"]:
        return
    screen_y = y - scroll
    x = W - CHAT_PAD - msg["width"]
    draw_round_rect(
        draw,
        (sc(x), sc(screen_y), sc(x + msg["width"]), sc(screen_y + msg["height"])),
        sc(13),
        fill=BUBBLE,
        outline=BUBBLE_BORDER,
        width=sc(1),
    )
    remaining = len(msg["text"])
    line_y = screen_y + USER_PAD_Y
    for line in msg["lines"]:
        if remaining <= 0:
            break
        part = line[:remaining]
        draw.text((sc(x + USER_PAD_X), sc(line_y)), part, font=F_REG, fill=TEXT)
        remaining -= len(line) + 1
        line_y += LINE_H


def draw_input(draw: ImageDraw.ImageDraw, t: float) -> None:
    x = 18
    y = H - INPUT_H - 10
    w = W - 36
    h = 40
    draw_round_rect(
        draw,
        (sc(x), sc(y), sc(x + w), sc(y + h)),
        sc(11),
        fill=(15, 15, 15, 255),
        outline=BORDER,
        width=sc(1),
    )
    draw.text((sc(x + 16), sc(y + 11)), "Pergunte qualquer coisa…", font=F_SMALL, fill=FAINT)
    if int(t * 2) % 2 == 0:
        caret_x = x + 174
        draw.rectangle((sc(caret_x), sc(y + 11), sc(caret_x + 1.5), sc(y + 29)), fill=WHITE)


def visible_bottom(t: float) -> float:
    bottom = 0
    for msg in LAYOUTS:
        if t >= msg["at"]:
            bottom = msg["y"] + msg["height"]
    return bottom


def render_frame(t: float, scroll: float) -> Image.Image:
    img = Image.new("RGBA", (sc(W), sc(H)), BG)
    draw = ImageDraw.Draw(img)
    draw_header(draw)

    chat_layer = Image.new("RGBA", (sc(W), sc(CHAT_H)), CHAT_BG)
    chat_draw = ImageDraw.Draw(chat_layer)
    for msg in LAYOUTS:
        if t < msg["at"]:
            continue
        y = msg["y"] - 4
        if msg["role"] == "user":
            draw_user_message(chat_draw, msg, y, t, scroll)
        else:
            draw_agent_message(chat_draw, msg, y, t, scroll)

    img.paste(chat_layer, (0, sc(CHAT_TOP)))

    if scroll > 2:
        cover_h = 18
        draw.rectangle((0, sc(CHAT_TOP), sc(W), sc(CHAT_TOP + cover_h)), fill=CHAT_BG)
        fade_h = sc(24)
        fade = Image.new("RGBA", (sc(W), fade_h), (0, 0, 0, 0))
        fade_draw = ImageDraw.Draw(fade)
        for yy in range(fade_h):
            alpha = int(255 * (1 - yy / max(1, fade_h - 1)))
            fade_draw.line((0, yy, sc(W), yy), fill=(10, 10, 10, alpha))
        img.alpha_composite(fade, (0, sc(CHAT_TOP + cover_h)))

    draw_input(draw, t)
    return img.resize((W, H), Image.Resampling.LANCZOS)


def main() -> None:
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True, exist_ok=True)

    total_frames = int(round(DURATION * FPS))
    scroll = 0.0
    for index in range(total_frames):
        t = index / FPS
        target = max(0.0, visible_bottom(t) + 22 - CHAT_H)
        scroll += (target - scroll) * 0.16
        frame = render_frame(t, scroll)
        frame.convert("RGB").save(FRAMES / f"frame-{index:04d}.png")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to assemble the GIF.")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-framerate",
            str(FPS),
            "-i",
            str(FRAMES / "frame-%04d.png"),
            "-vf",
            "split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
            "-loop",
            "0",
            str(OUT),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
