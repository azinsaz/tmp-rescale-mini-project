---
status: approved
feature: backend
verify: make test
---

# Tasks: Backend Jobs API

Atomic, ordered, vertical-slice task list. Each task produces a runnable + testable increment that can be exercised end-to-end before moving on. The verification spike for Ninja `CursorPagination` over the denormalized-`current_status` queryset (T3.1) gates every other API task.

## Traceability

Every approved FR/NFR maps to ≥1 task. `FR-014` (test-only DB reset for E2E) is owned by the **frontend stream** and is documented as a backend-stream gap.

| Req | Task IDs |
| --- | --- |
| FR-001 (list w/ current_status) | T3.6 |
| FR-002 (POST + initial PENDING) | T3.2 |
| FR-003 (GET detail) | T3.3 |
| FR-004 (PATCH append + denormalized + updated_at) | T3.4 |
| FR-005 (DELETE cascade) | T3.5 |
| FR-006 (filter/sort/cursor whitelisting) | T3.6 |
| FR-007 (history list paginated) | T3.7 |
| FR-008 (health endpoint) | T1.7 |
| FR-009 (validation envelope) | T4.1 |
| FR-010 (atomic writes) | T3.2, T3.4, T3.5 |
| FR-011 (logging conventions) | T4.2 |
| FR-012 (pytest + factory_boy + asyncio_mode) | T2.3 |
| FR-013 (OpenAPI served at /api/openapi.json, /api/docs/) | T3.1 |
| FR-014 (E2E DB reset hook) | **gap (frontend stream)** |
| FR-015 (DB CHECK on status_type) | deferred (Open Question 7) |
| NFR-001 (1M-row EXPLAIN index-only) | T5.2 |
| NFR-002 (stable cursor pagination) | T3.1, T3.6, T3.7 |
| NFR-003 (denormalized filter) | T2.1, T3.4, T3.6 |
| NFR-004 (no inline credentials) | T1.5 |
| NFR-005 (DJANGO_DEBUG=False default) | T1.2 |
| NFR-006 (log hygiene) | T4.2 |
| NFR-007 (structured logging) | T1.3, T4.3 |
| NFR-008 (multi-stage uv + curl runtime) | T1.4 |
| NFR-009 (cold-machine make test) | T5.3 |
| NFR-010 (pytest pass, ≥80% coverage on services + api) | T2.3, T3.2..T3.7 |
| NFR-011 (thin handlers / fat services) | T3.2..T3.7 |
| NFR-012 (no sync ORM in async paths) | T3.2..T3.7 |
| NFR-013 (uvicorn --workers 1) | T1.4 |

---

## Phase 1 — Foundation: container, compose, health

Goal: a backend container that builds from a uv-managed image, boots inside compose, talks to Postgres, and serves `/api/health/` healthy. No business logic yet.

### T1.1 — Backend project skeleton + uv-managed dependencies

- [x] **Refs**: NFR-008
- **Design ref**: `Deployment & Infrastructure → Dockerfile`, `Dependencies`
- **Description**: Create `backend/pyproject.toml` with the pinned dependency set from design.md (`Django>=5.2,<5.3`, `django-ninja==1.6.2`, `psycopg[binary]>=3.2,<3.3`, `uvicorn[standard]>=0.32`, `colorlog>=6.8`, `python-json-logger>=3.2`; dev group with pytest stack). Run `uv sync` to produce `uv.lock`. Add `backend/.python-version` pinning Python 3.12.
- **Effort**: S — single file plus a lockfile generation.
- **Depends on**: none
- **Parallelize with**: none
- **Acceptance**: `cd backend && uv sync` exits 0; `uv.lock` is present and committed.
- **Test type**: manual

### T1.2 — Django project + `jobs` app skeleton

- [x] **Refs**: NFR-005
- **Design ref**: `Architecture Overview`, `backend/config/settings.py` block
- **Description**: Create `backend/manage.py`, `backend/config/{__init__,settings,urls,asgi,api}.py`, and an empty `backend/jobs/{__init__,apps,models,services,api,schemas}.py`. `settings.py` reads env vars per design (DEBUG defaults to False; DATABASES, ALLOWED_HOSTS=["*"], INSTALLED_APPS, ASGI_APPLICATION). `urls.py` mounts the NinjaAPI from `config.api`. `config.api` declares an empty `NinjaAPI()` instance.
- **Effort**: M — many small files; nothing has logic yet.
- **Depends on**: T1.1
- **Parallelize with**: T1.3
- **Acceptance**: `python manage.py check` exits 0 from inside the container or a local uv venv; `DJANGO_DEBUG` defaults to `False` when env var is absent.
- **Test type**: manual + unit (a tiny `test_settings.py` that imports settings and asserts `DEBUG is False` by default).

### T1.3 — Logging factory (`config/logging.py`)

- [x] **Refs**: NFR-007
- **Design ref**: `Security, Performance, Observability → backend/config/logging.py`
- **Description**: Implement `build_log_config()` exactly as in design.md: env-driven format selection (text/dev with color, JSON/prod), `RotatingFileHandler(10 MiB × 7 backups)`, filename `{ENV}-{SERVICE_NAME}-{YYYY-MM-DD_HHMMSS}.{log|json}`. Wire into `settings.py` with `LOGGING_CONFIG = None` and a manual `dictConfig` call.
- **Effort**: M — careful formatter wiring; needs to handle missing `LOG_DIR`.
- **Depends on**: T1.1
- **Parallelize with**: T1.2
- **Acceptance**: Running Django emits a `dev-api-*.log` text file under `LOG_DIR`; switching `LOG_FORMAT=json` produces a `.json` extension and JSON-shaped lines. (T4.3 verifies hygiene properties later.)
- **Test type**: unit (`test_logging.py` asserts the dictConfig has the expected handler and formatter for each env).

### T1.4 — Backend Dockerfile + entrypoint.sh

- [x] **Refs**: NFR-008, NFR-013
- **Design ref**: `Deployment & Infrastructure → backend/Dockerfile`, `backend/entrypoint.sh`
- **Description**: Write `backend/Dockerfile` (multi-stage uv pattern with `curl` + `netcat-openbsd` in runtime, non-root `app` user, `--compile-bytecode`). Write `backend/entrypoint.sh` (LF endings, executable bit) that waits for db with `nc`, runs `python manage.py migrate --noinput`, then `exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --workers 1`.
- **Effort**: M — multi-stage layering and entrypoint correctness are easy to miss.
- **Depends on**: T1.1, T1.2
- **Parallelize with**: none
- **Acceptance**: `docker build ./backend` succeeds; the resulting image's `entrypoint.sh` is executable; `curl` is on PATH in the runtime stage.
- **Test type**: manual

### T1.5 — `docker-compose.yml` (db + backend)

- [x] **Refs**: NFR-004, NFR-009
- **Design ref**: plan §7 (referenced from design)
- **Description**: Top-level `docker-compose.yml` with `db` (postgres:16-alpine, pg_isready healthcheck, `db-data` named volume) and `backend` (built from `./backend`, env vars read from `.env`, `depends_on: db (service_healthy)`, `curl /api/health/` healthcheck `start_period: 30s, retries: 20, interval: 5s`, `expose: ["8000"]`, `backend-logs:/app/logs` named volume). Top-level `volumes:` block declares `db-data` and `backend-logs`.
- **Effort**: M
- **Depends on**: T1.4
- **Parallelize with**: none
- **Acceptance**: `docker compose config` parses without error; running `docker compose up -d db backend` makes both services healthy on a fresh machine within ~60 s.
- **Test type**: manual

### T1.6 — Makefile (`build`, `up`, `stop`, `clean`, `.env` preflight)

- [x] **Refs**: NFR-009
- **Design ref**: plan §7 Makefile block
- **Description**: Top-level `Makefile` with `.env` order-only-prerequisite (`cp -n .env.example .env`), and targets `build`, `up`, `stop`, `clean`. Leave `test` as a stub for now (final wiring in T5.3).
- **Effort**: S
- **Depends on**: T1.5
- **Parallelize with**: none
- **Acceptance**: `make build && make up` boots db + backend on a fresh clone with no manual `.env` step; `make stop` and `make clean` work cleanly.
- **Test type**: manual

### T1.7 — `/api/health/` endpoint and cold-machine smoke

- [x] **Refs**: FR-008, US-007
- **Design ref**: `API / Interface Design → Health endpoint`
- **Description**: Implement `GET /api/health/` in `config/api.py` (auth=None, `include_in_schema=False`, calls `connection.ensure_connection()` via `sync_to_async`, returns `{"status":"ok"}`). Confirm `docker compose ps` shows backend healthy and `curl http://localhost:<port>/api/health/` returns `{"status":"ok"}`.
- **Effort**: S
- **Depends on**: T1.6
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-007: backend healthy on cold-clone `make up`; `curl` returns 200.
- **Test type**: integration (one async test asserting 200 + body shape).

---

## Phase 2 — Data layer + verification spike

Goal: tables exist with the indexes the design requires; factories and pytest plumbing are ready; a 10-line spike confirms `CursorPagination` works on the queryset shape we depend on.

### T2.1 — `jobs.models` + 0001_initial migration

- [x] **Refs**: NFR-003
- **Design ref**: `Data Model & Schema → jobs.models`
- **Description**: Implement `jobs/models.py` exactly as in design (Job with `current_status` field `db_index=True`, JobStatus with composite index `(job, -timestamp)`, `StatusType` TextChoices). Run `python manage.py makemigrations jobs` to generate `0001_initial.py`. Commit the migration.
- **Effort**: M — index naming and field defaults must match design.
- **Depends on**: T1.7
- **Parallelize with**: none
- **Acceptance**: `python manage.py migrate` creates `jobs_job` and `jobs_jobstatus` with the expected indexes (verify via `\d+ jobs_job` and `\d+ jobs_jobstatus` in psql).
- **Test type**: manual + unit (`test_models.py::test_default_current_status_pending`, `test_cascade_delete_drops_statuses`).

### T2.2 — `jobs.tests.factories` (factory_boy)

- [x] **Refs**: FR-012
- **Design ref**: `Testing Strategy → factories.py`
- **Description**: Sync factory_boy factories: `JobFactory` (random name, `current_status=PENDING`), `JobStatusFactory` (FK to `JobFactory`, default `status_type=PENDING`).
- **Effort**: S
- **Depends on**: T2.1
- **Parallelize with**: T2.3
- **Acceptance**: `JobFactory()` returns a saved Job with `current_status=PENDING`.
- **Test type**: unit (factory smoke test).

### T2.3 — pytest configuration + conftest

- [x] **Refs**: FR-012, NFR-010
- **Design ref**: `Testing Strategy → conftest.py`
- **Description**: `backend/pytest.ini` with `DJANGO_SETTINGS_MODULE`, `asyncio_mode=auto`, `--cov=jobs.services --cov=jobs.api --cov-fail-under=80`. `backend/jobs/tests/conftest.py` with sync `job_factory`/`status_factory` fixtures and async `client` fixture using `ninja.testing.TestAsyncClient(api)`.
- **Effort**: M — fixture pattern (sync factory used by async tests) is the high-risk part.
- **Depends on**: T2.2
- **Parallelize with**: T2.2
- **Acceptance**: `pytest -q` runs and passes with the smoke factory test from T2.2.
- **Test type**: meta (the test infrastructure itself).

### T2.4 — Verification spike: `CursorPagination` over denormalized queryset

- [x] **Refs**: FR-001, NFR-002, ADR-4
- **Design ref**: `ADR-4 — CursorPagination over a service-returned queryset`
- **Description**: Write a 10–20 line `tests/test_pagination_spike.py` that seeds ~50 jobs across all four statuses, calls a temporary `services.list_jobs(status="RUNNING", ordering="-created_at")` (synchronous helper just for the spike), and confirms Ninja's `CursorPagination` envelope shape (`results`, `next`, `previous`) is produced when wrapped by `@paginate`. If the spike reveals incompatibility, switch ADR-4's fallback (hand-written keyset) before moving on.
- **Effort**: M — small code, but the answer changes the shape of T3.6.
- **Depends on**: T2.3
- **Parallelize with**: none
- **Acceptance**: Spike passes with the design's expected envelope; no fallback needed. If fallback engaged, design.md gets a small ADR-4 amendment and downstream tasks adopt the keyset shape.
- **Test type**: unit (spike test stays in the suite as a contract guard).

---

## Phase 3 — API surface (one endpoint slice at a time)

Goal: each endpoint shipped vertically with its service function, handler, schemas, and tests. Order: simplest writes → reads → list (which depends on the spike). PATCH (T3.4) is the most-tested slice because it exercises atomicity, the denormalized-cache invariant, and the explicit `updated_at` save.

### T3.1 — Ninja router scaffold + OpenAPI exposure

- [x] **Refs**: FR-013
- **Design ref**: `Architecture Overview`, `API / Interface Design → Handler signatures`
- **Description**: Wire `jobs.api.router` into `config.api.api`. Confirm `/api/openapi.json` returns the (initially empty) schema and `/api/docs/` renders.
- **Effort**: S
- **Depends on**: T2.4
- **Parallelize with**: none
- **Acceptance**: `curl /api/openapi.json` returns 200 with `{"openapi": "3.1.0", ...}`; `/api/docs/` renders Swagger UI.
- **Test type**: integration (one assertion).

### T3.2 — POST /api/jobs/ (create)

- [x] **Refs**: FR-002, FR-009, FR-010, NFR-011, NFR-012, US-002
- **Design ref**: `ADR-2`, `services.create_job`, `JobCreate`/`JobOut` schemas
- **Description**: Implement `services.create_job(name)` (sync helper inside `sync_to_async`, atomic block creates Job + initial PENDING JobStatus). Handler reads `JobCreate`, awaits service, sets `Location: /api/jobs/<id>/` on the response, returns 201 with `JobOut`. Schemas in `jobs/schemas.py` (Pydantic, with non-empty `name` validator).
- **Effort**: M
- **Depends on**: T3.1
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-002 (happy 201 + Location, empty-name 400, atomicity rollback). Tests in `test_api.py::test_create_*` and `test_services.py::test_create_job_*`.
- **Test type**: unit + integration

### T3.3 — GET /api/jobs/<id>/ (detail)

- [x] **Refs**: FR-003, US-003 (detail half)
- **Design ref**: `services.get_job`
- **Description**: `services.get_job(id) -> Job` using `await Job.objects.aget(pk=id)`; 404 path raises a domain exception caught by the (later) error handler — until T4.1 lands, raise `Http404` directly so Ninja returns 404.
- **Effort**: S
- **Depends on**: T3.2
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-003 detail (200 + JobOut shape; 404 envelope).
- **Test type**: unit + integration

### T3.4 — PATCH /api/jobs/<id>/ (append status)

- [x] **Refs**: FR-004, FR-009, FR-010, NFR-003, NFR-011, US-004
- **Design ref**: `ADR-1`, `ADR-2`, `services.update_job_status`
- **Description**: Implement `services.update_job_status(job_id, status_type)`: sync helper inside `sync_to_async` opens an `atomic` block, fetches Job (`select_for_update` not required at single-worker scope; document the rationale), inserts JobStatus, sets `job.current_status`, calls `job.save(update_fields=["current_status", "updated_at"])`. Handler accepts `JobStatusUpdate` (with `extra="forbid"`).
- **Effort**: L — three invariants tested: append + denormalized + updated_at; plus extra-fields rejection.
- **Depends on**: T3.3
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-004 — valid PATCH inserts row, bumps `current_status` and `updated_at`; unknown `status_type` returns 400; extra fields return 400; rollback leaves no rows changed.
- **Test type**: unit + integration

### T3.5 — DELETE /api/jobs/<id>/ (cascade)

- [x] **Refs**: FR-005, FR-010, US-005
- **Design ref**: `services.delete_job`
- **Description**: `services.delete_job(id)` deletes the Job; FK cascade removes JobStatus rows. Returns 204.
- **Effort**: S
- **Depends on**: T3.4
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-005 — 204 on success, 404 on missing, no JobStatus rows remain after delete.
- **Test type**: unit + integration

### T3.6 — GET /api/jobs/ (list with filter, sort, cursor)

- [x] **Refs**: FR-001, FR-006, NFR-002, NFR-003, US-001, US-006
- **Design ref**: `ADR-1`, `ADR-4`, `services.list_jobs`
- **Description**: `services.list_jobs(*, status, ordering)` returns a queryset filtered on the denormalized `current_status`, ordered per whitelist. Handler decorated with `@paginate(CursorPagination, ordering=("created_at",), page_size=20)`. Query params validated against `Literal[...]` types so unknowns return 400.
- **Effort**: L
- **Depends on**: T3.5
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-001 + US-006 — empty list, populated list, filter by status, ordering whitelist, cursor stability under inserts (test inserts a row between pages and asserts no duplicate).
- **Test type**: unit + integration

### T3.7 — GET /api/jobs/<id>/statuses/ (history)

- [x] **Refs**: FR-007, NFR-002, US-003 (history half)
- **Design ref**: `services.list_job_statuses`
- **Description**: `services.list_job_statuses(job_id)` returns a queryset filtered on `job_id`, ordered `-timestamp`. Handler decorated with `@paginate(CursorPagination, ordering=("timestamp",), page_size=20)`.
- **Effort**: M
- **Depends on**: T3.6
- **Parallelize with**: none
- **Acceptance**: G/W/T per US-003 history — DESC order, cursor pagination, 404 for missing job id.
- **Test type**: unit + integration

---

## Phase 4 — Cross-cutting hardening

Goal: the surface is correct; now make errors uniform, logging hygienic, and JSON output verified.

### T4.1 — Custom exception handlers + locked error envelope

- [x] **Refs**: FR-009, US-001..US-006 error paths
- **Design ref**: `ADR-6 — Custom error envelope via Ninja exception handlers`
- **Description**: In `config/api.py`, register `@api.exception_handler` for Pydantic `ValidationError` (400 with `errors` array), `Job.DoesNotExist`/`Http404` (404), and a catch-all `Exception` (500 with generic detail). All return the locked envelope shape. Replace any `Http404` raises in services with a domain `JobNotFound` and map it here.
- **Effort**: M
- **Depends on**: T3.7
- **Parallelize with**: T4.2
- **Acceptance**: every 4xx and 500 response across the existing tests matches the envelope shape.
- **Test type**: unit (`test_api.py::test_error_envelope_*`).

### T4.2 — Logging conventions + hygiene unit test

- [x] **Refs**: FR-011, NFR-006, US-008
- **Design ref**: `Security, Performance, Observability → Logging usage rules`
- **Description**: Wire INFO logs in `services.py` for `job_created`, `status_appended`, `job_deleted`. WARNING in the validation exception handler with `extra={"path": ..., "type": ...}` and **no `exc_info=True`**. ERROR + `logger.exception(...)` only in the 500 catch-all. Add `test_logging.py::test_validation_log_excludes_user_input` that POSTs an empty name and asserts no captured record's message/extra contains the offending payload.
- **Effort**: M
- **Depends on**: T3.7
- **Parallelize with**: T4.1
- **Acceptance**: Hygiene test passes. INFO state-change logs appear for create/patch/delete in test runs.
- **Test type**: unit

### T4.3 — JSON log format integration

- [x] **Refs**: NFR-007
- **Design ref**: `config/logging.py` JSON formatter, plan §9
- **Description**: With `LOG_FORMAT=json`, run the suite (or a single state-change test) and assert that each record under `LOG_DIR` is a valid JSON object containing `timestamp`, `level`, `logger`, `service`, `env`, `message`. Document the env switch in CLAUDE.md.
- **Effort**: S
- **Depends on**: T4.2
- **Parallelize with**: none
- **Acceptance**: `LOG_FORMAT=json pytest -q -k jsonlog` produces a `.json` file whose lines parse cleanly with `json.loads`.
- **Test type**: integration

---

## Phase 5 — Performance verification + cold-machine `make test`

Goal: prove the millions-of-jobs claim against a 1 M-row seed; wire `make test` to run pytest in the container so the cold-machine gate fires.

### T5.1 — `jobs.bench` seed script + `make seed-bench`

- [x] **Refs**: NFR-001
- **Design ref**: `Security, Performance, Observability → EXPLAIN verification`
- **Description**: `backend/jobs/bench.py` bulk-inserts 1 M Jobs with realistic status distribution (80% COMPLETED, 15% PENDING, 5% RUNNING/FAILED) and ~3 M JobStatus rows. Add `seed-bench` target to the Makefile that runs the script via `manage.py shell -c "from jobs.bench import run; run()"`.
- **Effort**: M — bulk_create chunking and `psycopg` batch tuning to keep memory bounded.
- **Depends on**: T4.3
- **Parallelize with**: none
- **Acceptance**: `make seed-bench` populates the tables in <90 s on a developer laptop; row counts match.
- **Test type**: manual

### T5.2 — `EXPLAIN (ANALYZE, BUFFERS)` verification

- [x] **Refs**: NFR-001, NFR-003
- **Design ref**: `Security, Performance, Observability → Performance`
- **Description**: Run `EXPLAIN (ANALYZE, BUFFERS)` on the unfiltered list, each filtered variant, the detail endpoint, and the history endpoint with cursor. Capture findings in `docs/perf.md` (gitignored). Pass criteria: no seq scans on `jobs_job`/`jobs_jobstatus`; per-page buffer hits <50 on the list endpoint.
- **Effort**: M
- **Depends on**: T5.1
- **Parallelize with**: none
- **Acceptance**: `docs/perf.md` records pass criteria met across all four queries.
- **Test type**: manual

### T5.3 — `make test` runs pytest in the container, cold-machine rehearsal

- [x] **Refs**: NFR-009, NFR-010
- **Design ref**: plan §7 Makefile + walkthrough
- **Description**: Update `make test` so it `make clean`s first, builds, brings up `db` + `backend`, then runs `docker compose exec -T backend pytest -q --cov-fail-under=80` and tears down on failure. (Vitest and Playwright legs are added in the frontend stream — backend stream stops at pytest.)
- **Effort**: M
- **Depends on**: T5.2
- **Parallelize with**: none
- **Acceptance**: From a fresh clone with no `.env` and no cached images, `make test` exits 0 in under ~3 minutes; non-zero exit is reflected in the make exit code.
- **Test type**: manual (cold-machine rehearsal)

---

## Notes

- **Open Questions still resolvable here**: 7 (DB CHECK constraint), 16 (health checks DB), 17 (health hidden from OpenAPI), 18 (ALLOWED_HOSTS=["*"]). All defaults baked into the tasks above; ping if you want any flipped.
- **Frontend dependencies on this stream**: the locked API contract in design.md is the consumable. T4.1 (error envelope) and T3.6 (cursor pagination shape) are the two pieces the FE needs verbatim. After T4.3 lands, the FE stream can begin without backend churn risk.
- **CLAUDE.md updates**: after T2.4 (spike result), T3.4 (denormalization invariant + test), T4.2 (log hygiene rule), and T5.2 (perf findings), invoke `claude-md-management:revise-claude-md` to capture new learnings.

When this file's `status` is set to `approved`, run `/spec:implement backend` to start executing T1.1 with verification at each task gate.
