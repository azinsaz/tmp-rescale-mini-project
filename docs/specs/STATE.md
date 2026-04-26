# Session resume pointer

Read this first if picking up after a `/compact` or new session. It says exactly where the work stopped and what the next concrete action is.

## You are here

**Phase 3b of the master plan — frontend stream, mid-cycle.**

| What | Where | Status |
| --- | --- | --- |
| Master plan | `/Users/ali/.claude/plans/melodic-toasting-beaver.md` | approved |
| Phase 1 — planning | (the plan itself) | done |
| Phase 2 — backend stream (`/spec:requirements`/design/tasks/implement) | `docs/specs/backend/` | **done — 20/20 tasks, 63 tests, 97% coverage, `make test` cold = 18.5 s** |
| Phase 3a — frontend design exploration | `docs/design/preview.html`, `docs/design/tokens.md` | done — Rescale-branded ("Drafting Table"), approved |
| Phase 3b — frontend `/spec:requirements` | `docs/specs/frontend/requirements.md` | **approved (just now)** |
| Phase 3b — frontend `/spec:design` | not yet written | **next** |
| Phase 3b — frontend `/spec:tasks` | not yet written | pending |
| Phase 3b — frontend `/spec:implement` | not yet started | pending |

## The exact next action

Invoke `/spec:design frontend`. Use the existing requirements (`docs/specs/frontend/requirements.md`) and the design language (`docs/design/preview.html` + `docs/design/tokens.md`) as inputs. Stack and scope are locked — this is not the time to re-explore alternatives.

The design doc should cover:

- Architecture: Vite SPA layout (folders), data layer (TanStack Query), routing (`createBrowserRouter`), styling (Tailwind v4 + the design tokens)
- Components: `StatusPill`, `Panel`, `JobList` table, `CreateJobForm`, `FilterPills`, `Pagination`, `JobDetail`, `StatusUpdateControl`, `StatusHistory`, `DeleteConfirmation`, `ErrorBanner`, `LoadingLine`
- Hooks: `useJobs`, `useJob`, `useStatuses`, `useCreateJob`, `useUpdateStatus`, `useDeleteJob`. Query key conventions. Invalidation rules.
- Cursor extraction utility: `parseCursorFromNextUrl(next: string | null) => string | null`
- Typed API client: `lib/api-client.ts` — `apiGet/apiPost/apiPatch/apiDelete<T>`, error envelope parsing, `ApiError` class
- Tailwind config: register `theme.extend.colors.rescale.{ ink, blue, blue-soft, blue-strong }` + the three font families
- Vite config: `server.proxy` for `/api` → backend dev address, `@tailwindcss/vite` plugin
- Playwright config: `workers: 1`, `globalSetup` shelling out to `docker compose exec backend python manage.py flush --no-input`, `baseURL` from env
- Multi-stage Dockerfile (node 20 builder → nginx 1.27 runtime), nginx config with `try_files $uri /index.html` and `location /api/ { proxy_pass http://backend:8000; }`
- Compose updates: `frontend` service on `8080`, `vitest` service under `test` profile (uses builder stage), `playwright` service under `test` profile (mcr.microsoft.com/playwright:v1.58.2-jammy)
- Make target updates: `make test` chains BE pytest → FE Vitest → Playwright; `make up` adds the frontend service

## Locked decisions to bake into the design (don't re-litigate)

- Stack: React 18, TS strict, Vite 8, TanStack Query 5, React Router 7 (data router), Tailwind v4, Vitest 4 (happy-dom), Playwright 1.58.2-jammy
- Visual: "Drafting Table" — Fraunces + IBM Plex Sans + IBM Plex Mono, ink `#1B1B1B`, accent `#489ABD`, paper-grid bg
- Brand: Rescale logo + favicon already at `frontend/public/`. Logo at `h-10` on list-page header, `h-8` `opacity-90` on detail
- API contract: locked in `docs/specs/backend/design.md §5` + ADR-4 spike findings (cursor is in a URL, items key is `results`, ordering is fixed `-created_at, -id`, no user-controlled sort)
- Errors: 400 with `{detail, errors:[{loc,msg,type}]}`; 404 `{detail}`; 500 generic detail
- Pagination: cursor-only on `/jobs` and `/jobs/<id>/statuses/`; FE extracts cursor via `URLSearchParams`
- Logging hygiene + service patterns are settled on the backend; FE doesn't log in v1 (browser console for errors only is fine)
- Out of scope (locked): auth, dark mode, skeletons, toasts, mobile <768 px, name sort, SSE/WebSockets, i18n, SSR

## Open questions baked into requirements (defaults already chosen)

| # | Question | Default |
| --- | --- | --- |
| 1 | Status update — submit-on-click vs two-step | Two-step (matches design) |
| 2 | Action menu on a list row | Just link to detail (no inline status update) |
| 3 | FE coverage gate | 70% on `src/features/jobs/` and `src/lib/` |
| 4 | axe-core a11y smoke | Yes — one assertion in `create.spec.ts` |
| 5 | Vitest coverage gate enforced in `make test` | Yes |
| 6 | Bundle-size budget — hard fail or measure | Measure only at this scope |

## Files of interest (read these in this order if picking up cold)

1. `/Users/ali/.claude/plans/melodic-toasting-beaver.md` — master plan, all phases, all open questions
2. `CLAUDE.md` — project memory, gotchas, dev iteration commands
3. `docs/specs/STATE.md` — this file
4. `docs/specs/backend/design.md` — locked API contract + the ADR-4 spike findings the FE depends on
5. `docs/specs/frontend/requirements.md` — what to design against (just approved)
6. `docs/design/preview.html` + `docs/design/tokens.md` — the visual language

## Backend stream summary (already shipped)

- 20 tasks complete; `make test` from a cold clone exits 0 in 18.5 s
- 63 pytest tests, 97.18% coverage, 80% gate enforced
- 6 endpoints + `/api/health/` + `/api/openapi.json` + `/api/docs/`
- Custom error envelope at 400/404/500 via Ninja exception handlers
- Logging factory (text/dev + JSON/prod, RotatingFileHandler 10 MiB × 7)
- `make seed-bench` populates 100 k jobs; perf verified in `docs/perf.md`

## What NOT to do after compact

- Don't re-run the design exploration — it's done and approved.
- Don't change the locked stack, design tokens, or API contract.
- Don't attempt to add user-controlled `ordering` back on the list endpoint — it's deliberately dropped (see backend design §5 ADR-4 spike findings).
- Don't introduce a custom paginator beyond Ninja's default — verified to work as-is.
- Don't write new CLAUDE.md sections from scratch — augment the existing one.
- Don't skip the `/spec:design` gate; the user wants to review at every gate.
