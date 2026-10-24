// Generated from nbbuild.py by scripts/gen-nbbuild.mjs. Don't edit by hand.
export const NBBUILD_PY = String.raw`"""Build an executed Jupyter notebook without Jupyter (the sandbox has no nbformat/nbclient).

Usage: python nbbuild.py cells.json out.ipynb [workdir]

cells.json: [{"type": "markdown" | "code", "source": "..."}]. Code cells run in order in one
namespace with the working directory set to workdir (default: $INPUT_DIR, where the datasets
are). Printed output, the value of a trailing expression (DataFrames as HTML), errors, and
matplotlib figures (as PNGs) become the cell's outputs, like a real run.
"""

import ast
import base64
import contextlib
import io
import json
import os
import sys
import traceback
import uuid


def _display(value):
    """A Jupyter-style display_data/execute_result payload for a value."""
    data = {"text/plain": repr(value)}
    html = getattr(value, "_repr_html_", None)
    if callable(html):
        try:
            rendered = html()
            if rendered:
                data["text/html"] = rendered
        except Exception:
            pass
    return data


def _figures():
    """PNG outputs for every open matplotlib figure (then closes them)."""
    if "matplotlib.pyplot" not in sys.modules:
        return []
    plt = sys.modules["matplotlib.pyplot"]
    out = []
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png", bbox_inches="tight", dpi=110)
        out.append(
            {
                "output_type": "display_data",
                "data": {
                    "image/png": base64.b64encode(buf.getvalue()).decode(),
                    "text/plain": "<Figure>",
                },
                "metadata": {},
            }
        )
    plt.close("all")
    return out


def _lines(text):
    return text.splitlines(keepends=True)


def run_cell(source, ns, count):
    outputs = []
    stdout, stderr = io.StringIO(), io.StringIO()
    result = None
    error = None
    try:
        tree = ast.parse(source, mode="exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(compile(tree, f"<cell {count}>", "exec"), ns)
            if last is not None:
                result = eval(compile(last, f"<cell {count}>", "eval"), ns)
    except Exception as e:  # noqa: BLE001 - record the error like Jupyter does
        error = e
    if stdout.getvalue():
        outputs.append(
            {"output_type": "stream", "name": "stdout", "text": _lines(stdout.getvalue())}
        )
    if stderr.getvalue():
        outputs.append(
            {"output_type": "stream", "name": "stderr", "text": _lines(stderr.getvalue())}
        )
    outputs.extend(_figures())
    if error is not None:
        tb = traceback.format_exception(type(error), error, error.__traceback__)
        outputs.append(
            {
                "output_type": "error",
                "ename": type(error).__name__,
                "evalue": str(error),
                "traceback": [line.rstrip("\n") for line in tb],
            }
        )
    elif result is not None:
        outputs.append(
            {
                "output_type": "execute_result",
                "execution_count": count,
                "data": _display(result),
                "metadata": {},
            }
        )
    return outputs, error


def build(cells, workdir):
    try:
        import matplotlib

        matplotlib.use("Agg")
    except ImportError:
        pass
    os.chdir(workdir)
    ns = {"__name__": "__main__"}
    nb_cells = []
    count = 0
    errors = 0
    for cell in cells:
        source = str(cell.get("source", ""))
        if cell.get("type") == "markdown":
            nb_cells.append(
                {
                    "cell_type": "markdown",
                    "id": uuid.uuid4().hex[:8],
                    "metadata": {},
                    "source": _lines(source),
                }
            )
            continue
        count += 1
        outputs, error = run_cell(source, ns, count)
        errors += error is not None
        nb_cells.append(
            {
                "cell_type": "code",
                "id": uuid.uuid4().hex[:8],
                "execution_count": count,
                "metadata": {},
                "outputs": outputs,
                "source": _lines(source),
            }
        )
    notebook = {
        "cells": nb_cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return notebook, errors


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1]) as f:
        cells = json.load(f)
    workdir = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("INPUT_DIR", os.getcwd())
    out = os.path.abspath(sys.argv[2])
    notebook, errors = build(cells, workdir)
    with open(out, "w") as f:
        json.dump(notebook, f, indent=1)
    print(
        f"wrote {out}: {sum(c['cell_type'] == 'code' for c in notebook['cells'])} code cells, {errors} with errors"
    )


if __name__ == "__main__":
    main()
`;
