"""NinjaAPI instance. Routers (jobs, etc.) are attached here."""

import logging
from collections.abc import Iterable

from asgiref.sync import sync_to_async
from django.http import Http404
from ninja import NinjaAPI
from ninja.errors import ValidationError as NinjaValidationError

from jobs.api import router as jobs_router

logger = logging.getLogger(__name__)

api = NinjaAPI(
    title="Job Management Dashboard API",
    version="1.0.0",
    description="Backend for the Rescale take-home job-management dashboard.",
)

api.add_router("/", jobs_router)


@api.get("/", auth=None)
async def ping(request):
    """API root — friendly index + ping/pong response.

    Hitting ``GET /api/`` with no path returns a small JSON pointing at the
    docs and health endpoints. Doubles as a cheap "is the API alive?" probe
    for humans (the container uses ``/api/health/`` for the orchestrator).
    """
    return {
        "message": "pong",
        "service": api.title,
        "version": api.version,
        "links": {
            "docs": "/api/docs/",
            "openapi": "/api/openapi.json",
            "health": "/api/health/",
            "jobs": "/api/jobs/",
        },
    }


@api.get("/health/", auth=None, include_in_schema=False)
async def health(request):
    """Liveness + DB-reachability check used by the container healthcheck."""

    def _check_db():
        from django.db import connection as conn

        conn.ensure_connection()

    await sync_to_async(_check_db)()
    return {"status": "ok"}


# ---- Locked error-envelope handlers (T4.1) ---------------------------------


def _shape_errors(errors: Iterable[dict]) -> list[dict]:
    """Project Pydantic / Ninja error dicts into the locked envelope shape."""
    return [
        {
            "loc": [str(p) for p in e.get("loc", [])],
            "msg": e.get("msg", ""),
            "type": e.get("type", ""),
        }
        for e in errors
    ]


@api.exception_handler(NinjaValidationError)
def _on_validation_error(request, exc: NinjaValidationError):
    """Map Pydantic / Ninja validation errors to 400 with the locked shape.

    Logging policy (NFR-006): record only the request path and an error type
    counter — never the raw exception chain (which echoes user input).
    """
    logger.warning(
        "validation_error",
        extra={"path": request.path, "type": "ValidationError"},
    )
    return api.create_response(
        request,
        {"detail": "Validation failed", "errors": _shape_errors(exc.errors)},
        status=400,
    )


@api.exception_handler(Http404)
def _on_404(request, exc: Http404):
    detail = str(exc) or "Not found"
    return api.create_response(request, {"detail": detail}, status=404)


@api.exception_handler(Exception)
def _on_unhandled(request, exc: Exception):
    """Catch-all: log with full exc_info; never echo the exception message."""
    logger.exception("unhandled_error", extra={"path": request.path})
    return api.create_response(
        request,
        {"detail": "Internal server error"},
        status=500,
    )
