"""Django settings for the jobs backend.

Reads configuration from environment variables; see ``.env.example`` for the
locked variable set. ``python-dotenv`` loads the project-root ``.env`` if
present so that local ``manage.py`` invocations work without manual exports.

Logging configuration is wired up in :mod:`config.logging` (T1.3).
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from the repo root (parent of backend/) so local manage.py works.
load_dotenv(BASE_DIR.parent / ".env")

# --- Required ---------------------------------------------------------------

SECRET_KEY = os.environ["JOBS_SECRET_KEY"]

# --- Toggles ----------------------------------------------------------------

DEBUG = os.environ.get("JOBS_DEBUG", "False").lower() == "true"

# Same-origin via nginx in compose; permissive here is acceptable for this
# scope. Documented as a known simplification in the README.
ALLOWED_HOSTS = ["*"]

# --- Apps and middleware ----------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "jobs.apps.JobsConfig",
]

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
]

# Minimal templates backend — required by Ninja's interactive docs view.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": False,
        "OPTIONS": {"context_processors": []},
    },
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

USE_TZ = True
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"

# --- Database ---------------------------------------------------------------

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("JOBS_DB_NAME", "jobs"),
        "USER": os.environ.get("JOBS_DB_USER", "jobs"),
        "PASSWORD": os.environ.get("JOBS_DB_PASSWORD", "jobs"),
        "HOST": os.environ.get("POSTGRES_HOST", "db"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# --- Logging ----------------------------------------------------------------

import logging.config  # noqa: E402

from config.logging import build_log_config  # noqa: E402

LOGGING_CONFIG = None  # we configure manually below
LOGGING = build_log_config()
logging.config.dictConfig(LOGGING)
