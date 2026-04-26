"""factory_boy factories for the ``jobs`` models.

These are *sync* factories. Async tests consume them via sync fixtures
(see design.md ADR-2 and the conftest pattern in T2.3).
"""

from __future__ import annotations

import factory

from jobs.models import Job, JobStatus, StatusType


class JobFactory(factory.django.DjangoModelFactory):
    """Factory for `Job`. Default `current_status` is PENDING."""

    class Meta:
        model = Job

    name = factory.Sequence(lambda n: f"Job {n}")
    current_status = StatusType.PENDING


class JobStatusFactory(factory.django.DjangoModelFactory):
    """Factory for `JobStatus`. Defaults to a PENDING row attached to a fresh Job."""

    class Meta:
        model = JobStatus

    job = factory.SubFactory(JobFactory)
    status_type = StatusType.PENDING
