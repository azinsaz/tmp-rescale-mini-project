"""Logging configuration factory.

Builds a stdlib ``logging.config.dictConfig``-compatible dict from the
environment so that the format selection (text/JSON) and rotation are
externalized. Called once from :mod:`config.settings`.

Filename pattern: ``{JOBS_ENV}-{SERVICE_NAME}-{YYYY-MM-DD_HHMM}.{log|json}``.
Rotation: ``RotatingFileHandler(maxBytes=10 MiB, backupCount=7)``.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

# Default to ``<repo-root>/logs`` so both local ``manage.py`` and compose runs
# write to the same directory. In compose, ``LOG_DIR=/app/logs`` overrides this
# and the Makefile bind-mounts ``./logs`` → ``/app/logs``.
_DEFAULT_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"

# Computed once at module-load time so that ``manage.py migrate`` and the
# subsequent ``uvicorn`` start (same entrypoint process) share one log file.
_STARTED = datetime.now(UTC).strftime("%Y-%m-%d_%H%M")


def build_log_config() -> dict:
    """Return a ``dictConfig``-compatible logging configuration."""
    env = os.environ.get("JOBS_ENV", "dev")
    fmt = os.environ.get("JOBS_LOG_FORMAT") or ("text" if env == "dev" else "json")
    level = os.environ.get("JOBS_LOG_LEVEL", "INFO").upper()
    log_dir = Path(os.environ.get("LOG_DIR") or str(_DEFAULT_LOG_DIR))
    service = os.environ.get("SERVICE_NAME", "api")

    log_dir.mkdir(parents=True, exist_ok=True)
    ext = "json" if fmt == "json" else "log"
    filename = log_dir / f"{env}-{service}-{_STARTED}.{ext}"

    formatters: dict = {
        "text_color": {
            "()": "colorlog.ColoredFormatter",
            "format": "%(log_color)s[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
        },
        "text_plain": {
            "format": "[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
        },
        "json": {
            "()": "pythonjsonlogger.json.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
            "rename_fields": {
                "asctime": "timestamp",
                "levelname": "level",
                "name": "logger",
            },
            "static_fields": {"service": service, "env": env},
        },
    }

    if fmt == "json":
        console_formatter = "json"
        file_formatter = "json"
    elif env == "dev":
        console_formatter = "text_color"
        file_formatter = "text_plain"
    else:
        console_formatter = "text_plain"
        file_formatter = "text_plain"

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": formatters,
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
                "formatter": console_formatter,
                "level": level,
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": str(filename),
                "maxBytes": 10 * 1024 * 1024,
                "backupCount": 7,
                "formatter": file_formatter,
                "level": level,
                "encoding": "utf-8",
            },
        },
        "loggers": {
            "": {
                "handlers": ["console", "file"],
                "level": level,
            },
            "jobs": {
                "handlers": ["console", "file"],
                "level": level,
                "propagate": False,
            },
            "django.request": {
                "handlers": ["console", "file"],
                "level": "WARNING",
                "propagate": False,
            },
            "django.db.backends": {
                "level": "WARNING",
            },
        },
    }
