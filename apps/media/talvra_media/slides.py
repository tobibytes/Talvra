"""Draws 1280x720 study slides with Pillow. Plain, high-contrast, readable."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
MARGIN = 88
BG = (250, 250, 252)
INK = (17, 24, 39)
MUTED = (75, 85, 99)
ACCENT = (29, 78, 216)

FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",  # Debian (container)
    "/System/Library/Fonts/Supplemental",  # macOS (local tests)
    "/Library/Fonts",
]


def _font(bold: bool, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ["DejaVuSans-Bold.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "Arial.ttf"]
    for d in FONT_DIRS:
        for n in names:
            p = Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=font) <= width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def render_slide(path: Path, heading: str, bullets: list[str], footer: str, index: int) -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 14, H], fill=ACCENT)
    title_font = _font(True, 54 if index == 0 else 46)
    body_font = _font(False, 32)
    small = _font(False, 22)

    y = MARGIN if bullets else H // 2 - 80
    for line in _wrap(d, heading, title_font, W - 2 * MARGIN)[:3]:
        d.text((MARGIN, y), line, font=title_font, fill=INK)
        y += int(title_font.size * 1.25)
    y += 28

    for bullet in bullets[:6]:
        lines = _wrap(d, bullet, body_font, W - 2 * MARGIN - 40)[:3]
        if y + len(lines) * 44 > H - MARGIN - 20:
            break
        d.ellipse([MARGIN, y + 13, MARGIN + 12, y + 25], fill=ACCENT)
        for line in lines:
            d.text((MARGIN + 36, y), line, font=body_font, fill=INK if index else MUTED)
            y += 44
        y += 14

    d.text((MARGIN, H - 56), footer[:90], font=small, fill=MUTED)
    img.save(path, "PNG", optimize=True)
