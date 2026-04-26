# Performance verification

The take-home spec calls out a hypothetical workload of **millions of
jobs** and asks us to "describe any performance considerations or
optimizations" we made. This document captures both: the design decisions
that shape the hot read path, and the `EXPLAIN (ANALYZE, BUFFERS)`
evidence that those decisions hold at the seed scales we can reproduce
locally.

## Headline numbers

| Query | Plan | Buffer hits | Wall time |
| --- | --- | --- | --- |
| List page 1, no filter | Index Scan `idx_job_created_at_id_desc` | 4 | 0.023 ms |
| List filtered by `status=RUNNING` | Index Scan `idx_job_created_at_id_desc` + filter | 10 | 0.033 ms |
| Detail by id | Index Scan `jobs_job_pkey` | 6 | 0.022 ms |
| Status history by `job_id` | Index Scan FK + in-memory sort | 4 | 0.026 ms |

All four queries hit indexes; no sequential scans on `jobs_job` or
`jobs_jobstatus`; per-page buffer hits well under 50.

## Seed shape

`make seed-bench` populates the schema with **100,000 jobs** and
**~185,271 `JobStatus` rows** (default `n_jobs=100_000`, distribution
roughly 80% COMPLETED / 15% PENDING / 4% RUNNING / 1% FAILED, with
extra status rows for jobs that have transitioned through more than one
state). `make seed` does the same at **1,000,000 jobs** for harder
stress runs (~1–2 min on a developer laptop).

```bash
make up
make seed-bench   # 100k jobs, ~5s
make seed         # 1,000,000 jobs, ~1–2 min
```

## Pass criteria

From spec §5 (`T5.2`):

- No sequential scans on `jobs_job` or `jobs_jobstatus`.
- Per-page buffer hits < 50 on the list endpoint.

All four hot queries below clear both bars at 100 k. Q2 is the closest
call (10 buffer hits at 4% selectivity) and is discussed below.

---

## Query 1 — Unfiltered list, first page (newest first)

```sql
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan using `idx_job_created_at_id_desc`
- **Buffers**: shared hit=4
- **Execution**: 0.023 ms

The planner walks the composite `(-created_at, -id)` index in DESC
order, returns 21 rows, stops. This is the cheapest possible plan: one
btree descent plus a sequential leaf-page walk.

The `LIMIT 21` (not 20) is the cursor pagination "look ahead" that lets
the API decide whether a next page exists without a second query.

✅ Index-only-ish scan; no seq scan.

## Query 2 — List filtered by `status=RUNNING`

```sql
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
WHERE current_status = 'RUNNING'
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan using `idx_job_created_at_id_desc` with filter
  on `current_status`
- **Buffers**: shared hit=10
- **Rows Removed by Filter**: 400
- **Execution**: 0.033 ms

The planner walks the `(-created_at, -id)` index in descending order,
applies the `current_status='RUNNING'` predicate as an in-memory filter,
and returns the first 21 matches. At 4% selectivity the planner reads
~400 rows to find 21 matches.

This is the most expensive of the four hot queries and the one that
scales least gracefully with selectivity. Two follow-ups are worth
calling out:

1. **At 1 M jobs with ≤1% selectivity** (e.g. `FAILED`), the same plan
   scans roughly 2,100 rows to fill a 21-row page — still sub-millisecond
   on warm caches but not free.
2. **A partial index per status** (`CREATE INDEX ... ON jobs_job
   (created_at DESC, id DESC) WHERE current_status='FAILED'`) would
   tighten the cold-page case to 21 reads. We did not ship this because
   four partial indexes is meaningful write amplification and the seed
   numbers comfortably clear the spec's bar without it. It is documented
   in [`docs/future-improvements.md`](./future-improvements.md) as a
   ready-to-pull optimization if the filter-by-status path ever becomes
   hot.

✅ No seq scan; well under the 50-buffer-hit bar.

## Query 3 — Detail by id

```sql
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
WHERE id = 50000;
```

- **Plan**: Index Scan using `jobs_job_pkey`
- **Buffers**: shared hit=6
- **Execution**: 0.022 ms

✅ The trivial case. PK lookup, no surprises.

## Query 4 — Status history by `job_id`

```sql
SELECT id, status_type, timestamp
FROM jobs_jobstatus
WHERE job_id = 50000
ORDER BY timestamp DESC, id DESC
LIMIT 21;
```

- **Plan**: Index Scan on FK index `jobs_jobstatus_job_id_e6419813` +
  in-memory Sort
- **Buffers**: shared hit=4
- **Execution**: 0.026 ms

At ~2 status rows per job in this seed, the planner picks the simpler
FK index and sorts in memory. The composite
`idx_jstatus_job_ts_desc` (`(job_id, -timestamp)`) is *also* present;
the planner chooses based on `ANALYZE` statistics. For a hot job with
hundreds of status rows the composite index is selected automatically
(`EXPLAIN` on a 100-row job confirms) and the sort step disappears.

✅ Both index strategies are in place; the planner chooses the right
one per row count.

---

## Summary

All four hot queries hit indexes; no sequential scans on either table;
per-query buffer hits are well under the 50-hit bar. The denormalized
`Job.current_status` column ([ADR-001](./ADR.md#adr-001--denormalized-jobcurrent_status))
keeps the filtered-list path index-pushable, validating the design
decision against the original `Subquery + OuterRef` approach which
would have been O(N) at this scope.

## Why these numbers generalize

The seed uses 100 k–1 M jobs, not the "millions" the spec frames around.
The plans scale because the *shape* of the access doesn't change with
row count:

- **Cursor pagination is constant-time per page.** `LIMIT 21` reads 21
  index leaves regardless of dataset size, because the cursor predicate
  prunes the scan to a contiguous range.
- **Composite indexes for every supported sort.** Adding a sort
  dimension that doesn't have an index would force a sort step, which
  is O(N log N). Every sort we expose has a backing index — see
  [ADR-003](./ADR.md#adr-003--composite-index-strategy-and-stable-tiebreakers).
- **The denormalized `current_status` column moves the filter
  predicate into a single-column btree.** The cost is a write-side
  invariant maintained by `services.update_job_status`; the read-side
  win is index push-down.

What *would* change with row count: the partial-index case (Q2) at
very low selectivity. We have an explicit follow-up for that.

## Frontend rendering at scale

The list endpoint is paginated; the frontend renders one page at a
time (Next/Previous buttons, cursor in the URL). We do not ship
virtualization for v1 because:

- Twenty rows per page is comfortable on every viewport we target.
- Virtualization adds bundle size, complicates the table layout (fixed
  row heights), and pushes the "millions of jobs" UX problem from
  pagination (well-understood) onto scroll-position management
  (often-fragile).
- TanStack Query's `placeholderData: (prev) => prev` keeps the
  previous page visible while the next loads, so the UI never blinks.

If the product ever wants live-tail UX (a single "infinite scroll"
list updated by SSE/WebSocket), virtualization is the right
companion. Documented in
[`docs/future-improvements.md`](./future-improvements.md).

## Reproducibility

```bash
make up
make seed-bench   # ~5s on a developer laptop for 100k jobs
docker compose exec db psql -U jobs -d jobs <<'SQL'
ANALYZE jobs_job;
ANALYZE jobs_jobstatus;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, current_status, created_at, updated_at
FROM jobs_job
ORDER BY created_at DESC, id DESC
LIMIT 21;
SQL
```

Substitute the SQL block for any of the four queries above. All four
plans reproduce on a clean container.
