---
status: approved
feature: frontend
verify: make test
---

# Tasks: Frontend SPA

Phases derive from the design doc's structure. Each task produces a runnable + testable increment; ordering puts risk-bearing pieces first (Tailwind v4 wiring, typed API seam, merged hooks module) so dependent UI tasks build on a verified base.

The verify command is `make test` from project root. Until the test legs (FE Vitest + Playwright) are wired into the chain (T8.x), `make test` runs only the existing BE pytest leg — that's the right baseline. Each pre-T8 task should additionally be verified locally via `npm run test:unit` (Vitest) or by-eye in `npm run dev`. Tasks call out the local verify when it differs.

## Traceability

| Req | Tasks | Notes |
| --- | --- | --- |
| FR-001 (two routes) | T2.1, T2.2 | router skeleton + page shells |
| FR-002 (relative /api) | T3.1, T8.1 | api-client uses relative; Vite proxy + nginx proxy |
| FR-003 (URL state for filter+cursor) | T6.4, T6.5 | FilterPills + Pagination read/write `useSearchParams` |
| FR-004 (TanStack Query keyed lists; mutations invalidate) | T4.1, T4.2 | merged jobs.hooks.ts |
| FR-005 (cursor extraction from `next` URL) | T3.3 | lib/cursor.ts + tests |
| FR-006 (CreateJobForm validation + 400 path) | T6.3 | + .test.tsx |
| FR-007 (PATCH mutation invalidates detail) | T4.2, T7.3 | hooks + StatusUpdateControl |
| FR-008 (DELETE mutation + navigate) | T4.2, T7.5 | hooks + DeleteConfirmation |
| FR-009 (StatusPill component) | T5.1 | + .test.tsx |
| FR-010 (ErrorBanner reuses Panel + envelope shape) | T5.2 | role="alert", optional onRetry |
| FR-011 (LoadingLine) | T5.2 | role="status" aria-live="polite" |
| FR-012 (logo h-10 list / h-8 detail; favicons) | T1.4, T6.1, T7.1 | inline lockups in pages |
| FR-013 (typed API client; ApiError; no any) | T3.1 | core seam |
| FR-014 (co-located unit tests; coverage gate) | T3.2, T3.3, T4.3, T5.1, T6.3, T8.4 | per-target tests + Vitest config |
| FR-015 (per-flow Playwright specs; workers:1; Makefile flush) | T9.1..T9.4, T8.5 | flush orchestrated by Make, not globalSetup |
| FR-016 (multi-stage Dockerfile; nginx.conf) | T8.2 | builder → nginx |
| FR-017 (compose: frontend + vitest + playwright) | T8.3 | profile-gated test services |
| FR-018 (`make test` chains BE→FE→PW) | T8.5 | orchestration with flush step |
| FR-019 (back link via Link) | T7.1 | detail page top bar |
| FR-020 (in-tree relative-time util, no date lib) | T4.1 | inlined into jobs.hooks.ts |
| FR-021 (focus rings; status glyphs not color-alone) | T5.1, T5.2, manual | primitives expose focus class |
| FR-022 (axe-core smoke on multiple specs) | T9.1, T9.2, T9.3 | create + update + delete |
| FR-023 (responsive: card list <768; touch targets) | T6.6, T7.6 | table↔card swap + detail stack |
| NFR-001 (a11y: focus, glyph, alt, contrast ≥AA) | T5.1, T5.2, T7.3, T7.5, manual contrast check | |
| NFR-002 (TS strict, no any) | T1.2 | tsconfig.json + lint |
| NFR-003 (perf: <250 KB gz; no virtualization) | T8.4, manual | bundle size measured at build |
| NFR-004 (visual conformance to tokens) | T1.3, T5.x, manual | CSS-first @theme |
| NFR-005 (UI never crashes; banner fallback) | T2.3, T3.1, T5.2 | RootErrorBoundary + ApiError + ErrorBanner |
| NFR-006 (Vitest coverage ≥70% on src/features/jobs + src/lib) | T8.4 | thresholds in vite.config |
| NFR-007 (relative /api; proxy in dev + nginx in prod) | T1.5, T8.1 | vite.config.ts proxy + nginx.conf |
| NFR-008 (`make test` cold; <4 min; flush via host exec) | T8.5, T9.5 | host-orchestrated flush, two-viewport matrix |
| NFR-009 (`npm run build` 0 warnings) | T1.2, T8.2 | `tsc --noEmit && vite build` script |
| NFR-010 (brand fidelity) | T1.3, T1.4 | sampled tokens + cloud-mark favicon |
| NFR-011 (responsive across 360/768/1024/1280) | T6.6, T7.6, T9.5 | per-surface rules + 2-viewport PW matrix |
| US-001..US-009, US-010 | covered by FR mapping above | — |

No uncovered requirements.

---

## Phase 1 — Project scaffolding & brand language

Goal: an empty Vite SPA that already looks correct — fonts, brand colors, paper-grid, favicon. Anything we render from this point forward inherits the right visual language.

### T1.1 Initialize Vite React-TS project under `frontend/`

- Reqs: NFR-002, NFR-009
- Design: §Project Layout
- Description: `npm create vite@latest frontend -- --template react-ts` then trim to the design's tree skeleton (`src/main.tsx`, `src/index.css`, `index.html`). Pin exact versions in `package.json` (no `^`) for the dependencies in §Dependencies.
- Effort: S — scaffolding command + version pins.
- Depends on: none
- Can parallelize with: T1.2
- Acceptance: `npm install` exits 0; `npm run dev` serves `http://localhost:5173/` with the default Vite page; `package.json` versions are pinned.
- Test type: manual
- [x]

### T1.2 Lock TypeScript strict + build hygiene

- Reqs: NFR-002, NFR-009
- Design: §Build & Deployment "Build-warning hygiene"
- Description: `tsconfig.json` with `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`. Replace `package.json` `build` script with `tsc --noEmit && vite build`. Add ESLint flat config + Prettier.
- Effort: S
- Depends on: T1.1
- Can parallelize with: T1.3, T1.4
- Acceptance: `npm run build` exits 0 with no warnings; `npx tsc --noEmit` clean; intentionally adding `let x: any = 1;` makes lint fail.
- Test type: manual
- [x]

### T1.3 Tailwind v4 CSS-first config + paper-grid

- Reqs: NFR-004, NFR-010
- Design: §Styling
- Description: install `tailwindcss@4` + `@tailwindcss/vite`; register the plugin in `vite.config.ts`; in `src/index.css` write `@import "tailwindcss";` then the `@theme` block with `--color-rescale-{ink,blue,blue-soft,blue-strong}` and `--font-{display,sans,mono}`; add the `.paper-grid` utility class. **No `tailwind.config.ts`** — v4 idiom is CSS-first.
- Effort: S
- Depends on: T1.1
- Can parallelize with: T1.2, T1.4
- Acceptance: a div with `className="bg-rescale-blue text-rescale-ink font-display"` renders the sampled blue background, brand ink text, and Fraunces face in `npm run dev`.
- Test type: manual
- [x]

### T1.4 Wire brand assets in `index.html`

- Reqs: FR-012, NFR-010, US-009
- Design: §`index.html`
- Description: set `<title>Job Management Dashboard · Rescale</title>`, the three favicon `<link>`s, the Google Fonts link (Fraunces + IBM Plex Sans + IBM Plex Mono in one stylesheet), and the viewport meta. Apply the `paper-grid` class + `font-sans bg-stone-50 text-rescale-ink` to `<body>`.
- Effort: S
- Depends on: T1.1, T1.3
- Can parallelize with: T1.2
- Acceptance: a fresh tab on `npm run dev` shows the cloud-mark favicon, the document title, the paper-grid background, and Plex Sans body text. `<meta name="viewport">` present.
- Test type: manual
- [x]

### T1.5 Vite dev proxy for `/api`

- Reqs: FR-002, NFR-007
- Design: §`vite.config.ts`
- Description: in `vite.config.ts`, set `server.proxy['/api']` to `process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'` with `changeOrigin: true`.
- Effort: S
- Depends on: T1.1
- Can parallelize with: T1.2, T1.3, T1.4
- Acceptance: with the backend running on `:8000`, `curl http://localhost:5173/api/health/` returns the BE health JSON.
- Test type: manual
- [x]

## Phase 2 — Routing shell + error boundary

Goal: a working router skeleton with stub pages and a real error boundary so the app never white-screens. Lays the spine the data layer can plug into.

### T2.1 Mount RouterProvider + QueryClientProvider in `main.tsx`

- Reqs: FR-001, NFR-005
- Design: §Routing, §Data Layer "QueryClient defaults"
- Description: write `src/lib/query-client.ts` exporting a `QueryClient` instance with the design's defaults (`staleTime: 30_000`, `gcTime: 5*60_000`, `refetchOnWindowFocus: false`, `retry: (n, err) => err instanceof ApiError && err.status >= 500 && n < 2`, `mutations: { retry: 0 }`). Wire `<RouterProvider>` and `<QueryClientProvider>` in `main.tsx`. **`ApiError` import will be unresolved until T3.1** — leave the import in place; T3.1 satisfies it.
- Effort: S
- Depends on: T1.4
- Can parallelize with: none
- Acceptance: `npm run dev` boots without console errors after T3.1 lands; before T3.1, `npx tsc --noEmit` is the verify gate.
- Test type: manual
- [x]

### T2.2 `router.tsx` with index redirect, list, detail, NotFound

- Reqs: FR-001
- Design: §Routing
- Description: `createBrowserRouter` with one root layout route carrying the `errorElement`, children: `{ index: true, loader: () => redirect('/jobs') }`, `/jobs` → `<JobsListPage />` stub, `/jobs/:id` → `<JobDetailPage />` stub, `*` → `<NotFoundPage />`. Stubs render a plain `Panel` with the route name. Imports per design: `createBrowserRouter` from `'react-router'`, `RouterProvider` from `'react-router/dom'`.
- Effort: S
- Depends on: T2.1
- Can parallelize with: none
- Acceptance: `/` 302→`/jobs` (stub renders); `/jobs/42` renders detail stub; `/anything-else` renders the NotFound stub; browser back/forward works.
- Test type: manual
- [x]

### T2.3 `RootErrorBoundary` wired as router `errorElement`

- Reqs: NFR-005
- Design: §Components `RootErrorBoundary`
- Description: write `src/components/RootErrorBoundary.tsx` that uses `useRouteError()` and renders a stone-bordered Panel with "Something went wrong" + a `<Link to="/jobs">Back to list</Link>`. Wire as the root `errorElement`.
- Effort: S
- Depends on: T2.2
- Can parallelize with: none
- Acceptance: temporarily throw inside the list-page stub render — the boundary's panel renders instead of a white screen; remove the throw before finishing.
- Test type: manual
- [x]

## Phase 3 — Typed API seam

Goal: the typed boundary that prevents `any` from leaking into feature code. Every later hook flows through this.

### T3.1 `lib/api-client.ts` with `ApiError` and `apiGet/Post/Patch/Delete<T>`

- Reqs: FR-013, NFR-002, NFR-005
- Design: §Data Layer "Typed API client"
- Description: implement the four typed wrappers and `ApiError` per design. Rules: 204 resolves `undefined as T`; 2xx parses JSON; non-2xx parses the envelope and raises `new ApiError(status, detail, errors)`; envelope-parse failure raises generic `ApiError(status, 'Something went wrong')`; `fetch` reject raises `ApiError(0, 'Network error')`. Add `src/features/jobs/jobs.types.ts` mirroring backend Pydantic shapes (`Job`, `JobStatus`, `StatusType`, `CursorPage<T>`, `ApiErrorBody`).
- Effort: M — small surface but the error-mapping branches need care.
- Depends on: T2.1
- Can parallelize with: T3.3
- Acceptance: `getQueryClient` no longer fails to import `ApiError`. Manual: a temporary `apiGet('/api/jobs/')` from a stub page logs an array of jobs.
- Test type: unit (covered by T3.2)
- [x]

### T3.2 Vitest setup + `api-client.test.ts`

- Reqs: FR-014, NFR-006
- Design: §Testing Strategy "Unit tests"
- Description: install `vitest@4`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`. Configure Vitest in `vite.config.ts` with `environment: 'happy-dom'`, `setupFiles: ['./src/setup.ts']`. Write `src/setup.ts` importing `'@testing-library/jest-dom/vitest'`. Write `src/test-utils/render.tsx::renderWithProviders` (QueryClient + MemoryRouter). Write `src/test-utils/mockFetch.ts` shared helper. Add `src/lib/api-client.test.ts` covering: 200 envelope parsing, 204 returning undefined, 400 with `errors[]`, 404 envelope, 500 generic, non-JSON body, fetch reject.
- Effort: M
- Depends on: T3.1
- Can parallelize with: T3.3
- Acceptance: `npx vitest run src/lib/api-client.test.ts` green; suite covers all 7 paths.
- Test type: unit
- [x]

### T3.3 `lib/cursor.ts::parseCursorFromNextUrl` + tests

- Reqs: FR-005
- Design: §Data Layer "Cursor helper"
- Description: implement the helper. Tests: `null` → `null`; full host URL with cursor → cursor; URL without cursor → `null`; malformed string → `null`; **internal-host case** `'http://backend:8000/api/jobs/?cursor=abc'` → `'abc'`.
- Effort: S
- Depends on: T2.1
- Can parallelize with: T3.1, T3.2
- Acceptance: `npx vitest run src/lib/cursor.test.ts` green; 5 cases.
- Test type: unit
- [x]

## Phase 4 — Data hooks (merged module)

Goal: every consumer touches one module — `jobs.hooks.ts` — for endpoint fns, hooks, key factory, and `qs`. Keeps the seam thin.

### T4.1 `jobs.hooks.ts` — endpoint fns, `qs` helper, `keys` factory, `relativeTime`

- Reqs: FR-004, FR-020
- Design: §Data Layer "Endpoint functions" + "Hooks and key conventions"
- Description: implement `qs` (skipping `undefined`/`null`/`''`), the six endpoint functions over `apiGet/Post/Patch/Delete`, the `keys` factory (`all`, `list`, `detail`, `history`), and a small `relativeTime(iso: string): string` using `Intl.RelativeTimeFormat`. No hook implementations yet — this task isolates the data layer's pure pieces for easier testing.
- Effort: M
- Depends on: T3.1
- Can parallelize with: none
- Acceptance: `npx tsc --noEmit` clean; importing `keys.list({status:'RUNNING'})` returns `['jobs','list',{status:'RUNNING'}]`; `qs({status:undefined, cursor:'abc'})` returns `'?cursor=abc'`.
- Test type: unit (covered by T4.3)
- [x]

### T4.2 `jobs.hooks.ts` — `useJobs`, `useJob`, `useStatuses`, `useCreateJob`, `useUpdateStatus`, `useDeleteJob`

- Reqs: FR-004, FR-007, FR-008
- Design: §Data Layer "Hooks and key conventions" (table)
- Description: implement six hooks per the design's table. `useJobs` and `useStatuses` use `placeholderData: (prev) => prev`. `useJob(id)` sets `enabled: Number.isFinite(id)`. `useCreateJob.onSuccess` invalidates `['jobs']`. `useUpdateStatus(id).onSuccess(updated)` calls `queryClient.setQueryData(keys.detail(id), updated)` then invalidates `keys.list` (prefix) + `keys.history(id)` precisely — **not** the umbrella. `useDeleteJob.onSuccess` invalidates `['jobs']`.
- Effort: M
- Depends on: T4.1
- Can parallelize with: none
- Acceptance: `npx tsc --noEmit` clean. Smoke: a stub page calling `useJobs({})` renders BE data when `npm run dev` is up.
- Test type: unit (covered by T4.3)
- [x]

### T4.3 `jobs.hooks.test.ts`

- Reqs: FR-014, NFR-006
- Design: §Testing Strategy "Targets"
- Description: write the hook test suite using `mockFetch` and `renderHook`. Cases: `useJobs` calls `fetchJobs` with `?status=RUNNING&cursor=abc`; key stable across re-renders with same args; `placeholderData` returns previous on cursor change; `useCreateJob.onSuccess` invalidates `['jobs']`; `useUpdateStatus.onSuccess` writes detail cache (`getQueryData` returns the patched job) and invalidates list + history precisely (not umbrella — assert detail query is NOT marked stale).
- Effort: L — five non-trivial cases.
- Depends on: T4.2
- Can parallelize with: none
- Acceptance: `npx vitest run src/features/jobs/jobs.hooks.test.ts` green; coverage on `jobs.hooks.ts` ≥ 70%.
- Test type: unit
- [x]

## Phase 5 — Shared primitives

Goal: the small library of components every page reuses. Each is testable in isolation; `StatusPill` gets a unit test because its rendering is pure logic.

### T5.1 `StatusPill` + test

- Reqs: FR-009, NFR-001, NFR-004
- Design: §Components, §tokens.md status table
- Description: write `src/components/StatusPill.tsx` accepting `{ state: StatusType; size?: 'sm'|'md' }`. Inline 10×10 SVG glyph per state (open circle, triangle, filled circle, cross). Color classes are inline literals (`bg-emerald-100 text-emerald-800 border-emerald-300` etc) so Tailwind JIT picks them up. Accessible name = state. Test: each of the four states renders the right glyph + label + accessible name.
- Effort: S
- Depends on: T1.3
- Can parallelize with: T5.2, T5.3
- Acceptance: `npx vitest run src/components/StatusPill.test.tsx` green; visually matches the preview HTML.
- Test type: unit
- [x]

### T5.2 `Panel`, `Button`, `Input`, `ErrorBanner`, `LoadingLine`

- Reqs: FR-010, FR-011, FR-021, NFR-001, NFR-005
- Design: §Components
- Description: implement these primitives per the design. `Button` exposes `loading?: boolean` (sets `disabled` + `aria-busy="true"` and renders an inline mono `…`) and three variants. `Input` flips to error variant on `aria-invalid="true"` + `aria-describedby`. `ErrorBanner` takes `{ error: ApiError | null; onRetry?: () => void }`, renders `null` when no error, else a red-tinted Panel-styled banner with `role="alert"`. `LoadingLine` is `<div role="status" aria-live="polite" className="text-stone-500 font-mono text-sm">Loading…</div>`. No tests at this scope — covered indirectly via Playwright + `CreateJobForm` test.
- Effort: M
- Depends on: T1.3
- Can parallelize with: T5.1, T5.3
- Acceptance: `npx tsc --noEmit` clean; visual check: build a throwaway storybook-style page route and confirm each variant renders.
- Test type: manual
- [x]

### T5.3 `FilterPill`, `Pagination`

- Reqs: FR-003, FR-021, NFR-001
- Design: §Components, US-004 AC
- Description: `FilterPill` is a toggle button with active/idle states matching tokens. `Pagination` takes `{ hasPrev, hasNext, onPrev, onNext, caption? }` and renders two ghost buttons + mono caption; disabled buttons set `aria-disabled="true"`, `tabIndex={-1}`, and the `onClick` short-circuits when disabled (defense in depth).
- Effort: S
- Depends on: T1.3
- Can parallelize with: T5.1, T5.2
- Acceptance: visual check matches preview; clicking a disabled `Pagination` button does not invoke its handler.
- Test type: manual
- [x]

## Phase 6 — List page (desktop table → mobile cards)

Goal: `/jobs` working end-to-end at desktop first, then the responsive card-list swap. Every list-page user story (US-001..US-004, US-009 list lockup) is reachable.

### T6.1 `JobsListPage` shell with brand header lockup

- Reqs: FR-012, US-001, US-009
- Design: §Components `JobsListPage`, §Responsive Design Brand header row
- Description: replace the stub. Render the inline lockup: `<img src="/rescale-logo.png" alt="Rescale" className="h-10">` left of a 1px rule; "OPS · INTERNAL" label + version on the right (label hidden below `md`). Page title "Job Management Dashboard" in `font-display`. Below: a wrapper `<main>` with `max-w-[1100px] mx-auto px-4 md:px-8 w-full` ready to host the panel.
- Effort: S
- Depends on: T2.2, T1.4
- Can parallelize with: T6.2
- Acceptance: `/jobs` renders the locked header; logo at `h-10`; resize to <640 → label hides; logo stays visible.
- Test type: manual
- [x]

### T6.2 `JobList` desktop `<table>` consuming `useJobs`

- Reqs: FR-004, FR-009, FR-011, US-001
- Design: §Components `JobList`, §Responsive table row (≥768)
- Description: render `<table>` with columns: name (Link to `/jobs/:id`), `StatusPill`, mono ID, `relativeTime(created_at)`. Use `useJobs({})`. States: `isLoading` → `LoadingLine`; `error` → `ErrorBanner` with `onRetry={refetch}`; empty → empty-state panel pointing at the form (no second render of the form).
- Effort: M
- Depends on: T4.2, T5.1, T5.2, T6.1
- Can parallelize with: T6.3, T6.4
- Acceptance: with backend up and seeded, `/jobs` shows the table; killing the backend mid-session shows the ErrorBanner with a working retry; flushing the DB shows the empty state.
- Test type: manual
- [x]

### T6.3 `CreateJobForm` + test

- Reqs: FR-006, US-002
- Design: §Components `CreateJobForm`
- Description: controlled `<Input>` + `<Button loading>` form. Validation: `name.trim().length > 0 && name.length <= 200`. `<input maxLength={200}>`. `useCreateJob` mutation. On 400 with `errors[]`, find the first error whose `loc` contains `'name'` and flip the input to error variant; otherwise show `ErrorBanner`. On success: clear input, refocus. Test cases: empty input disables submit; whitespace-only counts as empty; 400 with name-loc error flips variant; success clears + refocuses.
- Effort: M
- Depends on: T4.2, T5.2
- Can parallelize with: T6.2, T6.4
- Acceptance: `npx vitest run src/features/jobs/CreateJobForm.test.tsx` green; manual: typing → submit → row appears at top of list; submitting empty does nothing.
- Test type: unit
- [x]

### T6.4 `FilterPills` with URL state

- Reqs: FR-003, US-003
- Design: §Components `FilterPills`
- Description: `[All, PENDING, RUNNING, COMPLETED, FAILED]` as `FilterPill` toggles inside `<nav aria-label="Filter by status">`. Reads `?status=` via `useSearchParams`; on click, `setSearchParams` writes `status` and **removes `cursor`** (filter changes invalidate cursor). Selecting `All` removes both params.
- Effort: S
- Depends on: T5.3, T6.2
- Can parallelize with: T6.3, T6.5
- Acceptance: clicking `RUNNING` updates URL to `?status=RUNNING`, table refetches; clicking `All` clears the URL; filter persists across refresh.
- Test type: manual
- [x]

### T6.5 `Pagination` wired with cursor URL state

- Reqs: FR-005, US-004
- Design: §Components `Pagination`, §Routing URL state
- Description: in `JobsListPage`, read `cursor` from `useSearchParams`, pass to `useJobs`. Render `Pagination` below the table. `onNext` calls `setSearchParams(prev => { prev.set('cursor', parseCursorFromNextUrl(data.next)!); return prev; })`. `onPrev` similarly with `parseCursorFromNextUrl(data.previous)` (or removes the param if null). `hasNext = !!data.next`, `hasPrev = !!data.previous`.
- Effort: M
- Depends on: T3.3, T6.2, T5.3
- Can parallelize with: T6.4
- Acceptance: with a seeded BE (>20 jobs), Next moves to a new cursor in the URL and the table refetches; refresh restores the page; Previous works back; end-of-list disables Next.
- Test type: manual
- [x]

### T6.6 Responsive card list (<768)

- Reqs: FR-023, NFR-011, US-010
- Design: §Responsive Design "Job table" row
- Description: in `JobList`, render a parallel mobile tree behind `md:hidden`: a semantic `<ul data-list="cards">` of `<article>` cards, `<h3>` for name (link to detail), `<dl>` for status / ID / created_at. **No `role="table"`**. Desktop tree gets `hidden md:table`. Stack the create-form input + button below `md` (`flex-col gap-2 md:flex-row`). Pagination buttons full-width and stacked below `md`.
- Effort: M
- Depends on: T6.2, T6.3, T6.5
- Can parallelize with: T7.x (different surfaces)
- Acceptance: at 390 px width in DevTools, `/jobs` shows the card list with no horizontal scroll; touch targets ≥44 px; at ≥1024 px the desktop table renders.
- Test type: manual
- [x]

## Phase 7 — Detail page

Goal: `/jobs/:id` end-to-end. Reuses primitives from phase 5 and patterns from phase 6.

### T7.1 `JobDetailPage` top bar with back link + lockup

- Reqs: FR-012, FR-019, US-005, US-009
- Design: §Components `JobDetail` header
- Description: render `<Link to="/jobs">← Back to list</Link>` left, `<img src="/rescale-logo.png" className="h-8 opacity-90" alt="Rescale">` right. Page wrapper same `max-w-[1100px]` column.
- Effort: S
- Depends on: T2.2
- Can parallelize with: none
- Acceptance: `/jobs/1` renders the top bar; back link returns to list without page reload.
- Test type: manual
- [x]

### T7.2 `JobDetail` header + 404 path

- Reqs: NFR-005, US-005
- Design: §Components `JobDetail`
- Description: `useParams<{ id: string }>()`, parse to `Number(id)`. If `Number.isNaN(id)` or `useJob(id).error?.status === 404`, render not-found Panel with back link. Otherwise render the header: label "JOB" + mono ID, big display name, `StatusPill state={current_status}`, mono `created_at` / `updated_at`.
- Effort: M
- Depends on: T4.2, T5.1, T7.1
- Can parallelize with: T7.3, T7.5
- Acceptance: `/jobs/<id>` shows the header for a real job; `/jobs/9999999` (or `/jobs/abc`) shows the not-found panel with a back link.
- Test type: manual
- [x]

### T7.3 `StatusUpdateControl` (radiogroup + Apply)

- Reqs: FR-007, NFR-001, US-006
- Design: §Components `StatusUpdateControl`
- Description: `useState<StatusType | null>(selected)` with `useEffect(() => setSelected(null), [id])`. Wrap four `FilterPill`-styled options in `<div role="radiogroup" aria-labelledby="…">`; each option is `role="radio"` with `aria-checked`, **roving tabindex** (selected = 0, others = -1), arrow keys move selection, Space/Enter selects. `<Button loading={mut.isPending} disabled={!selected}>Apply update</Button>` below. On Apply, fires `useUpdateStatus(id).mutate(selected)`. On success, reset `selected`. Errors → `ErrorBanner role="alert"` at top.
- Effort: L — ARIA radiogroup + roving tabindex is the most complex a11y surface.
- Depends on: T4.2, T5.2, T5.3, T7.2
- Can parallelize with: T7.4, T7.5
- Acceptance: keyboard: Tab focuses the group; arrows move selection; Space selects; Tab moves to Apply. Click + Apply → header pill updates; new history entry appears (T7.4 prerequisite for the latter).
- Test type: manual
- [x]

### T7.4 `StatusHistory` timeline

- Reqs: FR-005, US-007
- Design: §Components `StatusHistory`
- Description: consume `useStatuses(id, cursor)` with **component-state cursor** (not URL). Render the vertical 1px stone rail with 19 px round wells per token, each hosting the `StatusPill`'s glyph + a precise UTC timestamp. Pagination via the shared `Pagination`.
- Effort: M
- Depends on: T4.2, T5.1, T5.3, T7.2
- Can parallelize with: T7.3, T7.5
- Acceptance: detail page shows newest-first history; >20 entries paginate via Next.
- Test type: manual
- [x]

### T7.5 `DeleteConfirmation` (disclosure)

- Reqs: FR-008, NFR-001, US-008
- Design: §Components `DeleteConfirmation`
- Description: collapsed: `<Button variant="danger">Delete job</Button>` with `aria-expanded="false"` + `aria-controls`. Expanded: panel with confirm copy, `<Button variant="ghost">Cancel</Button>` + `<Button variant="danger" loading={mut.isPending}>Yes, delete</Button>`. On expand, focus moves to Cancel. Escape collapses + returns focus to trigger. On confirm: `mut.mutate(id, { onSuccess: () => navigate('/jobs') })`. Errors render `ErrorBanner` inside the panel; stay on detail page.
- Effort: M
- Depends on: T4.2, T5.2, T7.2
- Can parallelize with: T7.3, T7.4
- Acceptance: keyboard: open with Enter → focus on Cancel → Escape collapses + refocuses trigger. Click Yes → 204 → navigate to `/jobs`; deleted row gone. Backend down → ErrorBanner inside panel; stays on detail.
- Test type: manual
- [x]

### T7.6 Detail page responsive stack (<768)

- Reqs: FR-023, NFR-011, US-010
- Design: §Responsive Design "Detail header" + "StatusUpdateControl" + "DeleteConfirmation" rows
- Description: at <768: top bar wraps (back link row 1, name row 2, pill+timestamps stack). `StatusUpdateControl` becomes a 2-column grid of options (`grid-cols-2 md:grid-cols-4`); Apply button full-width on mobile. `DeleteConfirmation` Cancel/Yes buttons full-width and stacked.
- Effort: S
- Depends on: T7.3, T7.4, T7.5
- Can parallelize with: none
- Acceptance: at 390 px width, all detail-page surfaces stack cleanly with no horizontal scroll; all interactive elements ≥44 px.
- Test type: manual
- [x]

## Phase 8 — Build & deployment plumbing

Goal: the FE container builds and runs in compose; the test legs exist as compose services; `make test` chains BE → Vitest → Playwright with the host-orchestrated DB flush.

### T8.1 `nginx.conf` + multi-stage `Dockerfile`

- Reqs: FR-002, FR-016, NFR-007, NFR-009
- Design: §Build & Deployment "Multi-stage Dockerfile" + "nginx.conf"
- Description: write `frontend/nginx.conf` with `try_files $uri /index.html` and `location /api/ { proxy_pass http://backend:8000; … }`. Write `frontend/Dockerfile`: `node:20-alpine` builder running `npm ci && npm run build`, then `nginx:1.27-alpine` runtime copying `dist/` and `nginx.conf`. `EXPOSE 80`.
- Effort: M
- Depends on: T6.x complete
- Can parallelize with: T8.4
- Acceptance: `docker build -t fe-test ./frontend` exits 0; `docker run --rm -p 8080:80 fe-test` serves the SPA at `http://localhost:8080/` with the SPA fallback (refresh on `/jobs/1` doesn't 404). API calls fail (no backend) — that's expected at this isolated step.
- Test type: manual
- [x]

### T8.2 `frontend` service in `docker-compose.yml`

- Reqs: FR-017, NFR-007, NFR-008
- Design: §Build & Deployment "docker-compose.yml additions"
- Description: add `frontend` service per design (build from `./frontend`, depends on `backend` healthy, BusyBox `wget` healthcheck, port `8080:80`). Update `make up` to bring `frontend` up alongside `db` + `backend`.
- Effort: S
- Depends on: T8.1
- Can parallelize with: T8.3
- Acceptance: `make up` brings the full stack up; `http://localhost:8080/` shows the list page; `http://localhost:8080/api/health/` proxies to BE health.
- Test type: manual
- [x]

### T8.3 `Dockerfile.playwright` + `vitest`/`playwright` services under `test` profile

- Reqs: FR-017, FR-015, NFR-008
- Design: §Build & Deployment "Dockerfile.playwright" + compose additions
- Description: `frontend/Dockerfile.playwright` based on `mcr.microsoft.com/playwright:v1.58.2-jammy`; `npm ci` + `COPY .` then `USER pwuser`; `CMD ["npx","playwright","test"]`. Add `vitest` service (uses `frontend` builder stage, runs `npm run test:unit -- --coverage`, `CI=true`) and `playwright` service (uses `Dockerfile.playwright`, depends on `frontend` healthy, `PLAYWRIGHT_TEST_BASE_URL=http://frontend:80`) — both under `profiles: ["test"]`. **No Docker socket mount.**
- Effort: M
- Depends on: T8.2
- Can parallelize with: T8.4
- Acceptance: `docker compose --profile test build vitest playwright` exits 0; `docker compose --profile test run --rm vitest` runs (will fail until tests exist — that's fine).
- Test type: manual
- [x]

### T8.4 Vitest config + coverage thresholds

- Reqs: FR-014, NFR-006
- Design: §Build & Deployment `vite.config.ts`
- Description: extend `vite.config.ts` `test` block with `coverage: { include: ['src/features/jobs/**','src/lib/**'], thresholds: { lines:70, statements:70, functions:70, branches:60 }, reporter: ['text','html'] }`. Add `"test:unit": "vitest run"` script.
- Effort: S
- Depends on: T3.2
- Can parallelize with: T8.1, T8.3
- Acceptance: `npm run test:unit -- --coverage` exits 0 and prints a coverage report; deleting a test temporarily makes the gate fail.
- Test type: unit
- [x]

### T8.5 Update `make test` to chain BE → Vitest → flush → Playwright

- Reqs: FR-018, NFR-008
- Design: §Build & Deployment "Makefile updates"
- Description: extend `Makefile`'s `test` target per design: build, bring up `db backend`, run BE pytest, run vitest service, bring up `frontend`, run `manage.py flush --no-input` via `docker compose exec`, run playwright service, `compose --profile test down -v`. Verify cold from a fresh clone exits 0.
- Effort: M
- Depends on: T8.3, T8.4, all of phase 9 (specs must exist)
- Can parallelize with: none
- Acceptance: `make clean && make test` exits 0 in <4 min on a developer laptop; intentionally breaking a Playwright assertion exits non-zero and `make` fails fast.
- Test type: e2e
- [x]

## Phase 9 — Playwright E2E

Goal: per-flow specs at two viewports lock in the contract end-to-end. axe-core smokes catch regressions on the highest-risk a11y surfaces.

### T9.1 `playwright.config.ts` + `e2e/fixtures.ts`

- Reqs: FR-015, NFR-008, NFR-011
- Design: §Testing Strategy "E2E (Playwright)"
- Description: `playwright.config.ts`: `workers: 1`, `baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL`, two chromium projects (`mobile` 390×844 with `devices['iPhone 13']`, `desktop` 1280×800), `retries: 0` locally and `retries: 1` in CI. **No `globalSetup`** (host Makefile flushes). `e2e/fixtures.ts`: extend `test` with `seedJob({ name }) => Promise<Job>` using the Playwright `request` fixture (HTTP-only seed; no FE flow).
- Effort: M
- Depends on: T8.3
- Can parallelize with: none
- Acceptance: `npx playwright test --list` prints the project matrix.
- Test type: e2e
- [x]

### T9.2 `create.spec.ts` + axe smoke

- Reqs: FR-015, FR-022, US-002, NFR-001, NFR-011
- Design: §Testing Strategy "Per-flow specs"
- Description: navigate to `/jobs`, type "Test job", submit, assert a row with that name + PENDING pill appears at the top. Assert no horizontal scroll. Run `@axe-core/playwright`'s `analyze()` on the page; expect zero violations of `wcag2a` + `wcag2aa` rules.
- Effort: M
- Depends on: T9.1, T6.x
- Can parallelize with: T9.3, T9.4
- Acceptance: `npx playwright test create.spec.ts` green at both projects.
- Test type: e2e
- [x]

### T9.3 `update.spec.ts` + axe smoke on detail

- Reqs: FR-015, FR-022, US-006, NFR-001, NFR-011
- Design: §Testing Strategy "Per-flow specs"
- Description: `seedJob` then navigate to `/jobs/:id`. Click `RUNNING` option, click Apply. Assert header pill = RUNNING; assert a new history row appears at the top with RUNNING. Run axe `analyze()` after the panel renders; expect zero violations (radiogroup is the highest-risk a11y surface).
- Effort: M
- Depends on: T9.1, T7.x
- Can parallelize with: T9.2, T9.4
- Acceptance: green at both projects.
- Test type: e2e
- [x]

### T9.4 `delete.spec.ts` + axe smoke on confirm panel

- Reqs: FR-015, FR-022, US-008, NFR-001, NFR-011
- Design: §Testing Strategy "Per-flow specs"
- Description: `seedJob`, navigate to `/jobs/:id`, click Delete, expand confirmation, click Yes. Assert URL is `/jobs` and the row is gone. Run axe `analyze()` while the panel is expanded (before click Yes); expect zero violations on the disclosure pattern.
- Effort: M
- Depends on: T9.1, T7.x
- Can parallelize with: T9.2, T9.3
- Acceptance: green at both projects.
- Test type: e2e
- [x]

### T9.5 `filter-sort.spec.ts` + responsive DOM swap assertion

- Reqs: FR-003, FR-023, US-003, US-010, NFR-011
- Design: §Testing Strategy "Per-flow specs"
- Description: seed two jobs; PATCH one to RUNNING via API. Navigate to `/jobs`, click `RUNNING` filter. Assert URL has `?status=RUNNING`; assert exactly one row visible. Then verify the responsive DOM swap: on the `desktop` project, `getByRole('table')` is visible; on the `mobile` project, `[data-list="cards"]` is visible.
- Effort: M
- Depends on: T9.1, T6.x
- Can parallelize with: T9.2, T9.3, T9.4
- Acceptance: green at both projects; the assertion that fails on the wrong-viewport DOM proves the swap.
- Test type: e2e
- [x]

---

When all tasks check off and `make test` from a fresh clone exits 0, set `status: approved` on this file and run `/spec:implement frontend`.
