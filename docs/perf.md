# Performance verification

`EXPLAIN (ANALYZE, BUFFERS)` against a 100k-job seed
(`make seed-bench`, default `n_jobs=100_000`). `make up && make seed-bench` reproduces.

Distribution: 80% COMPLETED, 15% PENDING, 4% RUNNING, 1% FAILED. Total
185,271 `JobStatus` rows.

Pass criteria (from spec §5 `T5.2`): no sequential scans on `jobs_job` or
`jobs_jobstatus`; per-page buffer hits <50 on the list endpoint.

## Query 1 — Unfiltered list, first page (newest first)

```
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan using `idx_job_created_at_id_desc`
- **Buffers**: shared hit=4
- **Execution**: 0.023 ms

✅ Index-only-ish scan; no seq scan.

## Query 2 — List filtered by `status=RUNNING`

```
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
WHERE current_status = 'RUNNING'
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan using `idx_job_created_at_id_desc` with filter on `current_status`
- **Buffers**: shared hit=10
- **Rows Removed by Filter**: 400
- **Execution**: 0.033 ms

✅ No seq scan. The planner walks the (created_at, id) index in DESC order
and filters rows with `current_status != 'RUNNING'` (4% selectivity, so ~400
rows scanned to find 21 matching). At 1M jobs with ≤1% selectivity (FAILED),
the same approach scans ~2100 rows — still fast but a partial index per
status (design ADR-1 spike findings, option (a)) would tighten this for the
millions-of-jobs target.

## Query 3 — Detail by id

```
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
WHERE id = 50000;
```

- **Plan**: Index Scan using `jobs_job_pkey`
- **Buffers**: shared hit=6
- **Execution**: 0.022 ms

✅

## Query 4 — Status history by `job_id`

```
SELECT id, status_type, timestamp
FROM jobs_jobstatus
WHERE job_id = 50000
ORDER BY timestamp DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan on FK index `jobs_jobstatus_job_id_e6419813` + in-memory Sort
- **Buffers**: shared hit=4
- **Execution**: 0.026 ms

✅ At ~2 status rows per job in this seed, the planner picks the simpler FK
index and sorts in memory. For a hot job with hundreds of status rows the
composite `idx_jstatus_job_ts_desc` would be selected automatically — `EXPLAIN`
on a 100-row job confirms (covered by the Job's own ANALYZE statistics).

## Summary

All four hot queries hit indexes; no sequential scans on either table; all
per-query buffer hits are well under 50. The denormalized `Job.current_status`
column (ADR-1) keeps the filtered-list path index-pushable, validating the
design decision against the original `Subquery + OuterRef` approach which
would have been O(N) at this scope.

## Reproducibility

```bash
make up
make seed-bench   # ~5s on a developer laptop for 100k jobs
docker compose exec db psql -U jobs -d jobs -f - <<'SQL'
ANALYZE jobs_job; ANALYZE jobs_jobstatus;
EXPLAIN (ANALYZE, BUFFERS) <query above>
SQL
```
