"""Model-level invariants for ``Job`` and ``JobStatus`` (T2.1 acceptance)."""

from __future__ import annotations

import pytest

from jobs.models import Job, JobStatus, StatusType


@pytest.mark.django_db
def test_job_default_current_status_pending(job_factory):
    """A freshly-created Job defaults to PENDING."""
    job = job_factory()
    assert job.current_status == StatusType.PENDING


@pytest.mark.django_db
def test_cascade_delete_drops_status_rows(job_factory, status_factory):
    """Deleting a Job removes all of its JobStatus rows."""
    job = job_factory()
    status_factory(job=job, status_type=StatusType.RUNNING)
    status_factory(job=job, status_type=StatusType.COMPLETED)
    assert JobStatus.objects.filter(job=job).count() == 2

    job.delete()
    assert Job.objects.filter(pk=job.pk).count() == 0
    assert JobStatus.objects.filter(job_id=job.pk).count() == 0


@pytest.mark.django_db
def test_status_type_choices_match_design(job_factory, status_factory):
    """The four status values from the spec are exactly the locked set."""
    expected = {"PENDING", "RUNNING", "COMPLETED", "FAILED"}
    assert {v for v, _ in StatusType.choices} == expected
