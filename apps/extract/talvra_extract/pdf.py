"""PDF: one section per page (pages are what students and instructors cite)."""

import re

import pypdfium2 as pdfium

from .model import BadFile, Extracted, Section

# Lines repeated on most pages (running headers/footers, page numbers) are noise.
PAGE_NUMBER = re.compile(r"^\s*(page\s*)?\d+(\s*(of|/)\s*\d+)?\s*$", re.I)


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    # Re-join words hyphenated across line breaks: "exam-\nple" -> "example".
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    lines = [ln.rstrip() for ln in text.split("\n")]
    out: list[str] = []
    for ln in lines:
        if PAGE_NUMBER.match(ln):
            continue
        out.append(ln)
    # Collapse 3+ blank lines.
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def extract_pdf(data: bytes) -> Extracted:
    try:
        pdf = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        raise BadFile(
            f"Couldn't open this PDF ({e}). It may be damaged or password-protected."
        ) from e
    try:
        pages: list[str] = []
        for i in range(len(pdf)):
            page = pdf[i]
            tp = page.get_textpage()
            pages.append(_clean(tp.get_text_bounded()))
            tp.close()
            page.close()
        title = (pdf.get_metadata_dict().get("Title") or "").strip() or None
    finally:
        pdf.close()

    # Drop lines that repeat on more than half the pages (headers/footers).
    if len(pages) >= 4:
        counts: dict[str, int] = {}
        for p in pages:
            for ln in set(p.split("\n")):
                if ln.strip():
                    counts[ln.strip()] = counts.get(ln.strip(), 0) + 1
        noisy = {ln for ln, n in counts.items() if n > len(pages) / 2 and len(ln) < 120}
        pages = ["\n".join(ln for ln in p.split("\n") if ln.strip() not in noisy) for p in pages]

    sections = [
        Section(f"Page {i + 1}", 2, text, "page", i + 1)
        for i, text in enumerate(pages)
        if text.strip()
    ]
    warnings: list[str] = []
    total = sum(len(p) for p in pages)
    if pages and total < 40 * len(pages):
        # Almost no text layer: scanned slides/handouts. OCR comes later.
        warnings.append("little_text")
    md = "\n\n".join(f"## Page {s.anchor}\n\n{s.text}" for s in sections)
    return Extracted(md, sections, page_count=len(pages), title=title, warnings=warnings)
