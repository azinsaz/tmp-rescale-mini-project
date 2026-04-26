"""Bulk-seed the database for performance benchmarking.

Usage (via docker compose):

    docker compose exec backend python manage.py shell -c "from jobs.bench import run; run()"

Default seeds 100,000 jobs with a realistic status distribution
(80% COMPLETED, 15% PENDING, 4% RUNNING, 1% FAILED). Each Job gets one
PENDING JobStatus row plus a final-state row if its current_status is
non-PENDING — so total JobStatus rows ≈ 1.85x N.

The 1M-row figure called out in design.md is the production verification
target; 100k surfaces the same index-vs-seqscan signal in `EXPLAIN` and is
fast enough for iterative dev.
"""

from __future__ import annotations

import random
import time

from jobs.models import Job, JobStatus, StatusType

_DISTRIBUTION = [
    (StatusType.COMPLETED, 0.80),
    (StatusType.PENDING, 0.15),
    (StatusType.RUNNING, 0.04),
    (StatusType.FAILED, 0.01),
]


def _pick_status() -> StatusType:
    r = random.random()
    acc = 0.0
    for status, weight in _DISTRIBUTION:
        acc += weight
        if r < acc:
            return status
    return StatusType.COMPLETED


def run(n_jobs: int = 100_000, batch_size: int = 5_000, truncate: bool = True) -> None:
    """Bulk-create ``n_jobs`` jobs with realistic status distribution.

    Args:
        n_jobs: total jobs to create.
        batch_size: rows per ``bulk_create`` round-trip.
        truncate: if True (default), wipe existing jobs first. Set False to
            stack new rows on top of existing data.
    """
    started = time.perf_counter()

    if truncate:
        print("[bench] truncating jobs_job + jobs_jobstatus")
        Job.objects.all().delete()  # cascades JobStatus

    print(f"[bench] creating {n_jobs} jobs in batches of {batch_size}")
    created = 0
    while created < n_jobs:
        batch = [
            Job(name=f"Job {created + i}", current_status=_pick_status())
            for i in range(min(batch_size, n_jobs - created))
        ]
        Job.objects.bulk_create(batch)
        created += len(batch)
        print(f"[bench]   {created}/{n_jobs}")

    print("[bench] creating JobStatus rows")
    status_count = 0
    for offset in range(0, n_jobs, batch_size):
        rows = []
        chunk = Job.objects.values_list("id", "current_status").order_by("id")[
            offset : offset + batch_size
        ]
        for job_id, current in list(chunk):
            rows.append(JobStatus(job_id=job_id, status_type=StatusType.PENDING))
            if current != StatusType.PENDING:
                rows.append(JobStatus(job_id=job_id, status_type=current))
        JobStatus.objects.bulk_create(rows)
        status_count += len(rows)

    elapsed = time.perf_counter() - started
    print(f"[bench] done in {elapsed:.1f}s — {n_jobs} jobs, {status_count} jobstatus rows")
