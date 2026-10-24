"""Split Markdown into heading-anchored sections (for DOCX, HTML, text)."""

import re

from .model import Section

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def sections_from_markdown(markdown: str, fallback_title: str = "Document") -> list[Section]:
    sections: list[Section] = []
    heading, level, buf = fallback_title, 1, []
    in_code = False

    def flush():
        text = "\n".join(buf).strip()
        if text:
            sections.append(Section(heading, level, text, "section", len(sections) + 1))

    for line in markdown.splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
        m = None if in_code else HEADING.match(line)
        if m:
            flush()
            heading, level, buf = m.group(2) or fallback_title, len(m.group(1)), []
        else:
            buf.append(line)
    flush()
    return sections
