"""Slides + narration -> MP4 (H.264/AAC, faststart) with ffmpeg."""

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .slides import render_slide

MAX_SLIDES = 20
MAX_TOTAL_SECONDS = 20 * 60


class RenderError(Exception):
    pass


@dataclass
class Slide:
    heading: str
    bullets: list[str]
    audio: bytes  # mp3/wav/anything ffmpeg reads


def _run(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RenderError(proc.stderr[-800:])
    return proc.stdout


def duration(path: Path) -> float:
    out = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]
    )
    try:
        return float(out.strip())
    except ValueError as e:
        raise RenderError("Couldn't read the narration audio.") from e


def render(title: str, slides: list[Slide]) -> tuple[bytes, list[float]]:
    if not slides:
        raise RenderError("No slides.")
    if len(slides) > MAX_SLIDES:
        raise RenderError("Too many slides.")
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        segments: list[Path] = []
        durations: list[float] = []
        for i, s in enumerate(slides):
            png, audio, seg = t / f"s{i}.png", t / f"a{i}", t / f"seg{i}.mp4"
            render_slide(png, s.heading, s.bullets, title, i)
            audio.write_bytes(s.audio)
            dur = duration(audio) + 0.6  # a short pause after each slide
            durations.append(dur)
            if sum(durations) > MAX_TOTAL_SECONDS:
                raise RenderError("The video would be too long.")
            _run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-loop",
                    "1",
                    "-framerate",
                    "1",
                    "-i",
                    str(png),
                    "-i",
                    str(audio),
                    "-af",
                    "apad=pad_dur=0.6",
                    "-t",
                    f"{dur:.3f}",
                    "-c:v",
                    "libx264",
                    "-tune",
                    "stillimage",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "28",
                    "-pix_fmt",
                    "yuv420p",
                    "-r",
                    "15",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "96k",
                    "-ar",
                    "44100",
                    "-ac",
                    "1",
                    str(seg),
                ]
            )
            segments.append(seg)
        listing = t / "list.txt"
        listing.write_text("".join(f"file '{p.name}'\n" for p in segments))
        out = t / "out.mp4"
        _run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(listing),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(out),
            ]
        )
        return out.read_bytes(), durations
