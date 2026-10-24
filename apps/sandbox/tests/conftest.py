import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Before the app is imported: a throwaway workspace and no auth.
ROOT = Path(tempfile.mkdtemp(prefix="sandbox-test-")).resolve()
os.environ["SANDBOX_ROOT"] = str(ROOT)
os.environ["ALLOW_NO_AUTH"] = "1"
os.environ.pop("SANDBOX_SECRET", None)


@pytest.fixture(autouse=True)
def clean_workspace():
    yield
    for p in ROOT.iterdir():
        if p.name in ("input", "output", ".home"):
            for child in p.iterdir():
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        elif p.is_dir() and not p.is_symlink():
            shutil.rmtree(p)
        else:
            p.unlink()
