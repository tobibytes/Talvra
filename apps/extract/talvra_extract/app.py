"""HTTP API. The Worker streams file bytes in; this service never fetches URLs.

POST /extract   body = raw file bytes
  headers: content-type, x-filename (URL-encoded)
  200 -> ExtractResult JSON
  415 unsupported type, 422 unreadable file, 413 too large
GET /ping, /health
"""

import hmac
import os
import time
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .dispatch import extract
from .model import BadFile, UnsupportedType

MAX_BYTES = int(os.environ.get("EXTRACT_MAX_BYTES", str(100 * 1024 * 1024)))
# Only required when exposed over the network (the Azure Container Apps fallback).
SECRET = os.environ.get("EXTRACT_SECRET", "")

app = FastAPI(title="talvra-extract", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/ping")
@app.get("/health")
def health():
    return {"ok": True}


def _error(status: int, code: str, message: str):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.post("/extract")
async def extract_route(request: Request):
    if SECRET:
        auth = request.headers.get("authorization", "")
        if not hmac.compare_digest(auth, f"Bearer {SECRET}"):
            raise HTTPException(status_code=401)
    declared = int(request.headers.get("content-length") or 0)
    if declared > MAX_BYTES:
        return _error(413, "too_large", "This file is too large to process.")
    data = await request.body()
    if len(data) > MAX_BYTES:
        return _error(413, "too_large", "This file is too large to process.")
    if not data:
        return _error(422, "empty", "This file is empty.")
    filename = unquote(request.headers.get("x-filename", "document"))
    content_type = request.headers.get("content-type", "")
    started = time.monotonic()
    try:
        result = extract(data, filename, content_type)
    except UnsupportedType as e:
        return _error(415, "unsupported_type", str(e))
    except BadFile as e:
        return _error(422, "unreadable", str(e))
    body = result.to_json()
    body["elapsedMs"] = round((time.monotonic() - started) * 1000)
    return body
