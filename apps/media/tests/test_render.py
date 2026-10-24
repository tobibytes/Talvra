import os

os.environ.setdefault("ALLOW_NO_AUTH", "1")

import base64
import subprocess
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from talvra_media.app import app

client = TestClient(app)


def tone(seconds: float) -> bytes:
    with tempfile.TemporaryDirectory() as t:
        out = Path(t) / "a.mp3"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:duration={seconds}",
                str(out),
            ],
            check=True,
        )
        return out.read_bytes()


def probe(data: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(data)
        f.flush()
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_name,width,height",
                "-of",
                "default=nw=1",
                f.name,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    return {k: v for k, v in (line.split("=", 1) for line in out.strip().splitlines())} | {
        "raw": out
    }


def test_renders_slides_with_narration_into_mp4():
    slides = [
        {
            "heading": "Arrays and lists",
            "bullets": [],
            "audio_b64": base64.b64encode(tone(1.5)).decode(),
        },
        {
            "heading": "Arrays",
            "bullets": [
                "Elements are stored contiguously, so indexing is constant time.",
                "Resizing copies everything.",
            ],
            "audio_b64": base64.b64encode(tone(2.0)).decode(),
        },
    ]
    r = client.post("/render", json={"title": "COSC 220 · Lecture 3", "slides": slides})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "video/mp4"
    durations = [float(x) for x in r.headers["x-slide-durations"].split(",")]
    assert len(durations) == 2 and abs(durations[0] - 2.1) < 0.2
    info = probe(r.content)
    assert "h264" in info["raw"] and "aac" in info["raw"]
    assert "width=1280" in info["raw"] and "height=720" in info["raw"]
    assert abs(float(info["duration"]) - sum(durations)) < 0.5


def test_refuses_playlist_masquerading_as_audio():
    playlist = b"#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n"
    r = client.post(
        "/render",
        json={
            "slides": [
                {"heading": "x", "bullets": [], "audio_b64": base64.b64encode(playlist).decode()}
            ]
        },
    )
    assert r.status_code == 422


def test_rejects_bad_input():
    assert client.post("/render", json={"slides": [{"heading": "x"}]}).status_code == 400
    assert (
        client.post("/render", json={"slides": [{"heading": "x", "audio_b64": "!!!"}]}).status_code
        == 400
    )
    bad_audio = base64.b64encode(b"not audio").decode()
    assert (
        client.post(
            "/render", json={"slides": [{"heading": "x", "audio_b64": bad_audio}]}
        ).status_code
        == 422
    )
    assert client.post("/render", json={"slides": []}).status_code == 422


def two_page_pdf() -> bytes:
    """Page 1: landscape, solid red. Page 2: portrait, solid blue."""
    from io import BytesIO

    buf = BytesIO()
    red = Image.new("RGB", (1600, 900), (220, 30, 30))
    blue = Image.new("RGB", (850, 1100), (30, 60, 220))
    red.save(buf, "PDF", save_all=True, append_images=[blue], resolution=150)
    return buf.getvalue()


def frame_at(mp4: bytes, seconds: float) -> Image.Image:
    from io import BytesIO

    with tempfile.TemporaryDirectory() as t:
        src = Path(t) / "v.mp4"
        src.write_bytes(mp4)
        png = Path(t) / "f.png"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-ss",
                f"{seconds}",
                "-i",
                str(src),
                "-frames:v",
                "1",
                str(png),
            ],
            check=True,
        )
        return Image.open(BytesIO(png.read_bytes())).convert("RGB")


def test_shows_the_cited_lecture_pages():
    audio = base64.b64encode(tone(1.2)).decode()
    r = client.post(
        "/render",
        json={
            "title": "Lecture 4",
            "pdf_b64": base64.b64encode(two_page_pdf()).decode(),
            "slides": [
                {"heading": "Lecture 4", "bullets": [], "audio_b64": audio, "page": 1},
                {
                    "heading": "Red slide",
                    "bullets": ["Shown beside page 1"],
                    "audio_b64": audio,
                    "page": 1,
                },
                {
                    "heading": "Blue notes",
                    "bullets": ["Tall page pans"],
                    "audio_b64": audio,
                    "page": 2,
                },
                {
                    "heading": "No such page",
                    "bullets": ["Text only"],
                    "audio_b64": audio,
                    "page": 9,
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    d = [float(x) for x in r.headers["x-slide-durations"].split(",")]
    starts = [sum(d[:i]) for i in range(len(d))]
    # The title slide stays plain; slides 2 and 3 show their page on the right.
    right = (900, 360)
    # H.264 is lossy and ffmpeg builds round differently, so allow a couple of levels.
    plain = frame_at(r.content, starts[0] + 0.5).getpixel(right)
    assert all(abs(a - b) <= 3 for a, b in zip(plain, (250, 250, 252), strict=True))
    r2, g2, b2 = frame_at(r.content, starts[1] + 0.5).getpixel(right)
    assert r2 > 180 and g2 < 80 and b2 < 80
    r3, g3, b3 = frame_at(r.content, starts[2] + 0.5).getpixel(right)
    assert b3 > 180 and r3 < 80
    # Out-of-range page: the plain text layout (background colour on the right).
    assert sum(frame_at(r.content, starts[3] + 0.5).getpixel(right)) > 700


def test_a_broken_pdf_just_means_text_slides():
    audio = base64.b64encode(tone(0.5)).decode()
    r = client.post(
        "/render",
        json={
            "pdf_b64": base64.b64encode(b"%PDF-1.7 garbage").decode(),
            "slides": [
                {"heading": "A", "bullets": [], "audio_b64": audio, "page": 1},
                {"heading": "B", "bullets": ["x"], "audio_b64": audio, "page": 1},
            ],
        },
    )
    assert r.status_code == 200, r.text
