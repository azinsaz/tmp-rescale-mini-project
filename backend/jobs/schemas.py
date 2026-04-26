"""Pydantic / Ninja schemas for the Jobs API.

The schemas mirror the locked contract in ``docs/specs/backend/design.md``
section 5. Field validation is layered: Pydantic validates the wire (this
file) and the Django model layer enforces persistence invariants.
"""

from datetime import datetime

from ninja import Schema
from pydantic import Field, field_validator

from jobs.models import StatusType


class JobCreate(Schema):
    """``POST /api/jobs/`` request body."""

    name: str = Field(..., max_length=200)

    model_config = {"extra": "forbid"}

    @field_validator("name")
    @classmethod
    def _strip_and_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        return v


class JobStatusUpdate(Schema):
    """``PATCH /api/jobs/<id>/`` request body. Body must contain ONLY status_type."""

    status_type: StatusType

    model_config = {"extra": "forbid"}


class JobOut(Schema):
    """Job representation used in every response that returns a Job."""

    id: int
    name: str
    current_status: StatusType
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, job) -> "JobOut":
        return cls(
            id=job.id,
            name=job.name,
            current_status=job.current_status,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )


class JobStatusOut(Schema):
    """Single row in the status-history endpoint."""

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
