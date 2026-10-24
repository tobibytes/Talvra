# Talvra homework sandbox: one container per run (docs/v2/SANDBOX.md).
# The agent's toolchain plus a small control server. Holds no secrets; the VM is the boundary.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy \
    DEBIAN_FRONTEND=noninteractive

# Compilers, runtimes and document tools, one layer each: Cloudflare's registry drops very
# large blob uploads, so no single layer should be more than a few hundred MB.
ENV APT="apt-get install -y --no-install-recommends"
RUN apt-get update && $APT bash ca-certificates curl git unzip zip xz-utils file sqlite3 \
      fonts-dejavu fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT build-essential && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT default-jdk-headless && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT r-base-core && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT nodejs npm pandoc && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT libreoffice-writer-nogui && rm -rf /var/lib/apt/lists/*
RUN apt-get update && $APT libreoffice-calc-nogui libreoffice-impress-nogui \
  && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

# The agent's Python (separate from the server's), split the same way, then Chromium.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
COPY toolchain/requirements.txt /tmp/toolchain.txt
RUN uv venv /opt/toolchain --python /usr/local/bin/python3.13 \
  && uv pip install --python /opt/toolchain/bin/python --no-cache --no-deps \
       $(grep -E '^(numpy|scipy|pandas)==' /tmp/toolchain.txt)
RUN uv pip install --python /opt/toolchain/bin/python --no-cache --no-deps \
       $(grep -E '^(scikit-learn|statsmodels|sympy|joblib|threadpoolctl|patsy)==' /tmp/toolchain.txt)
RUN uv pip install --python /opt/toolchain/bin/python --no-cache -r /tmp/toolchain.txt
RUN /opt/toolchain/bin/playwright install-deps chromium && rm -rf /var/lib/apt/lists/*
RUN /opt/toolchain/bin/playwright install --only-shell chromium && rm /tmp/toolchain.txt

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
