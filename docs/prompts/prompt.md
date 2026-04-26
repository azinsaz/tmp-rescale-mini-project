We're starting the planning phase of a take-home interview project. Implementation comes later through separate spec-driven streams. Right now I want a tight planning artifact I can review before any specs or code are written.

## Source of truth

Read `/Users/ali/Developer/tmp/Full-Stack-Engineer-Take-Home-Problem-Job-Management-Dashboard.md` end to end before responding. That spec is authoritative; do not infer requirements that aren't in it. Do not restate it.

## Hard constraint: cold-machine `make test` gate

Evaluators clone fresh on Linux/Mac with only `make`, `docker`, `docker compose v2`, `bash`, and DockerHub. They run `make test`. If it fails, evaluation stops. Every planning decision has to pass through this gate. State this constraint up front in your output and check it again in the orchestration section.

## Scope (locked, do not re-litigate)

All five stretch goals are in scope: Job Status History View, filtering/sorting (by status / name / creation date), Job Details View on a distinct URL, frontend unit tests, backend unit tests. This expands the API surface and forces React Router into the FE. Treat this as core scope, not optional.

## Stack (locked)

Backend: Django + Django Ninja + PostgreSQL + `psycopg[binary]`. ASGI via Uvicorn. Async handlers with async ORM (`aget`/`acreate`/`afilter`/async iteration). Pydantic schemas via Ninja's `Schema`. Wrap transactions with `sync_to_async`. Tests: pytest + pytest-django + pytest-asyncio (`asyncio_mode=auto`), factory_boy. Deps + Docker layering via `uv`. Migrations checked in, named, with a composite index on `JobStatus(job, timestamp DESC)` for latest-status. Choices-backed enum for `status_type`, timezone-aware datetimes, explicit `on_delete`.

Frontend: React + TypeScript strict, Vite, TanStack Query, Tailwind, React Router (required by the details-page stretch goal), ESLint flat config + Prettier. Vitest + React Testing Library co-located next to source. Playwright at `frontend/e2e/`. Vite dev proxy for `/api` so the client uses relative paths in dev and prod.

Infra: single `docker-compose.yml`, Makefile targets exactly per spec (`build`, `up`, `test`, `stop`, `clean`). Playwright runs inside Docker because the cold machine has no Node.

## Code-quality bars

Backend: thin handlers, fat services. Ninja handlers do HTTP only, schemas validate the wire, services own business logic, models own persistence and invariants. For four-ish endpoints, collapse reads and writes into `services.py`. SOLID applied with judgment, not religiously. Async by default; no sync ORM in async paths. Type hints everywhere, Google-style docstrings on public classes and functions. Design for millions of jobs: paginate, eliminate N+1, surface latest `JobStatus` efficiently.

Frontend: strict TS, typed API client, no `any`. Feature folders, small composable components, loading + error states on every async surface, co-located tests.

## Workflow (three sequential phases, each gated)

1. **Phase 1 — Planning.** Produce the deliverables below. Mandatory over-engineering review pass on every section before you hand it off (apply `simplify` skill principles manually since these outputs are not code yet). **Stop and wait for my approval.**
2. **Phase 2 — Backend stream.** `/spec:requirements` -> `/spec:design` -> `/spec:tasks` -> `/spec:implement`. Approve at each gate. Apply over-engineering review manually on requirements/design/tasks docs. Invoke the `simplify` skill literally on the diff produced by `/spec:implement`. Stop after phase 2 for approval.
3. **Phase 3 — Frontend stream.**
   - 3a: design exploration. Use `playground:playground` for interactive variants and `frontend-design:frontend-design` for production-quality Tailwind code. Invoke `simplify` literally on the frontend-design output. Lock direction before continuing.
   - 3b: `/spec:requirements` -> `/spec:design` -> `/spec:tasks` -> `/spec:implement`, with the same gate discipline as backend, including a literal `simplify` pass on the implementation diff.

Plan, align, implement. One phase at a time.

## Phase 1 deliverables

Use these exact section headers, in order. Be opinionated. Recommend, don't enumerate.

### 1. Spec confirmation
Surface only ambiguities or decisions worth flagging. Do not restate the spec.

### 2. Scope lock
Confirm all five stretch goals are in. Enumerate the resulting API surface beyond the four core endpoints (e.g. `GET /api/jobs/<id>/`, status-history retrieval, filter/sort query params), and the resulting FE surface (router, list page, detail page route, history view component, filter/sort controls). Recommend whether status history is a separate endpoint or embedded in the detail response — pick one.

### 3. Phased plan
The three-phase workflow above, with named approval gates and where the `simplify` skill (literal on code, principle on docs) and the over-engineering review apply at each gate.

### 4. Repo layout
One concrete monorepo tree. Start from this skeleton and refine to accommodate router, detail page, history view, filter/sort, and co-located unit tests on both sides. No alternatives.

```
backend/
  pyproject.toml, uv.lock, Dockerfile, manage.py, .env.example
  config/                asgi.py, settings.py, urls.py, api.py (NinjaAPI instance)
  jobs/                  models.py, schemas.py, services.py, api.py, migrations/
    tests/               conftest.py, factories.py, test_api.py, test_services.py
frontend/
  package.json, tsconfig.json, vite.config.ts, tailwind.config.ts
  playwright.config.ts, Dockerfile
  e2e/                   jobs.spec.ts
  src/
    main.tsx, App.tsx, router.tsx
    features/jobs/       JobList.tsx, JobDetail.tsx, JobHistory.tsx, jobs.api.ts, useJobs.ts, *.test.tsx
    components/          shared primitives only
    lib/                 api-client.ts
    pages/               JobsListPage.tsx, JobDetailPage.tsx
```

### 5. Locked API contract
Exact JSON request/response shapes for every endpoint, core and stretch. Include:
- `GET /api/jobs/` with `current_status` field, pagination (cursor recommended), and filter/sort query params (`status=`, `ordering=name|-name|created_at|-created_at`).
- `POST /api/jobs/`, `PATCH /api/jobs/<id>/`, `DELETE /api/jobs/<id>/`.
- `GET /api/jobs/<id>/` for the detail view.
- Status history retrieval (state your recommendation: separate endpoint vs embedded; lean toward a separate `GET /api/jobs/<id>/statuses/` for clean pagination).
- A single error envelope shape used everywhere.
- Cursor pagination contract (request param, response shape, `next` cursor).

This section is what unblocks parallel work later. Be exact. Show JSON.

### 6. Docker + Makefile orchestration
Service names, exposed ports, healthchecks, volume strategy, network, dependency order. Show `web` (Django/Uvicorn), `db` (Postgres), `frontend` (Vite build served via nginx in prod, dev server otherwise), and a `playwright` runner service for `make test`. Walk through `make test` on a cold machine: build images, start `db` and `web` with healthchecks, run migrations on entrypoint with wait-for-postgres, build and start the frontend, run Playwright in its container against the running stack, capture exit code, tear down. State the guarantee at each step. Re-state the cold-machine constraint here.

### 7. Performance plan for millions of jobs
- Indexing strategy (composite on `JobStatus(job, timestamp DESC)` plus any others worth calling out).
- Latest-status query: recommend a default (correlated subquery via `Subquery` + `OuterRef` for the list endpoint) and note that `Prefetch` with a sliced queryset is the alternative — pick subquery as the default and say why.
- Pagination: cursor-based on `(created_at DESC, id DESC)` to stay stable under inserts.
- FE rendering: paginated UI as the default for a 4-hour build with millions-of-jobs framing; note virtualization as the alternative if scroll UX matters more than implementation budget.

### 8. Open questions
Anything you need me to confirm before phase 2 starts. Keep this short.

## Stop gate

After section 8, **stop**. Do not start `/spec:requirements` or any phase-2 work. Do not write code, scaffolding, or files. Wait for my review and approval.

Use best OOP practices for design and, always refer to official docs or use context7 if you need to access any docs

Create a claude.md file and keep it lean and powerful. make sure to update it as we move on with whatver you learn about this project, use official anthropic docs for best practices and guideline and use the calude md management plugin to handle it
