"""Async business-logic layer for the jobs feature.

Each public function is ``async def``. Any code that touches a transaction or
``Subquery``/``OuterRef`` annotations is wrapped in ``sync_to_async`` per
``docs/specs/backend/design.md`` ADR-2 / ADR-3. Service functions emit INFO
logs on every state change (FR-011, NFR-006).
"""

import logging

from asgiref.sync import sync_to_async
from django.db import transaction

from jobs.models import Job, JobStatus, StatusType

logger = logging.getLogger(__name__)


# ---- create_job -------------------------------------------------------------


@sync_to_async
def _create_job_sync(name: str) -> Job:
    """Create a Job and its initial PENDING JobStatus in one atomic block."""
    with transaction.atomic():
        job = Job.objects.create(name=name, current_status=StatusType.PENDING)
        JobStatus.objects.create(job=job, status_type=StatusType.PENDING)
    return job


async def create_job(*, name: str) -> Job:
    """Create a Job. Returns the persisted instance.

    Side effects:
      - inserts one row into ``jobs_job`` with ``current_status=PENDING``
      - inserts one row into ``jobs_jobstatus`` with ``status_type=PENDING``
      Both inside the same DB transaction.

    Raises:
      Whatever the underlying ORM raises on transactional failure. Callers
      are expected to convert to HTTP errors at the handler layer.
    """
    job = await _create_job_sync(name)
    logger.info("job_created", extra={"job_id": job.id})
    return job


# ---- get_job ----------------------------------------------------------------


async def get_job(job_id: int) -> Job:
    """Fetch a Job by id. Raises ``Job.DoesNotExist`` if not found."""
    return await Job.objects.aget(pk=job_id)


# ---- update_job_status ------------------------------------------------------


@sync_to_async
def _update_job_status_sync(job_id: int, status_type: StatusType) -> Job:
    """Append a JobStatus row, sync the denormalized cache, bump updated_at.

    All three writes happen inside the same `atomic` block so a partial
    failure rolls everything back.
    """
    with transaction.atomic():
        job = Job.objects.get(pk=job_id)
        JobStatus.objects.create(job=job, status_type=status_type)
        job.current_status = status_type
        # `auto_now=True` ensures updated_at is set when included in update_fields.
        job.save(update_fields=["current_status", "updated_at"])
    return job


async def update_job_status(*, job_id: int, status_type: StatusType) -> Job:
    """Append a new JobStatus and refresh the Job's denormalized state.

    Raises:
      Job.DoesNotExist: if no Job has the given id.
    """
    job = await _update_job_status_sync(job_id, status_type)
    logger.info(
        "status_appended",
        extra={"job_id": job.id, "status_type": status_type.value},
    )
    return job


# ---- delete_job -------------------------------------------------------------


@sync_to_async
def _delete_job_sync(job_id: int) -> None:
    """Delete a Job; FK on_delete=CASCADE removes its JobStatus rows."""
    Job.objects.get(pk=job_id).delete()


async def delete_job(job_id: int) -> None:
    """Hard-delete the Job and cascade-remove its history.

    Raises:
      Job.DoesNotExist: if no Job has the given id.
    """
    await _delete_job_sync(job_id)
    logger.info("job_deleted", extra={"job_id": job_id})


# ---- list_jobs --------------------------------------------------------------


def list_jobs(*, status=None):
    """Return a *lazy* queryset of jobs filtered by status, ordered DESC by
    creation date.

    Ordering is fixed at ``(-created_at, -id)`` because Ninja's built-in
    ``CursorPagination`` requires a static ordering per route to encode the
    cursor stably. Supporting user-controlled sort would require a custom
    paginator and is out of scope for this take-home (see design.md ADR-4
    spike findings).

    Filtering on ``status`` hits the indexed denormalized ``current_status``
    column (ADR-1). The queryset is materialized by Ninja's ``@paginate``
    decorator at the handler layer.
    """
    qs = Job.objects.all()
    if status is not None:
        qs = qs.filter(current_status=status)
    return qs.order_by("-created_at", "-id")


# ---- list_job_statuses ------------------------------------------------------


async def list_job_statuses(*, job_id: int):
    """Return a lazy queryset of JobStatus rows for a job, newest first.

    Raises:
      Job.DoesNotExist: if no Job has the given id.
    """
    if not await Job.objects.filter(pk=job_id).aexists():
        raise Job.DoesNotExist(f"Job {job_id} not found")
    return JobStatus.objects.filter(job_id=job_id).order_by("-timestamp", "-id")
