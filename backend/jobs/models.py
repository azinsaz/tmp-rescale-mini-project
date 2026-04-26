"""Job and JobStatus models.

The `Job.current_status` field is a denormalized cache of the latest
`JobStatus.status_type`. It is set on POST and updated on PATCH inside the
same `atomic` block as the corresponding `JobStatus` write — see
`docs/specs/backend/design.md` ADR-1. The `JobStatus` table remains the
single source of truth for status history.
"""

from __future__ import annotations

from django.db import models


class StatusType(models.TextChoices):
    """The four status states a Job moves through."""

    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"


class Job(models.Model):
    """A computational job tracked by the dashboard."""

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
            models.Index(
                fields=["-created_at", "-id"],
                name="idx_job_created_at_id_desc",
            ),
            # Backs `sort=-updated_at` on GET /api/jobs/ (sortable cursor
            # pagination, see jobs.pagination). Stable tiebreaker on -id.
            models.Index(
                fields=["-updated_at", "-id"],
                name="idx_job_updated_id_desc",
            ),
            # Backs `sort=name` and `sort=-name`. PG can scan the same btree
            # forwards or backwards, so one ascending index covers both.
            models.Index(
                fields=["name", "id"],
                name="idx_job_name_id_asc",
            ),
        ]
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Job(id={self.id}, name={self.name!r}, status={self.current_status})"


class JobStatus(models.Model):
    """One row per status transition for a Job. Append-only via PATCH."""

    job = models.ForeignKey(
        Job,
        on_delete=models.CASCADE,
        related_name="statuses",
    )
    status_type = models.CharField(max_length=16, choices=StatusType.choices)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # Name shortened to ≤30 chars (Django's E034 cap); design.md
            # references the longer label which exceeded that limit.
            models.Index(
                fields=["job", "-timestamp"],
                name="idx_jstatus_job_ts_desc",
            ),
        ]
        ordering = ["-timestamp", "-id"]

    def __str__(self) -> str:
        return (
            f"JobStatus(job_id={self.job_id}, status={self.status_type}, "
            f"ts={self.timestamp.isoformat() if self.timestamp else 'unsaved'})"
        )
