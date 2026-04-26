# syntax=docker/dockerfile:1.7

# ============================================================================
# Builder stage: resolve and install dependencies with uv into /app/.venv
# ============================================================================
FROM python:3.12-slim-bookworm AS builder

# Pull the uv binary from the official image
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Layer-cache: install deps before copying source so source changes don't
# invalidate the dep layer.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

# Now the source. Dev deps are kept so `pytest` can run in this image.
COPY . .


# ============================================================================
# Runtime stage: slim image with curl (healthcheck) + netcat (wait-for-db)
# ============================================================================
FROM python:3.12-slim-bookworm AS runtime

RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends curl netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 app

WORKDIR /app

# Bring over the venv and source from the builder, owned by app
COPY --from=builder --chown=app:app /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Logs directory mounted by the named volume in compose; create it owned by app
RUN mkdir -p /app/logs && chown -R app:app /app/logs

# Ensure entrypoint is executable regardless of host permissions
RUN chmod +x /app/entrypoint.sh

USER app
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
