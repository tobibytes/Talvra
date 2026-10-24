# Talvra homework sandbox: one container per run (docs/v2/SANDBOX.md).
# The agent's toolchain plus a small control server. Holds no secrets; the VM is the boundary.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy \
    DEBIAN_FRONTEND=noninteractive

# Compilers and runtimes: C/C++, Java, R, Node, plus documents and data tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git unzip zip xz-utils file \
      build-essential default-jdk-headless r-base-core nodejs npm \
      sqlite3 pandoc \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      fonts-dejavu fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

# The agent's Python (separate from the server's), and Chromium for Playwright.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
COPY toolchain/requirements.txt /tmp/toolchain.txt
RUN uv venv /opt/toolchain --python /usr/local/bin/python3.13 \
  && uv pip install --python /opt/toolchain/bin/python --no-cache -r /tmp/toolchain.txt \
  && /opt/toolchain/bin/playwright install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/* /tmp/toolchain.txt

# The control server.
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev --no-install-project
COPY talvra_sandbox ./talvra_sandbox

RUN useradd --uid 10001 --create-home sandbox && mkdir /work && chown sandbox:sandbox /work
USER sandbox
ENV SANDBOX_ROOT=/work SANDBOX_TOOLCHAIN_BIN=/opt/toolchain/bin
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "talvra_sandbox.app:app", "--host", "0.0.0.0", "--port", "8000"]
