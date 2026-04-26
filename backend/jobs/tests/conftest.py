"""Shared pytest fixtures for the jobs test suite.

The `db` fixture from pytest-django activates per-test transactional isolation
on sync tests. Async tests that touch the ORM use
``@pytest.mark.django_db(transaction=True)`` so commits inside async/await
paths are visible.

`factory_boy` factories are sync and are consumed from sync fixtures here so
that async tests can inject a pre-built model without trying to ``await`` the
factory.
"""

from __future__ import annotations

import pytest
from ninja.testing import TestAsyncClient

from config.api import api
from jobs.tests.factories import JobFactory, JobStatusFactory


@pytest.fixture
def job_factory(db):
    """Return the sync ``JobFactory`` after activating the test DB."""
    return JobFactory


@pytest.fixture
def status_factory(db):
    """Return the sync ``JobStatusFactory`` after activating the test DB."""
    return JobStatusFactory


@pytest.fixture
def client():
    """Async-friendly Ninja test client for the project's NinjaAPI."""
    return TestAsyncClient(api)
