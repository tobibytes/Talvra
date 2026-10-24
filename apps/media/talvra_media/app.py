"""POST /render: {title, pdf_b64?, slides:[{heading, bullets[], audio_b64, page?}]} -> video/mp4.

With the source PDF, slides that name a page show that page (rendered here).

Durations per slide come back in the X-Slide-Durations header (seconds,
comma-separated) so the Worker can build captions. No network access needed.
"""

import base64
import binascii
import hmac
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from .video import RenderError, Slide, render

SECRET = os.environ.get("MEDIA_SECRET", "")
if not SECRET and os.environ.get("ALLOW_NO_AUTH") != "1":
    raise SystemExit("MEDIA_SECRET is required (or ALLOW_NO_AUTH=1 inside a private container)")
MAX_BODY = 90 * 1024 * 1024
MAX_PDF = 40 * 1024 * 1024

app = FastAPI(title="talvra-media", docs_url=None, redoc_url=None, openapi_url=None)


def _page(v: object) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 10_000 else None


@app.get("/ping")
@app.get("/health")
def health():
    return {"ok": True}


@app.post("/render")
async def render_route(request: Request):
    if SECRET and not hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {SECRET}"
    ):
        raise HTTPException(status_code=401)
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return JSONResponse(
            {"error": {"code": "too_large", "message": "Too much audio."}}, status_code=413
        )
    body = await request.json()
    try:
        slides = [
            Slide(
                heading=str(s["heading"])[:200],
                bullets=[str(b)[:300] for b in s.get("bullets", [])][:6],
                audio=base64.b64decode(s["audio_b64"], validate=True),
                page=_page(s.get("page")),
            )
            for s in body["slides"]
        ]
        title = str(body.get("title", "Talvra"))[:120]
        pdf = base64.b64decode(body["pdf_b64"], validate=True) if body.get("pdf_b64") else None
        if pdf is not None and len(pdf) > MAX_PDF:
            pdf = None  # too big to render pages from: text slides only
    except (KeyError, TypeError, ValueError, binascii.Error):
        return JSONResponse(
            {"error": {"code": "bad_request", "message": "Malformed request."}}, status_code=400
        )
    try:
        mp4, durations = await run_in_threadpool(render, title, slides, pdf)
    except RenderError as e:
        return JSONResponse(
            {"error": {"code": "render_failed", "message": str(e)[:300]}}, status_code=422
        )
    return Response(
        mp4,
        media_type="video/mp4",
        headers={"X-Slide-Durations": ",".join(f"{d:.3f}" for d in durations)},
    )
