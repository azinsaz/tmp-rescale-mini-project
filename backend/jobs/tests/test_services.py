"""Service-layer tests."""

import pytest
from asgiref.sync import sync_to_async

from jobs import services
from jobs.models import Job, JobStatus, StatusType

# ---- services.get_job (T3.3) ------------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_get_job_returns_existing(db):
    job = await services.create_job(name="findme")
    fetched = await services.get_job(job.id)
    assert fetched.id == job.id
    assert fetched.name == "findme"


@pytest.mark.django_db(transaction=True)
async def test_get_job_raises_does_not_exist_for_missing(db):
    with pytest.raises(Job.DoesNotExist):
        await services.get_job(999_999)


# ---- services.update_job_status (T3.4) --------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_update_job_status_appends_row(db):
    """A new JobStatus row should exist after PATCH."""
    job = await services.create_job(name="patch-test-1")

    @sync_to_async
    def _count():
        return JobStatus.objects.filter(job_id=job.id).count()

    assert await _count() == 1  # initial PENDING from create

    await services.update_job_status(job_id=job.id, status_type=StatusType.RUNNING)

    assert await _count() == 2  # PENDING + RUNNING


@pytest.mark.django_db(transaction=True)
async def test_update_job_status_refreshes_denormalized_cache(db):
    """`Job.current_status` should reflect the latest JobStatus."""
    job = await services.create_job(name="patch-test-2")
    assert job.current_status == StatusType.PENDING

    await services.update_job_status(job_id=job.id, status_type=StatusType.COMPLETED)

    @sync_to_async
    def _refetch():
        return Job.objects.get(pk=job.id)

    refreshed = await _refetch()
    assert refreshed.current_status == StatusType.COMPLETED


@pytest.mark.django_db(transaction=True)
async def test_update_job_status_bumps_updated_at(db):
    """`updated_at` must be strictly newer after PATCH (auto_now via explicit save)."""
    import asyncio

    job = await services.create_job(name="patch-test-3")
    original_updated_at = job.updated_at

    # Tiny pause so timestamps differ even on fast hardware
    await asyncio.sleep(0.01)

    refreshed = await services.update_job_status(job_id=job.id, status_type=StatusType.RUNNING)
    assert refreshed.updated_at > original_updated_at


@pytest.mark.django_db(transaction=True)
async def test_update_job_status_rolls_back_when_status_insert_fails(db, monkeypatch):
    """All three writes (status row, cache field, updated_at) must roll back together."""
    job = await services.create_job(name="patch-test-4")
    real_create = JobStatus.objects.create

    def boom(*args, **kwargs):
        raise RuntimeError("simulated jobstatus failure")

    @sync_to_async
    def _patch():
        monkeypatch.setattr(JobStatus.objects, "create", boom)

    await _patch()

    with pytest.raises(RuntimeError, match="simulated"):
        await services.update_job_status(job_id=job.id, status_type=StatusType.RUNNING)

    @sync_to_async
    def _refetch_and_count():
        j = Job.objects.get(pk=job.id)
        rows = JobStatus.objects.filter(job_id=job.id).count()
        return j.current_status, rows

    status, rows = await _refetch_and_count()
    assert status == StatusType.PENDING, "denormalized cache should not advance on rollback"
    assert rows == 1, "no new JobStatus row should persist"

    monkeypatch.setattr(JobStatus.objects, "create", real_create)


@pytest.mark.django_db(transaction=True)
async def test_update_job_status_raises_for_missing_job(db):
    with pytest.raises(Job.DoesNotExist):
        await services.update_job_status(job_id=999_999, status_type=StatusType.RUNNING)


# ---- services.delete_job (T3.5) ---------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_delete_job_removes_job_and_cascade_statuses(db):
    job = await services.create_job(name="to-delete")
    await services.update_job_status(job_id=job.id, status_type=StatusType.RUNNING)

    @sync_to_async
    def _counts():
        return (
            Job.objects.filter(pk=job.id).count(),
            JobStatus.objects.filter(job_id=job.id).count(),
        )

    assert await _counts() == (1, 2)

    await services.delete_job(job.id)
    assert await _counts() == (0, 0)


@pytest.mark.django_db(transaction=True)
async def test_delete_job_raises_for_missing(db):
    with pytest.raises(Job.DoesNotExist):
        await services.delete_job(999_999)


# ---- services.list_jobs (T3.6) ----------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_list_jobs_unfiltered_returns_all(db):
    @sync_to_async
    def _seed():
        from jobs.tests.factories import JobFactory

        return [JobFactory(current_status=StatusType.PENDING) for _ in range(5)]

    await _seed()

    @sync_to_async
    def _materialize():
        return list(services.list_jobs())

    rows = await _materialize()
    assert len(rows) == 5


@pytest.mark.django_db(transaction=True)
async def test_list_jobs_filters_by_status(db):
    @sync_to_async
    def _seed():
        from jobs.tests.factories import JobFactory

        for _ in range(3):
            JobFactory(current_status=StatusType.PENDING)
        for _ in range(2):
            JobFactory(current_status=StatusType.RUNNING)

    await _seed()

    @sync_to_async
    def _materialize():
        return list(services.list_jobs(status=StatusType.RUNNING))

    rows = await _materialize()
    assert len(rows) == 2
    assert all(r.current_status == StatusType.RUNNING for r in rows)


@pytest.mark.django_db(transaction=True)
async def test_list_jobs_orders_newest_first(db):
    """Default ordering is `-created_at, -id` for cursor stability."""
    import asyncio

    @sync_to_async
    def _seed_one(n: str):
        from jobs.tests.factories import JobFactory

        return JobFactory(name=n)

    await _seed_one("first")
    await asyncio.sleep(0.01)
    await _seed_one("second")
    await asyncio.sleep(0.01)
    await _seed_one("third")

    @sync_to_async
    def _materialize():
        return [j.name for j in services.list_jobs()]

    assert await _materialize() == ["third", "second", "first"]


# ---- services.list_job_statuses (T3.7) --------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_list_job_statuses_returns_history_newest_first(db):
    job = await services.create_job(name="hist-1")  # PENDING
    await services.update_job_status(job_id=job.id, status_type=StatusType.RUNNING)
    await services.update_job_status(job_id=job.id, status_type=StatusType.COMPLETED)

    qs = await services.list_job_statuses(job_id=job.id)

    @sync_to_async
    def _materialize():
        return [s.status_type for s in qs]

    statuses = await _materialize()
    assert statuses == [StatusType.COMPLETED, StatusType.RUNNING, StatusType.PENDING]


@pytest.mark.django_db(transaction=True)
async def test_list_job_statuses_raises_for_missing_job(db):
    with pytest.raises(Job.DoesNotExist):
        await services.list_job_statuses(job_id=999_999)


# ---- services.create_job ----------------------------------------------------


@pytest.mark.django_db(transaction=True)
async def test_create_job_persists_job_with_pending_status(db):
    job = await services.create_job(name="Fluid Dynamics")

    @sync_to_async
    def _assert():
        persisted = Job.objects.get(pk=job.id)
        assert persisted.name == "Fluid Dynamics"
        assert persisted.current_status == StatusType.PENDING
        statuses = list(JobStatus.objects.filter(job=persisted))
        assert len(statuses) == 1
        assert statuses[0].status_type == StatusType.PENDING

    await _assert()


@pytest.mark.django_db(transaction=True)
async def test_create_job_emits_info_log(db, caplog, monkeypatch):
    """The dictConfig sets propagate=False on the `jobs` logger so app logs
    don't double-emit through the root in production. caplog hooks the root
    logger, so we toggle propagate up the whole chain just for this test."""
    import logging

    for name in ("jobs", "jobs.services"):
        monkeypatch.setattr(logging.getLogger(name), "propagate", True)
    caplog.set_level(logging.INFO)

    await services.create_job(name="Sim 1")

    messages = [r.getMessage() for r in caplog.records if r.name == "jobs.services"]
    assert any("job_created" in m for m in messages), f"no job_created log: {messages}"


@pytest.mark.django_db(transaction=True)
async def test_create_job_rolls_back_on_status_failure(db, monkeypatch):
    """If the JobStatus insert fails, the Job insert must roll back too.

    This locks the atomicity invariant on POST /api/jobs/.
    """
    real_create = JobStatus.objects.create

    def boom(*args, **kwargs):
        raise RuntimeError("simulated jobstatus failure")

    @sync_to_async
    def _patch():
        monkeypatch.setattr(JobStatus.objects, "create", boom)

    await _patch()

    with pytest.raises(RuntimeError, match="simulated"):
        await services.create_job(name="should-not-persist")

    @sync_to_async
    def _assert_empty():
        assert Job.objects.count() == 0, "Job row leaked through failed transaction"
        assert JobStatus.objects.count() == 0

    await _assert_empty()
    # Restore for any later tests in the same module
    monkeypatch.setattr(JobStatus.objects, "create", real_create)
