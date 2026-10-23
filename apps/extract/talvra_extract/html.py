"""HTML (Canvas pages) and plain text / Markdown."""

import re

from bs4 import BeautifulSoup
from markdownify import markdownify

from .markdown_sections import sections_from_markdown
from .model import Extracted


def extract_html(data: bytes) -> Extracted:
    soup = BeautifulSoup(data, "html.parser")
    # Never carry scripts, styles or embedded frames into study material.
    for tag in soup(["script", "style", "iframe", "noscript", "form", "object", "embed"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else None
    md = markdownify(str(soup), heading_style="ATX", bullets="-", strip=["img"]).strip()
    md = re.sub(r"\n{3,}", "\n\n", md)
    return Extracted(md, sections_from_markdown(md, title or "Page"), title=title)


def extract_text(data: bytes, is_markdown: bool) -> Extracted:
    text = data.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
    return Extracted(text, sections_from_markdown(text if is_markdown else text, "Document"))
