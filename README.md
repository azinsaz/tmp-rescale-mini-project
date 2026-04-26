# Job Management Dashboard

Take-home implementation. Manage computational jobs (create, view,
update status, delete) with a per-job status history. Implements the
core requirements **and all five stretch goals** (history view, filter
+ multi-field sort, distinct detail URL, FE unit tests, BE unit tests).

The headline design and engineering decisions are recorded in three
companion docs that this README links into directly:

- [`docs/ADR.md`](docs/ADR.md) — Architecture Decision Record (18 ADRs covering the data model, pagination, indexing, async runtime, auth-free defaults, and the frontend shape).
- [`docs/perf.md`](docs/perf.md) — `EXPLAIN (ANALYZE, BUFFERS)` evidence at 100 k jobs and the reasoning that lets the same plans hold at the millions-of-jobs target.
- [`docs/future-improvements.md`](docs/future-improvements.md) — what changes when this graduates from a take-home to a production service (auth, multi-tenancy via RLS, secrets management, CD pipeline, soft-delete/archive, partial indexes, observability, more).

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
make up      # start db + backend + frontend (waits for health)
make test    # cold-machine evaluation gate (BE pytest → FE Vitest → Playwright)
make stop    # stop containers (volumes preserved)
make clean   # full reset (containers, volumes, .env, logs)
```

The app runs at <http://localhost:8080>. The API is at
<http://localhost:8000/api/> (the root returns `{"message": "pong"}`
plus a small index of links). Interactive API docs at
<http://localhost:8000/api/docs/>.

## Make targets in detail

Every target is idempotent. The dependency arrows in the comments
match the real dependencies in the `Makefile`.

| Target | What it does |
| --- | --- |
| `make build` | `docker compose build` for db, backend, and frontend. Bootstraps `.env` from `.env.example` if missing. |
| `make up` | Brings the stack up in the background (`db`, `backend`, `frontend`). Blocks until `/api/health/` returns 200, then prints the local URLs. |
| `make stop` | `docker compose down`. Containers stop; the `db-data` volume is preserved, so a subsequent `make up` retains state. |
| `make clean` | `docker compose down -v --remove-orphans`, removes `.env`, removes `logs/`. Full reset for a clean-slate run. |
| `make test` | The cold-machine evaluation gate. Builds the test profile, runs **backend pytest** (with coverage gates on `jobs.services`, `jobs.api`, `config.api`, `config.logging`), runs **frontend Vitest** (with coverage gate on `src/features/jobs` and `src/lib`), brings the frontend up, **flushes the database** to give Playwright a deterministic starting state, runs **Playwright E2E** specs across mobile (390×844) + desktop (1280×800) projects, and tears down the stack on success or failure. |
| `make seed-bench` | Seeds the running stack with **100 000 jobs** (~5 s on a laptop) for `EXPLAIN` benchmarking. Requires `make up` first. |
| `make seed` | Seeds **1 000 000 jobs** (~1–2 min on a laptop) — the design target for the millions-of-jobs scenario. Requires `make up`. |
| `make ci` | Mirrors GitHub Actions (`.github/workflows/ci.yml`) locally. Runs `./scripts/pre-commit.sh` end-to-end: backend lint (`ruff check` + `ruff format --check` + `compileall`), frontend lint (`tsc --noEmit` + `eslint` + `prettier --check`), then `make test`. |

## Architecture (one paragraph)

Django 5.2 + Django Ninja 1.6 backend on async ASGI (Uvicorn),
Postgres 16, async ORM with `sync_to_async` only at unavoidable seams
([ADR-004](docs/ADR.md#adr-004--async-asgi-with-sync_to_async-only-at-unavoidable-seams)).
React 18 + TypeScript strict + Vite frontend with TanStack Query and
React Router v7 (data router). Frontend nginx serves the SPA build and
proxies `/api/*` to the backend, so the client always uses relative
paths and there is no CORS layer
([ADR-016](docs/ADR.md#adr-016--nginx-api-reverse-proxy-relative-urls-only)).

## Repo layout

```
.
├── Makefile
├── docker-compose.yml
├── .env.example
├── .github/                       # CI/CD workflows + PR template
├── scripts/pre-commit.sh          # local mirror of CI gates
├── backend/                       # Django + Ninja API
├── frontend/                      # React + Vite SPA + Playwright E2E
└── docs/
    ├── ADR.md                     # Architecture Decision Record
    ├── perf.md                    # EXPLAIN evidence at 100k jobs
    ├── future-improvements.md     # production graduation roadmap
    ├── design/                    # design tokens + locked preview
    ├── prompts/                   # planning prompt(s)
    ├── sessions/                  # session logs from the build
    └── specs/{backend,frontend}/  # requirements / design / tasks / impl-log
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

`?sort` accepts: `created_at`, `-created_at`, `updated_at`,
`-updated_at`, `name`, `-name`. Invalid values silently fall back to
`-created_at` ([ADR-010](docs/ADR.md#adr-010--custom-sortablecursorpagination)).
The list and history endpoints both return the locked
cursor-pagination envelope: `{"results": [...], "next": "...?cursor=...",
"previous": null}`.

## Performance considerations

The list endpoint is designed for the millions-of-jobs scenario. The
core levers:

- **Cursor (keyset) pagination** with stable tiebreaker on `id` —
  constant-time pagination regardless of dataset size, deterministic
  under concurrent inserts. Rationale and trade-offs in
  [ADR-002](docs/ADR.md#adr-002--cursor-keyset-pagination-over-offsetlimit).
- **Composite indexes** for every supported sort key
  (`(-created_at, -id)`, `(-updated_at, -id)`, `(name, id)`), each
  ending in a unique tiebreaker so the cursor predicate is total. See
  [ADR-003](docs/ADR.md#adr-003--composite-index-strategy-and-stable-tiebreakers).
- **Denormalized `Job.current_status`** column maintained inside the
  same atomic block as the `JobStatus` insert, so the list endpoint
  never has to subquery the history table to determine current state.
  See [ADR-001](docs/ADR.md#adr-001--denormalized-jobcurrent_status).
- **`JobStatus(job_id, -timestamp)`** composite index for the per-job
  history view; the planner picks it automatically as soon as a job
  has more than a handful of status rows.
- `EXPLAIN (ANALYZE, BUFFERS)` evidence at 100 k jobs — including the
  Q2 filter-by-status case and how it scales to 1 M — is in
  [`docs/perf.md`](docs/perf.md).

To reproduce locally:

```bash
make up
make seed-bench  # 100 000 jobs (~5 s)
make seed        # 1 000 000 jobs (~1–2 min)
```

## Frontend notes

- **Stack**: React 18 + TS strict + Vite + TanStack Query 5 + React
  Router 7 (data router) + Tailwind v4 (CSS-first via `@theme`,
  see [ADR-015](docs/ADR.md#adr-015--tailwind-v4-css-first-theme-no-tailwindconfigts)).
- **Detail view — drawer over the list, with a distinct URL.** The
  spec's stretch goal asks for "more detailed information in a
  separate page with a distinct URL from the job list page." We
  implement the URL contract verbatim — `/jobs/:id` is a real route,
  reload-safe, share-link-safe, deep-linkable. The *layout* is a
  right-side drawer that opens over the list (rather than swapping the
  list out for a separate page) because the list is the operator's
  triage surface — yanking it away on every detail click forces a
  re-orientation every time they come back. Click-from-list and
  deep-link both end at the same URL and the same visual state. Full
  reasoning in [ADR-013](docs/ADR.md#adr-013--drawer-over-the-list-with-distinct-url-for-the-detail-view).
- **Responsive**: real `<table>` ≥768 px, parallel semantic `<ul>` of
  `<article>` cards below. The whole row is the click target with
  proper keyboard activation. No fake `role="table"` on the cards.
- **Status update UX**: per-row pill is itself a `role="menu"` popover
  (`menuitemradio` items, arrow-key nav, optimistic + rollback). The
  drawer uses the same component for consistency.
- **Delete UX**: shared `role="dialog"` modal with focus trap and
  Cancel as default focus, opened from the drawer footer **or** a
  per-row kebab menu.
- **State**: TanStack Query is the single source of truth (queries +
  surgical invalidation, [ADR-011](docs/ADR.md#adr-011--tanstack-query-as-the-only-server-state-store)).
  Filter, sort, and selected job all live in the URL, so every state
  is shareable and reload-safe ([ADR-012](docs/ADR.md#adr-012--url-as-state-for-filter-sort-cursor-and-selection)).

## CI/CD

GitHub Actions workflows under `.github/workflows/`:

- `ci.yml` — runs on every push and PR. Stages: **lint → test**.
  Backend lint = `ruff check` + `ruff format --check` + `compileall`.
  Frontend lint = `tsc --noEmit` + `eslint` + `prettier --check`.
  Tests run as separate jobs (BE pytest, FE Vitest, Playwright E2E
  via `make test`).
- `cd.yml` — runs on a SemVer tag push (`v*.*.*`). Builds the backend
  and frontend Docker images at the tagged commit and attaches
  `CHANGELOG.md` to the GitHub Release. Registry push and rollout are
  left as `TODO(deploy)` (no real cloud target wired up — see
  [`docs/future-improvements.md` §4](docs/future-improvements.md#4-container-registry-cd-pipeline-and-cloud-deployment)).

To run the same checks locally before pushing:

```bash
./scripts/pre-commit.sh           # everything (lint + tests)
./scripts/pre-commit.sh --lint    # lint only
./scripts/pre-commit.sh --skip-e2e
make ci                           # alias for the above
```

## Repo navigation

- [`docs/ADR.md`](docs/ADR.md) — 18 architecture decisions, with context, alternatives, and trade-offs
- [`docs/perf.md`](docs/perf.md) — `EXPLAIN (ANALYZE, BUFFERS)` evidence on a 100 k seed
- [`docs/future-improvements.md`](docs/future-improvements.md) — production graduation roadmap
- `docs/specs/backend/` — backend requirements / design / tasks / implementation log
- `docs/specs/frontend/` — frontend requirements / design / tasks / implementation log
- `docs/design/preview.html` — locked design preview
- `docs/design/tokens.md` — design tokens (Drafting Table direction)
- `docs/prompts/prompt.md` — Phase-1 planning prompt (verbatim)
- `docs/sessions/` — full session transcripts from the build
- `CLAUDE.md` — project memory (gotchas, dev iteration commands, invariants)
- `CHANGELOG.md` — Keep-a-Changelog formatted release log
- `LICENSE` — interview-only, non-redistribution

## Time spent

- ~ 2 hours: Phase 1 planning (Opus 4.7 with maximum reasoning effort) — locked the stack, the API contract, and the workflow before any code.
- ~ 5 hours: spec-driven implementation across the backend and frontend streams.
- ~ 30 min: CI/CD scaffold, then the README, ADR, perf, and future-improvements documentation.

Total: roughly 7.5 hours of focused work.

---

## AI usage — methodology and prompt engineering

This project was built end-to-end with **Claude Code (Opus 4.7) as
the primary developer pair**, under a workflow that is itself a
deliberate engineering choice. The interesting question for an
interview is not "did you use AI" — it is "what did the workflow look
like, where did it succeed, where did it fail, and what did you do
about both."

The full Phase-1 planning prompt is in
[`docs/prompts/prompt.md`](docs/prompts/prompt.md) and the verbatim
session transcripts are in [`docs/sessions/`](docs/sessions/). What
follows is the methodology.

### 1. The non-negotiables locked before any code

Before generating a single line of implementation, I locked the
constraints that no model output should be allowed to perturb:

- **Cold-machine `make test` gate.** The spec says evaluation stops
  if `make test` fails on a fresh clone with only
  `make`/`docker`/`docker compose v2`/`bash`/DockerHub. Every
  downstream decision had to pass through that gate. This was stated
  explicitly in the planning prompt and re-stated in the
  orchestration section.
- **Stack pinned.** Django 5.2 + Ninja 1.6 + Postgres 16 on the
  backend; React 18 + TS strict + Vite + TanStack Query + React
  Router 7 + Tailwind v4 + Playwright on the frontend. No
  mid-project stack rewrites — the planning phase chose, the
  implementation phase executed.
- **All five stretch goals are in scope.** Not optional. The "should
  I do this stretch goal?" decision was made up front, so the model
  never had to ask and I never had to re-litigate.
- **Senior-quality conventions, no enterprise scaffolding.** No
  framework-of-frameworks; no DI containers; no service registries;
  no microservices. A four-endpoint CRUD with thin handlers and fat
  services.

### 2. Phase-gated workflow

The whole project ran through a strict three-phase gate, with my
explicit approval required between phases:

1. **Phase 1 — Planning.** A single planning prompt produced the
   master plan: scope confirmation, repo layout, locked API contract,
   pagination strategy, indexing plan, Docker/Makefile orchestration,
   open questions. Reviewed by `prompt-engineer`, then audited in
   parallel by `architect-reviewer`, `data-engineer`,
   `database-administrator`, and `cloud-architect` subagents. The
   final plan lives at `~/.claude/plans/melodic-toasting-beaver.md`.
2. **Phase 2 — Backend stream.** `/spec:requirements` →
   `/spec:design` → `/spec:tasks` → `/spec:implement`, with a manual
   gate at every transition. Each gate had two passes: an
   over-engineering review (am I adding things the spec doesn't ask
   for?) and a literal `simplify` skill pass on the implementation
   diff. Result: 20/20 tasks, 63 pytest tests, 97% coverage, cold
   `make test` ≈ 18.5 s.
3. **Phase 3 — Frontend stream.** Same gate discipline, with an
   additional sub-phase (3a) for design exploration via the
   `frontend-design` skill before any code. The exploration produced
   the "Drafting Table" direction which incorporated the Rescale
   brand assets (logo, favicons, sampled brand colors). Phase 3b ran
   `/spec:requirements` → `/spec:design` → `/spec:tasks` →
   `/spec:implement` with parallel review by `architect-reviewer`,
   a frontend-engineer subagent, a simplification reviewer, and
   `accessibility-tester`.

The phase gates are the single most leveraged thing I did. Every
gate forced a small, reviewable artifact (a requirements doc, a
design doc, a tasks list, a diff) instead of letting a 4-hour sprint
produce one giant unreviewable PR.

### 3. Spec-driven development as a forcing function

I used the `/spec:requirements` → `/spec:design` → `/spec:tasks` →
`/spec:implement` workflow because it forces the model to write down
its assumptions *before* it writes code, and forces me to sign off on
those assumptions explicitly. The artifacts in
[`docs/specs/`](docs/specs/) are the unedited record:

- **Requirements.** Functional + non-functional, every user story
  with Given/When/Then acceptance criteria. The model has to
  enumerate what it thinks "done" looks like before designing.
- **Design.** Architecture, alternatives considered, ADRs (the
  long-form kind), data model, API contract, error envelope, test
  strategy. Catches ambiguity at the design stage where it is cheap
  to fix.
- **Tasks.** A linear list of small, testable tasks with clear exit
  criteria. The implementation phase ticks them off; if a task takes
  longer than expected I can see the divergence in real time.
- **Implementation log.** Per-task notes — what worked, what
  surprised me, what the test pass count looks like. Useful for
  archeology.

### 4. Parallel reviewer subagents

Senior code review is the highest-leverage activity in any project.
Doing it serially with one model is slow; doing it in parallel with
specialized reviewers is the way Claude Code is meant to be used.
Concretely:

- The Phase 1 plan was audited in parallel by **four** specialist
  subagents (`architect-reviewer`, `data-engineer`,
  `database-administrator`, `cloud-architect`). The convergent
  findings — "denormalize the latest status," "cursor over offset,"
  "no PgBouncer at this scope" — became locked decisions before any
  code was written.
- The frontend design was reviewed in parallel by
  `architect-reviewer`, a frontend-engineer subagent, a
  simplification reviewer, and `accessibility-tester`. Convergent
  findings drove substantive changes: dropped Docker-socket mount in
  favor of host Makefile-orchestrated DB flush; switched Tailwind v4
  to CSS-first `@theme`; merged three `jobs.*` files into one
  `jobs.hooks.ts`; replaced the fake `role="table"` mobile pattern
  with semantic `<article>` cards; added ARIA radiogroup + roving
  tabindex on the status update control; added focus-return on
  delete-confirm.

A reviewer that disagrees is more valuable than one that agrees.
Running them in parallel surfaces the disagreements faster.

### 5. Where the model got it wrong, and what I did about it

The honest catalog. Not exhaustive — items that were either
non-obvious or that taught me something about how to use the tool.

- **Async ORM in transactions.** First-cut implementation tried to
  put `Job.objects.acreate(...)` inside `transaction.atomic()`. Django
  5.2 doesn't support that pattern safely. Caught at test time with
  intermittent failures. Fix: every transactional write goes through
  a `@sync_to_async`-wrapped helper; the async wrapper just awaits it
  and logs ([ADR-004](docs/ADR.md#adr-004--async-asgi-with-sync_to_async-only-at-unavoidable-seams)).
  The fix became a CLAUDE.md invariant so future sessions don't
  regress.
- **`auto_now` + `update_fields`.** First implementation of
  `update_job_status` updated `current_status` only — `updated_at`
  didn't move because `auto_now` doesn't fire when the field isn't
  in `update_fields`. Caught by a unit test asserting `updated_at`
  changes on PATCH. Fix: include `updated_at` explicitly in
  `update_fields`.
- **`from __future__ import annotations` breaks Ninja.** Ninja 1.6 +
  Pydantic 2 can't resolve forward references for `Enum` / `Literal`
  query-param types when the module imports
  `__future__.annotations`. Caught at request time as
  `PydanticUserError`. Fix: do not import `__future__.annotations` in
  modules that contain Ninja handlers with enum/literal params.
- **Ninja `CursorPagination` ordering is set at decoration time.**
  The first attempt at user-controlled sort wrote per-request
  `?sort=` into the queryset; Ninja's paginator overrode it from the
  decorator's `ordering=` arg. Verified with a dedicated spike
  (`backend/jobs/tests/test_pagination_spike.py`). Fix: a custom
  `SortableCursorPagination` subclass that derives the ordering
  tuple per request without mutating shared instance state
  ([ADR-010](docs/ADR.md#adr-010--custom-sortablecursorpagination)).
- **Django index-name limit.** Django enforces a 30-character cap on
  `Meta.indexes` names (system check `models.E034`); the design doc
  used `idx_jobstatus_job_timestamp_desc` (32 chars). Caught by
  `manage.py check`. Fix: shortened to `idx_jstatus_job_ts_desc`.
- **Mobile fake-table ARIA pattern.** First-pass mobile cards used
  `role="table"` + `role="row"` + `role="cell"` to mirror the desktop
  semantics. axe-core flagged it ("0-column table"). The
  accessibility-tester subagent confirmed the fix: drop the ARIA
  chain entirely and use semantic `<article>` cards. ARIA is not a
  free upgrade.
- **`caplog` doesn't see app loggers.** Our app loggers (`jobs`,
  `jobs.services`) have `propagate=False` in dictConfig so they
  don't double-log. pytest's `caplog` only sees the root logger, so
  log assertions silently passed when they should have failed. Fix:
  monkey-patch `propagate=True` on both loggers inside the test
  fixture. Documented in CLAUDE.md.
- **Coverage permissions in container.** The non-root `app` user in
  the backend container can't write `.coverage` to `/app`. Fix: pass
  `COVERAGE_FILE=/tmp/.coverage` and `-p no:cacheprovider` to
  pytest. Already wired into `make test`.
- **Docker socket mount for E2E DB reset.** The first design had
  Playwright shell out to Docker via a mounted socket; the security
  cost (full Docker privileges in the test container) wasn't worth
  it. Fix: orchestrate the flush from the host `Makefile` between FE
  bring-up and the Playwright run
  ([ADR-009](docs/ADR.md#adr-009--managepy-flush-for-e2e-db-reset-no-test-endpoint)).
- **TanStack Query mutation invalidation.** The first
  `useUpdateStatus.onSuccess` invalidated the umbrella `['jobs']`
  key. That refetched the detail and clobbered the freshly-set
  cache from `setQueryData`. The reviewer subagent caught it; the
  fix is to invalidate **list + history precisely** and use
  `setQueryData` for the detail. The invalidation rules are now a
  CLAUDE.md invariant.

### 6. Prompt-engineering posture

A few things that converged into a posture:

- **Lead with the constraint, then the goal.** "We will run `make
  test` on a cold machine with only `make`/`docker`/`bash`. Now:
  plan the architecture." beats "Plan the architecture for a job
  dashboard." The constraint shapes the answer; deferring it forces
  a rewrite.
- **Lock before exploring.** When the stack and scope are settled,
  state them as "locked, do not re-litigate." The model otherwise
  helpfully re-suggests alternatives every turn, eating context.
- **Specific over generic.** "Use `aget`/`acreate`/`afilter` and
  `sync_to_async` only inside transaction blocks" produces the right
  code; "use the async ORM" produces a coin flip.
- **Refuse one-shot mega-prompts.** A prompt that asks for "the
  whole backend" produces compilable but unreviewable output. The
  spec-driven workflow exists because the gates are the forcing
  function for review.
- **Tell the model what *not* to do.** The planning prompt
  explicitly forbids restating the spec, picking alternative stacks,
  and proceeding without approval. Negative constraints are as
  load-bearing as positive ones.
- **Treat the model's confidence as data, not as truth.** When a
  reviewer subagent disagrees with the implementer subagent, the
  disagreement is the signal — surface both views, decide
  explicitly, write down why.

### 7. Where the model genuinely added value

Worth being equally specific:

- **Long-form planning.** The Phase 1 plan is detailed in a way I
  would not have produced by hand in the same time budget. Forcing
  the model to enumerate alternatives ("denormalize vs Subquery vs
  partial indexes") and trade-offs surfaces decisions earlier than
  my unaided process would.
- **Convergent reviewer findings.** Running four specialist
  reviewers in parallel on the same artifact is the closest I can
  get to a real architecture review without scheduling four
  meetings.
- **Boilerplate elimination.** Pydantic schemas, factory_boy
  factories, Vitest mocks, Playwright fixtures — generation is
  faster than typing and the diffs are short enough to review at
  speed.
- **Mechanical refactors.** The `simplify` skill pass on every
  implementation diff caught real over-abstraction multiple times
  (helpers used once, parameters that defaulted to the only value
  ever passed, error handlers that re-wrapped errors with no added
  context).

### 8. What I would do differently next time

- **More aggressive use of `simplify` mid-stream**, not just at the
  end of a phase. Some redundancy compounds before the gate.
- **A formal "interface lock" artifact** between the backend and
  frontend streams. The contract was locked in the backend design
  doc; the frontend stream nonetheless re-derived parts of it. A
  small dedicated `contracts.md` would have shortened the FE design
  pass.
- **Explicit `simplify` runs on docs.** I applied the simplification
  lens to code; I didn't apply it as rigorously to the design docs,
  which are longer than they need to be in a few places.

---

The methodology, not the model, is what makes the output usable. The
model is fast at producing first drafts; the gates and the reviewers
are what turn first drafts into something I am willing to ship.
