---
status: approved
feature: backend
---

# Design: Backend Jobs API

## Context & Problem Recap

Implements the requirements at `docs/specs/backend/requirements.md` (FR-001..FR-015, NFR-001..NFR-013) and the locks in plan sections 4–9 (`/Users/ali/.claude/plans/melodic-toasting-beaver.md`). Greenfield: no prior code to integrate with. The end state is an async Django Ninja service that exposes six `/api/jobs/*` endpoints plus `/api/health/`, runs in a uv-built multi-stage container, ships structured logs (text/dev, JSON/prod), and is queryable at the millions-of-jobs scale.

## Goals / Non-Goals

**Goals**

- Match the locked API contract exactly (FR-001..FR-008, plan §5).
- Keep the latest-status read path index-only at 1 M rows, including under `?status=` filter (NFR-001..NFR-003).
- Keep handlers thin and put business logic in `services.py` (NFR-011).
- Make `make test` pass cold from a fresh clone (NFR-009).
- Async throughout, with `sync_to_async` only at the unavoidable seams (NFR-012).

**Non-Goals**

- Auth, multi-tenancy, real job execution, soft delete, batch ops, rate limiting (out-of-scope per requirements).
- Optimizing the path beyond what `EXPLAIN` confirms is needed; no PgBouncer, no caching layer.
- Frontend implementation (separate stream).

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  uvicorn (1 worker) ───── ASGI ───── Django 5.2 ──── NinjaAPI(/api)    │
│                                                                        │
│   /api/health/   ──┐                                                   │
│   /api/openapi.json─┤  ┌──────────────┐    ┌──────────────────────┐    │
│   /api/docs/    ──┤  │              │    │                      │    │
│   /api/jobs/*  ──┼─▶│ jobs.api     │───▶│ jobs.services         │    │
│                  │  │ (Ninja Router)│    │ (async + sync_to_async│    │
│                  │  │ thin handlers │    │ around atomic/Subquery│    │
│                  │  │ Pydantic in/  │    │ blocks; logs INFO on  │    │
│                  │  │ out only      │    │ state changes)         │    │
│                  │  └──────────────┘    └──────────┬───────────┘    │
│                  │                                  │                  │
│                  │                                  ▼                  │
│                  │                       ┌──────────────────────┐     │
│                  │                       │ jobs.models          │     │
│                  │                       │ Job, JobStatus       │     │
│                  │                       │ StatusType (enum)    │     │
│                  │                       └──────────┬───────────┘     │
│                  │                                  │                  │
│                  │                                  ▼                  │
│                  │                       ┌──────────────────────┐     │
│                  │                       │ Postgres 16          │     │
│                  │                       │  jobs_job            │     │
│                  │                       │  jobs_jobstatus      │     │
│                  │                       └──────────────────────┘     │
│                                                                        │
│  config.logging ─── dictConfig (stderr handler + RotatingFileHandler)  │
│  emits to stderr (compose tails) + /app/logs (named volume)            │
└────────────────────────────────────────────────────────────────────────┘
```

Three layers, three responsibilities:

- **`jobs.api`** — Ninja `Router` and handler functions. HTTP only. Parses `Schema`, calls a single service function, shapes the response. No business logic, no logging.
- **`jobs.services`** — async functions. Where business logic lives: `create_job`, `get_job`, `list_jobs`, `update_job_status`, `delete_job`, `list_job_statuses`. Wraps any code that touches a transaction or `Subquery`/`OuterRef` annotation in `sync_to_async`. Emits INFO logs on state changes. Re-raises domain errors as Ninja-friendly exceptions.
- **`jobs.models`** — `Job`, `JobStatus`, `StatusType` (TextChoices). Persistence and invariants. The `current_status` field on `Job` is the denormalized hot read.

`config.api` constructs the single `NinjaAPI()` instance and includes the jobs router. `config.urls` mounts it at `/api`. `config.logging` configures stdlib logging from env vars at Django startup.

## Alternatives Considered & Trade-offs

| Decision | Rejected option | Why rejected |
| --- | --- | --- |
| `current_status` denormalized on `Job` | `Subquery+OuterRef` annotation only | Filter-by-status is O(N) on annotation predicate (plan §8). Denormalization is one extra column maintained inside the same `atomic` block as the `JobStatus` insert. Trade-off: one tiny write-side coupling for index-pushable reads at scale. |
| `current_status` denormalized on `Job` | Per-status partial indexes on `JobStatus` | Adds 4 indexes; query layer becomes a `LATERAL` join. Denormalized column is simpler and has the same read complexity. |
| `current_status` denormalized on `Job` | Raw-SQL keyset / window functions | Most flexible but hardest to debug; over-engineering for this scope. |
| `services.py` async functions wrapping `sync_to_async` | Service-layer methods stay sync, handlers wrap | Pushes async/sync split to handlers, repeats `sync_to_async` everywhere. Service-layer functions own the seam: handlers `await service.x()`, period. |
| Django Ninja built-in `CursorPagination` | DRF + custom paginator | Plan locks Django Ninja. CursorPagination is built-in since 1.6. |
| Single uvicorn worker | `--workers 4` + connection pool | Take-home scope; one worker keeps connection-count predictable, removes a class of multi-process flakiness from the cold-machine `make test` gate. |
| `manage.py flush` for E2E DB reset | `POST /api/test/reset/` endpoint behind `ENV=test` | Endpoint adds an attack surface and an extra branch in the API; `manage.py flush --no-input` from compose-exec is dependency-free. (Open Question 12 confirms.) |
| Hard delete with cascade | Soft delete (deleted_at) | Spec literally says delete; cascade is the explicit instruction. |

## Key Design Decisions

### ADR-1 — Denormalized `Job.current_status`

`Job.current_status` is a `CharField(choices=StatusType.choices, default=StatusType.PENDING, db_index=True)`. It is:

- Set on `POST /api/jobs/` to `PENDING` in the same transaction as the initial `JobStatus` row.
- Updated on `PATCH /api/jobs/<id>/` to the new status_type, in the same transaction as the appended `JobStatus` row.

The `JobStatus` table remains the **single source of truth for history**. `Job.current_status` is a derived cache of "the status_type of the latest JobStatus row," kept fresh by the service layer. There is no Postgres trigger or signal — a trigger would invert who-owns-the-write and complicate testing; signals don't fire on bulk operations.

**Consequence**: any future bypass of the service layer (raw `JobStatus.objects.create(...)`) corrupts the cache. We mitigate by: (a) routing all writes through `services.py`, (b) a unit test that asserts `current_status` reflects the latest `JobStatus` after every mutation flow, (c) a CLAUDE.md note.

### ADR-2 — `services.py` as the single seam

Handlers in `jobs/api.py` look like:

```python
@router.post("/jobs/", response={201: JobOut, 400: ErrorEnvelope})
async def create_job(request, payload: JobCreate, response: HttpResponse):
    job = await services.create_job(name=payload.name)
    response["Location"] = f"/api/jobs/{job.id}/"
    return 201, JobOut.from_orm_with_status(job)
```

Service functions in `jobs/services.py` are `async def`. Each one wraps any DB/transaction work in a single `sync_to_async`-wrapped helper, awaits it, logs the result, and returns a model instance or a structured DTO. Example:

```python
@sync_to_async
def _create_job_sync(name: str) -> Job:
    with transaction.atomic():
        job = Job.objects.create(name=name, current_status=StatusType.PENDING)
        JobStatus.objects.create(job=job, status_type=StatusType.PENDING)
    return job

async def create_job(*, name: str) -> Job:
    job = await _create_job_sync(name)
    logger.info("job_created", extra={"job_id": job.id})
    return job
```

This pattern keeps the async/sync seam in one place per operation. Handlers remain trivially testable; services are unit-testable without HTTP. No raw ORM in handlers.

### ADR-3 — `sync_to_async` only where Django requires it

Reads of single rows use the native async ORM (`await Job.objects.aget(pk=id)`, `Job.objects.filter(...).aiterator()`). `sync_to_async` is reserved for:

- `transaction.atomic()` blocks.
- `Subquery` / `OuterRef` annotations (Django 5.2 limitation; see CLAUDE.md).
- The `Job.objects.filter(...).order_by(...)` chain that gets handed to Ninja's paginator decorator (paginator iterates the queryset; safer to materialize in sync).

This minimizes `sync_to_async` overhead while staying correct.

### ADR-4 — `CursorPagination` over a service-returned queryset

Django Ninja 1.6's `@paginate(CursorPagination, ordering=("created_at",), page_size=20)` is the chosen mechanism. The service returns a queryset (or list) that the decorator paginates and serializes.

**Verification spike at the start of `/spec:implement`**: write a 10-line script in the Django shell that constructs the filtered, denormalized-column-using queryset (no Subquery needed since `current_status` is now a real column) inside `sync_to_async`, returns it from a service function, and confirms `CursorPagination` produces the expected envelope. Document the snippet in CLAUDE.md.

If the spike fails, fall back to a hand-written keyset pagination in `services.list_jobs(...)` returning `(items, next_cursor, prev_cursor)` directly.

#### ADR-4 spike findings (T2.4 — locked)

Spike at `backend/jobs/tests/test_pagination_spike.py` passed. Locked envelope:

```json
{
  "results": [/* items */],
  "next": "http://host/path?cursor=<base64-token>",
  "previous": null
}
```

- Items key: **`results`**.
- `next` and `previous` are **fully qualified URLs** with the `cursor=<value>` query param embedded — not bare cursor tokens. The FE extracts the `cursor` query param via `URLSearchParams` and uses it as the next request's `cursor`. Documented in CLAUDE.md.
- The handler may return a *lazy* `QuerySet` directly from an `async def` body. Building the queryset (`.all()`, `.filter()`, `.order_by()`) is safe in async context — no SQL fires until iteration, which Ninja's paginator wraps. **No `sync_to_async` is needed at the handler layer** for read-side pagination. (`sync_to_async` remains required for writes/transactions, per ADR-3.)
- Filtering on the denormalized `current_status` column produces the expected subset (verified across PENDING / RUNNING / COMPLETED).

#### T3.6 contract amendment (drop user-controlled `ordering`)

Implementation revealed that `CursorPagination`'s decorator-level `ordering`
tuple **overrides** the queryset's `order_by`, so a per-request ordering
query param cannot drive cursor encoding without a custom paginator.

Decision: drop the `ordering` query param. The `GET /api/jobs/` endpoint
exposes only `status` and `cursor`. Ordering is fixed at `-created_at, -id`
(newest first). Page size is fixed at 20.

Implication: stretch goal "sort by name/creation date" is partially
implemented — the spec's wording covers either-or; we ship creation-date
descending sort and document name-sort as out of scope. Locked in CLAUDE.md
under "Decisions deferred".

### ADR-5 — `uvicorn --workers 1` (plan locked)

Single worker, single connection pool. Postgres `max_connections=100` default is more than enough. PgBouncer is the production answer; out of scope.

### ADR-6 — Custom error envelope via Ninja exception handlers

Define a single `NinjaAPI` subclass (or use `api.add_router(...)` plus `api.exception_handler(...)` decorators) that:

- Catches Pydantic `ValidationError` → 400 with `{detail: "Validation failed", errors: [{loc, msg, type}, ...]}`.
- Catches `Job.DoesNotExist` (or our own `JobNotFound`) → 404 with `{detail: "Not found"}`.
- Catches anything else uncaught → 500 with `{detail: "Internal server error"}` — never echoes the original message.

The shape matches plan §5's error envelope.

### ADR-7 — DB reset for E2E via `manage.py flush`

Playwright's `globalSetup` (runs once before the spec files) shells out to `docker compose exec -T backend python manage.py flush --no-input`. No test endpoint, no extra surface. `flush` truncates tables and re-runs initial fixtures (we have none) — the cleanest reset available without dropping/recreating the DB.

## Data Model & Schema

### `jobs.models`

```python
# jobs/models.py
from django.db import models


class StatusType(models.TextChoices):
    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"


class Job(models.Model):
    name = models.CharField(max_length=200)
    current_status = models.CharField(
        max_length=16,
        choices=StatusType.choices,
        default=StatusType.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["-created_at", "-id"], name="idx_job_created_at_id_desc"),
            # current_status has db_index=True via the field; that single-column
            # index plus the (-created_at,-id) index covers the locked queries.
        ]
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Job(id={self.id}, name={self.name!r}, status={self.current_status})"


class JobStatus(models.Model):
    job = models.ForeignKey(
        Job,
        on_delete=models.CASCADE,
        related_name="statuses",
        db_index=False,  # composite below covers it
    )
    status_type = models.CharField(max_length=16, choices=StatusType.choices)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["job", "-timestamp"],
                name="idx_jobstatus_job_timestamp_desc",
            ),
        ]
        ordering = ["-timestamp", "-id"]

    def __str__(self) -> str:
        return f"JobStatus(job_id={self.job_id}, status={self.status_type}, ts={self.timestamp.isoformat()})"
```

### Migrations

- `0001_initial.py` — generated by `makemigrations`. Creates both tables with the indexes above.
- (Optional) `0002_status_check_constraint.py` — adds `CheckConstraint(check=Q(status_type__in=StatusType.values))` if open question 7 flips. Skip by default.

The migration runs from `entrypoint.sh` via `python manage.py migrate --noinput` before `uvicorn` starts. With one worker on cold start there is no race; if we ever go multi-worker we move migrations to a separate one-shot init container.

## API / Interface Design

### Schemas (`jobs/schemas.py`)

```python
from datetime import datetime
from typing import Literal
from ninja import Schema
from .models import StatusType

OrderingValue = Literal["name", "-name", "created_at", "-created_at"]


class JobCreate(Schema):
    name: str  # validation: non-empty, max 200 (Pydantic + model max_length backstop)


class JobStatusUpdate(Schema):
    status_type: StatusType

    class Config:
        extra = "forbid"  # plan: PATCH body must contain ONLY status_type


class JobOut(Schema):
    id: int
    name: str
    current_status: StatusType
    created_at: datetime
    updated_at: datetime

    @staticmethod
    def from_model(job) -> "JobOut":
        return JobOut(
            id=job.id,
            name=job.name,
            current_status=job.current_status,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )


class JobStatusOut(Schema):
    id: int
    status_type: StatusType
    timestamp: datetime


class ErrorItem(Schema):
    loc: list[str]
    msg: str
    type: str


class ErrorEnvelope(Schema):
    detail: str
    errors: list[ErrorItem] | None = None
```

`JobCreate.name` validation: a Pydantic validator rejects empty strings and trims whitespace. `max_length=200` is enforced both by the Pydantic schema and as a backstop in the DB column.

### Handler signatures (`jobs/api.py`)

Pseudocode — actual implementation in `/spec:implement`:

```python
from ninja import Router, Query
from ninja.pagination import paginate, CursorPagination
from . import services, schemas

router = Router(tags=["jobs"])


@router.get("/jobs/", response=list[schemas.JobOut])
@paginate(CursorPagination, ordering=("created_at",), page_size=20)
async def list_jobs(request, status: StatusType | None = None, ordering: OrderingValue = "-created_at"):
    return await services.list_jobs(status=status, ordering=ordering)


@router.post("/jobs/", response={201: schemas.JobOut})
async def create_job(request, payload: schemas.JobCreate, response):
    job = await services.create_job(name=payload.name)
    response["Location"] = f"/api/jobs/{job.id}/"
    return 201, schemas.JobOut.from_model(job)


@router.get("/jobs/{job_id}/", response={200: schemas.JobOut, 404: schemas.ErrorEnvelope})
async def get_job(request, job_id: int):
    job = await services.get_job(job_id)
    return 200, schemas.JobOut.from_model(job)


@router.patch("/jobs/{job_id}/", response={200: schemas.JobOut})
async def update_job(request, job_id: int, payload: schemas.JobStatusUpdate):
    job = await services.update_job_status(job_id=job_id, status_type=payload.status_type)
    return 200, schemas.JobOut.from_model(job)


@router.delete("/jobs/{job_id}/", response={204: None})
async def delete_job(request, job_id: int):
    await services.delete_job(job_id)
    return 204, None


@router.get("/jobs/{job_id}/statuses/", response=list[schemas.JobStatusOut])
@paginate(CursorPagination, ordering=("timestamp",), page_size=20)
async def list_job_statuses(request, job_id: int):
    return await services.list_job_statuses(job_id=job_id)
```

`Ordering` of `CursorPagination` accepts a tuple — the implementation calls `qs.order_by("-created_at", "-id")` upstream (see ADR-4). The verification spike confirms the exact incantation.

### Health endpoint (`config/api.py`)

```python
@api.get("/health/", auth=None, include_in_schema=False)
async def health(request):
    # Cheap: hit the connection.
    await sync_to_async(lambda: connection.ensure_connection())()
    return {"status": "ok"}
```

## Deployment & Infrastructure

### `backend/Dockerfile` (multi-stage with uv)

```dockerfile
# syntax=docker/dockerfile:1.7

# --- Builder stage: install deps with uv into a venv ---
FROM python:3.12-slim-trixie AS builder
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen


# --- Runtime stage ---
FROM python:3.12-slim-trixie AS runtime

# curl for healthcheck; netcat-openbsd for wait-for-db in entrypoint
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends curl netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 app
WORKDIR /app

COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Logs volume mountpoint owned by app
RUN mkdir -p /app/logs && chown -R app:app /app/logs

USER app
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
```

Notes:

- `uv sync --frozen` twice: once before COPY of source for layer-cache friendliness, once after to install the project itself. (Standard uv pattern.)
- `python:3.12-slim-trixie` is the small Debian-trixie base; matches Postgres 16 era.
- `useradd -m -u 1000 app` keeps host-volume permissions sane on macOS/Linux.

### `backend/entrypoint.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] waiting for db at $POSTGRES_HOST:$POSTGRES_PORT"
until nc -z "$POSTGRES_HOST" "${POSTGRES_PORT:-5432}"; do
  sleep 0.5
done
echo "[entrypoint] db reachable"

echo "[entrypoint] running migrations"
python manage.py migrate --noinput

echo "[entrypoint] starting uvicorn"
exec uvicorn config.asgi:application \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --log-config /app/config/uvicorn_logging.json
```

`uvicorn_logging.json` is a small dictConfig file that hands uvicorn's access logger to our handlers (so request logs are uniform with app logs).

LF line endings, `chmod +x` in the Dockerfile is implicit (`COPY` preserves mode).

### `backend/pyproject.toml` (deps)

Pinned versions per research:

```toml
[project]
name = "jobs-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "Django>=5.2,<5.3",
  "django-ninja==1.6.2",
  "psycopg[binary]>=3.2,<3.3",
  "uvicorn[standard]>=0.32",
  "colorlog>=6.8",
  "python-json-logger>=3.2",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "pytest-django>=4.9",
  "pytest-asyncio>=0.25",
  "factory-boy>=3.3",
  "httpx>=0.28",  # for Ninja's TestAsyncClient
]
```

### `backend/config/settings.py` (key bits)

```python
import os
from pathlib import Path
from .logging import build_log_config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.environ.get("DJANGO_DEBUG", "False").lower() == "true"
ALLOWED_HOSTS = ["*"]  # behind nginx in compose; same-origin

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",  # required by contenttypes / migrations
    "jobs",
]

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTGRES_DB"],
        "USER": os.environ["POSTGRES_USER"],
        "PASSWORD": os.environ["POSTGRES_PASSWORD"],
        "HOST": os.environ.get("POSTGRES_HOST", "db"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

LOGGING_CONFIG = None  # we configure via dictConfig manually
LOGGING = build_log_config()
import logging.config  # noqa: E402
logging.config.dictConfig(LOGGING)
```

## Security, Performance, Observability

### `backend/config/logging.py` — dictConfig factory

```python
import os
from datetime import datetime, timezone
from pathlib import Path

def build_log_config() -> dict:
    env = os.environ.get("ENV", "dev")
    fmt = os.environ.get("LOG_FORMAT", "text" if env == "dev" else "json")
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_dir = Path(os.environ.get("LOG_DIR", "/app/logs"))
    service = os.environ.get("SERVICE_NAME", "api")
    log_dir.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    ext = "json" if fmt == "json" else "log"
    filename = log_dir / f"{env}-{service}-{started}.{ext}"

    formatters = {
        "text_color": {
            "()": "colorlog.ColoredFormatter",
            "format": "%(log_color)s[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
        },
        "text_plain": {
            "format": "[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
        },
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
            "rename_fields": {"asctime": "timestamp", "levelname": "level", "name": "logger"},
            "static_fields": {"service": service, "env": env},
        },
    }

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": formatters,
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
                "formatter": "text_color" if (env == "dev" and fmt == "text") else ("json" if fmt == "json" else "text_plain"),
                "level": level,
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": str(filename),
                "maxBytes": 10 * 1024 * 1024,
                "backupCount": 7,
                "formatter": "json" if fmt == "json" else "text_plain",
                "level": level,
                "encoding": "utf-8",
            },
        },
        "loggers": {
            "": {"handlers": ["console", "file"], "level": level},
            "jobs": {"handlers": ["console", "file"], "level": level, "propagate": False},
            "django.request": {"handlers": ["console", "file"], "level": "WARNING", "propagate": False},
            "django.db.backends": {"level": "WARNING"},  # silence query spam unless DEBUG
        },
    }
```

### Logging usage rules (FR-011, NFR-006)

- `logger = logging.getLogger(__name__)` at the top of every module.
- Service layer emits state-change INFO events. Each event uses a stable verb-noun message like `"job_created"` and structured `extra` keys (`job_id`, `status_type`).
- Validation 4xx logging happens in the Ninja exception handler: `logger.warning("validation_error", extra={"path": request.path, "type": exc_type})`. **Never `exc_info=True`.**
- 5xx logging happens in the catch-all exception handler: `logger.exception("unhandled_error", extra={"path": request.path})`. The traceback never includes user-supplied bodies because we logged before serializing.

### Performance

- `current_status` is a single CharField with `db_index=True`. Filter by status hits the index directly.
- Composite index `(job_id, timestamp DESC)` on `JobStatus` serves both the history endpoint and any future "n most recent statuses" lookup.
- `EXPLAIN (ANALYZE, BUFFERS)` verification at /spec:implement against a 1 M-row seed. Pass criteria: no seq scans, buffer hits per page <50.
- `CONN_MAX_AGE=60` keeps a persistent connection per worker; with `--workers 1` we hold one connection at steady state.

### Security posture (NFR-004..NFR-006)

- `DJANGO_DEBUG` defaults to `False` if env var unset OR not literal `"True"`.
- `SECRET_KEY` read from env; absence raises `KeyError` at boot (fail loud, not silent default).
- Pydantic `Schema` rejects unknown fields where it matters (PATCH).
- Ninja handlers only declare query params they accept; unknown query params return 422.
- No request bodies in logs; validation log path uses error type + path only.
- Postgres user is the same as the DB owner (single-tenant compose); README documents this as a known simplification.

## Testing Strategy

### Layout (`backend/jobs/tests/`)

- `conftest.py` — sync `db` fixture from pytest-django; sync factory fixtures (`job`, `pending_job`, `running_job`); async `client` fixture that yields a `TestAsyncClient(api)`.
- `factories.py` — `factory_boy` factories for `Job` and `JobStatus`.
- `test_services.py` — exhaustive coverage of `services.create_job`, `update_job_status`, `delete_job`, `list_jobs`, `get_job`, `list_job_statuses`. Targets edge cases (atomicity rollback, denormalized cache stays in sync, `updated_at` bumps on PATCH but not on DELETE).
- `test_api.py` — handler coverage via `TestAsyncClient`. Asserts status codes, response envelope, `Location` header, error envelope shape, query-param whitelisting.

### Patterns

```python
# conftest.py
import pytest
import pytest_asyncio
from ninja.testing import TestAsyncClient
from config.api import api
from .factories import JobFactory, JobStatusFactory

@pytest.fixture
def job_factory(db):
    return JobFactory

@pytest.fixture
def status_factory(db):
    return JobStatusFactory

@pytest_asyncio.fixture
async def client():
    return TestAsyncClient(api)
```

```python
# Async ORM tests need transaction=True (committing inside async context)
@pytest.mark.django_db(transaction=True)
async def test_create_job_persists_and_logs_pending(client, caplog):
    response = await client.post("/jobs/", json={"name": "Sim 1"})
    assert response.status_code == 201
    body = response.json()
    assert body["current_status"] == "PENDING"
    assert response.headers["Location"] == f"/api/jobs/{body['id']}/"
    assert "job_created" in caplog.text
```

### Coverage target

`pytest --cov=jobs.services --cov=jobs.api --cov-fail-under=80` — wired into `pytest.ini` so `make test` enforces it.

### Logging verification test

Submit a malformed `name` payload, capture log records, assert that no record's `message` or `extra` contains the offending input. Locks NFR-006.

### `EXPLAIN` verification

Not a unit test. Run `python manage.py shell -c "from jobs.bench import run; run()"` from a `make seed-bench` target documented in CLAUDE.md. Output captured into a `docs/perf.md` (gitignored) note before final submission.

## Rollout / Migration Plan

Greenfield. Migrations are 0001 (initial). No data migration. Developers and CI run `migrate` from `entrypoint.sh`. There is no production environment in scope.

## Dependencies

- Django 5.2 — async ORM, async views.
- Django Ninja 1.6.2 — async-friendly Pydantic-based router with built-in `CursorPagination`.
- `psycopg[binary]` 3.2+ — async-capable Postgres driver.
- `uvicorn[standard]` — ASGI server with reload + uvloop.
- `colorlog` — colored dev console formatter.
- `python-json-logger` — JSON formatter.
- `pytest`, `pytest-django`, `pytest-asyncio`, `factory-boy`, `httpx` — test stack.
- Postgres 16-alpine (compose) — DB.

## Open Questions

These remain from the plan and the requirements file. Defaults baked into this design; flag any to redirect:

| # | Question | Default in this design |
| --- | --- | --- |
| 7 | DB-level CHECK on `status_type`? | Skip; rely on `TextChoices` + Pydantic |
| 10 | Filter-by-status strategy? | Denormalized `Job.current_status` (ADR-1) |
| 11 | Connection pooling? | `uvicorn --workers 1` (ADR-5) |
| 12 | E2E DB reset? | `manage.py flush` (ADR-7) |

Plus three **new** questions surfaced by this design:

| # | Question | Default |
| --- | --- | --- |
| 16 | Health endpoint should also check DB connectivity (not just Django up)? | Yes — `connection.ensure_connection()` (cheap) |
| 17 | `auth=None` and `include_in_schema=False` on `/api/health/` (so it doesn't show in `/api/docs/`)? | Yes |
| 18 | `ALLOWED_HOSTS = ["*"]` — acceptable for take-home given the same-origin nginx? | Yes; documented in README's Security notes |

## Glossary

(Same as `requirements.md`'s glossary; not duplicated here.)
