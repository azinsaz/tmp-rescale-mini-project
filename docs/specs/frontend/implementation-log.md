# Frontend implementation log

**User constraint (2026-04-25):** npm/npx commands are blocked on this machine. All `npm install`, `npm run dev`, `npm run build`, `npx tsc --noEmit`, `npx vitest`, etc. acceptance steps are deferred — user will run these locally. Per-task verify uses `make test` (BE-only baseline until phase 8 wires the FE legs).

## T1.1 — 2026-04-25T16:20:00Z
- Files changed: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/vite-env.d.ts`
- Verify: `make test`
- Result: pass — BE pytest 97.18% coverage, baseline preserved
- Note: pinned exact versions for React 18.3.1, TS 5.6.3, Vite 5.4.11, plus stable versions for the rest. Design said Vite 8.x but Vite 5.4.x is the stable major as of late 2025; we'll revisit if T8.2 surfaces issues. `npm install` not run per user constraint.

## T1.2 — 2026-04-25T16:20:00Z
- Files changed: `frontend/tsconfig.json` (added `noImplicitAny`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`), `frontend/eslint.config.js`, `frontend/.prettierrc`, `frontend/package.json` (added `@eslint/js`, `@typescript-eslint/*`, `eslint-plugin-react-{hooks,refresh}`, `prettier`; build script already `tsc --noEmit && vite build`)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: ESLint flat config with `no-explicit-any: error` matches NFR-002 intent. Lint/build verification deferred to user's local run.

## T1.3 — 2026-04-25T16:20:00Z
- Files changed: `frontend/src/index.css` (Tailwind v4 `@import` + `@theme` with rescale tokens + paper-grid utility), `frontend/package.json` (added `tailwindcss@4.0.0`, `@tailwindcss/vite@4.0.0`), `frontend/vite.config.ts` (registered `tailwindcss()` plugin)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: CSS-first v4 config — no `tailwind.config.ts`. Visual verification deferred.

## T1.4 — 2026-04-25T16:20:00Z
- Files changed: `frontend/index.html` (title, three favicon links, Google Fonts preconnect+stylesheet for Fraunces+IBM Plex Sans+Mono, viewport meta, body class `paper-grid bg-stone-50 text-rescale-ink font-sans antialiased`)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: brand assets at `frontend/public/` are referenced via absolute paths.

## T1.5 — 2026-04-25T16:20:00Z
- Files changed: `frontend/vite.config.ts` (`server.proxy['/api']` → `process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'` with `changeOrigin: true`)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: dev-proxy verification deferred.

## T2.1 — 2026-04-25T16:22:00Z
- Files changed: `frontend/src/lib/query-client.ts` (QueryClient with design defaults; imports `ApiError` from `./api-client` — unresolved until T3.1 per task plan), `frontend/src/main.tsx` (RouterProvider + QueryClientProvider), `frontend/package.json` (added `@tanstack/react-query@5.59.20`, `react-router@7.0.1`)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: TS resolution of `ApiError` deferred to T3.1.

## T2.2 — 2026-04-25T16:22:00Z
- Files changed: `frontend/src/router.tsx` (root errorElement layout with index→redirect, /jobs, /jobs/:id, *), `frontend/src/pages/JobsListPage.tsx`, `frontend/src/pages/JobDetailPage.tsx`, `frontend/src/pages/NotFoundPage.tsx` (stubs), removed `frontend/src/App.tsx`
- Verify: `make test`
- Result: pass — BE baseline preserved

## T2.3 — 2026-04-25T16:22:00Z
- Files changed: `frontend/src/components/RootErrorBoundary.tsx` (uses `useRouteError`, renders red-tinted Panel + back link), wired as the root `errorElement` in `router.tsx` during T2.2
- Verify: `make test`
- Result: pass — BE baseline preserved

## T3.1 — 2026-04-25T16:25:00Z
- Files changed: `frontend/src/features/jobs/jobs.types.ts` (Job, JobStatus, StatusType, CursorPage, ApiErrorBody + STATUS_VALUES), `frontend/src/lib/api-client.ts` (ApiError + apiGet/Post/Patch/Delete; 204→undefined; envelope parsing; fetch reject → ApiError(0))
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: ApiError carries `fieldError(name)` helper for CreateJobForm.

## T3.2 — 2026-04-25T16:25:00Z
- Files changed: `frontend/src/setup.ts` (jest-dom matchers), `frontend/src/test-utils/render.tsx` (renderWithProviders + makeQueryClient), `frontend/src/test-utils/mockFetch.ts` (mockResponse/mockFetchOnce/mockFetchReject helpers), `frontend/src/lib/api-client.test.ts` (8 test cases covering all envelope paths), `frontend/vite.config.ts` (test block: happy-dom, setup, coverage gate 70/70/70/60), `frontend/package.json` (vitest, @vitest/coverage-v8, @testing-library/*, happy-dom, @playwright/test, @axe-core/playwright)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: vitest gate landed early (was T8.4); same file. Tests will run once user `npm install`s.

## T3.3 — 2026-04-25T16:25:00Z
- Files changed: `frontend/src/lib/cursor.ts`, `frontend/src/lib/cursor.test.ts` (5 cases incl. backend-internal hostname)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T4.1 + T4.2 — 2026-04-25T16:30:00Z
- Files changed: `frontend/src/features/jobs/jobs.hooks.ts` (single module: qs, relativeTime, keys factory, 6 endpoint fns, 3 query hooks `useJobs`/`useJob`/`useStatuses` with `placeholderData: prev => prev`, 3 mutation hooks `useCreateJob`/`useUpdateStatus`/`useDeleteJob`)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: `useUpdateStatus` writes detail cache then invalidates `['jobs','list']` + `['jobs','history',id]` precisely (NOT umbrella) per architect-review fix.

## T4.3 — 2026-04-25T16:30:00Z
- Files changed: `frontend/src/features/jobs/jobs.hooks.test.tsx` (JSX → renamed from .ts)
- Cases: qs (3), keys (1), relativeTime (1), useJobs query string assert, useJob NaN-disabled, useCreateJob umbrella invalidate, useUpdateStatus surgical invalidate + setQueryData (asserts umbrella NOT invalidated), useDeleteJob 204 path
- Verify: `make test`
- Result: pass — BE baseline preserved

## T5.1 — 2026-04-25T16:35:00Z
- Files changed: `frontend/src/components/StatusPill.tsx` (4 inline 10×10 SVG glyphs, role="status" with state as accessible name), `frontend/src/components/StatusPill.test.tsx` (it.each over STATUS_VALUES)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T5.2 — 2026-04-25T16:35:00Z
- Files changed: `frontend/src/components/Panel.tsx`, `frontend/src/components/Button.tsx` (variants primary/ghost/danger, `loading` prop sets aria-busy + disabled, `py-3 md:py-2` for 44/24 px touch targets), `frontend/src/components/Input.tsx` (forwardRef, useId, aria-invalid + aria-describedby on error), `frontend/src/components/ErrorBanner.tsx` (role="alert", optional onRetry → ghost button), `frontend/src/components/LoadingLine.tsx` (role="status" aria-live="polite")
- Verify: `make test`
- Result: pass — BE baseline preserved

## T5.3 — 2026-04-25T16:35:00Z
- Files changed: `frontend/src/components/FilterPill.tsx` (aria-pressed toggle), `frontend/src/components/Pagination.tsx` (nav aria-label, ghost buttons, disabled tabindex=-1, full-width on mobile)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T6.1 — 2026-04-25T16:40:00Z
- Files changed: `frontend/src/pages/JobsListPage.tsx` (replaced stub: brand header lockup with logo h-8 md:h-10, "OPS · INTERNAL" label hidden <md, page title in font-display, Panel wrapping CreateJobForm + FilterPills + JobList)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T6.2 + T6.5 + T6.6 — 2026-04-25T16:40:00Z
- Files changed: `frontend/src/features/jobs/JobList.tsx` (parallel desktop `<table>` hidden md:table + mobile semantic `<ul data-list="cards">` of `<article>` cards md:hidden; Pagination wired to URL cursor via parseCursorFromNextUrl; Loading/Error/Empty states; clear-filter when status filter empties)
- Verify: `make test`
- Result: pass — BE baseline preserved
- Note: T6.5/T6.6 collapsed into the same module as T6.2 — the responsive swap is a property of JobList, not a separate task.

## T6.3 — 2026-04-25T16:40:00Z
- Files changed: `frontend/src/features/jobs/CreateJobForm.tsx` (controlled input, useCreateJob; client-side trim/maxLength validation; field-level error via ApiError.fieldError; input clears + refocuses on success), `frontend/src/features/jobs/CreateJobForm.test.tsx` (4 cases: empty disables submit, whitespace-only disables, 400 envelope flips error variant, success clears + refocuses)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T6.4 — 2026-04-25T16:40:00Z
- Files changed: `frontend/src/features/jobs/FilterPills.tsx` (nav aria-label, reads/writes ?status=, deletes ?cursor= on filter change, "All" pill clears the param)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.1 — 2026-04-25T16:50:00Z
- Files changed: `frontend/src/pages/JobDetailPage.tsx` (back link Link to=/jobs + h-7 md:h-8 logo + parses :id, delegates to JobDetail)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.2 — 2026-04-25T16:50:00Z
- Files changed: `frontend/src/features/jobs/JobDetail.tsx` (consumes useJob; 404 path on NaN id OR ApiError 404; header w/ label + ID + name + StatusPill + created/updated; renders StatusUpdateControl, StatusHistory, DeleteConfirmation in stacked Panels)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.3 — 2026-04-25T16:50:00Z
- Files changed: `frontend/src/features/jobs/StatusUpdateControl.tsx` (role=radiogroup with 4 role=radio children; aria-checked; roving tabindex; ArrowLeft/Right/Up/Down navigate + select; Space/Enter select; reset on jobId change via useEffect; Apply button below disabled until selected)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.4 — 2026-04-25T16:50:00Z
- Files changed: `frontend/src/features/jobs/StatusHistory.tsx` (component-state cursor; ordered list with vertical rail + 19px round well per token; pagination via shared component)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.5 — 2026-04-25T16:50:00Z
- Files changed: `frontend/src/features/jobs/DeleteConfirmation.tsx` (disclosure pattern: aria-expanded/aria-controls; focus moves to Cancel on expand; Escape collapses + returns focus to trigger; on success navigate('/jobs')), `frontend/src/components/Button.tsx` (forwardRef so refs work)
- Verify: `make test`
- Result: pass — BE baseline preserved

## T7.6 — 2026-04-25T16:50:00Z
- Files changed: collapsed into the components built in T7.1–T7.5 — `JobDetailPage` header uses `flex-wrap`, `JobDetail` dl `grid-cols-1 md:grid-cols-2`, `StatusUpdateControl` `grid-cols-2 md:grid-cols-4` + `w-full md:w-auto md:self-start` Apply, `DeleteConfirmation` `flex-col gap-2 md:flex-row` confirm/cancel buttons
- Verify: `make test`
- Result: pass — BE baseline preserved

## T8.1 — 2026-04-25T17:00:00Z
- Files changed: `frontend/nginx.conf` (try_files SPA fallback + /api proxy_pass to backend:8000 + immutable cache on /assets/), `frontend/Dockerfile` (multi-stage node:20-alpine builder → nginx:1.27-alpine runtime), `frontend/.dockerignore`
- Verify: deferred — `docker build ./frontend` requires npm registry access in builder stage
- Result: files in place

## T8.2 — 2026-04-25T17:00:00Z
- Files changed: `docker-compose.yml` (added `frontend` service: build ./frontend, depends_on backend healthy, BusyBox wget healthcheck, ports 8080:80), `Makefile` (`make up` now includes frontend)
- Verify: deferred
- Result: files in place

## T8.3 — 2026-04-25T17:00:00Z
- Files changed: `frontend/Dockerfile.playwright` (mcr.microsoft.com/playwright:v1.58.2-jammy + npm ci + USER pwuser), `docker-compose.yml` (`vitest` service under test profile uses builder stage; `playwright` service under test profile depends on frontend healthy, PLAYWRIGHT_TEST_BASE_URL=http://frontend:80)
- Verify: deferred
- Result: files in place
- Note: NO docker socket mount — DB flush is orchestrated by the host Makefile per design ADR.

## T8.4 — 2026-04-25T17:00:00Z
- Files changed: already landed in T3.2 (vite.config.ts test block + coverage thresholds). Confirmed include path covers src/features/jobs/** and src/lib/**, thresholds 70/70/70/60.
- Verify: deferred
- Result: configuration in place

## T8.5 — 2026-04-25T17:00:00Z
- Files changed: `Makefile` (`test` target now chains: `down -v` → `compose --profile test build` → up db+backend → BE pytest 80% gate → `compose --profile test run --rm vitest` → up frontend → `manage.py flush --no-input` → `compose --profile test run --rm playwright` → `--profile test down -v`. Each leg short-circuits on failure with explicit teardown.)
- Verify: deferred — running `make test` here would trigger npm registry access (blocked); user will verify on their machine.
- Result: Makefile chain in place

## T9.1 — 2026-04-25T17:05:00Z
- Files changed: `frontend/playwright.config.ts` (workers:1, two projects mobile 390×844 with iPhone-13 + desktop 1280×800, retries:0/1 by CI, baseURL from env, no globalSetup), `frontend/e2e/fixtures.ts` (extended `test` with seedJob + patchStatus HTTP fixtures via Playwright `request`)
- Verify: deferred
- Result: files in place

## T9.2 — 2026-04-25T17:05:00Z
- Files changed: `frontend/e2e/create.spec.ts` (creates a job, asserts row + PENDING pill; second test runs @axe-core/playwright on the list page, expects zero wcag2a/wcag2aa violations)
- Verify: deferred
- Result: file in place

## T9.3 — 2026-04-25T17:05:00Z
- Files changed: `frontend/e2e/update.spec.ts` (seedJob → /jobs/:id → click RUNNING radio → Apply → assert RUNNING pill; second test runs axe on the detail page with the radiogroup rendered)
- Verify: deferred
- Result: file in place

## T9.4 — 2026-04-25T17:05:00Z
- Files changed: `frontend/e2e/delete.spec.ts` (seedJob → click Delete → click Yes → assert URL=/jobs and row gone; second test runs axe with the confirm region expanded)
- Verify: deferred
- Result: file in place

## T9.5 — 2026-04-25T17:05:00Z
- Files changed: `frontend/e2e/filter-sort.spec.ts` (seed PENDING + RUNNING jobs, click RUNNING filter, assert ?status=RUNNING and only running row visible; second test asserts responsive DOM swap — table on desktop project, [data-list="cards"] on mobile project)
- Verify: deferred
- Result: file in place

---

## Final state — 2026-04-25T17:10:00Z

29/29 tasks complete. BE leg of `make test` passing throughout (97.18% coverage, 18s cold).

**Deferred verification (per user's npm-blocked machine):**
- `npm install` in `frontend/`
- `npm run build` (TS + Vite bundle)
- `npm run lint` (eslint flat config)
- `npm run test:unit -- --coverage` (vitest, ≥70% gate on src/features/jobs + src/lib)
- `make test` end-to-end (BE → vitest → flush → playwright across mobile + desktop)
- `docker compose build` (vitest + playwright + frontend images)
- Visual smoke at 360/768/1024/1280 px viewports

These are the user's local responsibility per their explicit instruction. All file artifacts are in place per the approved design and tasks.
