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


# Page slides: text on the left, the real lecture page on the right.
PAGE_BOX = (552, 64, W - 48, H - 96)  # x0, y0, x1, y1 the page is fitted into
TEXT_RIGHT = 512


def render_page_slide(
    bg_path: Path,
    page_path: Path,
    heading: str,
    bullets: list[str],
    footer: str,
    page: Image.Image,
    page_number: int,
) -> tuple[int, int, int, int]:
    """Draws the static frame and saves the page (at 2x) for the zoom.

    Returns where the page goes (x, y, w, h); even sizes, as H.264 needs.
    """
    x0, y0, x1, y1 = PAGE_BOX
    box_w, box_h = x1 - x0, y1 - y0
    ratio = min(box_w / page.width, box_h / page.height)
    fw, fh = int(page.width * ratio) // 2 * 2, int(page.height * ratio) // 2 * 2
    px, py = x0 + (box_w - fw) // 2, y0 + (box_h - fh) // 2

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 14, H], fill=ACCENT)
    # A soft frame so the page reads as "the source".
    d.rounded_rectangle(
        [px - 10, py - 10, px + fw + 10, py + fh + 10], radius=10, fill=(229, 231, 235)
    )
    d.rectangle([px - 1, py - 1, px + fw, py + fh], outline=(209, 213, 219), width=1)

    title_font = _font(True, 38)
    body_font = _font(False, 26)
    small = _font(False, 20)
    width = TEXT_RIGHT - MARGIN
    y = 72
    for line in _wrap(d, heading, title_font, width)[:3]:
        d.text((MARGIN, y), line, font=title_font, fill=INK)
        y += int(title_font.size * 1.25)
    y += 20
    for bullet in bullets[:4]:
        lines = _wrap(d, bullet, body_font, width - 30)[:3]
        if y + len(lines) * 36 > H - MARGIN - 40:
            break
        d.ellipse([MARGIN, y + 11, MARGIN + 10, y + 21], fill=ACCENT)
        for line in lines:
            d.text((MARGIN + 28, y), line, font=body_font, fill=INK)
            y += 36
        y += 12
    d.text((px, py + fh + 18), f"Page {page_number}", font=small, fill=MUTED)
    d.text((MARGIN, H - 56), footer[:48], font=small, fill=MUTED)
    img.save(bg_path, "PNG", optimize=True)

    page.resize((fw * 2, fh * 2), Image.Resampling.LANCZOS).save(page_path, "PNG")
    return px, py, fw, fh
