# Talvra media service: Pillow + ffmpeg. Cloudflare Container with no internet
# (or the same image on Azure Container Apps).
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY talvra_media ./talvra_media
RUN useradd --uid 10001 --no-create-home app
USER app
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "talvra_media.app:app", "--host", "0.0.0.0", "--port", "8000"]
