# Project memory — Job Management Dashboard

Take-home interview project. Lightweight CRUD over `Job` and `JobStatus` with a small dashboard. All five stretch goals are in scope (history view, filter/sort, detail page on distinct URL, FE unit tests, BE unit tests). Senior-quality conventions, no enterprise scaffolding.

## Stack (pinned)

- **Backend**: Django 5.2 + Django Ninja 1.6 + Postgres 16 + `psycopg[binary]`. ASGI via Uvicorn. Async handlers + async ORM. `uv` for deps **and for every Python invocation** — never call bare `python` / `pytest` / `ruff` from a host shell or a CI script; always go through `uv run --group dev <cmd>` so the project's pinned interpreter and venv are used. The host machine isn't required to have a global Python on PATH. pytest + pytest-django + pytest-asyncio (`asyncio_mode=auto`) + factory_boy + ruff.
- **Frontend**: React 18.3 + TypeScript strict + Vite 5.4 + TanStack Query 5 + React Router 7 (data router) + Tailwind 4 (CSS-first) + Vitest 2 (happy-dom) + React Testing Library + Playwright 1.58.2-jammy.
- **Infra**: single `docker-compose.yml`; Makefile targets `build` / `up` / `test` / `stop` / `clean`. Frontend's nginx proxies `/api/*` to backend (no CORS).

## Make targets

- `make build` — `docker compose build`.
- `make up` — `docker compose up -d` (db + backend + frontend).
- `make stop` — `docker compose down`.
- `make clean` — `docker compose down -v --remove-orphans` + remove `.env`.
- `make test` — chains BE pytest → FE Vitest → Playwright; tears down with `down -v` to leave the next run clean.

`make test` is the cold-machine evaluation entrypoint. Anything that breaks it stops evaluation.

## Critical patterns and gotchas

### Backend

- **Async ORM rule**: no sync ORM in async paths. Use `aget` / `acreate` / `afilter` / `aiterator`.
- **`sync_to_async` is required for**: transactions (`atomic`), signals, m2m operations, and complex `Subquery` / `OuterRef` annotations. Django 5.2 does not safely evaluate annotated querysets in async context.
- **PATCH service must call** `job.save(update_fields=["updated_at"])` after appending the new `JobStatus` row, inside the same `atomic` block. `auto_now` only fires on `Job.save()`; appending a child does not trigger it.
- **Latest-status read**: shipping with denormalized `Job.current_status` (set on POST, refreshed on PATCH inside the atomic block). Filter-by-status hits the index directly. The original `Subquery + OuterRef` plan was O(N) on the filter predicate — see `docs/perf.md` for `EXPLAIN` evidence.
- **Connection pooling**: `uvicorn --workers 1`. Single async worker, single pool, simple under the take-home budget.
- **factory_boy is sync**. Call factories from a sync fixture, OR wrap with `@sync_to_async` inside async tests. Never call a factory directly from `async def`.
- **Boundary**: thin handlers, fat services. Ninja handlers do HTTP only. `services.py` owns business logic. `models.py` owns persistence and invariants.
- **Index name limit**: Django E034 caps custom `Meta.indexes` names at 30 chars (PG allows 63). Composite history index is `idx_jstatus_job_ts_desc`.
- **Don't `from __future__ import annotations`** in modules that contain Ninja handlers with `Enum` or `Literal` query-param types — Pydantic 2 can't resolve the forward refs and raises `PydanticUserError` at request time.
- **`TEMPLATES` setting is required** for `/api/docs/` to render the Swagger UI (Ninja uses Django's template engine).
- **Cursor pagination**: `next` is a full URL with `cursor=<value>` query param embedded — not a bare token. FE extracts via `URLSearchParams`.
- **`ordering` query param is NOT exposed** on `GET /api/jobs/`. Ninja's `CursorPagination` enforces static ordering per route (verified T2.4 spike); user-controlled sort would need a custom paginator. Default and only ordering is `-created_at, -id`.
- **Validation errors return 400** (locked envelope `{detail, errors:[{loc,msg,type}]}`) via `@api.exception_handler(NinjaValidationError)`. Out of the box Ninja returns 422.

### Frontend

- **Relative `/api` only.** Vite dev proxy forwards `/api` to the backend in dev; nginx proxies `/api/*` to `backend:8000` in compose. No base-URL split, no CORS.
- **Tailwind v4 is CSS-first.** No `tailwind.config.ts`. Brand colors and font families are declared in `src/index.css` via `@theme { --color-rescale-*: ...; --font-display: ...; }`. The `@tailwindcss/vite` plugin reads them. Adding a new token = adding a CSS variable.
- **Query key factory** lives in `features/jobs/jobs.hooks.ts`. Never inline `['jobs', ...]` arrays in components. Shape: `keys.list({ status, cursor })`, `keys.detail(id)`, `keys.history(id, cursor)`, all under the umbrella `['jobs']`.
- **Mutation invalidation rules** are surgical:
  - `useCreateJob.onSuccess` → invalidate umbrella `['jobs']` (covers list, detail, history).
  - `useUpdateStatus.onSuccess(updated)` → `setQueryData(keys.detail(id), updated)` then invalidate **list + history precisely**, NOT the umbrella. Invalidating the umbrella would refetch the detail and clobber the just-set cache.
  - `useDeleteJob.onSuccess` → invalidate umbrella; the caller does `navigate('/jobs')`.
- **Pagination is page-by-page** with `placeholderData: (prev) => prev` for v5. The named `keepPreviousData` export was removed in v5. Cursor lives in URL state on the list, component state on the history.
- **Cursor extraction**: backend `next`/`previous` are full URLs (e.g., `http://backend:8000/api/jobs/?cursor=abc`). `parseCursorFromNextUrl` uses `new URL(next, window.location.origin).searchParams.get('cursor')` to handle absolute and relative.
- **No user-controlled `ordering`** — backend dropped it (see backend section). FE has no sort UI.
- **Responsive**: list page renders a real `<table>` at `≥768 px` and a parallel semantic `<ul>` of `<article>` cards below, swapped via `md:hidden` / `hidden md:table`. **No fake `role="table"` ARIA** on the cards — that pattern announces as 0-column when the role chain is incomplete. Touch targets ≥ 44 px on mobile (Tailwind `py-3 md:py-2` on buttons).
- **a11y patterns to preserve**: `StatusUpdateControl` is `role="radiogroup"` + `role="radio"` children with roving tabindex and arrow-key nav. `DeleteConfirmation` is a disclosure (`aria-expanded` + `aria-controls`); Escape collapses and returns focus to the trigger; **no focus trap** — disclosures don't trap, only modals do. `ErrorBanner` is `role="alert"`. `LoadingLine` is `role="status" aria-live="polite"`.
- **Typed seam**: every network call goes through `lib/api-client.ts` (`apiGet/Post/Patch/Delete<T>` + `ApiError`). Components don't call `fetch` directly. Error envelope shape is parsed once; `ApiError.fieldError(name)` is the contract for inline form errors.
- **Test mocks**: `vi.stubGlobal('fetch', ...)` per suite via `test-utils/mockFetch.ts`. No MSW. Page-level integration is covered by Playwright; unit tests focus on the typed seam, hooks, `StatusPill`, and `CreateJobForm`.

### npm registry blocked locally (2026-04-25 session)

The user's machine cannot reach the npm registry. All FE acceptance criteria that require `npm install` / `npm run build` / `npm run test:unit` / `npx playwright test` were left as written-but-deferred. The BE leg of `make test` is the per-task verify gate during implementation. End-to-end FE verification is the user's responsibility on a network-enabled machine. Future sessions: this is an environment quirk, not a code defect — `npm install && make test` should just work elsewhere.

### Logging

- `config/logging.py` configures stdlib `logging` via `dictConfig`.
- `LOG_FORMAT=text` (dev, colored) or `json` (prod). Defaults from `ENV`.
- Filename: `{ENV}-{SERVICE_NAME}-{YYYY-MM-DD_HHMMSS}.{log|json}`. Rotated via `RotatingFileHandler` (10 MiB × 7 backups).
- Service layer logs `INFO` on every state change (`job_created`, `status_appended`, `job_deleted`).
- `WARNING` on validation failures with **only error type and request path** — never `exc_info=True` on a 4xx, since exception chains contain user input.
- `ERROR` + `logger.exception(...)` only on uncaught 5xx paths.
- **Never log**: request bodies, DB connection strings, secret-key fragments, raw exception messages from Pydantic/Django validation.

### Testing

- `make test` runs BE pytest + FE Vitest + Playwright in that order (FE legs added in the frontend stream).
- BE: `pytest -q` inside the `backend` container. `asyncio_mode=auto`. `@pytest.mark.django_db(transaction=True)` is **required** on every async test calling the ORM (without it async commits aren't visible).
- FE: `vitest run` (one-shot) in the FE builder stage. Co-located `*.test.tsx` next to source. Use `frontend/src/test-utils/render.tsx::renderWithProviders` (QueryClient + MemoryRouter) for component tests.
- E2E: per-flow Playwright specs under `frontend/e2e/`. `workers: 1`, two projects (`mobile` 390×844, `desktop` 1280×800). **DB reset is orchestrated by the host Makefile** (`docker compose exec backend python manage.py flush --no-input`) between FE bring-up and the Playwright run — NOT by a Playwright `globalSetup`. This avoids mounting the host Docker socket into the test container. Uses extended `test` from `frontend/e2e/fixtures.ts` for HTTP-only `seedJob` / `patchStatus`.
- **`caplog` doesn't see our app loggers** — `jobs` and `jobs.services` have `propagate=False` in dictConfig. Monkeypatch `propagate=True` on both for log assertions:
  ```python
  for n in ("jobs", "jobs.services"):
      monkeypatch.setattr(logging.getLogger(n), "propagate", True)
  ```
- **Coverage in container**: pass `COVERAGE_FILE=/tmp/.coverage` and `-p no:cacheprovider` to pytest. The non-root `app` user can't write coverage's sqlite db or pytest cache to `/app`. `make test` already does this.

### Dev iteration

- **Source is baked into the image** at build time. After any backend code change: `docker compose build backend && docker compose up -d backend`. (No bind-mount on purpose — keeps the prod surface clean.)
- **Frontend changes**: `docker compose build frontend && docker compose up -d frontend`. For fast inner-loop work prefer `cd frontend && npm run dev` (Vite dev proxy forwards `/api` to the running compose backend at `:8000`).
- **Direct DB access**: `docker compose exec -T db psql -U jobs -d jobs -c "<sql>"`.
- **Django shell**: `docker compose exec -T backend python manage.py shell -c "<snippet>"`.
- **Perf seeding**: `make seed-bench` (100k jobs, ~5s on a laptop). Findings in `docs/perf.md`.

## Scaling notes (informational)

Plan target is millions of jobs on a single Postgres. With the indexes defined in the plan, no partitioning is needed at this scope. If `jobs_jobstatus` ever passes ~100M rows, range-partition by `timestamp` monthly. Multi-tenancy → partition or shard by `tenant_id`. Out of scope here.

## Where things live

See `README.md` for the canonical repo tree and setup instructions. Plan archive: `/Users/ali/.claude/plans/melodic-toasting-beaver.md`.
