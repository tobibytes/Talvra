import base64
import subprocess
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

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
