"""Output shape shared by every extractor. Mirrors ExtractResult in @talvra/contracts."""

from dataclasses import asdict, dataclass, field
from typing import Literal

AnchorKind = Literal["page", "slide", "section"]


@dataclass
class Section:
    """A citable piece of the document: one PDF page, one slide, or one heading's body."""

    heading: str
    level: int
    text: str
    anchor_kind: AnchorKind
    anchor: int  # 1-based page/slide/section number

    def to_json(self) -> dict:
        d = asdict(self)
        return {
            "heading": d["heading"],
            "level": d["level"],
            "text": d["text"],
            "anchor": {"kind": d["anchor_kind"], "n": d["anchor"]},
        }


@dataclass
class Extracted:
    markdown: str
    sections: list[Section]
    page_count: int | None = None
    title: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "markdown": self.markdown,
            "sections": [s.to_json() for s in self.sections],
            "pageCount": self.page_count,
            "title": self.title,
            "warnings": self.warnings,
            "wordCount": len(self.markdown.split()),
        }


class UnsupportedType(Exception):
    pass


class BadFile(Exception):
    """The bytes don't parse as the claimed type (corrupt, encrypted, truncated)."""
