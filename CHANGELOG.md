# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — 2026-04-26

Initial take-home submission. Implements the core Job Management Dashboard
plus all five stretch goals (status history, filter + sort, distinct detail
URL, FE unit tests, BE unit tests).

### Added

- **Backend (Django 5.2 + Django Ninja 1.6, async ASGI on Uvicorn)**
  - `Job` and `JobStatus` models with a denormalized `Job.current_status`
    cache for O(1) "list with current status" reads.
  - REST endpoints under `/api/jobs/` — list (cursor-paginated, filterable
    by status, sortable by `created_at` / `updated_at` / `name`), create,
    retrieve, status update (PATCH appends a new `JobStatus` row inside an
    atomic block), delete (cascades), and per-job status history.
  - `SortableCursorPagination` — custom Ninja paginator that accepts a
    closed-allow-list `sort` query param without mutating shared state.
  - `GET /api/` ping endpoint and `GET /api/health/` liveness probe.
  - Composite indexes for every supported sort key (`-created_at`,
    `-updated_at`, `name`) plus the `JobStatus(job_id, -timestamp)` index
    backing the history view.
  - Locked error envelope (`{detail, errors[]}`) on validation, 404, and
    uncaught 5xx paths.
  - Structured logging via `dictConfig` with text/json formatters.
- **Frontend (React 18 + TypeScript strict + Vite 5 + TanStack Query 5 +
  React Router 7 + Tailwind v4)**
  - Job list with responsive layout: a true `<table>` ≥768 px and a parallel
    semantic `<ul>` of `<article>` cards below.
  - Whole-row click target (Enter/Space activation, focus-visible ring).
  - Right-anchored detail drawer — list stays mounted as the parent route;
    deep links to `/jobs/:id` work; Escape closes; focus returns to trigger.
  - Per-row `StatusQuickChange` popover (`role="menu"` with
    `menuitemradio` items) with optimistic updates and snapshot-based
    rollback on error.
  - True modal `ConfirmDeleteDialog` (focus-trapped, Cancel as default
    focus) shared between drawer footer and per-row kebab menu.
  - Sortable column headers (desktop) + sort `<select>` and direction
    toggle (mobile); state lives in the URL via `?sort=`.
  - Cursor pagination with surgical TanStack-Query invalidation rules
    (umbrella for create/delete; targeted list + history for status
    update so the optimistic detail cache is preserved).
  - Typed API seam (`apiGet/Post/Patch/Delete<T>` + `ApiError`).
- **Infra & DX**
  - Single `docker-compose.yml` orchestrating Postgres 16, backend, and
    frontend (nginx serving the SPA build and proxying `/api/*`).
  - `Makefile` with `build` / `up` / `stop` / `clean` / `test` targets,
    plus `seed` (1 000 000 rows) and `seed-bench` (100 k rows).
  - `make test` chain: backend pytest → frontend Vitest → Playwright E2E
    on both mobile (390×844) and desktop (1280×800) projects.
  - GitHub Actions CI/CD scaffold — `lint → test → deploy` stages, FE/BE
    split, deploy stub triggers on tag push.
  - Local `scripts/pre-commit.sh` mirroring CI for pre-push verification.

### Notes

- Time spent: ~5 hours.
- AI usage: developed with Claude Code under a strict spec-driven workflow
  (see `README.md` for breakdown and `docs/specs/` for prompt history).
