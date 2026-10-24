"""Opt-in: runs the built image and checks every toolchain the prompt promises.

docker build --platform linux/amd64 -t talvra-sandbox:dev apps/sandbox
SANDBOX_IMAGE=talvra-sandbox:dev uv run pytest tests/test_image.py -v
"""

import json
import os
import platform
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

IMAGE = os.environ.get("SANDBOX_IMAGE")
NBBUILD = Path(__file__).parents[3] / "apps/api/src/ai/nbbuild.py"

pytestmark = pytest.mark.skipif(not IMAGE, reason="set SANDBOX_IMAGE to test a built image")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def box():
    port = _free_port()
    cid = subprocess.check_output(
        ["docker", "run", "-d", "--rm", "--platform", "linux/amd64", "-e", "ALLOW_NO_AUTH=1"]
        + ["-p", f"127.0.0.1:{port}:8000", IMAGE],
        text=True,
    ).strip()
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"{base}/health", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError(subprocess.run(["docker", "logs", cid], capture_output=True).stderr)
        yield base
    finally:
        subprocess.run(["docker", "rm", "-f", cid], capture_output=True)


def call(base: str, method: str, path: str, body: bytes | None = None) -> bytes:
    req = urllib.request.Request(f"{base}{path}", data=body, method=method)
    if method == "POST":
        req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def sh(base: str, command: str, timeout_ms: int = 240_000) -> dict:
    body = json.dumps({"command": command, "timeout_ms": timeout_ms}).encode()
    return json.loads(call(base, "POST", "/exec", body))


def ok(base: str, command: str) -> str:
    r = sh(base, command)
    assert r["exit_code"] == 0, r
    return r["stdout"]


def test_runs_as_an_unprivileged_user(box):
    assert ok(box, "id -u").strip() == "10001"


def test_python_data_stack(box):
    out = ok(
        box,
        "python -c 'import pandas, numpy, scipy, sklearn, statsmodels, matplotlib, seaborn, "
        "sympy, docx, openpyxl, pptx, pypdf, bs4, nbclient; print(pandas.__version__)'",
    )
    assert out.strip()


def test_compilers_and_runtimes(box):
    ok(
        box,
        "printf '#include <stdio.h>\\nint main(){puts(\"c ok\");}' > a.c && gcc a.c -o a && ./a",
    )
    ok(
        box,
        "printf '#include <iostream>\\nint main(){std::cout<<\"cpp ok\";}' > b.cpp && g++ b.cpp -o b && ./b",
    )
    out = ok(
        box,
        "mkdir -p j && printf 'class H{public static void main(String[] a){System.out.println(\"java ok\");}}' > j/H.java && javac j/H.java && java -cp j H",
    )
    assert "java ok" in out
    assert "r ok" in ok(box, "Rscript -e 'cat(\"r ok\")'")
    assert "node ok" in ok(box, "node -e 'console.log(\"node ok\")'")
    assert "3" in ok(box, "sqlite3 :memory: 'select 1+2'")


def test_documents(box):
    ok(box, "printf '# Title\\n\\nHello' > d.md && pandoc d.md -o d.docx")
    ok(box, 'soffice --headless --convert-to pdf --outdir "$OUTPUT_DIR" d.docx')
    assert '"d.pdf"' in call(box, "GET", "/outputs").decode()


def test_executed_notebook_with_nbbuild(box):
    call(box, "PUT", "/files/input/nbbuild.py", NBBUILD.read_bytes())
    cells = [
        {"type": "markdown", "source": "# Plot"},
        {
            "type": "code",
            "source": "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nprint(6 * 7)",
        },
    ]
    call(box, "PUT", "/files/cells.json", json.dumps(cells).encode())
    ok(box, 'python "$INPUT_DIR/nbbuild.py" cells.json "$OUTPUT_DIR/nb.ipynb"')
    nb = json.loads(call(box, "GET", "/files/output/nb.ipynb"))
    outputs = [o for c in nb["cells"] if c["cell_type"] == "code" for o in c["outputs"]]
    assert any("42" in "".join(o.get("text", "")) for o in outputs)
    assert any("image/png" in o.get("data", {}) for o in outputs)


# ZeroMQ kernels hang under x86 emulation (Apple Silicon); a plain python:3.13-slim image with the
# same pins does too. Real amd64 hosts (CI, Cloudflare) run it.
@pytest.mark.skipif(
    platform.machine() not in ("x86_64", "AMD64"), reason="Jupyter kernels hang under emulation"
)
def test_jupyter_kernel_executes(box):
    ok(
        box,
        "python -c \"import nbformat, nbclient; nb = nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell('print(1)')]); nbclient.NotebookClient(nb, kernel_name='python3', startup_timeout=240).execute()\"",
    )


def test_browser_screenshot(box):
    script = (
        "from playwright.sync_api import sync_playwright\n"
        "with sync_playwright() as p:\n"
        "    b = p.chromium.launch()\n"
        "    page = b.new_page()\n"
        "    page.set_content('<h1>browser ok</h1>')\n"
        "    print(page.inner_text('h1'))\n"
        "    page.screenshot(path='shot.png')\n"
        "    b.close()\n"
    )
    call(box, "PUT", "/files/shot.py", script.encode())
    assert "browser ok" in ok(box, "python shot.py && file shot.png")
