---
status: approved
feature: backend
---

# Requirements: Backend Jobs API

## Problem Statement

A simplified job-management dashboard needs a server that owns the job lifecycle: who/what was created, when, in which states it has been, and how to query and mutate that data efficiently. Today there is no backend at all. Without it, the frontend has nothing to render and operators cannot see or change job state. The store must remain queryable as the dataset grows toward millions of jobs without each list request degrading.

## Stakeholders

| Role | Name / Team | Interest |
| --- | --- | --- |
| Take-home candidate | implementer | Ships a senior-quality, evaluable submission |
| Rescale interview team | evaluators | Run `make test` cold on a fresh clone and judge correctness, code quality, and design choices |
| Frontend stream (this project) | phase 3 | Consumes the API contract once it is locked |
| Future maintainers | hypothetical | Read CLAUDE.md and code to extend without breaking invariants |

## User Stories

### US-001 — List jobs with current status

**As** a job operator, **I want** to see every job and its current status in one paginated list, **so that** I can survey the state of the system.

- **Given** the database contains jobs with various statuses, **when** I `GET /api/jobs/`, **then** I receive 200, a `results` array of jobs each carrying `current_status`, and `next` / `previous` cursor fields.
- **Given** more than `limit` rows exist, **when** I follow `next`, **then** the second page is contiguous with the first under concurrent inserts and contains no duplicates.
- **Given** the database is empty, **when** I `GET /api/jobs/`, **then** I receive 200 with `results=[]` and `next=null`, `previous=null`.

### US-002 — Create a job

**As** a job operator, **I want** to create a new job by name, **so that** it appears in the dashboard at status PENDING.

- **Given** a valid payload `{name: "Fluid Dynamics"}`, **when** I `POST /api/jobs/`, **then** I receive 201, header `Location: /api/jobs/<id>/`, body with `current_status: "PENDING"`, and a `JobStatus(PENDING)` row exists.
- **Given** an empty or missing name, **when** I `POST /api/jobs/`, **then** I receive 400 with the locked error envelope and no rows are written.
- **Given** the service crashes between `Job` insert and `JobStatus` insert, **when** the transaction rolls back, **then** neither row exists (atomicity).

### US-003 — View job detail and status history

**As** a job operator, **I want** to view a single job with its full history, **so that** I can understand its progression.

- **Given** a job exists, **when** I `GET /api/jobs/<id>/`, **then** I receive 200 with the same shape as the create response.
- **Given** no job with that id exists, **when** I `GET /api/jobs/<id>/`, **then** I receive 404 with the error envelope.
- **Given** a job with N status transitions, **when** I `GET /api/jobs/<id>/statuses/`, **then** results are ordered DESC by timestamp and paginated with the same cursor contract as the list endpoint.

### US-004 — Update job status

**As** a job operator, **I want** to advance a job through statuses, **so that** the dashboard reflects real-world progression.

- **Given** a valid status transition, **when** I `PATCH /api/jobs/<id>/` with `{status_type: "RUNNING"}`, **then** I receive 200, a new `JobStatus` row is appended, `Job.current_status` and `Job.updated_at` are bumped, and all changes happen in one transaction.
- **Given** an unknown `status_type`, **when** I PATCH, **then** I receive 400 with the error envelope and no rows change.
- **Given** the body contains fields besides `status_type` (for example `name`), **when** I PATCH, **then** I receive 400 — extra fields are rejected.

### US-005 — Delete a job

**As** a job operator, **I want** to delete a job, **so that** I can remove cancelled or test entries.

- **Given** a job with status history, **when** I `DELETE /api/jobs/<id>/`, **then** I receive 204 and all `JobStatus` rows for that job are also removed (cascade).
- **Given** the id does not exist, **when** I DELETE, **then** I receive 404.

### US-006 — Filter and sort the list

**As** a job operator, **I want** to filter by current status and sort by name or creation date, **so that** I can find specific jobs quickly.

- **Given** `?status=RUNNING`, **when** I list jobs, **then** results contain only rows whose `current_status` equals RUNNING; query plan does not seq-scan at scale.
- **Given** `?ordering=name` (or `-name`, `created_at`, `-created_at`), **when** I list, **then** results are sorted accordingly and pagination remains stable.
- **Given** an unknown `status` or `ordering` value, **when** I list, **then** I receive 400 with the error envelope.

### US-007 — Container healthcheck

**As** an ops surface (Docker compose, k8s in future), **I want** a cheap liveness endpoint, **so that** the container orchestrator can decide when the backend is ready.

- **Given** the backend is running and the DB is reachable, **when** the orchestrator hits `GET /api/health/`, **then** it receives 200 with a minimal JSON body.
- **Given** the DB is unreachable on startup, **when** the orchestrator hits `/api/health/`, **then** the response is non-200 (or no response) so `condition: service_healthy` does not flip true prematurely.

### US-008 — Structured operational logs

**As** a developer or future operator, **I want** structured logs for every state-changing operation, **so that** I can observe and debug the system in dev and in cloud deployments.

- **Given** a `Job` is created or its status appended or deleted, **when** the service runs, **then** an INFO log line is emitted naming the operation and key ids.
- **Given** `LOG_FORMAT=json`, **when** logs are emitted, **then** every record is a single JSON line with the keys `timestamp, level, logger, service, env, message`.
- **Given** a 4xx validation error, **when** logged, **then** the log entry contains only error type and request path — never the user's input.

## Functional Requirements

MoSCoW. Each FR maps to ≥1 User Story.

### Must

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-001 | `GET /api/jobs/` returns paginated list with `current_status`. Default ordering `-created_at`. Cursor pagination via Django Ninja `CursorPagination`. | US-001 |
| FR-002 | `POST /api/jobs/` creates a `Job` and an initial `JobStatus(PENDING)` in the same `atomic` block. Response 201 with `Location` header. | US-002 |
| FR-003 | `GET /api/jobs/<id>/` returns the detail shape; 404 if not found. | US-003 |
| FR-004 | `PATCH /api/jobs/<id>/` appends `JobStatus`, updates `Job.current_status`, bumps `Job.updated_at` via explicit `save(update_fields=["updated_at"])`. All in one `atomic` block. Body must contain only `status_type`. | US-004 |
| FR-005 | `DELETE /api/jobs/<id>/` hard-deletes; cascade removes `JobStatus` rows via FK `on_delete=CASCADE`. | US-005 |
| FR-006 | `GET /api/jobs/` accepts query params `status`, `ordering`, `cursor`, `limit` with whitelisted values; unknown values yield 400. | US-006 |
| FR-007 | `GET /api/jobs/<id>/statuses/` returns paginated history DESC by `timestamp`. | US-003 |
| FR-008 | `GET /api/health/` returns 200 with `{"status":"ok"}` and verifies DB connectivity (cheap query). | US-007 |
| FR-009 | All inputs validated via Pydantic / Ninja `Schema`. Validation errors return the locked envelope (`detail`, `errors`). | US-001..US-006 |
| FR-010 | All write endpoints are atomic. Async handlers wrap transactional service-layer code in `sync_to_async`. | US-002, US-004, US-005 |
| FR-011 | Service layer logs INFO on every state change (`job_created`, `status_appended`, `job_deleted`); WARNING for validation errors with no `exc_info`; ERROR + `exception` for uncaught 5xx paths. | US-008 |
| FR-012 | pytest + pytest-django + pytest-asyncio (`asyncio_mode=auto`) cover services and API handlers. factory_boy supplies fixtures from sync fixtures consumed by async tests. `pytest.mark.django_db(transaction=True)` on async ORM tests. | NFR-010 |

### Should

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-013 | OpenAPI schema auto-served at `/api/openapi.json`; interactive docs at `/api/docs/`. | — |
| FR-014 | Test-only DB-reset hook (either `manage.py flush --no-input` from compose-exec OR `POST /api/test/reset/` gated by `ENV=test`). Used by Playwright `globalSetup`. Default: flush via exec. | E2E enabler |

### Could

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-015 | DB-level `CheckConstraint` on `JobStatus.status_type`. Defense-in-depth against raw-SQL bypass. (Open question 7 in plan.) | — |

### Won't (in this scope)

- Authentication or authorization (spec is explicit).
- Editing `Job.name` after creation (immutable post-POST).
- Soft delete.
- Multi-tenancy.
- Real job execution / scheduling — this is a status-tracking CRUD only.
- Notifications, webhooks, batch operations, file uploads.
- Rate limiting.

## Non-Functional Requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-001 | Performance | List endpoint serves a ≥1 M-row dataset with `EXPLAIN (ANALYZE, BUFFERS)` showing no seq scans on `jobs_job` or `jobs_jobstatus`; buffer hits <50 per paginated read. |
| NFR-002 | Performance | Cursor pagination is stable under concurrent inserts: composite cursor on `(created_at, id)` for list, `(timestamp, id)` for history. |
| NFR-003 | Performance | Filter-by-status uses the denormalized `Job.current_status` column maintained on PATCH inside the same `atomic` block, avoiding the O(N) annotation-then-filter path. |
| NFR-004 | Security | No inline credentials in any committed file. All secrets via env vars; `.env.example` has dev-only sample values; `.env` gitignored. |
| NFR-005 | Security | `DJANGO_DEBUG` defaults to `False`; setting it to `True` requires explicit `.env` override. |
| NFR-006 | Security | Logger never emits request bodies, validation exception chains (which echo user input), connection strings, or secret fragments. |
| NFR-007 | Operability | Structured logging via stdlib `logging` + `dictConfig`. Console + rotating file handler (10 MiB × 7 backups). Format selected by env: text+color in dev, JSON in prod. Filename `{ENV}-{SERVICE_NAME}-{YYYY-MM-DD_HHMMSS}.{log\|json}`. |
| NFR-008 | Deployability | Backend containerized via multi-stage `uv` Dockerfile; runtime image installs `curl` for healthcheck; image runs as non-root if practical without breaking the uv layout. |
| NFR-009 | Reliability | On a cold machine running `make test`: backend healthcheck flips healthy within ≤130 s (start_period 30 s + retries 20 × interval 5 s). |
| NFR-010 | Testability | pytest passes with `-q` and no warnings. Coverage on `jobs/services.py` and `jobs/api.py` ≥80%. |
| NFR-011 | Maintainability | Thin handlers, fat services. Handlers do HTTP only; `services.py` owns business logic; `models.py` owns persistence and invariants. Type hints on all public surfaces; Google-style docstrings on public classes and functions. |
| NFR-012 | Async safety | No sync ORM calls inside `async def`. `sync_to_async` wraps any Django code that touches transactions, signals, m2m, or `Subquery`/`OuterRef` annotations. |
| NFR-013 | Connection management | `uvicorn --workers 1` is the locked default; matches Postgres `max_connections=100`; PgBouncer noted as production-grade alternative but out of scope. |

## Constraints and Assumptions

- Stack locked by `/Users/ali/.claude/plans/melodic-toasting-beaver.md`: Django 5.2 + Django Ninja 1.6 + Postgres 16 + `psycopg[binary]` + `uv`. Async-first.
- Cold-machine evaluation: only `make`, `docker`, `docker compose v2`, `bash`, DockerHub. Anything that breaks `make test` from a fresh clone stops evaluation.
- `factory_boy` is sync-only; tests pull from sync fixtures into async test bodies.
- No PgBouncer at this scope; single uvicorn worker; default Postgres connection count is sufficient.
- `name` is not unique — same job name can recur.
- Status values are exactly four: `PENDING / RUNNING / COMPLETED / FAILED`. No `CANCELLED`.
- Time budget targets ≈4 hours but is not strict given full stretch-goal scope.
- Frontend will consume the API via same-origin nginx proxy, so no CORS layer.

## Out of Scope

- AuthN / AuthZ
- Real job execution or scheduling
- Multi-tenancy
- Soft delete
- Job-name editing
- Rate limiting
- File uploads / blob storage
- Notifications, webhooks
- Batch operations
- Audit log beyond `JobStatus` history
- Frontend implementation (separate spec stream — phase 3)
- Infra outside compose (k8s, Terraform, cloud deploy)

## Open Questions

These mirror plan section 11 with backend-relevant ones called out. Defaults are baked into the requirements above; flag any to redirect.

| # | Question | Owner | Default |
| --- | --- | --- | --- |
| 1 | Job name mutability via PATCH? | user | Immutable post-creation (FR-004 enforces) |
| 2 | Status set fixed at four values, or include CANCELLED? | user | Four values |
| 7 | DB-level CHECK constraint on `status_type`? | user | Skip; rely on `TextChoices` + Pydantic |
| 8 | Data partitioning? | user | None at this scope |
| 9 | Logging defaults (text/dev, JSON/prod, INFO, 10 MiB × 7)? | user | As stated |
| 10 | Filter-by-status strategy at scale? | user | Denormalized `current_status` on `Job` |
| 11 | Connection pooling? | user | `uvicorn --workers 1` |
| 12 | E2E DB-reset mechanism? | user | `manage.py flush --no-input` via Playwright `globalSetup` |

## Glossary

- **Job** — a computational job tracked in the system. One row in `jobs_job`.
- **JobStatus** — a row representing one status transition for a Job. One row in `jobs_jobstatus`. Append-only via PATCH.
- **`current_status`** — denormalized column on `Job` reflecting the latest `JobStatus.status_type`. Single source of truth for filter-by-status performance.
- **Cursor pagination** — opaque base64-encoded `(ordering_field, id)` tuple. Stable under concurrent inserts.
- **`atomic`** — Django's `transaction.atomic()` block. Required for write-side multi-step operations; called via `sync_to_async` from async handlers.
- **`sync_to_async`** — `asgiref.sync.sync_to_async`. Wraps blocking sync code to be awaited from async context.
- **TextChoices** — Django enum-on-string class used to constrain `status_type` at the application layer.

## Success Metrics

- All 12 Must FRs pass against a 1 M-row seed database.
- `pytest -q` exits 0 with no warnings, coverage ≥80% on `services.py` and `api.py`.
- `EXPLAIN (ANALYZE, BUFFERS)` for the unfiltered list and each filtered variant shows index scans only; total buffer hits per page <50.
- p95 list-endpoint latency on the seeded dataset <50 ms (single instance, single worker, Docker compose).
- `make test` exits 0 from a fresh clone on Linux/Mac with only the four required tools available.
- Logger output never contains a request body or a credential — verified by a unit test that submits a malformed payload and inspects the captured log buffer.
