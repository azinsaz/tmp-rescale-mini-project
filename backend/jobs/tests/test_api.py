"""HTTP-handler tests for the jobs API.

Each handler is exercised through ``ninja.testing.TestAsyncClient``.
"""

import pytest
from asgiref.sync import sync_to_async

from jobs.models import JobStatus, StatusType

# ---- POST /api/jobs/ --------------------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_post_returns_201_with_location_and_pending_status(client):
    response = await client.post("/jobs/", json={"name": "Fluid Dynamics"})

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Fluid Dynamics"
    assert body["current_status"] == "PENDING"
    assert "id" in body and isinstance(body["id"], int)
    assert "created_at" in body
    assert "updated_at" in body

    location = response.headers.get("Location")
    assert location == f"/api/jobs/{body['id']}/", f"unexpected Location: {location!r}"


@pytest.mark.django_db(transaction=True)
async def test_post_persists_a_jobstatus_row(client):
    response = await client.post("/jobs/", json={"name": "Sim 2"})
    assert response.status_code == 201
    job_id = response.json()["id"]

    @sync_to_async
    def _count_statuses():
        return JobStatus.objects.filter(job_id=job_id, status_type=StatusType.PENDING).count()

    assert await _count_statuses() == 1


@pytest.mark.django_db(transaction=True)
async def test_post_rejects_empty_name_with_400(client):
    response = await client.post("/jobs/", json={"name": ""})
    assert response.status_code == 400  # Ninja default for Pydantic validation
    body = response.json()
    assert "detail" in body  # the locked envelope shape; T4.1 normalises 422→400


@pytest.mark.django_db(transaction=True)
async def test_post_rejects_whitespace_only_name(client):
    response = await client.post("/jobs/", json={"name": "   "})
    assert response.status_code == 400
    body = response.json()
    assert "detail" in body


@pytest.mark.django_db(transaction=True)
async def test_post_rejects_extra_fields(client):
    response = await client.post("/jobs/", json={"name": "ok", "current_status": "RUNNING"})
    assert response.status_code == 400  # extra=forbid


@pytest.mark.django_db(transaction=True)
async def test_post_rejects_too_long_name(client):
    response = await client.post("/jobs/", json={"name": "x" * 201})
    assert response.status_code == 400


@pytest.mark.django_db(transaction=True)
async def test_post_strips_whitespace_from_name(client):
    response = await client.post("/jobs/", json={"name": "  Trimmed Sim  "})
    assert response.status_code == 201
    assert response.json()["name"] == "Trimmed Sim"


# ---- GET /api/jobs/<id>/ (T3.3) ---------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_get_detail_returns_jobout_shape(client):
    create = await client.post("/jobs/", json={"name": "Detail Sim"})
    job_id = create.json()["id"]

    response = await client.get(f"/jobs/{job_id}/")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == job_id
    assert body["name"] == "Detail Sim"
    assert body["current_status"] == "PENDING"
    assert "created_at" in body and "updated_at" in body


@pytest.mark.django_db(transaction=True)
async def test_get_detail_returns_404_for_missing(client):
    response = await client.get("/jobs/999999/")
    assert response.status_code == 404


# ---- PATCH /api/jobs/<id>/ (T3.4) -------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_patch_advances_status(client):
    create = await client.post("/jobs/", json={"name": "patch-api-1"})
    job_id = create.json()["id"]

    response = await client.patch(f"/jobs/{job_id}/", json={"status_type": "RUNNING"})
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["current_status"] == "RUNNING"
    assert body["id"] == job_id


@pytest.mark.django_db(transaction=True)
async def test_patch_returns_404_for_missing_job(client):
    response = await client.patch("/jobs/999999/", json={"status_type": "RUNNING"})
    assert response.status_code == 404


@pytest.mark.django_db(transaction=True)
async def test_patch_rejects_unknown_status(client):
    create = await client.post("/jobs/", json={"name": "patch-api-2"})
    job_id = create.json()["id"]
    response = await client.patch(f"/jobs/{job_id}/", json={"status_type": "QUEUED"})
    assert response.status_code == 400


@pytest.mark.django_db(transaction=True)
async def test_patch_rejects_extra_fields(client):
    create = await client.post("/jobs/", json={"name": "patch-api-3"})
    job_id = create.json()["id"]
    response = await client.patch(
        f"/jobs/{job_id}/", json={"status_type": "RUNNING", "name": "rename"}
    )
    assert response.status_code == 400


@pytest.mark.django_db(transaction=True)
async def test_patch_then_get_reflects_new_status(client):
    create = await client.post("/jobs/", json={"name": "round-trip"})
    job_id = create.json()["id"]

    await client.patch(f"/jobs/{job_id}/", json={"status_type": "COMPLETED"})

    detail = await client.get(f"/jobs/{job_id}/")
    assert detail.status_code == 200
    assert detail.json()["current_status"] == "COMPLETED"


# ---- DELETE /api/jobs/<id>/ (T3.5) ------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_delete_returns_204_and_subsequent_get_404s(client):
    create = await client.post("/jobs/", json={"name": "to-delete"})
    job_id = create.json()["id"]

    response = await client.delete(f"/jobs/{job_id}/")
    assert response.status_code == 204
    assert response.content == b""

    follow = await client.get(f"/jobs/{job_id}/")
    assert follow.status_code == 404


@pytest.mark.django_db(transaction=True)
async def test_delete_returns_404_for_missing(client):
    response = await client.delete("/jobs/999999/")
    assert response.status_code == 404


@pytest.mark.django_db(transaction=True)
async def test_delete_cascade_removes_status_rows(client):
    create = await client.post("/jobs/", json={"name": "cascade-test"})
    job_id = create.json()["id"]
    await client.patch(f"/jobs/{job_id}/", json={"status_type": "RUNNING"})

    @sync_to_async
    def _count_statuses():
        return JobStatus.objects.filter(job_id=job_id).count()

    assert await _count_statuses() == 2

    response = await client.delete(f"/jobs/{job_id}/")
    assert response.status_code == 204

    assert await _count_statuses() == 0


# ---- GET /api/jobs/ (T3.6) --------------------------------------------------


from urllib.parse import parse_qs, urlparse  # noqa: E402


@pytest.mark.django_db(transaction=True)
async def test_list_empty_returns_envelope_with_no_results(client):
    response = await client.get("/jobs/")
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == []
    assert body["next"] is None
    assert body["previous"] is None


@pytest.mark.django_db(transaction=True)
async def test_list_paginates_and_advances_cursor(client):
    # Seed 25 jobs
    for i in range(25):
        await client.post("/jobs/", json={"name": f"page-{i:02d}"})

    response = await client.get("/jobs/")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 20  # default page_size
    assert body["next"] is not None

    # Follow the cursor
    cursor = parse_qs(urlparse(body["next"]).query)["cursor"][0]
    next_response = await client.get(f"/jobs/?cursor={cursor}")
    assert next_response.status_code == 200
    next_body = next_response.json()
    assert len(next_body["results"]) == 5

    # No overlap between pages
    page_one_ids = {r["id"] for r in body["results"]}
    page_two_ids = {r["id"] for r in next_body["results"]}
    assert page_one_ids.isdisjoint(page_two_ids)


@pytest.mark.django_db(transaction=True)
async def test_list_filter_by_status(client):
    for _ in range(3):
        await client.post("/jobs/", json={"name": "p"})
    for _ in range(2):
        c = await client.post("/jobs/", json={"name": "r"})
        await client.patch(f"/jobs/{c.json()['id']}/", json={"status_type": "RUNNING"})

    response = await client.get("/jobs/?status=RUNNING")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 2
    assert all(r["current_status"] == "RUNNING" for r in body["results"])


@pytest.mark.django_db(transaction=True)
async def test_list_unknown_status_rejected(client):
    response = await client.get("/jobs/?status=QUEUED")
    assert response.status_code == 400


@pytest.mark.django_db(transaction=True)
async def test_list_default_orders_newest_first(client):
    """Default ordering is `-created_at` (newest first)."""
    import asyncio

    for n in ["first", "second", "third"]:
        await client.post("/jobs/", json={"name": n})
        await asyncio.sleep(0.01)

    response = await client.get("/jobs/")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["third", "second", "first"]


# ---- GET /api/jobs/?sort=... (sortable cursor pagination) -------------------


@pytest.mark.django_db(transaction=True)
async def test_list_sort_by_name_asc_orders_alphabetically(client):
    for n in ["charlie", "alpha", "bravo"]:
        await client.post("/jobs/", json={"name": n})

    response = await client.get("/jobs/?sort=name")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["alpha", "bravo", "charlie"]


@pytest.mark.django_db(transaction=True)
async def test_list_sort_by_name_desc_orders_reverse(client):
    for n in ["charlie", "alpha", "bravo"]:
        await client.post("/jobs/", json={"name": n})

    response = await client.get("/jobs/?sort=-name")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["charlie", "bravo", "alpha"]


@pytest.mark.django_db(transaction=True)
async def test_list_sort_by_updated_at_reflects_patches(client):
    """Updating a job bumps `updated_at` → that job should sort first under -updated_at."""
    import asyncio

    ids = []
    for n in ["first", "second", "third"]:
        r = await client.post("/jobs/", json={"name": n})
        ids.append(r.json()["id"])
        await asyncio.sleep(0.01)
    # Bump the oldest job to the top via a status update.
    await client.patch(f"/jobs/{ids[0]}/", json={"status_type": "RUNNING"})

    response = await client.get("/jobs/?sort=-updated_at")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names[0] == "first"


@pytest.mark.django_db(transaction=True)
async def test_list_sort_invalid_falls_back_to_default(client):
    """Unknown sort tokens silently fall back to -created_at instead of erroring."""
    import asyncio

    for n in ["a", "b", "c"]:
        await client.post("/jobs/", json={"name": n})
        await asyncio.sleep(0.01)

    response = await client.get("/jobs/?sort=bogus")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["c", "b", "a"]


@pytest.mark.django_db(transaction=True)
async def test_list_sort_paginates_without_overlap(client, job_factory):
    """Sort by name: paging must not skip or duplicate rows across boundaries."""

    @sync_to_async
    def _seed():
        # Sequence guarantees unique names: "Job 0", "Job 1", ...
        for _ in range(30):
            job_factory()

    await _seed()

    response = await client.get("/jobs/?sort=name")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 20
    assert body["next"]

    cursor = parse_qs(urlparse(body["next"]).query)["cursor"][0]
    next_response = await client.get(f"/jobs/?sort=name&cursor={cursor}")
    assert next_response.status_code == 200
    next_body = next_response.json()
    page_one = [r["id"] for r in body["results"]]
    page_two = [r["id"] for r in next_body["results"]]
    assert set(page_one).isdisjoint(set(page_two))
    assert len(page_one) + len(page_two) == 30


# ---- GET /api/jobs/<id>/statuses/ (T3.7) ------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_history_returns_all_statuses_newest_first(client):
    create = await client.post("/jobs/", json={"name": "hist-api-1"})
    job_id = create.json()["id"]

    await client.patch(f"/jobs/{job_id}/", json={"status_type": "RUNNING"})
    await client.patch(f"/jobs/{job_id}/", json={"status_type": "COMPLETED"})

    response = await client.get(f"/jobs/{job_id}/statuses/")
    assert response.status_code == 200
    body = response.json()
    types = [s["status_type"] for s in body["results"]]
    assert types == ["COMPLETED", "RUNNING", "PENDING"]


@pytest.mark.django_db(transaction=True)
async def test_history_404_for_missing_job(client):
    response = await client.get("/jobs/999999/statuses/")
    assert response.status_code == 404


@pytest.mark.django_db(transaction=True)
async def test_history_paginates(client):
    create = await client.post("/jobs/", json={"name": "hist-api-paginate"})
    job_id = create.json()["id"]

    # Default page size is 20; we already have one PENDING so 19 PATCHes -> 20 rows
    statuses = ["PENDING", "RUNNING", "COMPLETED", "FAILED"]
    for i in range(25):
        await client.patch(f"/jobs/{job_id}/", json={"status_type": statuses[i % 4]})

    response = await client.get(f"/jobs/{job_id}/statuses/")
    body = response.json()
    assert len(body["results"]) == 20
    assert body["next"] is not None


# ---- Locked error envelope (T4.1) -------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_validation_400_envelope_shape(client):
    """400 envelope: detail + errors[{loc, msg, type}]."""
    response = await client.post("/jobs/", json={"name": ""})
    assert response.status_code == 400
    body = response.json()
    assert body["detail"] == "Validation failed"
    assert isinstance(body.get("errors"), list)
    assert len(body["errors"]) >= 1
    for item in body["errors"]:
        assert set(item.keys()) == {"loc", "msg", "type"}
        assert isinstance(item["loc"], list)
        assert isinstance(item["msg"], str)
        assert isinstance(item["type"], str)


@pytest.mark.django_db(transaction=True)
async def test_404_envelope_shape(client):
    response = await client.get("/jobs/999999/")
    assert response.status_code == 404
    body = response.json()
    assert "detail" in body
    assert "errors" not in body  # only present on validation errors


# ---- Logging hygiene (T4.2) -------------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_validation_log_excludes_user_input(client, caplog, monkeypatch):
    """4xx validation logs must NOT contain the rejected user input.

    Locks NFR-006: no request body leakage into logs.
    """
    import logging

    for name in ("config", "jobs"):
        monkeypatch.setattr(logging.getLogger(name), "propagate", True)
    caplog.set_level(logging.WARNING)

    sentinel = "SENSITIVE_TOKEN_xyz_abc_123"
    response = await client.post(
        "/jobs/", json={"name": sentinel * 20}
    )  # too long, triggers validation
    assert response.status_code == 400

    leaked = []
    for record in caplog.records:
        msg = record.getMessage()
        if sentinel in msg:
            leaked.append(("message", msg))
        for key, value in record.__dict__.items():
            if key in {"args", "msg", "message", "exc_info", "exc_text", "stack_info", "_name"}:
                continue
            if isinstance(value, str) and sentinel in value:
                leaked.append((key, value))

    assert not leaked, f"sentinel leaked into log records: {leaked}"


@pytest.mark.django_db(transaction=True)
async def test_state_change_logs_emit_at_info(client, caplog, monkeypatch):
    """create / patch / delete each emit a structured INFO log line."""
    import logging

    for name in ("config", "jobs", "jobs.services"):
        monkeypatch.setattr(logging.getLogger(name), "propagate", True)
    caplog.set_level(logging.INFO)

    create = await client.post("/jobs/", json={"name": "log-test"})
    job_id = create.json()["id"]
    await client.patch(f"/jobs/{job_id}/", json={"status_type": "RUNNING"})
    await client.delete(f"/jobs/{job_id}/")

    msgs = [
        r.getMessage()
        for r in caplog.records
        if r.levelname == "INFO" and r.name.startswith("jobs.services")
    ]
    assert any("job_created" in m for m in msgs), f"missing job_created in {msgs}"
    assert any("status_appended" in m for m in msgs), f"missing status_appended in {msgs}"
    assert any("job_deleted" in m for m in msgs), f"missing job_deleted in {msgs}"
