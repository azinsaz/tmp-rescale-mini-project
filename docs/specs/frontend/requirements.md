---
status: approved
feature: frontend
---

# Requirements: Frontend SPA

## Problem Statement

The backend Jobs API is built and verified, but it has no consumer. Operators have no way to see, create, or manage jobs without crafting `curl` calls. They need a focused two-page interface that surfaces job state at a glance, lets them push jobs through the lifecycle without leaving the page, and stays usable as the dataset grows toward millions of rows. The interface must read as a Rescale internal product — the visual identity is part of the deliverable, not an afterthought.

## Stakeholders

| Role | Name / Team | Interest |
| --- | --- | --- |
| Take-home candidate | implementer | Ships a polished, evaluable submission |
| Rescale interview team | evaluators | Run `make test` cold, then click through the UI to gauge taste, code quality, and contract conformance |
| Backend stream (already shipped) | phase 2 | Owns the contract this UI consumes; design.md §5 is the source of truth |
| Operators (the in-fiction user) | hypothetical HPC engineers | Want to spend zero time fighting the UI |

## User Stories

### US-001 — Browse the job list

**As** an operator, **I want** to land on `/jobs` and see every job with its current status, **so that** I can survey the system at a glance.

- **Given** the API returns a populated page, **when** the page renders, **then** I see a table with name, current_status pill (with its geometric glyph), monospace ID, and a relative-time `created_at`. Newest first.
- **Given** the API returns an empty page, **when** the page renders, **then** I see the empty-state panel from the design with the create form prominent and a short explanatory line.
- **Given** the API returns a network/5xx failure, **when** the page renders, **then** I see an inline error banner reusing the Panel primitive and a retry affordance, not a blank screen or a thrown exception.
- **Given** the data is in flight, **when** the page is mid-fetch, **then** I see a calm "Loading…" muted-text indicator (no skeletons in v1).

### US-002 — Create a job

**As** an operator, **I want** to create a job by typing a name and submitting, **so that** I can register a new run quickly.

- **Given** the create form on the list page, **when** I type a non-empty name (≤200 chars) and submit, **then** the API responds 201, the new job appears at the top of the list immediately, and the form clears.
- **Given** an empty/whitespace-only name, **when** I submit, **then** the input shows the inline error state ("name cannot be empty") and the submit button is disabled until the input changes — no API call is made.
- **Given** the API returns 400, **when** the response arrives, **then** the field-level error from the envelope is rendered inline below the input (we don't show a generic toast).
- **Given** name length exceeds 200 chars, **when** I type, **then** the `maxlength` attribute prevents further input; submit is allowed at exactly 200.
- **Given** a successful create, **when** the row appears, **then** its status is PENDING and the `Location` header from the response is read but not navigated (the list is the right place for this).

### US-003 — Filter by status

**As** an operator, **I want** to filter the list by current status, **so that** I can find the subset I care about.

- **Given** the filter pill row, **when** I click `RUNNING`, **then** the list refetches with `?status=RUNNING` and only RUNNING rows render. The pill's selected state matches the design.
- **Given** I'm on a status filter, **when** I click `All`, **then** the filter clears and the unfiltered list returns.
- **Given** a filter and a cursor are both in URL state, **when** I switch filters, **then** the cursor resets (filter changes invalidate the cursor — they're a different "stream").
- **Given** a backend error during the filtered fetch, **when** the response arrives, **then** the inline error banner shows; the filter state is preserved so the user can retry without re-clicking the pill.

### US-004 — Paginate forward and back

**As** an operator, **I want** Next / Previous controls so I can move through pages, **so that** I can review jobs beyond the first 20.

- **Given** the API returns a `next` URL, **when** I click `Next →`, **then** the cursor query param is extracted from the `next` URL and the next page is loaded.
- **Given** I'm on a deeper page and the API returns a `previous` URL, **when** I click `← Previous`, **then** I move back to the prior page.
- **Given** there's no `next` (end of list), **when** the page renders, **then** the `Next →` button is visually disabled and not focusable as a "next" trigger.
- **Given** the URL has a `cursor` param on initial load, **when** the page mounts, **then** the corresponding page is fetched (cursor is reflected in URL state, not just component state).

### US-005 — Open a job's detail page

**As** an operator, **I want** to click a job's name to see its full record, **so that** I can manage it.

- **Given** any row, **when** I click its name, **then** I navigate to `/jobs/<id>` via React Router (no page reload).
- **Given** I navigate to `/jobs/<unknown_id>`, **when** the API returns 404, **then** the page shows a not-found panel with a back-to-list link.
- **Given** a deep link to `/jobs/<id>` from a fresh tab, **when** the app boots, **then** the detail page hydrates correctly without bouncing through the list.

### US-006 — Update a job's status

**As** an operator, **I want** to advance a job to a new status from its detail page, **so that** the dashboard reflects reality.

- **Given** the four status buttons on the detail panel, **when** I click `RUNNING` and click `Apply update`, **then** the API responds 200, the badge in the header updates, the action panel's selected state updates, and a new entry appears at the top of the history list.
- **Given** I click the currently-selected status and apply, **when** the API responds, **then** a new history entry is still appended (the backend always appends; the UI doesn't second-guess).
- **Given** the API returns 4xx/5xx, **when** the response arrives, **then** an inline error banner appears at the top of the action panel; the previous status badge is unchanged (no optimistic rollback needed since we render after success).

### US-007 — See a job's status history

**As** an operator, **I want** to read the chronological history of every status change for a job, **so that** I can debug or audit.

- **Given** any job, **when** I open its detail page, **then** I see the timeline panel with rows newest first, each row showing the status pill and a precise UTC timestamp.
- **Given** more than 20 history entries, **when** the page renders, **then** the older-page cursor controls work the same as the list page's pagination contract.
- **Given** zero history (theoretically impossible — POST always creates one), **when** the page renders, **then** the timeline shows a single PENDING entry. Defensive empty-state copy is not required.

### US-008 — Delete a job

**As** an operator, **I want** to delete a job with confirmation, **so that** I can clean up cancelled or test entries without accidents.

- **Given** the delete button on the detail page, **when** I click it, **then** an inline confirmation panel appears (matching the design) asking me to confirm.
- **Given** the confirmation panel, **when** I click `Yes, delete`, **then** the API responds 204, I navigate back to `/jobs`, and the deleted row is no longer present.
- **Given** the confirmation panel, **when** I click `Cancel`, **then** the panel collapses and no API call is made.
- **Given** the API returns 4xx/5xx during delete, **when** the response arrives, **then** an inline error banner appears in the confirmation panel and I stay on the detail page.

### US-009 — Recognize the product as Rescale's

**As** an evaluator, **I want** the brand identity to read as Rescale, **so that** the submission demonstrates attention to context, not generic boilerplate.

- **Given** the browser tab, **when** the page is loaded, **then** the favicon is the Rescale cloud-mark.
- **Given** the list page, **when** the page renders, **then** the Rescale lockup is in the top-left of the header at the size locked in `tokens.md`.
- **Given** the detail page, **when** the page renders, **then** the lockup is in the top bar paired with the back link.

### US-010 — Use the dashboard on mobile, tablet, and desktop

**As** an operator, **I want** the dashboard to render flawlessly on phones, tablets, and laptops/desktops, **so that** I can monitor and manage jobs from any device without zooming, horizontal scrolling, or fighting the layout.

- **Given** a phone-sized viewport (≤640 px wide), **when** I open `/jobs`, **then** the brand header, create form, filter pills, job list, and pagination are all fully visible and operable without horizontal scrolling. The job list renders as a stacked card list (one card per job), not a horizontally scrolling table.
- **Given** a phone-sized viewport, **when** I open `/jobs/:id`, **then** the back link, header, status update control, history timeline, and delete affordance all stack vertically and remain reachable. Touch targets are ≥ 44×44 px.
- **Given** a tablet viewport (640–1023 px), **when** I open either page, **then** the layout uses intermediate spacing — true table on the list page, inline form/filter row, and proportionally sized typography.
- **Given** a desktop viewport (≥1024 px), **when** I open either page, **then** the layout matches the locked design preview (`docs/design/preview.html`).
- **Given** any viewport between 360 px and 1440 px, **when** I rotate / resize, **then** there is no horizontal scroll on primary surfaces and no clipped controls.

## Functional Requirements

MoSCoW. Each FR maps to ≥1 US-ID.

### Must

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-001 | The app exposes two routes via React Router v7 `createBrowserRouter`: `/jobs` (default redirect from `/`) and `/jobs/:id`. | US-001, US-005 |
| FR-002 | All HTTP traffic uses **relative `/api`** paths. The Vite dev server proxies `/api` to the backend; nginx in the prod image proxies `/api/*` to `backend:8000`. | NFR-007 |
| FR-003 | The list page reads + writes `status` and `cursor` to the URL query string so reload + share-link both restore state. | US-003, US-004 |
| FR-004 | The list endpoint is consumed via TanStack Query `useQuery` keyed `['jobs', { status, cursor }]`. Mutations (create/update/delete) call `queryClient.invalidateQueries({ queryKey: ['jobs'] })` on success. | US-001..US-004, US-006, US-008 |
| FR-005 | The Next-page cursor is **extracted from the `next` URL** via `URLSearchParams` (the backend returns a full URL, not a bare token — see backend design §5 ADR-4 spike findings). | US-004, US-007 |
| FR-006 | Create form: typed `useMutation` with empty-string + max-200 client-side validation that mirrors backend NFR-006 hygiene; on 400, the field-level error from `errors[]` is rendered inline. | US-002 |
| FR-007 | Status update: typed `useMutation` for PATCH; on success the detail query is invalidated so the badge + history rerender. | US-006, US-007 |
| FR-008 | Delete: typed `useMutation` for DELETE behind the inline confirmation panel; on success navigate to `/jobs` and invalidate `['jobs']`. | US-008 |
| FR-009 | The `StatusPill` component takes `state: 'PENDING'\|'RUNNING'\|'COMPLETED'\|'FAILED'` and renders the locked geometric glyph + uppercase mono label per `tokens.md`. Used in tables, headers, history rows, and as the status-update toggle. | US-001, US-006, US-007 |
| FR-010 | Inline error banner component reuses the `Panel` primitive and renders the locked envelope shape (`detail` + optional `errors[]`). Network/parse failures show a generic message; never a thrown exception in the UI tree. | US-001, US-002, US-006, US-008 |
| FR-011 | Loading states: a single `<LoadingLine>` muted-text component (no skeletons). Used wherever `isLoading` is `true`. | US-001, US-005 |
| FR-012 | The Rescale logo (`/rescale-logo.png`) is rendered at `h-10` in the list-page header and `h-8 opacity-90` in the detail-page top bar. Favicons are wired in `frontend/index.html` per `tokens.md`. | US-009 |
| FR-013 | Typed API client: a single `lib/api-client.ts` exports `apiGet/apiPost/apiPatch/apiDelete<T>` that parse the locked envelope, raise typed `ApiError` on non-2xx, and never produce `any`. | NFR-002, NFR-005 |
| FR-014 | Co-located unit tests for `useJobs`/`useJob`/`useStatuses` hooks, the `StatusPill`, the `CreateJobForm`, and the cursor-extraction helper. Vitest + React Testing Library. Min coverage: 70% on `src/features/jobs/` and `src/lib/`. | NFR-006 |
| FR-015 | Per-flow Playwright specs at `frontend/e2e/`: `create.spec.ts`, `update.spec.ts`, `delete.spec.ts`, `filter-sort.spec.ts`. `playwright.config.ts` sets `workers: 1` and a `globalSetup` that resets the backend DB via `docker compose exec backend python manage.py flush --no-input`. | NFR-008 |
| FR-016 | Multi-stage Dockerfile: `node:20-alpine` builder running `npm ci && npm run build` → `nginx:1.27-alpine` runtime serving `/usr/share/nginx/html` plus a `location /api/ { proxy_pass http://backend:8000; }` block and SPA fallback (`try_files $uri /index.html`). | NFR-007 |
| FR-017 | Compose updates: a `frontend` service (built from `./frontend`) on port `8080`, plus a `vitest` service under the `test` profile that runs `npm run test:unit` from the builder stage, plus the `playwright` service under the `test` profile (Microsoft image, baseURL `http://frontend:80`). | NFR-008 |
| FR-018 | `make test` extended to chain BE pytest → FE Vitest → Playwright; fails on any non-zero exit; tears down volumes on success or failure. | NFR-008 |

### Should

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-019 | Detail page links to the list page from the back affordance via `Link to="/jobs"` (no full reload, preserves history). | US-005 |
| FR-020 | The relative-time formatter ("12 minutes ago", "yesterday") is a small in-tree util, not a date library, to keep the bundle slim. | NFR-002 |
| FR-021 | Accessibility: every interactive element has a visible focus state matching the locked focus-ring style; status pills include the geometric glyph so state is legible without color. | NFR-001 |
| FR-023 | Mobile-first responsive layout via Tailwind breakpoints. Below 768 px: the job list renders as a stacked card list (not a table), the create form and pagination stack vertically, and the status-update grid is 2-column. Touch targets ≥ 44×44 px on mobile. Verified across `mobile` (390 px), `tablet` (768 px), and `desktop` (1280 px) Playwright projects — every per-flow spec runs at every viewport. | US-010, NFR-011 |

### Could

| ID | Requirement | Stories |
| --- | --- | --- |
| FR-022 | One `@axe-core/playwright` smoke assertion in `create.spec.ts` (cheap a11y signal — open question 14 default). | NFR-001 |

### Won't (in this scope)

- Authentication / authorization
- Dark mode
- Loading skeletons (we use a muted "Loading…" line)
- Toast notifications (inline banners only)
- Name sort (backend doesn't expose; design tokens lock this out)
- Localization (English only)
- A WebSocket / SSE live-update layer (the spec doesn't ask for it; refresh + Next click is enough)

## Non-Functional Requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-001 | Accessibility | Focus rings on all interactive elements per `tokens.md`. Status pills carry a geometric glyph, never color alone. Logo `<img>` carries `alt="Rescale"`. Body color contrast ≥ AA on stone-50 background. |
| NFR-002 | Type safety | TS strict; **no `any`** in committed code (`tsconfig.json` enforces `strict: true`, `noImplicitAny: true`). The locked API contract types are mirrored in `features/jobs/jobs.types.ts` and consumed across the feature. |
| NFR-003 | Performance | First paint after `make up` lands the list page < 1 s on a developer laptop. Bundle size < 250 KB gzipped. Pagination is page-by-page (no virtualization library). |
| NFR-004 | Visual conformance | The implemented UI matches `docs/design/preview.html` and the tokens in `docs/design/tokens.md` — same color values, type scale, spacing, status glyphs, and logo placement. |
| NFR-005 | Error resilience | The UI tree never crashes on a backend failure. All network calls are wrapped, errors surface as inline banners with the envelope's `detail` field; unrecognized failures fall back to a generic "Something went wrong" banner. |
| NFR-006 | Testability | Vitest passes with coverage ≥ 70% on `src/features/jobs/` and `src/lib/`. `frontend/src/test-utils/render.tsx` exposes a `renderWithProviders` helper wrapping `QueryClient` + `MemoryRouter`. |
| NFR-007 | Routing & origin | Client always uses relative `/api` paths. Vite dev server proxies; nginx in compose proxies. No CORS layer needed in either env. |
| NFR-008 | Reliability of `make test` | Cold-clone `make test` chains BE pytest → FE Vitest → Playwright in order. Per-flow Playwright specs run with `workers: 1`. `globalSetup` flushes the backend DB so tests don't depend on order. Total runtime budget < 4 minutes from a fresh image build. |
| NFR-009 | Build hygiene | `npm run build` exits 0 with no warnings (no missing peer deps, no TypeScript errors). Vite's prod bundle hashes assets. nginx serves with `try_files` for SPA routing. |
| NFR-010 | Brand fidelity | Logo + favicon are the canonical Rescale assets at `frontend/public/`. The favicon is the cloud mark only (no wordmark). Brand ink and accent colors are the sampled values from the logo. |
| NFR-011 | Responsive design | The UI renders correctly and remains fully usable across mobile, tablet, and desktop viewports — verified at 360, 768, 1024, and 1280 px widths. No horizontal scroll on primary surfaces. Touch targets ≥ 44×44 px on mobile. The list-page job table collapses to a card list below 768 px. Playwright runs every per-flow spec across mobile / tablet / desktop projects. See `design.md` "Responsive Design" for the breakpoint matrix. |

## Constraints and Assumptions

- Stack locked by the master plan: React 18 + TS strict, Vite 8, TanStack Query 5, React Router 7 (data router), Tailwind v4, Vitest 4 (happy-dom), Playwright 1.58.2-jammy.
- The backend is the source of truth for the API contract. Any divergence from `docs/specs/backend/design.md §5` is a frontend bug, not a contract change.
- Cursor pagination's `next`/`previous` are full URLs with a `cursor=…` param — the FE parses them rather than treating them as bare tokens.
- The default and only ordering is `-created_at, -id` (newest first). The FE does not expose an ordering control.
- Logo and favicon assets are already in place at `frontend/public/`; the FE just references them.
- `frontend/public/` is static — Vite serves it at root in dev and nginx serves it from `/usr/share/nginx/html` in prod.
- `make test` runs Playwright in a Docker container that talks to the running stack via the compose network (`http://frontend:80`); the host-port mapping is for human use, not for tests.
- DB-reset for E2E uses `docker compose exec backend python manage.py flush --no-input` from the Playwright `globalSetup`; no test-only API endpoint is added on the backend.

## Out of Scope

- Authentication, multi-tenancy
- Dark mode
- Skeletons, toasts, tooltips
- A real-time push layer (SSE / WebSockets)
- Internationalization
- Name sort (backend doesn't expose)
- A separate "settings" / "account" page
- Server-side rendering — Vite SPA only

## Open Questions

Defaults baked into the requirements above; flag any to redirect.

| # | Question | Owner | Default |
| --- | --- | --- | --- |
| 1 | Detail-page status update — submit-on-click or two-step (pick + Apply)? | user | Two-step (matches the design preview's `Apply update` button) |
| 2 | What does the action-menu (`⋯`) on a list row do — link to detail and inline status update, or just link? | user | Just link to the detail page; status updates live on the detail page |
| 3 | Coverage gate value — 70% or 80% on FE? | user | 70% (matches backend's level of stretch but FE has more presentational code) |
| 4 | A11y smoke (axe-core in one Playwright spec)? | user | Yes — one assertion on `create.spec.ts` |
| 5 | Should `Vitest` enforce a coverage gate via `--coverage` in `make test`? | user | Yes, on `src/features/` and `src/lib/`; aligns with backend pattern |
| 6 | Bundle-size budget — hard fail in CI or just measure? | user | Measure only at this scope; document the number in README |

## Glossary

- **StatusPill** — the small badge component with a geometric glyph + uppercase mono label, one per status state (PENDING / RUNNING / COMPLETED / FAILED).
- **Panel** — the off-white card primitive with a 1 px stone border, 6 px radius, and a subtle two-layer shadow.
- **Drafting Table** — the design direction codename (see `docs/design/tokens.md`). Engineering-precise, calm, editorial.
- **Cursor pagination** — opaque base64-encoded `(ordering_field, id)` tuple delivered inside the `next`/`previous` URL's `cursor=` query param.
- **Per-flow spec** — one Playwright file per user flow (create / update / delete / filter), as opposed to one big spec with many `test()` blocks. Better isolation under `workers: 1`.

## Success Metrics

- Visiting `http://localhost:8080` after `make up` shows the list page with the Rescale lockup, the create form, and any seeded jobs in < 1 s.
- All four Playwright per-flow specs pass cold from `make test`.
- Vitest passes ≥ 70 % coverage on `src/features/jobs/` and `src/lib/`.
- `npm run build` produces a bundle < 250 KB gzipped.
- TypeScript compilation has zero errors and zero `any` in committed code (verified via `npx tsc --noEmit`).
- Manual click-through: every user story above is reachable from the UI without crashes; a backend 500 is shown as an inline banner, not a white screen.
