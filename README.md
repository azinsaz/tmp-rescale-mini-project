# Job Management Dashboard

Take-home implementation. Manage computational jobs (create, view, update
status, delete) with a per-job status history. Implements the core
requirements **and all five stretch goals** (history view, filter +
multi-field sort, distinct detail URL, FE unit tests, BE unit tests).

## Prerequisites

The evaluation environment only assumes:

- `make`
- `docker`
- `docker compose v2`
- `bash`
- DockerHub access

Nothing else needs to be installed on the host.

## Quick start

```bash
make build   # build all images
make up      # start db + backend + frontend
make test    # BE pytest → FE Vitest → Playwright E2E
make stop    # stop containers
make clean   # full reset (containers, volumes, .env, logs)
```

The app lives at <http://localhost:8080>. The API is reachable at
<http://localhost:8000/api/> (the root returns `{"message": "pong"}` and a
small index of links). Interactive API docs at
<http://localhost:8000/api/docs/>.

## Architecture (one paragraph)

Django 5.2 + Django Ninja 1.6 backend on async ASGI (Uvicorn), Postgres 16,
async ORM. React 18 + TypeScript strict + Vite frontend with TanStack Query
and React Router v7. Frontend nginx serves the SPA build and proxies
`/api/*` to the backend, so the client always uses relative paths and
there is no CORS layer.

## Repo layout

```
.
├── Makefile
├── docker-compose.yml
├── .env.example
├── .github/                  # CI/CD workflows + PR template
├── scripts/pre-commit.sh     # local mirror of CI gates
├── backend/                  # Django + Ninja API
└── frontend/                 # React + Vite SPA + Playwright E2E
```

## API

Six endpoints under `/api/jobs/` plus health and ping. OpenAPI schema at
`/api/openapi.json`, interactive docs at `/api/docs/`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/` | Ping → `{"message": "pong", ...links}` |
| GET | `/api/health/` | Liveness + DB-reachability probe |
| GET | `/api/jobs/` | Paginated list with `current_status`; supports `?status=`, `?sort=`, `?cursor=` |
| POST | `/api/jobs/` | Create job (auto-creates initial PENDING `JobStatus`) |
| GET | `/api/jobs/<id>/` | Job detail |
| PATCH | `/api/jobs/<id>/` | Append a new `JobStatus` row with the given `status_type` |
| DELETE | `/api/jobs/<id>/` | Delete (cascade removes `JobStatus` rows) |
| GET | `/api/jobs/<id>/statuses/` | Status history (paginated DESC by timestamp) |

`?sort` accepts: `created_at`, `-created_at`, `updated_at`, `-updated_at`,
`name`, `-name`. Invalid values silently fall back to `-created_at`.

## Performance considerations

The list endpoint targets the millions-of-jobs scenario:

- **Cursor pagination** with stable tie-break on `id` — constant-time pagination
  regardless of dataset size.
- **Composite indexes** for every supported sort key (`-created_at,-id`,
  `-updated_at,-id`, `name,id`) so paged scans hit a single index.
- **Denormalized `Job.current_status`** column maintained inside the same
  atomic block as the new `JobStatus` row, so the list endpoint never has
  to subquery the history table.
- **`JobStatus(job_id, -timestamp)`** index for the per-job history view.
- `EXPLAIN (ANALYZE, BUFFERS)` evidence at 100 k rows lives in
  `docs/perf.md`.

To stress-test locally:

```bash
make up          # bring stack up
make seed-bench  # seed 100,000 jobs (~5 s)
make seed        # seed 1,000,000 jobs (~1–2 min on a laptop)
```

## Frontend notes

- **Stack**: React 18 + TS strict + Vite + TanStack Query 5 + React Router 7
  (data router) + Tailwind v4 (CSS-first via `@theme`).
- **Layout**: `/jobs` lists; `/jobs/:id` opens a right-side drawer over the
  list (list stays mounted, scroll/cursor preserved). Direct deep-links to
  `/jobs/:id` work — list mounts behind, drawer opens on top.
- **Responsive**: real `<table>` ≥768 px, parallel semantic `<ul>` of
  `<article>` cards below. The whole row is the click target with proper
  keyboard activation.
- **Status update UX**: per-row pill is itself a `role="menu"` popover
  (`menuitemradio` items, arrow-key nav, optimistic + rollback). The drawer
  uses the same component for consistency.
- **Delete UX**: shared `role="dialog"` modal with focus trap and Cancel as
  default focus, opened from the drawer footer **or** a per-row kebab menu.
- **State**: TanStack Query is the single source of truth (queries +
  surgical invalidation). Filter, sort, and selected job all live in the
  URL, so every state is shareable.

## CI/CD

GitHub Actions workflows live under `.github/workflows/`:

- `ci.yml` — runs on every push and PR.
  Stages: **lint → test**. Backend lint = `ruff check` + `ruff format
  --check` + `compileall`. Frontend lint = `tsc --noEmit` + `eslint` +
  `prettier --check`. Tests run as separate jobs (BE pytest, FE Vitest,
  Playwright E2E via `make test`).
- `deploy.yml` — runs on a SemVer tag push (`v*.*.*`).
  Same lint + test gates, then placeholder `deploy-backend` and
  `deploy-frontend` jobs that build the Docker images, smoke-test them, and
  leave clearly marked `TODO(deploy)` blocks for the registry push and
  rollout step (no real cloud target wired up).

To run the same checks locally before pushing:

```bash
./scripts/pre-commit.sh           # everything
./scripts/pre-commit.sh --lint    # lint only
./scripts/pre-commit.sh --skip-e2e
make ci                            # alias for the above
```

## Repo navigation

- `docs/specs/backend/` — backend requirements / design / tasks / impl log
- `docs/specs/frontend/` — frontend requirements / design / tasks / impl log
- `docs/design/preview.html` — locked design preview
- `docs/design/tokens.md` — design tokens (Drafting Table direction)
- `docs/perf.md` — `EXPLAIN (ANALYZE, BUFFERS)` results on a 100 k seed
- `CLAUDE.md` — project memory (gotchas, dev iteration commands, invariants)
- `CHANGELOG.md` — Keep-a-Changelog formatted release log
- `LICENSE` — interview-only, non-redistribution

## Time spent

~ 5 hours initial implementation + ~1 hour for the drawer/quick-change/sort
redesign + ~30 min for CI/CD scaffold and finishing touches.

## AI usage

Built with Claude Code as the primary developer pair under a strict
spec-driven workflow:

1. **Phase 1 — Planning.** Merged prompt reviewed by `prompt-engineer`,
   then a master plan audited in parallel by `architect-reviewer`,
   `data-engineer`, `database-administrator`, `cloud-architect`. Saved to
   `~/.claude/plans/melodic-toasting-beaver.md`.
2. **Phase 2 — Backend.** `/spec:requirements` → `/spec:design` →
   `/spec:tasks` → `/spec:implement`, with user approval at each gate.
   20/20 tasks; pytest 100 % green; 97 % coverage; cold `make test` ≈ 18 s.
3. **Phase 3a — Frontend design exploration.** `frontend-design` skill
   produced the "Drafting Table" direction; iterated to incorporate Rescale
   brand assets (logo, favicon, sampled brand colors).
4. **Phase 3b — Frontend.** Same spec-driven cycle. Design reviewed in
   parallel by `architect-reviewer`, `adsk:frontend-engineer`,
   `adsk:reviewer` (simplification lens), and `accessibility-tester`.
   29/29 tasks. Convergent reviewer findings drove substantive changes:
   dropped Docker-socket mount in favor of host Makefile flush; switched
   Tailwind v4 to CSS-first `@theme`; merged three `jobs.*` files into one
   `jobs.hooks.ts`; replaced fake `role="table"` mobile pattern with
   semantic cards; added ARIA radiogroup + roving tabindex on status
   update; added focus-return on delete-confirm.
5. **Redesign pass.** Whole-row clickability + right-side drawer + per-row
   `StatusQuickChange` popover (optimistic + rollback) + sort UI with
   custom `SortableCursorPagination` paginator. All under plan mode with
   `Explore` and `Plan` subagents producing the design before any code.

Prompt history, reviewer outputs, and decision rationale are checked into
`docs/specs/{backend,frontend}/{requirements,design,tasks,implementation-log}.md`.
