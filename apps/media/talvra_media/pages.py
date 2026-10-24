"""Renders the lecture pages a video cites, so slides can show the real material."""

import pypdfium2 as pdfium
from PIL import Image

MAX_PAGES_RENDERED = 20
# Long side of a rendered page, in pixels: room for a slow zoom at 720p.
LONG_SIDE = 2000
MAX_PIXELS = 6_000_000


def render_pages(pdf: bytes, wanted: set[int]) -> dict[int, Image.Image]:
    """1-based page numbers -> RGB images. Bad PDFs or pages are skipped, never fatal."""
    out: dict[int, Image.Image] = {}
    if not pdf or not wanted:
        return out
    try:
        doc = pdfium.PdfDocument(pdf)
    except pdfium.PdfiumError:
        return out
    try:
        count = len(doc)
        for n in sorted(p for p in wanted if 1 <= p <= count)[:MAX_PAGES_RENDERED]:
            try:
                page = doc[n - 1]
                w, h = page.get_size()
                if w <= 0 or h <= 0:
                    continue
                scale = min(4.0, LONG_SIDE / max(w, h))
                if (w * scale) * (h * scale) > MAX_PIXELS:
                    scale = (MAX_PIXELS / (w * h)) ** 0.5
                img = page.render(scale=scale, fill_color=(255, 255, 255, 255)).to_pil()
                out[n] = img.convert("RGB")
                page.close()
            except pdfium.PdfiumError:
                continue
    finally:
        doc.close()
    return out
