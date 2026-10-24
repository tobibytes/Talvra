from fastapi.testclient import TestClient

from talvra_extract.app import app

client = TestClient(app)


def post(data: bytes, filename: str, content_type: str = "application/octet-stream"):
    return client.post(
        "/extract", content=data, headers={"content-type": content_type, "x-filename": filename}
    )


def test_pdf_has_one_section_per_page_and_drops_headers(pdf_bytes):
    r = post(pdf_bytes, "Lecture%201.pdf", "application/pdf")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pageCount"] == 4
    assert [s["anchor"] for s in body["sections"]] == [
        {"kind": "page", "n": n} for n in range(1, 5)
    ]
    assert "contiguously" in body["sections"][0]["text"]
    # Running header and "Page n of 4" are noise.
    assert "COSC 220 Fall 2026" not in body["markdown"]
    assert "of 4" not in body["markdown"]
    assert body["markdown"].startswith("## Page 1")
    assert body["title"] == "Lecture 1"
    assert body["warnings"] == []


def test_docx_keeps_headings_tables_and_lists(docx_bytes):
    r = post(docx_bytes, "Syllabus.docx")
    assert r.status_code == 200, r.text
    md = r.json()["markdown"]
    assert "# COSC 220 Syllabus" in md
    assert "## Grading" in md
    assert "### Late policy" in md
    assert "| Labs \\| quizzes | 40% |" in md
    assert "- Ten percent off per day." in md
    headings = [s["heading"] for s in r.json()["sections"]]
    assert headings == ["Grading", "Late policy"]


def test_pptx_has_one_section_per_slide_with_notes(pptx_bytes):
    r = post(pptx_bytes, "Lecture 2.pptx")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pageCount"] == 3
    assert [s["heading"] for s in body["sections"]] == [
        "Slide 1: Big-O notation",
        "Slide 2: Arrays",
        "Slide 3",
    ]
    s1 = body["sections"][0]["text"]
    assert "- Upper bound on growth" in s1
    assert "  - Drop constants" in s1
    assert "> Mention the exam question." in s1
    assert body["sections"][2]["anchor"] == {"kind": "slide", "n": 3}


def test_html_strips_scripts_and_converts():
    html = (
        b"<h2>Welcome</h2><p>Hello <b>class</b></p><script>alert(1)</script><ul><li>One</li></ul>"
    )
    r = post(html, "page-welcome.html", "text/html")
    assert r.status_code == 200
    md = r.json()["markdown"]
    assert "## Welcome" in md and "**class**" in md and "- One" in md
    assert "alert" not in md


def test_unsupported_and_broken_files():
    assert post(b"\x00\x01binary", "song.mp3", "audio/mpeg").status_code == 415
    assert post(b"PK\x03\x04garbage", "broken.docx").status_code == 422
    assert post(b"%PDF-1.4 garbage", "broken.pdf").status_code == 422
    assert post(b"", "empty.txt", "text/plain").status_code == 422
    assert post(b"old", "notes.doc").status_code == 415


def test_rejects_zip_bombs():
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"0" * (200 * 1024 * 1024))
    r = post(buf.getvalue(), "bomb.docx")
    assert r.status_code == 422
    assert "unreasonable size" in r.json()["error"]["message"]


def test_requires_secret_when_configured(monkeypatch, pdf_bytes):
    import talvra_extract.app as mod

    monkeypatch.setattr(mod, "SECRET", "s3cret")
    assert post(pdf_bytes, "a.pdf").status_code == 401
    ok = client.post(
        "/extract",
        content=pdf_bytes,
        headers={"x-filename": "a.pdf", "authorization": "Bearer s3cret"},
    )
    assert ok.status_code == 200


def test_symbol_font_bullets_become_list_items():
    from talvra_extract.pdf import _clean

    text = "Our goal:  Understand reliable transfer  Explain flow control"
    assert _clean(text) == "Our goal:\n- Understand reliable transfer\n- Explain flow control"
