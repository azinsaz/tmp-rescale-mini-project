# Architecture Decision Record

This document captures the load-bearing decisions made while building the Job
Management Dashboard. Each decision is recorded with the **context** that
forced the choice, the **decision** itself, the **alternatives considered**,
and the **consequences** we accept by picking it. Where a trade-off is
non-obvious, the rationale is written out long-form rather than bulleted —
the goal is for a reviewer to be able to disagree with a decision on its
merits, not just take it on faith.

The decisions are grouped by layer (data, backend, frontend, infrastructure,
testing) and ordered roughly by blast radius. ADRs that are also captured
inline in `docs/specs/{backend,frontend}/design.md` are summarized here and
cross-referenced rather than duplicated.

---

## Table of contents

1. [ADR-001 — Denormalized `Job.current_status`](#adr-001--denormalized-jobcurrent_status)
2. [ADR-002 — Cursor (keyset) pagination over offset/limit](#adr-002--cursor-keyset-pagination-over-offsetlimit)
3. [ADR-003 — Composite-index strategy and stable tiebreakers](#adr-003--composite-index-strategy-and-stable-tiebreakers)
4. [ADR-004 — Async ASGI with `sync_to_async` only at unavoidable seams](#adr-004--async-asgi-with-sync_to_async-only-at-unavoidable-seams)
5. [ADR-005 — Thin handlers, fat services](#adr-005--thin-handlers-fat-services)
6. [ADR-006 — Locked error envelope and Ninja exception handlers](#adr-006--locked-error-envelope-and-ninja-exception-handlers)
7. [ADR-007 — Hard delete with `ON DELETE CASCADE`](#adr-007--hard-delete-with-on-delete-cascade)
8. [ADR-008 — Single uvicorn worker, single connection pool](#adr-008--single-uvicorn-worker-single-connection-pool)
9. [ADR-009 — `manage.py flush` for E2E DB reset (no test endpoint)](#adr-009--managepy-flush-for-e2e-db-reset-no-test-endpoint)
10. [ADR-010 — Custom `SortableCursorPagination`](#adr-010--custom-sortablecursorpagination)
11. [ADR-011 — TanStack Query as the only server-state store](#adr-011--tanstack-query-as-the-only-server-state-store)
12. [ADR-012 — URL-as-state for filter, sort, cursor, and selection](#adr-012--url-as-state-for-filter-sort-cursor-and-selection)
13. [ADR-013 — Drawer over the list (with distinct URL) for the detail view](#adr-013--drawer-over-the-list-with-distinct-url-for-the-detail-view)
14. [ADR-014 — Hand-rolled typed fetch wrapper, no generated client](#adr-014--hand-rolled-typed-fetch-wrapper-no-generated-client)
15. [ADR-015 — Tailwind v4 CSS-first `@theme`, no `tailwind.config.ts`](#adr-015--tailwind-v4-css-first-theme-no-tailwindconfigts)
16. [ADR-016 — nginx `/api/*` reverse proxy, relative URLs only](#adr-016--nginx-api-reverse-proxy-relative-urls-only)
17. [ADR-017 — Source baked into images (no bind mounts)](#adr-017--source-baked-into-images-no-bind-mounts)
18. [ADR-018 — `make test` is the cold-machine evaluation contract](#adr-018--make-test-is-the-cold-machine-evaluation-contract)

---

## ADR-001 — Denormalized `Job.current_status`

**Status**: accepted · **Layer**: data model

### Context

`GET /api/jobs/` must return the current status of every job. The naive
implementation expresses "current status" as the `status_type` of the
`JobStatus` row with the maximum `timestamp` per job, which means either a
correlated `Subquery` + `OuterRef` annotation or a `Prefetch` with a sliced
queryset. Both break down at the millions-of-jobs target the spec asks us to
design for: filtering by current status becomes O(N) over the annotation
predicate, and the index push-down PostgreSQL would otherwise apply on a
single-column predicate is lost.

### Decision

Add a `current_status` column directly on `Job` with `db_index=True`. Treat
`JobStatus` as the **single source of truth for history** and treat
`Job.current_status` as a **derived cache** of "the `status_type` of the
latest `JobStatus` row." The cache is maintained by the service layer, not
by a database trigger or Django signal.

Concretely:

- `services.create_job` creates the `Job` with `current_status=PENDING` and
  the initial `JobStatus(PENDING)` row inside the same `transaction.atomic()`
  block.
- `services.update_job_status` appends a new `JobStatus` row, sets
  `job.current_status`, and persists via `job.save(update_fields=[...])`
  inside the same `atomic()` block.

### Alternatives considered

| Option | Why rejected |
| --- | --- |
| `Subquery + OuterRef` annotation | O(N) on the filter predicate at scale; loses index push-down. |
| Per-status partial indexes on `JobStatus` | Adds four partial indexes; query becomes a `LATERAL` join. Same end state, more complexity. |
| Postgres `BEFORE INSERT` trigger | Inverts ownership of the write — "who owns the cache?" becomes split across the application and the database. Trigger logic is harder to test, harder to migrate, and silently fires on bulk operations. |
| Django `post_save` signal | Doesn't fire on `bulk_create` or raw SQL. Same coupling problem, with worse failure modes. |

### Consequences

- **Pro**: Filtering by status hits a single-column btree directly. The hot
  read path is index-only-ish at the millions-of-jobs target.
- **Pro**: Service code is straightforward to read and to test — the
  invariant "cache equals latest history row" lives in one function.
- **Con**: Any future write path that bypasses `services.py` (raw
  `JobStatus.objects.create(...)`, a script, a migration data-fix) corrupts
  the cache. Mitigated by (a) routing all writes through the service layer,
  (b) a unit test asserting `current_status` reflects the latest `JobStatus`
  after every mutation flow, and (c) a CLAUDE.md note flagging the
  invariant.

`EXPLAIN (ANALYZE, BUFFERS)` evidence on a 100 k-row seed is in
[`docs/perf.md`](./perf.md).

---

## ADR-002 — Cursor (keyset) pagination over offset/limit

**Status**: accepted · **Layer**: API contract

### Context

The spec frames the system around "millions of jobs." Any pagination scheme
we ship has to be stable under concurrent inserts (jobs are appended over
time) and has to keep page-fetch cost flat as the dataset grows. Offset
pagination (`LIMIT 20 OFFSET 1_000_000`) makes the database walk and discard
a million rows for every deep-page request; it is also non-deterministic
under inserts because new rows shift everyone's offsets.

### Decision

Use **cursor (keyset) pagination** on every list endpoint. The cursor is an
opaque base64 token encoding the value of the active sort key plus a small
offset for ties. Concretely:

1. Order by a tuple that ends in a strictly unique column (the primary key).
2. Encode the last item's sort-key value in the cursor.
3. The next page is `WHERE sort_key < :cursor` (or `>` for ascending sorts),
   followed by `ORDER BY sort_key DESC, id DESC LIMIT :page_size + 1`.

The endpoint envelope is:

```json
{
  "results": [...],
  "next": "http://host/api/jobs/?cursor=<token>",
  "previous": null
}
```

Both `next` and `previous` are **fully qualified URLs** (not bare tokens).
The frontend extracts the cursor with `URLSearchParams` and round-trips it
on the next request.

### Why cursor pagination

The decision rests on three properties that offset/limit cannot match:

1. **Constant time per page.** Every page is an index range scan bounded by
   the cursor's position; PostgreSQL never reads a row it doesn't return.
   `OFFSET 1_000_000` reads and discards one million rows; cursor
   pagination reads twenty.
2. **Stability under concurrent inserts.** With offset pagination, an insert
   between page reads shifts every subsequent offset by one — readers see
   duplicates and skip rows. With keyset pagination, the cursor names a
   *position in the sort order*, so concurrent inserts at the head of the
   list don't perturb deep pages.
3. **Composability with the index.** The keyset predicate `WHERE
   created_at < :c OR (created_at = :c AND id < :id)` is exactly the access
   pattern a `(created_at DESC, id DESC)` btree is built for. The planner
   walks the index once, returns the rows, stops.

### Trade-offs accepted

- **No "jump to page N."** Cursor pagination is intrinsically sequential.
  We do not expose page numbers, and the UI uses Next/Previous buttons. For
  a job-monitoring dashboard this is the right shape (operators rarely need
  to go to "page 743") but it is a real loss for use cases like "deep
  pagination by index."
- **No total count.** A cursor-paginated endpoint returns no
  `count` field. Computing the total would force a `SELECT COUNT(*)` on
  every page request, which itself becomes O(N). For dashboards that
  genuinely need a total, the right answer is a denormalized counter or an
  approximate `pg_stat` estimate, not a synchronous count.
- **Cursor invalidation under sort changes.** Because the cursor encodes
  the value of the *current* sort key, switching from `-created_at` to
  `name` mid-pagination invalidates the cursor. The frontend explicitly
  drops the cursor on sort change ([ADR-012](#adr-012--url-as-state-for-filter-sort-cursor-and-selection)).
- **Opaque cursor.** Decoding the cursor reveals the position value (a
  timestamp or name) — not a security issue here, but worth noting if the
  data ever becomes sensitive.

### Alternatives considered

| Option | Why rejected |
| --- | --- |
| `LIMIT/OFFSET` | O(N) deep pages; non-deterministic under inserts. |
| Range pagination on a public id (`?since_id=...`) | Couples the API to a client-visible monotonic id; same problem under non-PK sorts (name, updated_at). |
| Server-side virtual scrolling / streaming | Worth it for live tail UX; adds infrastructure (websockets/SSE) the spec doesn't require. |

The detailed contract envelope and the FE cursor-extraction utility are
documented in [`docs/specs/backend/design.md` §5](./specs/backend/design.md)
(ADR-4 spike findings) and [`docs/specs/frontend/design.md`](./specs/frontend/design.md)
(ADR-FE-1).

---

## ADR-003 — Composite-index strategy and stable tiebreakers

**Status**: accepted · **Layer**: data model

### Context

Cursor pagination is only as fast as the index that backs it. We need an
index for every sort dimension we expose, and every such index must end in a
**stable, unique** tiebreaker column so the sort order is total — otherwise
two rows with the same `created_at` will swap places between requests and
the cursor's position predicate breaks.

### Decision

Define one composite index per supported sort key, with `id` as the
tiebreaker. Direction in the index matches the dominant query direction so
PostgreSQL doesn't have to walk the index backwards (it can, but a forward
walk is slightly cheaper and the costs aren't symmetric on disk).

```python
class Job(models.Model):
    class Meta:
        indexes = [
            models.Index(fields=["-created_at", "-id"], name="idx_job_created_at_id_desc"),
            models.Index(fields=["-updated_at", "-id"], name="idx_job_updated_id_desc"),
            models.Index(fields=["name", "id"],         name="idx_job_name_id_asc"),
        ]
```

`Job.current_status` carries `db_index=True` (a separate single-column
btree) which the planner pairs with the `(-created_at, -id)` index when
filtering by status.

For status history:

```python
class JobStatus(models.Model):
    class Meta:
        indexes = [
            models.Index(fields=["job", "-timestamp"], name="idx_jstatus_job_ts_desc"),
        ]
```

### Trade-offs and reasoning

- **One index per sort dimension is deliberate.** Three composite indexes
  on a hot table is real write amplification (every insert updates three
  trees), but the millions-of-jobs target is read-dominated and the
  alternative — letting any sort fall back to a full table scan — would
  blow the latency budget. We accept the write cost.
- **Why the same index covers `name` ASC and `name` DESC.** PostgreSQL can
  walk a btree forward or backward at roughly the same cost, so a single
  ascending `(name, id)` index serves both `?sort=name` and `?sort=-name`.
  We do not duplicate it.
- **Why `id` as tiebreaker, not `pk`.** The `Job` model uses an
  auto-incrementing integer pk, so `id` is monotonically increasing and
  unique. This makes it the cheapest possible tiebreaker — no hashing, no
  collision handling.
- **Index name limit.** Django enforces a 30-character cap on
  `Meta.indexes` names (system check `models.E034`). PostgreSQL itself
  permits 63. We use shortened names and document the longer
  human-readable label in the ADR. The composite history index is
  `idx_jstatus_job_ts_desc`, not `idx_jobstatus_job_timestamp_desc`.

`EXPLAIN (ANALYZE, BUFFERS)` evidence in [`docs/perf.md`](./perf.md).

---

## ADR-004 — Async ASGI with `sync_to_async` only at unavoidable seams

**Status**: accepted · **Layer**: backend runtime

### Context

Django Ninja 1.6 supports async handlers and Django 5.2 supports an async
ORM (`aget`, `acreate`, `aiterator`, etc.). However, two patterns still
require a sync context: `transaction.atomic()` blocks (the async equivalent
is incomplete in 5.2) and `Subquery`/`OuterRef` annotations (the planner
materializes them in a sync evaluation step).

### Decision

Async by default. Use `await Job.objects.aget(pk=id)` and friends for
single-row reads. Use `sync_to_async` only for:

1. `transaction.atomic()` blocks — wraps any multi-statement write.
2. `Subquery` / `OuterRef` annotations (rare in the current code; would
   appear if we ever bypassed the denormalized `current_status`).
3. Materializing a queryset for handoff to Ninja's pagination decorator
   (the decorator iterates the queryset; safer to materialize in sync).

Each service function owns its own seam — the `_sync` helper is private to
the function, the `async def` wrapper awaits it and emits the log line.

### Why not pure sync (WSGI)?

The spec is read-dominated and the I/O profile (one PG query per request,
no fan-out, no external HTTP) is exactly where async shines: a single
worker can multiplex hundreds of concurrent reads against the connection
pool. The cost is a small mental tax (the `sync_to_async` rule above), and
that tax is well-defined and limited to two patterns.

### Why not async-everywhere (eliminate `sync_to_async`)?

Django 5.2 doesn't make this safe. `atomic()` will work in async contexts
in a future Django release; we'd rather use the documented sync seam than
write code that is "almost right" today.

---

## ADR-005 — Thin handlers, fat services

**Status**: accepted · **Layer**: backend code organization

### Context

Django Ninja handlers can do quite a lot — parse a Pydantic schema,
validate it, query the ORM, build a response. With four endpoints it is
tempting to put all the logic inline. The take-home spec rewards
maintainability and modularity, and the experience of reading a five-method
file where each method mixes HTTP concerns with ORM access is uniformly
worse than reading two smaller files.

### Decision

Three layers, three responsibilities:

- **`jobs.api`** (Ninja `Router`). HTTP only. Parse `Schema`, call exactly
  one service function, shape the response. No business logic, no logging,
  no transactions.
- **`jobs.services`** (async functions). Business logic. Owns the
  `sync_to_async` seam. Logs `INFO` on every state change. Re-raises
  domain errors as Ninja-friendly exceptions.
- **`jobs.models`** (Django models). Persistence and invariants. Indexes,
  ordering, choices.

`jobs.schemas` holds the Pydantic-via-Ninja DTOs — the wire types.

### Consequences

- Handlers are trivially testable through Django's test client.
- Services are unit-testable without HTTP.
- Adding an endpoint is a three-line change to `api.py` plus a service
  function; adding a state-change rule (e.g. "RUNNING → COMPLETED only,
  not RUNNING → PENDING") is a one-place change in `services.py`.

---

## ADR-006 — Locked error envelope and Ninja exception handlers

**Status**: accepted · **Layer**: API contract

### Context

Ninja's default validation error response is an HTTP 422 with a Pydantic
trace. That's fine for an internal tool but it leaks framework specifics
and breaks the contract that a frontend can reason about.

### Decision

A single error envelope used at every error code:

```json
{
  "detail": "Validation failed",
  "errors": [
    { "loc": ["body", "name"], "msg": "ensure this value has at least 1 character", "type": "value_error.any_str.min_length" }
  ]
}
```

- `400` for validation errors (we override Ninja's 422 via
  `@api.exception_handler(NinjaValidationError)`).
- `404` for missing resources (`{detail: "Job <id> not found"}`).
- `500` for uncaught exceptions, with a generic detail — never echo the
  original message, which can contain user input or stack frames.

The envelope shape is enforced by a top-level handler so individual
endpoints don't need to know about it.

### Why not stick with Ninja's 422?

422 is technically more correct (RFC 4918) but the wider HTTP world treats
client validation as 400. The frontend's typed `ApiError` already centers
on 400 + the structured `errors` array; harmonizing on 400 means the FE
has one error path, not two.

---

## ADR-007 — Hard delete with `ON DELETE CASCADE`

**Status**: accepted (with a known follow-up) · **Layer**: data model

### Context

The spec states: "DELETE /api/jobs/<id>/: Delete a specific job. Ensure
that all associated JobStatus entries are also deleted." This is
unambiguous as a behavioral requirement, but it is rarely the right
production behavior.

### Decision

Hard-delete the `Job` row. The `JobStatus.job` foreign key has
`on_delete=models.CASCADE`, so PostgreSQL drops the history rows in the
same transaction. The service emits a `job_deleted` log line.

### Why not soft-delete?

In production we would absolutely soft-delete: an `is_archived` boolean (or
a `deleted_at` timestamp) plus a manager that hides archived rows by
default. That preserves audit history, lets users recover from
fat-fingered deletes, and keeps history queries semantically meaningful.
We did not ship soft-delete because:

1. The spec literally says "delete" and "ensure that all associated
   `JobStatus` entries are also deleted" — going against that reads as
   over-interpretation of the requirements.
2. The data model didn't have an `is_archived` / `deleted_at` field, and
   adding one without being asked changes the contract.

The follow-up — switching to soft-delete with `is_archived` — is
documented in [`docs/future-improvements.md`](./future-improvements.md)
(§5). The migration is small (one boolean column with a partial index plus
a manager change); the hard part is deciding the retention policy.

---

## ADR-008 — Single uvicorn worker, single connection pool

**Status**: accepted · **Layer**: backend runtime

### Context

Production Django services run multiple uvicorn/gunicorn workers behind a
process supervisor. Each worker owns its own connection pool, which means
a fan-out from N workers × M pool size into PostgreSQL — easy to
oversubscribe `max_connections=100`.

### Decision

`uvicorn --workers 1`. One worker, one async event loop, one connection
pool. Uvicorn's async I/O multiplexes concurrent requests on a single
worker, and PostgreSQL's connection cost is meaningful enough that fewer
connections is genuinely better at this scope.

### When this stops being right

When CPU on the worker process becomes the bottleneck — which is unlikely
for an I/O-bound API like this one — the next move is either: (a) more
workers behind PgBouncer (transaction pooling), or (b) a sidecar
connection pool. Both are documented in
[`docs/future-improvements.md`](./future-improvements.md).

---

## ADR-009 — `manage.py flush` for E2E DB reset (no test endpoint)

**Status**: accepted · **Layer**: testing infrastructure

### Context

Playwright specs need a deterministic starting state. The two common
options are: (a) a test-only HTTP endpoint that the spec calls before each
test, or (b) shelling out to a Django management command from the test
runner.

### Decision

Between FE bring-up and the Playwright run, the host `Makefile` runs:

```
docker compose exec -T backend python manage.py flush --no-input
```

`flush` truncates every table and re-runs initial fixtures (we have none).
The compose-exec is host-orchestrated — Playwright itself never talks to
Docker.

### Why not a test endpoint?

A `POST /api/test/reset/` endpoint behind `ENV=test` is the cleaner thing
in some ecosystems, but it adds an attack surface (one more route in the
production binary), forces an environment branch in the API, and means
you have to be careful never to deploy with the test gate on. The
management-command path has none of those properties: production uvicorn
never runs `flush`, the command is dependency-free, and it's exactly one
line in the `Makefile`.

### Why not Docker socket mount?

Mounting `/var/run/docker.sock` into the Playwright container so it can
flush the DB itself is a real option, and it was the first pattern we
considered. We rejected it because:

- Mounting the Docker socket gives the test container full Docker
  privileges (it can stop the backend, pull arbitrary images, etc.). On a
  reviewer's laptop this is annoying, but in CI it's a real risk.
- Reviewer machines aren't guaranteed to have a Docker socket at the
  default path on every host (Linux/macOS/CI runners differ).

The host-orchestrated flush is cleaner and works identically on every
host.

---

## ADR-010 — Custom `SortableCursorPagination`

**Status**: accepted · **Layer**: backend pagination

### Context

Ninja 1.6's built-in `CursorPagination` accepts an `ordering=` argument at
**decoration time** (`@paginate(CursorPagination, ordering=("-created_at",
"-id"))`). The decorator-level ordering is captured into the paginator
instance once and reused for every request. There is no public hook for
varying the ordering per request.

We need per-request ordering because the spec lists "filter/sort by name,
creation date" as a stretch goal and we ship all five.

### Decision

Subclass `CursorPagination` as `jobs.pagination.SortableCursorPagination`.
The subclass:

1. Accepts `allowed_sorts` (a closed allow-list) and `default_sort` at
   construction time.
2. Adds a `sort` field to its `Input` schema.
3. Overrides `apaginate_queryset` to derive the ordering tuple per request
   from `pagination.sort`, validated against `allowed_sorts`. Invalid
   values silently fall back to `default_sort`.
4. Builds the cursor locally using the per-request ordering — never
   mutating `self.ordering`, because the paginator instance is shared
   across async requests.

### Why a closed allow-list?

`?sort=` is user input. Without an allow-list, a client could pass
`sort=password` (hypothetically) and force the planner to scan the wrong
index — or expose internal field names. The allow-list maps directly to
the index set in [ADR-003](#adr-003--composite-index-strategy-and-stable-tiebreakers);
nothing else is sortable.

### Trade-offs

- The custom paginator is ~150 lines of code and directly couples to
  Ninja's `Cursor` internals. If Ninja changes those internals in a
  future release we'll need to update.
- Switching sort mid-pagination invalidates the cursor (the cursor's
  position value belongs to the old sort key). The frontend handles this
  by dropping the cursor on sort change ([ADR-012](#adr-012--url-as-state-for-filter-sort-cursor-and-selection)).

---

## ADR-011 — TanStack Query as the only server-state store

**Status**: accepted · **Layer**: frontend

### Context

React applications routinely smear server state across `useState`,
`useEffect`, `useContext`, and a global store. This makes invalidation
hard, makes loading/error states inconsistent, and is the leading cause of
"why did this not refetch?" bugs.

### Decision

Components do not call `fetch` directly. They call typed hooks
(`useJobs`, `useJob`, `useStatuses`, `useCreateJob`, `useUpdateStatus`,
`useDeleteJob`) defined in `features/jobs/jobs.hooks.ts`. Each hook owns
its own query key and its own invalidation rules. TanStack Query is the
single source of truth for server data; React local state is reserved for
form drafts and ephemeral UI.

A query-key factory (`keys.list({status, cursor})`, `keys.detail(id)`,
`keys.history(id, cursor)`, all under the umbrella `['jobs']`) prevents
inlined arrays in components and makes invalidation surgical.

### Invalidation rules (worth recording)

- `useCreateJob.onSuccess` → invalidate the umbrella `['jobs']` (covers
  list, detail, history).
- `useUpdateStatus.onSuccess(updated)` → `setQueryData(keys.detail(id),
  updated)` then invalidate **list + history precisely**, not the
  umbrella. Invalidating the umbrella would refetch the detail and
  clobber the just-set cache.
- `useDeleteJob.onSuccess` → invalidate umbrella; the caller does
  `navigate('/jobs')`.

These rules are the failure mode you fix once and write down.

---

## ADR-012 — URL-as-state for filter, sort, cursor, and selection

**Status**: accepted · **Layer**: frontend

### Context

A dashboard's view is a function of: which filter is active, which sort
is active, which page (cursor), and which job is selected (drawer open
on which id). Any of these stored in component state is unshareable,
non-restorable, and doesn't survive a page reload.

### Decision

The list page reads `?status=`, `?sort=`, and `?cursor=` from
`useSearchParams`. The drawer is rendered by a nested route at
`/jobs/:id`. Every state the user can manipulate is therefore a URL.

Filter clicks call `setSearchParams` with `cursor` removed (changing the
filter invalidates the cursor — they're a different "stream").

### Consequences

- **Reload-safe.** A reviewer can land on `/jobs/12345?status=RUNNING`
  and see exactly what the previous user saw.
- **Share-link safe.** The URL is the canonical view.
- **Browser back/forward works for free.** No reducer, no router shim.
- **One source of truth.** The URL describes what's shown; TanStack
  Query describes what's loaded; everything else is derived.

---

## ADR-013 — Drawer over the list (with distinct URL) for the detail view

**Status**: accepted · **Layer**: frontend

### Context

The take-home spec lists, as a stretch goal, "Allow users to click on a
job to view more detailed information **in a separate page with a
distinct URL** from the job list page." We implement this requirement
verbatim — the detail view is reachable at the dedicated URL `/jobs/:id`
and that URL is shareable, reload-safe, and direct-linkable.

The non-trivial design question is *how the detail view should render*
when the user clicks a job from the list. The two natural answers are
(a) a separate page that replaces the list, and (b) a side drawer that
slides in over the list while the list stays mounted underneath.

### Decision

The detail view lives at the distinct URL `/jobs/:id`. When the user
**arrives via a click from `/jobs`**, the list stays mounted and the
detail renders into a right-side drawer (a nested route, with the drawer
as `<Outlet />` inside the list page). When the user **deep-links
directly** to `/jobs/12345`, the list page mounts behind the drawer and
the drawer opens on top — same final visual state, same URL,
indistinguishable from the click-from-list path.

```
/jobs              → JobsListPage
  └─ /jobs/:id     → JobDetailDrawer (rendered into <Outlet />)
```

### Why a drawer over a full-page swap

The spec's wording is satisfied by both — "a separate page with a
distinct URL" is a *contract* about URL-addressability, not a *layout*
mandate, and React Router treats both layouts as routes. Given the
choice, a drawer is the right answer for an operator-facing dashboard:

1. **List context never goes away.** Operators triage jobs by scanning
   the list. Yanking the list away to show one job's details forces a
   re-orientation every time they return.
2. **Scroll position and cursor preserved.** The list component does
   not unmount; React Query does not refetch the page; the user's scroll
   position is intact when the drawer closes.
3. **Faster perceived navigation.** The drawer animates in over a list
   that's already rendered. A full-page swap requires the list to be
   re-rendered (and re-fetched if cache invalidates) on close.
4. **Closes via Escape, click-outside, or `navigate('/jobs')`.** All
   three round-trip through the router; none break the URL contract.

### Trade-offs

- **Mobile.** A right-side drawer over a list doesn't fit a 360 px
  viewport. The implementation collapses the drawer to a near-full-width
  panel below the breakpoint, which is functionally a "page swap on
  mobile" — a deliberate convergence to the same UX where the drawer
  metaphor stops paying off.
- **Two mount paths to test.** The drawer-from-list flow and the
  deep-link flow are technically different mount sequences and we test
  both in Playwright.
- **The drawer is *not* a modal.** It uses `role="dialog"` semantics
  for screen-reader announcement but does not trap focus (the list
  underneath is still navigable). Modals trap; drawers don't. Confusing
  the two is a common a11y bug and we deliberately don't make it.

---

## ADR-014 — Hand-rolled typed fetch wrapper, no generated client

**Status**: accepted · **Layer**: frontend

### Context

The backend exposes an OpenAPI schema at `/api/openapi.json`. We could
run `openapi-typescript` (or similar) to generate a typed client. The
alternative is a small hand-written wrapper around `fetch`.

### Decision

`lib/api-client.ts` exports four typed functions (`apiGet`, `apiPost`,
`apiPatch`, `apiDelete<T>`) plus an `ApiError` class that carries
`status`, `detail`, and `errors[]` from the locked envelope. Feature
hooks call these directly; `features/jobs/jobs.types.ts` mirrors the
backend Pydantic schemas by hand.

### Why not generate?

For four endpoints and one error envelope the generator's output is more
code than the hand-written version, and the generated client introduces
a build-time dependency on a remote `openapi.json` (or a checked-in
copy that drifts). The TypeScript types we care about — `Job`,
`JobStatus`, `CursorPage<T>`, `ApiErrorBody` — are six lines each. The
hand-written seam is dramatically simpler to read and to evolve.

If the API surface grew to 30 endpoints we would revisit this. At six,
it isn't worth it.

---

## ADR-015 — Tailwind v4 CSS-first `@theme`, no `tailwind.config.ts`

**Status**: accepted · **Layer**: frontend tooling

### Context

Tailwind v4 (released 2025) moves the theme definition into CSS via the
`@theme { ... }` at-rule and removes `tailwind.config.ts` for projects
that don't need plugin-level extension. The `@tailwindcss/vite` plugin
reads CSS variables out of `@theme` and generates the utility classes.

### Decision

Brand colors and font families are declared in `src/index.css`:

```css
@theme {
  --color-rescale-ink: #1B1B1B;
  --color-rescale-blue: #489ABD;
  --font-display: "Fraunces", serif;
  /* ... */
}
```

Adding a new design token = adding a CSS variable. There is no
`tailwind.config.ts`.

### Why

- The design system is small (six colors, three fonts). A config file
  would be ceremony for no payoff.
- Co-locating tokens with `index.css` means the design tokens live in
  the same file as the global styles, which is where reviewers look.
- Tailwind v4's CSS-first approach is the recommended path for projects
  without plugin extension.

---

## ADR-016 — nginx `/api/*` reverse proxy, relative URLs only

**Status**: accepted · **Layer**: infrastructure

### Context

The frontend needs to talk to the backend. The two common patterns are:
(a) the SPA reads a `VITE_API_URL` env var and uses a fully-qualified
URL with a CORS layer on the backend, or (b) the SPA uses relative `/api`
paths and the static server proxies `/api/*` to the backend.

### Decision

The frontend nginx serves the SPA build and proxies `/api/*` to
`backend:8000`. In dev, Vite's dev server does the same proxy. The
client always uses relative paths (`fetch('/api/jobs/')`).

### Consequences

- **No CORS layer on the backend.** Same origin, no preflights, no
  `Access-Control-Allow-Origin` config drift between dev and prod.
- **No environment-specific URLs in the bundle.** The same JS works in
  dev, in compose, and (in the future) on staging — the URL is always
  `/api/...`.
- **Cookie-based auth (future) "just works."** Same-origin cookies
  don't need `SameSite=None; Secure` gymnastics.
- **The frontend nginx is now load-bearing.** It is the request entry
  point for both static assets and API proxying.

---

## ADR-017 — Source baked into images (no bind mounts)

**Status**: accepted · **Layer**: infrastructure

### Context

Compose can mount the working directory into the container so code
changes take effect on save (`-v ./backend:/app`). This is great for
rapid iteration but means the running image is not what gets shipped:
the prod image has the source baked in; the dev container runs the
host's source.

### Decision

No bind mounts. Every code change rebuilds the relevant image
(`docker compose build backend && docker compose up -d backend`). The
image you test is the image you ship.

### Trade-offs

- **Slower inner-loop edits.** A single backend change costs a rebuild.
  We mitigate by recommending `cd frontend && npm run dev` for
  frontend-heavy iteration (Vite dev proxy still hits the running
  compose backend) and by keeping backend rebuilds fast (uv cache,
  layered Dockerfile).
- **Test surface = ship surface.** This is the win. The
  `make test` cold-machine run executes against exactly the bytes that
  would deploy; there's no "works on my host but not in the image"
  class of bug.

---

## ADR-018 — `make test` is the cold-machine evaluation contract

**Status**: accepted · **Layer**: testing / orchestration

### Context

The take-home spec says: "We will first attempt to build and run tests
on a modern Linux or Mac OS installation. … After extracting the source
code archive, or cloning it from a Git repo, we will enter the top-level
project directory and execute `make test`. … If this step fails, we
will not proceed any further with the evaluation."

That makes `make test` the single most load-bearing command in the
repository. It must be hermetic (no host dependencies beyond `make`,
`docker`, `docker compose v2`, `bash`, and DockerHub access),
deterministic (no race conditions), and self-cleaning (a failed run
must not pollute the next).

### Decision

`make test` is the hermetic evaluation entrypoint:

1. `docker compose --profile test down -v --remove-orphans` (clean
   slate; ignore errors).
2. `docker compose --profile test build`.
3. `docker compose up -d db backend`.
4. Backend pytest in the running backend container, with `--cov` gates
   on `jobs.services`, `jobs.api`, `config.api`, `config.logging`.
5. Frontend Vitest via the `vitest` profile service (`npm run
   test:unit -- --coverage`).
6. `docker compose up -d frontend`.
7. `docker compose exec -T backend python manage.py flush --no-input`
   to reset state before E2E ([ADR-009](#adr-009--managepy-flush-for-e2e-db-reset-no-test-endpoint)).
8. Playwright via the `playwright` profile service against the running
   frontend.
9. Capture exit code; tear down on success **or** failure.

Any failure short-circuits and triggers the teardown path. The next
`make test` always starts from a clean slate.

### Why

The spec is unambiguous: this is the gate. Designing the rest of the
project around it — image layering for fast cold builds, host-orchestrated
DB reset, tear-down on failure — is the highest-leverage thing we can
do for evaluation success.

---

## Cross-cutting notes

- **Logging.** Stdlib logging via `dictConfig`, configured by env
  (`LOG_FORMAT=text|json`). `INFO` on every state change; `WARNING` on
  4xx with only error type and request path (never `exc_info=True` on
  user-input-derived errors); `ERROR` + `logger.exception(...)` on
  uncaught 5xx. Never log request bodies, secret-key fragments, or raw
  Pydantic exception messages.
- **Migrations.** Run from `entrypoint.sh` with `python manage.py
  migrate --noinput` before uvicorn starts. Single worker means no
  startup race; multi-worker would move migrations to an init container.
- **CHANGELOG.** Keep-a-Changelog format. Each meaningful behavioral
  change gets a line.
