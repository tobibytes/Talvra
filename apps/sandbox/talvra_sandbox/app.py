"""Control server for one homework run's sandbox (docs/v2/SANDBOX.md).

  PUT  /files/{path}   raw body -> file in the workspace (parents created)
  GET  /files/{path}   file bytes
  GET  /outputs        [{name, size}] for the files in $OUTPUT_DIR
  POST /exec           {command, timeout_ms?} -> {stdout, stderr, exit_code, timed_out, ...}

One container per run; the container (a VM) is the isolation boundary. The agent already has a
shell, so this server and its commands run as the same unprivileged user and nothing secret is
in here. The path checks keep the files API inside the workspace, because file names come from
Canvas and the model.
"""

import asyncio
import contextlib
import hmac
import os
import signal
import tempfile
from pathlib import Path, PurePosixPath

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

SECRET = os.environ.get("SANDBOX_SECRET", "")
# Fail closed, like extract/media: no secret only inside a container reachable from its DO.
if not SECRET and os.environ.get("ALLOW_NO_AUTH") != "1":
    raise SystemExit("SANDBOX_SECRET is required (or ALLOW_NO_AUTH=1 inside a private container)")

ROOT = Path(os.environ.get("SANDBOX_ROOT", "/work")).resolve()
INPUT = ROOT / "input"
OUTPUT = ROOT / "output"
HOME = ROOT / ".home"
TOOLCHAIN_BIN = os.environ.get("SANDBOX_TOOLCHAIN_BIN", "/opt/toolchain/bin")

MAX_FILE = 200 * 1024 * 1024
# Per stream returned to the Worker (which clips further for the model).
MAX_STREAM = 1024 * 1024
DEFAULT_TIMEOUT_MS = 120_000
MAX_TIMEOUT_MS = 600_000
# After the command exits, how long to wait for background children to let go of its pipes.
DRAIN_GRACE_S = 0.5
# Per-file size limit for commands (KiB), and no core dumps.
FILE_LIMIT_KB = 2 * 1024 * 1024

for d in (INPUT, OUTPUT, HOME):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="talvra-sandbox", docs_url=None, redoc_url=None, openapi_url=None)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@app.exception_handler(ApiError)
async def _api_error(_: Request, e: ApiError):
    return error(e.status, e.code, e.message)


def auth(request: Request) -> None:
    if SECRET and not hmac.compare_digest(
        request.headers.get("authorization", ""), f"Bearer {SECRET}"
    ):
        raise HTTPException(status_code=401)


def workspace_path(rel: str) -> Path:
    """A path inside the workspace, or 400. Follows symlinks before checking."""
    pure = PurePosixPath(rel)
    if not rel or "\x00" in rel or pure.is_absolute() or ".." in pure.parts:
        raise ApiError(400, "bad_path", "Use a relative path inside the workspace.")
    p = (ROOT / pure).resolve()
    if p == ROOT or not p.is_relative_to(ROOT):
        raise ApiError(400, "bad_path", "Use a relative path inside the workspace.")
    return p


@app.get("/ping")
@app.get("/health")
def health():
    return {"ok": True}


@app.put("/files/{path:path}", dependencies=[Depends(auth)])
async def put_file(path: str, request: Request):
    target = workspace_path(path)
    if int(request.headers.get("content-length") or 0) > MAX_FILE:
        raise ApiError(413, "too_large", "File too large.")
    if target.is_dir():
        raise ApiError(409, "is_directory", "A directory has that name.")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_FILE:
                    raise ApiError(413, "too_large", "File too large.")
                f.write(chunk)
        os.replace(tmp, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise
    return {"path": str(target.relative_to(ROOT)), "size": size}


@app.get("/files/{path:path}", dependencies=[Depends(auth)])
def get_file(path: str):
    target = workspace_path(path)
    if not target.is_file():
        raise ApiError(404, "not_found", "No such file.")
    return FileResponse(target, media_type="application/octet-stream")


@app.get("/outputs", dependencies=[Depends(auth)])
def outputs():
    return {
        "files": [
            {"name": p.name, "size": p.stat().st_size}
            for p in sorted(OUTPUT.iterdir())
            if p.is_file() and not p.name.startswith(".upload-")
        ]
    }


class ExecBody(BaseModel):
    command: str = Field(min_length=1, max_length=100_000)
    timeout_ms: int = Field(default=DEFAULT_TIMEOUT_MS, ge=100, le=MAX_TIMEOUT_MS)


class Capture:
    """Keeps the first and last MAX_STREAM/2 bytes of a stream and counts the rest."""

    def __init__(self, cap: int = MAX_STREAM):
        self.half = cap // 2
        self.head = bytearray()
        self.tail = bytearray()
        self.total = 0

    def add(self, chunk: bytes) -> None:
        self.total += len(chunk)
        room = self.half - len(self.head)
        if room > 0:
            self.head += chunk[:room]
            chunk = chunk[room:]
        if chunk:
            self.tail += chunk
            if len(self.tail) > self.half:
                del self.tail[: len(self.tail) - self.half]

    def text(self) -> str:
        cut = self.total - len(self.head) - len(self.tail)
        middle = f"\n… [{cut} bytes cut] …\n".encode() if cut > 0 else b""
        return bytes(self.head + middle + self.tail).decode("utf-8", errors="replace")


def command_env() -> dict[str, str]:
    path = "/usr/local/bin:/usr/bin:/bin"
    if Path(TOOLCHAIN_BIN).is_dir():
        path = f"{TOOLCHAIN_BIN}:{path}"
    env = {
        "PATH": path,
        "HOME": str(HOME),
        "INPUT_DIR": str(INPUT),
        "OUTPUT_DIR": str(OUTPUT),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TERM": "dumb",
        "MPLBACKEND": "Agg",
        "PYTHONUNBUFFERED": "1",
    }
    # Toolchain settings baked into the image (never secrets).
    for key in ("PLAYWRIGHT_BROWSERS_PATH", "JAVA_HOME"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


# Limits are set inside bash so they apply to the command and everything it starts. Setting
# soft and hard together means the command can't raise them again.
LIMITS = f'ulimit -c 0 2>/dev/null; ulimit -f {FILE_LIMIT_KB} 2>/dev/null; exec bash -c "$1"'


async def _pump(stream: asyncio.StreamReader, cap: Capture) -> None:
    while chunk := await stream.read(65536):
        cap.add(chunk)


def _kill_group(pid: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, signal.SIGKILL)


@app.post("/exec", dependencies=[Depends(auth)])
async def exec_command(body: ExecBody):
    proc = await asyncio.create_subprocess_exec(
        "bash",
        "-c",
        LIMITS,
        "sandbox",
        body.command,
        cwd=ROOT,
        env=command_env(),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # its own process group, so a timeout kills everything it started
    )
    out, err = Capture(), Capture()
    assert proc.stdout and proc.stderr
    pumps = asyncio.gather(_pump(proc.stdout, out), _pump(proc.stderr, err))
    timed_out = False
    try:
        await asyncio.wait_for(proc.wait(), body.timeout_ms / 1000)
    except TimeoutError:
        timed_out = True
        _kill_group(proc.pid)
        await proc.wait()
    # Background children (`server &`) may keep the pipes open; don't wait for them.
    try:
        await asyncio.wait_for(asyncio.shield(pumps), DRAIN_GRACE_S)
    except TimeoutError:
        pumps.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pumps
    return {
        "stdout": out.text(),
        "stderr": err.text(),
        "exit_code": proc.returncode if not timed_out else -1,
        "timed_out": timed_out,
        "stdout_bytes": out.total,
        "stderr_bytes": err.total,
    }
