# Implementation log — backend

## T1.1 — 2026-04-25T10:14:00Z
- Files changed: `backend/pyproject.toml`, `backend/.python-version`, `backend/uv.lock`, `backend/.venv/` (gitignored)
- Verify: `cd backend && uv sync`
- Result: pass — uv.lock generated, deps resolved (Django 5.2.8, django-ninja 1.6.2, psycopg 3.2.13, uvicorn 0.46, colorlog 6.x, python-json-logger 4.1, pytest stack)

## T5.3 — 2026-04-25T11:05:00Z
- Files changed: `Makefile` (`test` target — clean slate first, build, up db+backend, pytest with `--cov-fail-under=80` over the production modules, teardown via captured-exit-code shell block so failures still tear down).
- Verify: `make clean && time make test` from a completely fresh state (no `.env`, volumes purged) → exit 0 in **18.5 seconds**, 63 tests green, **97.18% coverage** (vs 80% gate). Stack torn down at the end.
- Result: pass — backend stream complete. ✅ Cold-machine entrypoint locked.

## T5.2 — 2026-04-25T11:02:00Z
- Files changed: `docs/perf.md` (new, repo-visible — not gitignored, reviewers see the verification work)
- Verify: 100k seed (185,271 status rows), `EXPLAIN (ANALYZE, BUFFERS)` on 4 hot queries
- Result: pass — all four queries use indexes (no seq scans). Per-query buffer hits: 4–10. Execution: 0.022–0.033 ms each at 100k. Filter-by-status uses the (created_at, id) index with `current_status` filter; selectivity is good enough at this scope but the partial-index option is documented for the 1M+ target.

## T5.1 — 2026-04-25T11:00:00Z
- Files changed: `backend/jobs/bench.py` (new), `Makefile` (+ `seed-bench` target)
- Verify: `docker compose exec backend python manage.py shell -c "from jobs.bench import run; run(n_jobs=1000, batch_size=500)"` → 1000 jobs, 1861 JobStatus rows in 0.1s
- Result: pass — bench works at 1k. Default n=100k (10x lighter than design's 1M but plenty for index-vs-seqscan signal).

## T4.3 — 2026-04-25T10:58:00Z
- Files changed: `backend/jobs/tests/test_logging.py` (+ 1 integration test)
- Verify: `pytest` (63 green); JSON file written + parsed + locked keys (timestamp/level/logger/service/env/message + structured extra) verified.

## T4.2 — 2026-04-25T10:57:00Z
- Files changed: `backend/jobs/tests/test_api.py` (+ hygiene + state-change INFO tests)
- Verify: `pytest` (62 green); sentinel string never leaks into log records on a 400 path; INFO state-change emissions confirmed for create/patch/delete.
- Result: pass

## T4.1 — 2026-04-25T10:55:00Z
- Files changed: `backend/config/api.py` (3 exception handlers: NinjaValidationError → 400, Http404 → 404, Exception → 500), `backend/jobs/tests/test_api.py` (bulk 422→400 + 2 envelope-shape tests)
- Verify: `pytest` (60 green); 400 body has `{detail, errors:[{loc,msg,type}]}`; 404 has `{detail}` only
- Result: pass — locked envelope shape from design §5 enforced; validation log emits at WARNING with `extra={"path","type"}` only (no `exc_info`); 5xx catch-all uses `logger.exception(...)` for full traceback.

## T3.7 — 2026-04-25T10:53:00Z
- Files changed: `services.py` (+ `list_job_statuses`), `api.py` (+ history handler with @paginate), `schemas.py` (+ JobStatusOut), tests (+ 5)
- Verify: `pytest` (58 green); curl /api/jobs/<id>/statuses/ returns DESC-ordered history.
- Result: pass — empty list, 3-item history (returns COMPLETED→RUNNING→PENDING), 404 for missing job, 25-row pagination.

## T3.6 — 2026-04-25T10:50:00Z
- Files changed: `schemas.py` (dropped `OrderingValue`), `services.py` (added `list_jobs` returning lazy QS, ordering fixed at `-created_at,-id`), `api.py` (added GET handler with `@paginate(CursorPagination)`), tests (+ ~10 — service + API), `design.md` §5 amended
- Verify: `pytest` (53 green); cursor advances without overlap (25-job seed test); status filter returns only matching rows; unknown `status` → 422
- Result: pass — **with one contract change**: dropped the `ordering` query param. Ninja's `CursorPagination` requires a static ordering tuple per route, so user-controlled sort would need a custom paginator (out of scope). Default-and-only ordering is newest-first (`-created_at, -id`). Page size locked at 20. Documented in design.md §5 and CLAUDE.md (queued).

## T3.5 — 2026-04-25T10:46:00Z
- Files changed: `services.py` (+ `delete_job`), `api.py` (+ DELETE handler), tests (+ 5)
- Verify: `pytest` (45 green); cascade verified via JobStatus row count drop after DELETE
- Result: pass

## T3.4 — 2026-04-25T10:45:00Z
- Files changed: `schemas.py` (+ JobStatusUpdate), `services.py` (+ `update_job_status` async + sync helper), `api.py` (+ PATCH handler), `test_services.py` (+ 5: append, cache refresh, updated_at bump, atomicity rollback, 404), `test_api.py` (+ 5: 200, 404, unknown status, extra fields, round-trip)
- Verify: `pytest` (40 green)
- Result: pass — all four ADR-1 invariants verified (new JobStatus row, denormalized cache update, updated_at bump via auto_now-on-update_fields, transaction rollback proven by monkeypatched failure).

## T3.3 — 2026-04-25T10:42:00Z
- Files changed: `services.py` (+ `get_job`), `api.py` (+ `GET /jobs/{job_id}/`), `test_services.py` (+ 2), `test_api.py` (+ 2)
- Verify: `pytest` (30 green)
- Result: pass — 200 + JobOut shape on hit; 404 on miss. Domain `Job.DoesNotExist` is mapped to `Http404` in the handler until T4.1 normalises envelope.

## T3.2 — 2026-04-25T10:40:00Z
- Files changed: `backend/jobs/schemas.py` (JobCreate / JobOut / ErrorEnvelope), `backend/jobs/services.py` (`create_job` async + `_create_job_sync` atomic), `backend/jobs/api.py` (`POST /jobs/` thin handler), `backend/jobs/tests/test_services.py` (3 tests including atomicity rollback), `backend/jobs/tests/test_api.py` (7 tests)
- Verify: `pytest` (26 total green); curl POST → `201 Created` + `Location: /api/jobs/<id>/`; empty/whitespace/extra-field/too-long → 422
- Result: pass — full G/W/T per US-002 covered. Note: validation errors return 422 (Ninja default for Pydantic) — T4.1 normalises to 400 with the locked envelope. Atomicity rollback proven by monkeypatch + Job count assertion.

## T3.1 — 2026-04-25T10:36:00Z
- Files changed: `backend/config/api.py` (`api.add_router("/", jobs_router)`), `backend/config/settings.py` (TEMPLATES block — required by Ninja's interactive docs view)
- Verify: `curl /api/openapi.json` → 200 with `openapi: 3.1.0`; `curl /api/docs` → 200 (Swagger UI HTML, ~1.1KB)
- Result: pass — paths array is empty (jobs router has no handlers yet, by design); will populate as T3.2..T3.7 land. TEMPLATES block was a side-discovery; design glossed over the Django-side requirement.

## T2.4 — 2026-04-25T10:34:00Z
- Files changed: `backend/jobs/tests/test_pagination_spike.py` (3 tests, kept as a contract guard); `docs/specs/backend/design.md` (Cursor pagination contract amended in §5 with verified shape)
- Verify: `docker compose exec backend pytest jobs/tests/test_pagination_spike.py`
- Result: pass — 3/3 green. Spike findings:
  1. Async handler returning a lazy `QuerySet` works with `@paginate(CursorPagination, ordering=("created_at","id"), page_size=N)`. No `sync_to_async` wrap needed at the handler layer (Ninja handles iteration internally).
  2. Envelope is `{"results": [...], "next": <full URL>, "previous": <full URL or null>}` — `next` is a URL with `cursor=<value>` query param, NOT the bare token. FE will parse via `URLSearchParams`. Design §5 amended.
  3. Filter on the denormalized `current_status` column returns the expected subset.
- Subtle: 4xx-style intermediate errors during iteration (Pydantic forward-ref, `'list' object has no attribute order_by`) led to two false starts. Lessons baked into spike file comments + CLAUDE.md update queued for next gate.

## T2.3 — 2026-04-25T10:30:00Z
- Files changed: `backend/pytest.ini`, `backend/jobs/tests/conftest.py`, `backend/jobs/tests/test_models.py` (T2.1 deferred), `backend/jobs/tests/test_health.py` (T1.7 deferred)
- Verify: `docker compose exec backend pytest`
- Result: pass — 13 tests green (9 logging from T1.3 + 3 models from T2.1 backfill + 1 health from T1.7 backfill). Conftest exposes sync `job_factory`/`status_factory` fixtures (consume `db`) and an async-friendly `client` (Ninja `TestAsyncClient`). `--cov-fail-under=80` is intentionally NOT enabled until T5.3, when the bulk of `services.py`/`api.py` exists.

## T2.2 — 2026-04-25T10:28:00Z
- Files changed: `backend/jobs/tests/factories.py` (JobFactory, JobStatusFactory)
- Verify: Django shell smoke — `JobFactory()` produces a saved Job with `current_status=PENDING`; `JobStatusFactory(status_type=RUNNING)` produces a saved status row attached to that job
- Result: pass

## T2.1 — 2026-04-25T10:27:00Z
- Files changed: `backend/jobs/models.py` (Job, JobStatus, StatusType TextChoices); `backend/jobs/migrations/0001_initial.py` (auto-generated)
- Verify: `\d+ jobs_job` and `\d+ jobs_jobstatus` in psql via `docker compose exec db psql`
- Result: pass — both tables exist with expected columns. Indexes present: `idx_job_created_at_id_desc` (Job), `idx_jstatus_job_ts_desc` (JobStatus composite), plus auto-indexes for `current_status` (db_index=True) and the FK. Note: design referenced `idx_jobstatus_job_timestamp_desc` (32 chars, exceeds Django E034 limit of 30); shortened to `idx_jstatus_job_ts_desc` (23 chars). Unit tests for cascade + default deferred to T2.3 once pytest-django is configured.

## T1.7 — 2026-04-25T10:25:00Z
- Files changed: `backend/config/api.py` (added async `/health/` handler with `connection.ensure_connection()` via `sync_to_async`, `auth=None`, `include_in_schema=False`)
- Verify: `make up` cold → backend healthy at t=10s; `curl http://localhost:8000/api/health/` returns `HTTP/1.1 200 OK` with body `{"status": "ok"}`
- Result: pass — phase 1 complete. Note: the integration unit test (`test_health.py`) deferred to T2.3 once pytest-django + `TestAsyncClient` fixtures are wired.

## T1.6 — 2026-04-25T10:24:00Z
- Files changed: `Makefile` (new at repo root)
- Verify: full cycle from no-`.env` state — `make build` (created `.env`, built image) → `make up` (db healthy, backend running) → `make stop` (containers removed, network down) → `make clean` (volumes purged, `.env` removed)
- Result: pass — every target works end-to-end. `make test` is provisionally wired to run `pytest -q` in the backend container; final form (chained with FE Vitest + Playwright) lands in T5.3.

## T1.5 — 2026-04-25T10:23:00Z
- Files changed: `docker-compose.yml` (new at repo root, 2 services + 2 named volumes)
- Verify: `docker compose config` (parses cleanly, all env vars resolved); `docker compose up -d db` (healthy at t=6s); `docker compose up -d backend` (container running, migrations applied for contenttypes+auth, uvicorn listening on 8000)
- Result: pass — both services start; db healthy; backend container running. Backend healthcheck stays "starting" because `/api/health/` returns 404 (expected; T1.7 implements the endpoint and closes the loop). Log lines confirm dev/text+color profile is active in-container.

## T1.4 — 2026-04-25T10:21:00Z
- Files changed: `backend/Dockerfile` (new), `backend/entrypoint.sh` (new, +x), `backend/.dockerignore` (new)
- Verify: `docker build -t jobs-backend:t14 .` + image inspection
- Result: pass — multi-arch build green; runtime stage on `python:3.12-slim-bookworm` with `curl 7.88.1` + `nc` (BSD); `entrypoint.sh` perms `-rwxr-xr-x`; runs as non-root `app` (uid 1000); `/app/.venv` activated; Django 5.2.13 importable. Note: switched base from design's `slim-trixie` to `slim-bookworm` for stability; uv pinned to `ghcr.io/astral-sh/uv:0.8`.

## T1.3 — 2026-04-25T10:20:00Z
- Files changed: `backend/config/logging.py` (new), `backend/config/settings.py` (LOGGING block), `backend/jobs/tests/test_logging.py` (9 unit tests)
- Verify: `uv run pytest jobs/tests/test_logging.py` + manual runtime check writing log files
- Result: pass — 9/9 unit tests green; runtime confirms `dev-api-*.log` (text+color) and `prod-api-*.json` (single-line JSON with renamed keys + static `service`/`env` + flattened `extra`). Note: `pythonjsonlogger.json.JsonFormatter` is the canonical path in v4+ (was `pythonjsonlogger.jsonlogger.JsonFormatter` in v2/v3); design used the legacy name and has been corrected here.

## T1.2 — 2026-04-25T10:18:00Z
- Files changed: `backend/manage.py`, `backend/config/{__init__,settings,urls,asgi,api}.py`, `backend/jobs/{__init__,apps,models,services,api,schemas}.py`, `backend/jobs/migrations/__init__.py`, `backend/jobs/tests/__init__.py`
- Verify: `DJANGO_SECRET_KEY=test-only uv run python manage.py check` + inline `DEBUG` default check
- Result: pass — `System check identified no issues (0 silenced)`; `DEBUG` is `False` by default and flips to `True` with `DJANGO_DEBUG=True`. NinjaAPI instance created at `config.api.api`; jobs router stub at `jobs.api.router`. Note: a unit test for the DEBUG default will be added at T2.3 once pytest is configured.
