"""Slides + narration -> MP4 (H.264/AAC, faststart) with ffmpeg."""

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .pages import render_pages
from .slides import render_page_slide, render_slide

MAX_SLIDES = 20
MAX_TOTAL_SECONDS = 20 * 60


class RenderError(Exception):
    pass


@dataclass
class Slide:
    heading: str
    bullets: list[str]
    audio: bytes  # mp3 narration
    page: int | None = None  # 1-based page of the source PDF to show, if any


FPS = 15
# Same encoder settings for every segment, so the concat can copy streams.
ENCODE = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    str(FPS),
]
AUDIO = ["-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "1"]
# Inputs are files this process wrote: only the file protocol, formats stated.
SAFE = ["-protocol_whitelist", "file"]


def _motion(fw: int, fh: int, frames: int) -> str:
    """A slow zoom on landscape pages; a gentle top-to-bottom pan on tall ones."""
    n = max(frames, 1)
    if fh > fw * 1.15:
        return (
            f"zoompan=z=1.12:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/{n}'"
            f":d={n}:s={fw}x{fh}:fps={FPS}"
        )
    return (
        f"zoompan=z='1+0.06*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={n}:s={fw}x{fh}:fps={FPS}"
    )


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


def render(title: str, slides: list[Slide], pdf: bytes | None = None) -> tuple[bytes, list[float]]:
    if not slides:
        raise RenderError("No slides.")
    if len(slides) > MAX_SLIDES:
        raise RenderError("Too many slides.")
    pages: dict[int, Image.Image] = (
        render_pages(pdf, {s.page for s in slides if s.page}) if pdf else {}
    )
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        segments: list[Path] = []
        durations: list[float] = []
        for i, s in enumerate(slides):
            png, audio, seg = t / f"s{i}.png", t / f"a{i}.mp3", t / f"seg{i}.mp4"
            audio.write_bytes(s.audio)
            dur = duration(audio) + 0.6  # a short pause after each slide
            durations.append(dur)
            if sum(durations) > MAX_TOTAL_SECONDS:
                raise RenderError("The video would be too long.")
            page = pages.get(s.page) if s.page else None
            if page is not None and i > 0:
                page_png = t / f"p{i}.png"
                x, y, fw, fh = render_page_slide(
                    png, page_png, s.heading, s.bullets, title, page, s.page or 0
                )
                frames = int(dur * FPS) + 1
                graph = (
                    f"[1:v]{_motion(fw, fh, frames)}[pg];"
                    f"[0:v][pg]overlay={x}:{y}:shortest=1,format=yuv420p[v];"
                    "[2:a]apad=pad_dur=0.6[a]"
                )
                args = [
                    *SAFE,
                    "-loop",
                    "1",
                    "-framerate",
                    str(FPS),
                    "-f",
                    "image2",
                    "-i",
                    str(png),
                    *SAFE,
                    "-f",
                    "image2",
                    "-i",
                    str(page_png),
                    *SAFE,
                    "-f",
                    "mp3",
                    "-i",
                    str(audio),
                    "-filter_complex",
                    graph,
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                ]
            else:
                render_slide(png, s.heading, s.bullets, title, i)
                args = [
                    *SAFE,
                    "-loop",
                    "1",
                    "-framerate",
                    str(FPS),
                    "-f",
                    "image2",
                    "-i",
                    str(png),
                    *SAFE,
                    "-f",
                    "mp3",
                    "-i",
                    str(audio),
                    "-af",
                    "apad=pad_dur=0.6",
                ]
            _run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    *args,
                    "-t",
                    f"{dur:.3f}",
                    *ENCODE,
                    *AUDIO,
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
                *SAFE,
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
