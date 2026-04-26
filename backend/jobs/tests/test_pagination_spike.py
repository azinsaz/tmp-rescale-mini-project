"""Verification spike (T2.4 / ADR-4) for Ninja `CursorPagination`.

Confirms that Ninja 1.6's built-in `CursorPagination` produces the expected
envelope shape when:

1. The handler is `async def`.
2. The queryset filter is applied to the denormalized `Job.current_status`
   column (set in T2.1 via ADR-1).
3. The queryset evaluation is wrapped in ``sync_to_async`` so we don't break
   the async-ORM rule.

If this test passes, downstream tasks T3.1, T3.6, T3.7 can use the same
pattern without further investigation. If it fails, ADR-4's keyset fallback
applies and `design.md` gets a small amendment.

This file is intentionally self-contained: it builds its own `NinjaAPI`
instance so the spike does not pollute the production router.

Note: ``from __future__ import annotations`` is intentionally NOT used here
because Pydantic 2 cannot resolve forward references inside Ninja query-param
schemas built from ``StatusType | None`` hints.
"""

from urllib.parse import parse_qs, urlparse

import pytest
from asgiref.sync import sync_to_async
from ninja import NinjaAPI, Schema
from ninja.pagination import CursorPagination, paginate
from ninja.testing import TestAsyncClient

from jobs.models import Job, StatusType
from jobs.tests.factories import JobFactory

# ---- Spike API: a temporary NinjaAPI instance just for this test file ------


class _SpikeJobOut(Schema):
    id: int
    name: str
    current_status: StatusType


_spike_api = NinjaAPI(urls_namespace="spike")


@_spike_api.get("/jobs", response=list[_SpikeJobOut])
@paginate(CursorPagination, ordering=("created_at", "id"), page_size=20)
async def _spike_list_jobs(request, status: StatusType | None = None):
    """Return a lazy queryset; CursorPagination materializes it via its own
    async-aware path. Building querysets (``.all()``, ``.filter()``,
    ``.order_by()``) is safe in async context — no SQL until iteration."""
    qs = Job.objects.all()
    if status is not None:
        qs = qs.filter(current_status=status)
    return qs.order_by("created_at", "id")


_spike_client = TestAsyncClient(_spike_api)


# ---- Helpers ----------------------------------------------------------------


@sync_to_async
def _seed_mixed(count: int) -> None:
    statuses = list(StatusType.values)
    for i in range(count):
        JobFactory(current_status=statuses[i % len(statuses)])


@sync_to_async
def _seed_status(status: StatusType, count: int) -> None:
    for _ in range(count):
        JobFactory(current_status=status)


# ---- Tests ------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_unfiltered_list_returns_cursor_envelope(db):
    """The CursorPagination envelope contains an items list and a cursor token."""
    await _seed_mixed(50)

    response = await _spike_client.get("/jobs")
    assert response.status_code == 200, response.content

    body = response.json()
    assert isinstance(body, dict), f"expected dict envelope, got {type(body)}"

    items_key = "items" if "items" in body else "results"
    assert items_key in body, f"envelope missing items/results: {list(body.keys())}"
    assert len(body[items_key]) == 20, f"expected page_size=20, got {len(body[items_key])}"


@pytest.mark.django_db(transaction=True)
async def test_filtered_by_denormalized_status(db):
    """Filter on the denormalized current_status returns only matching rows."""
    await _seed_status(StatusType.PENDING, 10)
    await _seed_status(StatusType.RUNNING, 5)
    await _seed_status(StatusType.COMPLETED, 8)

    response = await _spike_client.get("/jobs?status=RUNNING")
    assert response.status_code == 200, response.content
    body = response.json()
    items_key = "items" if "items" in body else "results"
    assert len(body[items_key]) == 5
    assert all(item["current_status"] == "RUNNING" for item in body[items_key])


@pytest.mark.django_db(transaction=True)
async def test_pagination_advances_without_overlap(db):
    """Page 2 contains different ids than page 1; cursor is parsed from `next` URL.

    Ninja's CursorPagination returns ``next`` as a fully-qualified URL with a
    ``cursor=<value>`` query param embedded. We parse it out here, which is
    what the FE will do too (TanStack Query keys want the cursor value, not
    the URL).
    """
    await _seed_status(StatusType.PENDING, 30)

    response = await _spike_client.get("/jobs")
    assert response.status_code == 200
    body = response.json()
    page_one_ids = [item["id"] for item in body["results"]]
    assert len(page_one_ids) == 20
    assert len(set(page_one_ids)) == 20
    assert body["next"], f"expected a next URL, got {body['next']!r}"

    cursor_value = parse_qs(urlparse(body["next"]).query)["cursor"][0]
    response2 = await _spike_client.get(f"/jobs?cursor={cursor_value}")
    assert response2.status_code == 200, response2.content
    body2 = response2.json()
    page_two_ids = [item["id"] for item in body2["results"]]
    assert set(page_one_ids).isdisjoint(set(page_two_ids))
