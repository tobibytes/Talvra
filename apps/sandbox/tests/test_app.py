import importlib
import os
import time

import pytest
from fastapi.testclient import TestClient

from talvra_sandbox import app as sandbox
from talvra_sandbox.app import Capture

from .conftest import ROOT

client = TestClient(sandbox.app)


def run(command: str, timeout_ms: int = 10_000) -> dict:
    r = client.post("/exec", json={"command": command, "timeout_ms": timeout_ms})
    assert r.status_code == 200, r.text
    return r.json()


def test_health():
    assert client.get("/health").json() == {"ok": True}


def test_files_round_trip_and_nested_paths():
    r = client.put("/files/input/data/hw 1.csv", content=b"x,y\n1,2")
    assert r.status_code == 200
    assert r.json() == {"path": "input/data/hw 1.csv", "size": 7}
    assert (ROOT / "input/data/hw 1.csv").read_bytes() == b"x,y\n1,2"
    assert client.get("/files/input/data/hw 1.csv").content == b"x,y\n1,2"
    assert client.get("/files/input/missing.txt").status_code == 404


@pytest.mark.parametrize(
    "path",
    ["%2e%2e/escape.txt", "input/%2e%2e/%2e%2e/escape.txt", "%2Fetc%2Fpasswd", "input", "."],
)
def test_paths_outside_the_workspace_are_refused(path):
    assert client.put(f"/files/{path}", content=b"x").status_code in (400, 409)
    assert client.get(f"/files/{path}").status_code in (400, 404)
    assert not (ROOT.parent / "escape.txt").exists()


def test_symlinks_out_of_the_workspace_are_refused():
    (ROOT / "input" / "etc").symlink_to("/etc")
    r = client.get("/files/input/etc/hosts")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "bad_path"
    assert client.put("/files/input/etc/evil", content=b"x").status_code == 400


def test_uploads_over_the_limit_are_refused(monkeypatch):
    monkeypatch.setattr(sandbox, "MAX_FILE", 10)
    r = client.put("/files/input/big.bin", content=b"x" * 11)
    assert r.status_code == 413
    assert not (ROOT / "input/big.bin").exists()
    assert not [p for p in (ROOT / "input").iterdir() if p.name.startswith(".upload-")]


def test_outputs_lists_files_in_output_dir():
    client.put("/files/output/b.md", content=b"bb")
    client.put("/files/output/a.ipynb", content=b"a")
    (ROOT / "output" / "folder").mkdir()
    assert client.get("/outputs").json() == {
        "files": [{"name": "a.ipynb", "size": 1}, {"name": "b.md", "size": 2}]
    }


def test_exec_returns_streams_exit_code_and_sandbox_env():
    r = run('echo out; echo err >&2; echo "$INPUT_DIR|$OUTPUT_DIR|$PWD|$HOME"; exit 3')
    assert r["exit_code"] == 3
    assert r["timed_out"] is False
    assert r["stderr"] == "err\n"
    lines = r["stdout"].splitlines()
    assert lines[0] == "out"
    assert lines[1] == f"{ROOT}/input|{ROOT}/output|{ROOT}|{ROOT}/.home"


def test_exec_does_not_leak_the_server_environment(monkeypatch):
    monkeypatch.setenv("SOMETHING_PRIVATE", "nope")
    assert "nope" not in run("env")["stdout"]


def test_commands_write_files_the_api_can_read():
    run('printf 42 > "$OUTPUT_DIR/answer.txt"')
    assert client.get("/files/output/answer.txt").content == b"42"
    assert client.get("/outputs").json()["files"] == [{"name": "answer.txt", "size": 2}]


def test_timeout_kills_the_whole_process_group():
    pidfile = ROOT / "child.pid"
    start = time.monotonic()
    r = run(f"sleep 30 & echo $! > {pidfile}; sleep 30", timeout_ms=500)
    assert time.monotonic() - start < 5
    assert r["timed_out"] is True
    assert r["exit_code"] == -1
    child = int(pidfile.read_text())
    time.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(child, 0)


def test_background_processes_do_not_hold_the_response():
    start = time.monotonic()
    r = run("sleep 20 & echo started")
    assert time.monotonic() - start < 5
    assert r["stdout"] == "started\n"
    assert r["timed_out"] is False


def test_long_output_keeps_head_and_tail():
    r = run("head -c 3000000 /dev/zero | tr '\\0' a; echo; echo THE-END")
    assert r["stdout_bytes"] == 3_000_000 + 1 + 8
    assert len(r["stdout"]) < sandbox.MAX_STREAM + 100
    assert "bytes cut" in r["stdout"]
    assert r["stdout"].endswith("THE-END\n")


def test_limits_apply_and_cannot_be_raised():
    r = run("ulimit -f; ulimit -c")
    assert r["stdout"].split() == [str(sandbox.FILE_LIMIT_KB), "0"]
    assert run("ulimit -f unlimited")["exit_code"] != 0


def test_exec_validates_input():
    assert client.post("/exec", json={"command": ""}).status_code == 422
    assert client.post("/exec", json={"command": "ls", "timeout_ms": 10**9}).status_code == 422


def test_capture_counts_what_it_cuts():
    cap = Capture(cap=10)
    for chunk in (b"abc", b"defgh", b"ijklmnop"):
        cap.add(chunk)
    assert cap.total == 16
    assert cap.text() == "abcde\n… [6 bytes cut] …\nlmnop"
    small = Capture(cap=10)
    small.add(b"0123456789")
    assert small.text() == "0123456789"


def test_secret_is_required_when_set(monkeypatch):
    monkeypatch.setenv("SANDBOX_SECRET", "s3cret")
    secured = importlib.reload(sandbox)
    try:
        c = TestClient(secured.app)
        assert c.get("/health").status_code == 200
        assert c.get("/outputs").status_code == 401
        ok = c.get("/outputs", headers={"authorization": "Bearer s3cret"})
        assert ok.status_code == 200
    finally:
        monkeypatch.delenv("SANDBOX_SECRET")
        importlib.reload(sandbox)
