"""Ninja Router for /api/jobs/* endpoints.

Handlers are thin: parse Pydantic schema, call a single ``services.x``
function, shape the response. No business logic, no logging.
"""

from django.http import Http404, HttpResponse
from ninja import Router
from ninja.pagination import CursorPagination, paginate

from jobs import schemas, services
from jobs.models import Job, StatusType
from jobs.pagination import SortableCursorPagination

router = Router(tags=["jobs"])

# Closed allow-list for the `sort` query param on GET /api/jobs/. The
# paginator silently falls back to the default if a client sends anything
# else — keeps the contract forgiving without leaking field names.
JOB_SORT_VALUES: tuple[str, ...] = (
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
    "name",
    "-name",
)


@router.get("/jobs/", response=list[schemas.JobOut])
@paginate(
    SortableCursorPagination,
    allowed_sorts=JOB_SORT_VALUES,
    default_sort="-created_at",
    page_size=20,
)
async def list_jobs(request, status: StatusType | None = None):
    """Paginated job list, optionally filtered by status, ordered by ``sort``.

    Sort is validated against ``JOB_SORT_VALUES``; invalid/missing values fall
    back to ``-created_at``. See ``docs/specs/backend/design.md`` §5 for the
    locked envelope shape (``results``, ``next``, ``previous``).
    """
    return services.list_jobs(status=status)


@router.post("/jobs/", response={201: schemas.JobOut})
async def create_job(request, payload: schemas.JobCreate, response: HttpResponse):
    """Create a new Job. Auto-creates the initial ``PENDING`` JobStatus.

    Returns 201 with a ``Location: /api/jobs/<id>/`` header per RFC 7231.
    """
    job = await services.create_job(name=payload.name)
    response["Location"] = f"/api/jobs/{job.id}/"
    return 201, schemas.JobOut.from_model(job)


@router.get("/jobs/{job_id}/", response={200: schemas.JobOut})
async def get_job(request, job_id: int):
    """Fetch a single Job by id. Returns 404 if not found.

    Until T4.1 normalises 404s into the locked envelope, ``Http404`` is
    raised here so Django's default 404 page kicks in.
    """
    try:
        job = await services.get_job(job_id)
    except Job.DoesNotExist as exc:
        raise Http404(f"Job {job_id} not found") from exc
    return 200, schemas.JobOut.from_model(job)


@router.patch("/jobs/{job_id}/", response={200: schemas.JobOut})
async def update_job(request, job_id: int, payload: schemas.JobStatusUpdate):
    """Append a new ``JobStatus`` row and update the denormalized cache.

    The body must contain *only* ``status_type``; extras are rejected by the
    schema. Bumps ``Job.updated_at`` inside the same atomic block.
    """
    try:
        job = await services.update_job_status(job_id=job_id, status_type=payload.status_type)
    except Job.DoesNotExist as exc:
        raise Http404(f"Job {job_id} not found") from exc
    return 200, schemas.JobOut.from_model(job)


@router.delete("/jobs/{job_id}/", response={204: None})
async def delete_job(request, job_id: int):
    """Hard-delete a Job and cascade-remove all its JobStatus rows."""
    try:
        await services.delete_job(job_id)
    except Job.DoesNotExist as exc:
        raise Http404(f"Job {job_id} not found") from exc
    return 204, None


@router.get("/jobs/{job_id}/statuses/", response=list[schemas.JobStatusOut])
@paginate(CursorPagination, ordering=("-timestamp", "-id"), page_size=20)
async def list_job_statuses(request, job_id: int):
    """Paginated status history for a Job, newest first."""
    try:
        return await services.list_job_statuses(job_id=job_id)
    except Job.DoesNotExist as exc:
        raise Http404(f"Job {job_id} not found") from exc
