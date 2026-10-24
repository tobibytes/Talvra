# Talvra extraction service. Runs on Cloudflare Containers (or Azure Container
# Apps with the same image). No outbound network access is needed or granted.
FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY talvra_extract ./talvra_extract
RUN useradd --uid 10001 --no-create-home app
USER app
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "talvra_extract.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
