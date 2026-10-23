import io
import zipfile

from .html import extract_html, extract_text
from .model import BadFile, Extracted, UnsupportedType
from .office import extract_docx, extract_pptx
from .pdf import extract_pdf

PDF_MAGIC = b"%PDF"
ZIP_MAGIC = b"PK\x03\x04"


def kind_of(filename: str, content_type: str, data: bytes) -> str:
    name = filename.lower()
    ct = content_type.lower()
    if data.startswith(PDF_MAGIC) or name.endswith(".pdf") or "pdf" in ct:
        return "pdf"
    if name.endswith(".docx") or "wordprocessingml" in ct:
        return "docx"
    if name.endswith(".pptx") or "presentationml" in ct:
        return "pptx"
    if name.endswith((".html", ".htm")) or "html" in ct:
        return "html"
    if name.endswith((".md", ".markdown")) or "markdown" in ct:
        return "md"
    if name.endswith(".txt") or ct.startswith("text/"):
        return "txt"
    if name.endswith((".doc", ".ppt")):
        raise UnsupportedType(
            "Old Office formats (.doc, .ppt) aren't supported yet. Save as .docx/.pptx."
        )
    raise UnsupportedType(f"Talvra can't read this file type yet ({content_type or filename}).")


MAX_UNZIPPED = 300 * 1024 * 1024
MAX_RATIO = 100


def check_zip(data: bytes) -> None:
    """Refuse zip bombs before python-docx/pptx decompress everything."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            total = sum(i.file_size for i in z.infolist())
    except zipfile.BadZipFile as e:
        raise BadFile("This file isn't a valid Office document.") from e
    if total > MAX_UNZIPPED or total > MAX_RATIO * max(len(data), 1):
        raise BadFile("This file expands to an unreasonable size and can't be read.")


def extract(data: bytes, filename: str, content_type: str) -> Extracted:
    kind = kind_of(filename, content_type, data)
    if kind in ("docx", "pptx"):
        if not data.startswith(ZIP_MAGIC):
            raise BadFile("This file isn't a valid Office document.")
        check_zip(data)
    return {
        "pdf": lambda: extract_pdf(data),
        "docx": lambda: extract_docx(data),
        "pptx": lambda: extract_pptx(data),
        "html": lambda: extract_html(data),
        "md": lambda: extract_text(data, True),
        "txt": lambda: extract_text(data, False),
    }[kind]()
