---
status: approved
feature: frontend
---

# Design: Frontend SPA

## Context & Problem Recap

The backend Jobs API is implemented and verified (phase 2: 20/20 tasks, 63 tests, 97% coverage). It needs a two-page SPA consumer that surfaces the Jobs lifecycle to operators with Rescale brand identity. This design implements the requirements at `docs/specs/frontend/requirements.md` (FR-001..FR-022, NFR-001..NFR-010) using the locked stack and visual language. Stack and scope are not re-litigated here — this document describes _how_ the frontend is assembled, not _whether_ it should exist.

Inputs:
- Requirements: `docs/specs/frontend/requirements.md`
- API contract: `docs/specs/backend/design.md §5` (+ ADR-4 spike findings)
- Visual language: `docs/design/preview.html`, `docs/design/tokens.md`
- Brand assets: `frontend/public/{rescale-logo.png, favicon.ico, favicon.png, apple-touch-icon.png}`

## Goals / Non-Goals

**Goals**

- A focused, fast, brand-correct two-page SPA consuming the locked API contract.
- A typed seam (`lib/api-client.ts` + `features/jobs/jobs.types.ts`) that prevents `any` from leaking into feature code (NFR-002).
- Co-located unit tests + per-flow Playwright E2E specs that pass cold from `make test` in <4 min (NFR-008).
- `make test` extended to chain BE pytest → FE Vitest → Playwright with no new test-only backend endpoints.
- Fully responsive layout from ~360 px phones up through laptop/desktop widths. The dashboard must remain usable, legible, and visually correct on both mobile and PC across common breakpoints.

**Non-Goals**

- Authentication, dark mode, toasts, skeletons, name sort, SSE/WebSockets, i18n, SSR — all explicitly out of scope per requirements.
- Optimistic mutations — we render after server confirmation for simplicity (US-006).
- A custom design system or Tailwind plugin — the design is small enough that local primitive components plus `theme.extend` is the right level.

## Architecture Overview

```
┌─────────── Browser ────────────┐
│ ┌──────────── React 18 SPA ──────────┐
│ │  RouterProvider (createBrowserRouter)
│ │     ├─ /jobs       → JobsListPage
│ │     └─ /jobs/:id   → JobDetailPage
│ │  QueryClientProvider (TanStack Query)
│ │     features/jobs/* hooks
│ │     lib/api-client.ts (typed fetch)
│ └────────────────────────────────────┘
└─────────────┬──────────────────┘
              │ relative /api/* (no CORS)
              ▼
   nginx (compose) / Vite proxy (dev)
              │
              ▼
        backend:8000 (Django Ninja)
```

Single-process SPA, no SSR. State is partitioned:

- **URL state** (React Router `useSearchParams`): `?status=…&cursor=…` on the list. Reload + share-link restore (FR-003).
- **Server state** (TanStack Query): all API data. Cache keyed per query, invalidated by mutations (FR-004).
- **Local component state**: form input drafts, "selected status" pre-apply on the detail page, delete-confirmation expansion.

No global client-state library (Redux/Zustand). The two stores above cover everything; introducing a third would be premature.

## Alternatives Considered & Trade-offs

| # | Decision | Picked | Rejected | Why |
| --- | --- | --- | --- | --- |
| 1 | Pagination model | `useQuery` keyed by `cursor`, `placeholderData: keepPreviousData` | `useInfiniteQuery` | Design is page-by-page Next/Previous; infinite-query's cache shape (pages array) doesn't fit. Page-by-page also lets cursor live in the URL cleanly. |
| 2 | Form state | Uncontrolled + native `<form>` `onSubmit` with `useMutation` | `react-hook-form` / `formik` | One field with one rule. Adding a form lib is bundle bloat with no payoff. |
| 3 | Routing data flow | Components call `useQuery` directly | Route `loader`s | Route loaders work but force a parallel data path next to TanStack Query's cache. Picking one source-of-truth (Query) is simpler and matches CLAUDE.md guidance. |
| 4 | Date formatting | In-tree `Intl.RelativeTimeFormat` helper | `date-fns` / `dayjs` | Single use case (relative-time on list rows). NFR-002 wants a slim bundle (FR-020). |
| 5 | E2E DB reset | `globalSetup` shells `docker compose exec backend python manage.py flush --no-input` | Test-only `POST /api/test/reset/` endpoint | Requirements lock this (constraints §). No prod-surface contamination, no extra Django route. |
| 6 | Component test mock layer | `vi.stubGlobal('fetch', …)` per-suite | MSW | One contract, four endpoints. MSW's value (browser+node parity, request matching) doesn't pay off at this scope; integration coverage comes from Playwright. |
| 7 | Status update UX | Two-step (select pill → click `Apply update`) | Submit-on-click | Matches the design preview; lets operators reconsider before the PATCH lands (open question 1). |
| 8 | List-row action | Click name → navigate to detail | Inline status change on each row | Open question 2 default. Detail is where every job action lives; keeps the table read-only. |

## Key Design Decisions (mini-ADRs)

### ADR-FE-1 — Page-by-page cursor, not `useInfiniteQuery`

**Context.** The backend returns `{results, next, previous}` where `next` is a full URL with `cursor=…`. The design has Next/Previous buttons (not infinite scroll).

**Decision.** Use `useQuery` keyed `['jobs', { status, cursor }]` with `placeholderData: keepPreviousData` so the previous page stays visible while the next loads. Cursor lives in the URL; the Next button reads `parseCursorFromNextUrl(data.next)` and pushes it to `setSearchParams`.

**Consequences.** No "history of pages" is kept across navigations — Previous works as long as the backend returned a `previous` URL on the current page. Refresh on a deep page works because cursor is in the URL.

### ADR-FE-2 — Single typed fetch wrapper, no client SDK

**Decision.** `lib/api-client.ts` exports four typed functions (`apiGet/apiPost/apiPatch/apiDelete<T>`) plus an `ApiError` class that carries `status`, `detail`, and `errors[]` from the locked envelope. Feature hooks call these directly. No code generation, no OpenAPI client, no fetch wrapper that hides URL paths.

**Why.** Six endpoints, one envelope, one error shape. A generated client would be more code than the hand-written version. The typed seam is in `features/jobs/jobs.types.ts` mirroring backend Pydantic schemas.

### ADR-FE-3 — TanStack Query as the only server-state store

**Decision.** Components do not call `fetch` directly. They call `useJobs/useJob/useStatuses/useCreateJob/useUpdateStatus/useDeleteJob`. The hooks own the keys and the invalidation rules.

**Why.** Centralizes caching, deduping, retries, and invalidation. Tests mock at the hook layer or stub `fetch` in `lib/api-client.ts` — never at the component layer.

### ADR-FE-4 — URL is the canonical filter+cursor state

**Decision.** `?status=` and `?cursor=` are read with `useSearchParams`, not stored in component state. Filter clicks use `setSearchParams` with `cursor` removed (filter changes invalidate cursor — FR-003, US-003 AC).

**Why.** Reload, share-link, browser back/forward all just work. No extra reducer.

### ADR-FE-5 — Inline error banners via `Panel` primitive, no toast layer

**Decision.** Errors render as a child of the closest panel using an `<ErrorBanner>` that takes an `ApiError | null`. Network/parse failures resolve to a generic copy. No global toast portal.

**Why.** Every error has a natural anchor (the form, the detail action panel, the delete confirm). A toast layer is bundle + a11y surface for no payoff.

### ADR-FE-6 — Brand assets live under `frontend/public/`, referenced by absolute path

**Decision.** `<img src="/rescale-logo.png" alt="Rescale">` and `<link rel="icon" href="/favicon.ico">`. Vite serves `public/` at root in dev; nginx serves the same files from `/usr/share/nginx/html` in prod (FR-012, NFR-010).

**Why.** No bundler import = no hash in URL = simple compose-network references work too.

## Project Layout

```
frontend/
├── package.json                    # exact pinned versions
├── package-lock.json
├── tsconfig.json                   # strict: true, noImplicitAny: true
├── tsconfig.node.json
├── vite.config.ts                  # @tailwindcss/vite, /api proxy, vitest config
├── playwright.config.ts            # workers:1, globalSetup, baseURL from env
├── tailwind.config.ts              # rescale colors + font-families
├── eslint.config.js                # flat config (typescript-eslint)
├── .prettierrc
├── Dockerfile                      # node:20-alpine builder → nginx:1.27-alpine runtime
├── Dockerfile.playwright           # mcr.microsoft.com/playwright:v1.58.2-jammy
├── nginx.conf                      # try_files + /api proxy_pass
├── index.html                      # favicons + title
├── public/                         # brand assets (already in repo)
│   ├── rescale-logo.png
│   ├── favicon.ico
│   ├── favicon.png
│   └── apple-touch-icon.png
├── e2e/
│   ├── fixtures.ts                 # extended `test` with seedJob helper (HTTP only)
│   ├── create.spec.ts              # + axe-core smoke
│   ├── update.spec.ts              # + axe-core smoke (detail page)
│   ├── delete.spec.ts              # + axe-core smoke (delete confirm)
│   └── filter-sort.spec.ts
└── src/
    ├── main.tsx                    # mounts RouterProvider + QueryClientProvider
    ├── router.tsx                  # createBrowserRouter; index → redirect('/jobs')
    ├── index.css                   # Tailwind v4 @theme + paper-grid utility
    ├── setup.ts                    # @testing-library/jest-dom matchers
    ├── test-utils/
    │   └── render.tsx              # renderWithProviders (QueryClient + MemoryRouter)
    ├── lib/
    │   ├── api-client.ts           # apiGet/apiPost/apiPatch/apiDelete<T>, ApiError
    │   ├── api-client.test.ts
    │   ├── cursor.ts               # parseCursorFromNextUrl
    │   ├── cursor.test.ts
    │   └── query-client.ts         # QueryClient with default options
    ├── components/                 # cross-feature primitives
    │   ├── StatusPill.tsx          # + .test.tsx
    │   ├── Panel.tsx
    │   ├── Button.tsx              # variants + `loading` prop (mutations)
    │   ├── Input.tsx
    │   ├── FilterPill.tsx
    │   ├── Pagination.tsx
    │   ├── ErrorBanner.tsx         # role="alert"
    │   ├── LoadingLine.tsx         # role="status" aria-live="polite"
    │   └── RootErrorBoundary.tsx   # wired as router errorElement
    ├── pages/
    │   ├── JobsListPage.tsx        # inlines BrandHeader lockup
    │   ├── JobDetailPage.tsx       # inlines top-bar lockup
    │   └── NotFoundPage.tsx
    └── features/jobs/
        ├── jobs.types.ts           # Job, JobStatus, StatusType, CursorPage<T>, ApiErrorBody
        ├── jobs.hooks.ts           # endpoint fns + 3 query hooks + 3 mutation hooks + key factory + qs helper + relativeTime helper
        ├── jobs.hooks.test.ts
        ├── JobList.tsx             # table on ≥768, semantic <ul> of <article> below
        ├── CreateJobForm.tsx       # + .test.tsx (validation + 400 envelope path)
        ├── FilterPills.tsx
        ├── JobDetail.tsx           # consumes useJob; renders status / history / delete sub-components
        ├── StatusUpdateControl.tsx # role="radiogroup", arrow-key nav
        ├── StatusHistory.tsx       # timeline; consumes useStatuses
        └── DeleteConfirmation.tsx  # disclosure pattern (aria-expanded, focus return)
```

## Data Layer

### Types (`features/jobs/jobs.types.ts`)

Mirrors backend Pydantic schemas exactly (FR-013, NFR-002):

```ts
export type StatusType = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface Job {
  id: number;
  name: string;
  current_status: StatusType;
  created_at: string;  // ISO 8601 UTC
  updated_at: string;
}

export interface JobStatus {
  id: number;
  status_type: StatusType;
  timestamp: string;
}

export interface CursorPage<T> {
  results: T[];
  next: string | null;
  previous: string | null;
}

export interface ApiErrorBody {
  detail: string;
  errors?: { loc: (string | number)[]; msg: string; type: string }[];
}
```

### Typed API client (`lib/api-client.ts`)

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public errors?: ApiErrorBody['errors'],
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T>
export const apiGet    = <T>(path: string)            => request<T>('GET',    path);
export const apiPost   = <T>(path: string, body: unknown) => request<T>('POST',   path, body);
export const apiPatch  = <T>(path: string, body: unknown) => request<T>('PATCH',  path, body);
export const apiDelete = (path: string)               => request<void>('DELETE', path);
```

`request<T>` rules:
- Sets `Content-Type: application/json` when `body` is present.
- On 204: resolves `undefined as T`.
- On 2xx: `await res.json() as T`.
- On non-2xx: parses the envelope; raises `new ApiError(status, body.detail, body.errors)`. If parse fails, raises `new ApiError(status, 'Something went wrong')`.
- On network failure (`fetch` rejects): raises `new ApiError(0, 'Network error')`.

### Endpoint functions (in `features/jobs/jobs.hooks.ts`)

Endpoint fns and hooks live in a single ~120-line module. Splitting `api`/`queries`/`mutations` into separate files implies layers that don't exist at this scope.

```ts
const fetchJobs    = (q: { status?: StatusType; cursor?: string }) =>
  apiGet<CursorPage<Job>>(`/api/jobs/${qs(q)}`);
const fetchJob     = (id: number) => apiGet<Job>(`/api/jobs/${id}/`);
const fetchStatuses = (id: number, cursor?: string) =>
  apiGet<CursorPage<JobStatus>>(`/api/jobs/${id}/statuses/${qs({ cursor })}`);
const createJob    = (name: string)              => apiPost<Job>('/api/jobs/', { name });
const updateStatus = (id: number, s: StatusType) => apiPatch<Job>(`/api/jobs/${id}/`, { status_type: s });
const deleteJob    = (id: number)                => apiDelete(`/api/jobs/${id}/`);
```

`qs(obj)` returns `?k=v&…` from defined values only — keys whose value is `undefined`, `null`, or `''` are skipped, preventing `?status=undefined` bugs. Returns `''` when no defined values.

### Cursor helper (`lib/cursor.ts`)

```ts
export function parseCursorFromNextUrl(next: string | null): string | null {
  if (!next) return null;
  try {
    return new URL(next, window.location.origin).searchParams.get('cursor');
  } catch {
    return null;
  }
}
```

The `new URL(next, base)` form tolerates both absolute and (theoretically) relative `next` values (FR-005).

### QueryClient defaults (`lib/query-client.ts`)

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // calm cache; mutations invalidate explicitly
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,  // dashboard, not a feed
      retry: (n, err) => err instanceof ApiError && err.status >= 500 && n < 2,
    },
    mutations: { retry: 0 },
  },
});
```

### Hooks and key conventions

```ts
const keys = {
  all:       ['jobs'] as const,
  list:      (q: { status?: StatusType; cursor?: string }) => ['jobs', 'list', q] as const,
  detail:    (id: number) => ['jobs', 'detail', id] as const,
  history:   (id: number, cursor?: string) => ['jobs', 'history', id, cursor ?? null] as const,
};
```

| Hook | Key | Notes |
| --- | --- | --- |
| `useJobs({status, cursor})` | `keys.list({status, cursor})` | `placeholderData: (prev) => prev` for smooth Next/Previous (v5 idiom; the named `keepPreviousData` export is removed in v5) |
| `useJob(id)` | `keys.detail(id)` | `enabled: Number.isFinite(id)`. `error` of type `ApiError` with `status === 404` drives the not-found panel (US-005 AC) |
| `useStatuses(id, cursor)` | `keys.history(id, cursor)` | same `placeholderData` pattern as list |
| `useCreateJob()` | mutation | `onSuccess`: invalidate `keys.all` |
| `useUpdateStatus(id)` | mutation | `onSuccess(updated)`: `setQueryData(keys.detail(id), updated)` for instant header refresh; then invalidate `keys.list` + `keys.history(id)` precisely. Do **not** invalidate the umbrella `keys.all` — that would refetch the detail and overwrite the just-set cache, wasting a round trip |
| `useDeleteJob()` | mutation | `onSuccess`: invalidate `keys.all`; the caller in `DeleteConfirmation` calls `useNavigate('/jobs')` |

**Invalidation contract.** TanStack Query v5 uses **prefix matching** on `queryKey` by default. `invalidateQueries({ queryKey: ['jobs'] })` therefore matches every key beginning with `['jobs', ...]`. The `keys` factory keeps every key under that umbrella so a single invalidate covers list/detail/history when that's what we want. The PATCH path is the one exception — it surgically targets list + history to preserve the `setQueryData` win on the detail.

## Routing

```ts
// router.tsx
const router = createBrowserRouter([
  {
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, loader: () => redirect('/jobs') },
      { path: '/jobs',     element: <JobsListPage /> },
      { path: '/jobs/:id', element: <JobDetailPage /> },
      { path: '*',         element: <NotFoundPage /> },
    ],
  },
]);
```

Imports per context7 (React Router v7): `createBrowserRouter` from `'react-router'`, `RouterProvider` from `'react-router/dom'`. The single root `errorElement` is the unhandled-render-error boundary referenced by NFR-005 — without it, a render exception white-screens the app.

`JobDetailPage` reads `useParams<{ id: string }>()`, parses to `Number(id)`, renders the not-found panel if `Number.isNaN(id) || (useJob.error instanceof ApiError && useJob.error.status === 404)` (US-005 AC).

## Components

### Cross-feature primitives (`src/components/`)

All consume Tailwind classes only — no inline styles, no CSS-in-JS.

All primitives expose the locked focus-ring class on every interactive descendant (FR-021). All meet ≥ 24×24 px target size at desktop and ≥ 44×44 px at mobile (NFR-001).

- **`StatusPill`** — props `{ state: StatusType; size?: 'sm'|'md' }`. Renders a 10×10 inline SVG glyph + uppercase mono label per `tokens.md`. Color classes are inline literals (`bg-emerald-100 text-emerald-800 …`) so Tailwind's JIT picks them up at build. **Contrast verification at implement time**: confirm `slate-100/slate-700` (PENDING), `amber-100/amber-800`, `emerald-100/emerald-800`, `red-100/red-800` all meet AA 4.5:1 — slate is the riskiest combo.
- **`Panel`** — `<section>` with white bg + 1px stone border + 6 px radius + the two-layer shadow from tokens.
- **`Button`** — variants `primary | ghost | danger`. Props include `loading?: boolean` (renders an inline mono "…" while a mutation is in flight, sets `disabled` + `aria-busy="true"`) and `disabled`. Disabled state at 40% opacity, `aria-disabled`. The `loading` prop is what the create form, status-update Apply, and delete-confirm buttons consume during `useMutation.isPending`.
- **`Input`** — controlled `<input>` with focus ring matching tokens. Error variant flips border to red, renders a mono error message slot, and wires `aria-invalid="true"` + `aria-describedby` pointing at the message.
- **`FilterPill`** — toggle button. Active = `bg-stone-900 text-white`; idle hover = `bg-stone-100`. Reused as the visual primitive for `StatusUpdateControl`'s radio options (different ARIA wrapper there).
- **`Pagination`** — `{ hasPrev, hasNext, onPrev, onNext, caption? }`. Two ghost buttons + mono caption. Disabled buttons set `aria-disabled="true"`, `tabIndex={-1}`, **and** the `onClick` short-circuits when disabled (defense in depth — US-004 AC).
- **`ErrorBanner`** — `{ error: ApiError | null }`. Renders `null` when no error; else a stone-bordered, red-tinted banner with `error.detail` and `role="alert"` so screen readers announce async failures after a mutation. Field-level `errors[]` are not surfaced here — fields handle their own (FR-006, FR-010). Optionally accepts `onRetry?: () => void` to render a `Button variant="ghost"` retry affordance (US-001 AC).
- **`LoadingLine`** — `<div role="status" aria-live="polite" className="text-stone-500 font-mono text-sm">Loading…</div>`. The `role="status"` makes loading-state announcements polite and unique-once (FR-011, NFR-001).
- **`RootErrorBoundary`** — wired as the router's single `errorElement`. Renders a stone-bordered Panel with "Something went wrong" + a back-to-list link. Catches both render exceptions and unhandled loader errors (NFR-005).

### Feature components (`src/features/jobs/`)

- **`JobList`** — consumes `useJobs`. **Renders a real `<table>` at ≥768 px and a semantic `<ul>` of `<article>` cards with a visually-hidden heading at <768 px** — same data, two DOM trees, swapped via Tailwind's `hidden md:table` / `md:hidden` utilities. The card uses `<h3>` for the job name (link to detail) and a `<dl>` for status / ID / created_at pairs. We deliberately avoid `role="table"` on the mobile tree — fake ARIA tables are a screen-reader footgun (incomplete role chains announce "table, 0 columns"). Empty result + no filter → empty-state panel that points at the form already on the page (no second render of the form). Empty result + filter → "No jobs match this filter" + a `Clear filter` button. Error → `ErrorBanner` with `onRetry={refetch}`. Loading → `LoadingLine`.
- **`CreateJobForm`** — controlled `<input>` + submit `<Button loading={mutation.isPending}>`. Client-side validation: `name.trim().length > 0 && name.length <= 200`. `<input maxlength="200">` enforces the upper bound. `useCreateJob` mutation. On 400 with `errors[]`, the first error whose `loc` contains `'name'` flips the input to error variant; otherwise `ErrorBanner`. After success, the form clears and re-focuses the input (good keyboard UX for repeat creates).
- **`FilterPills`** — `[All, PENDING, RUNNING, COMPLETED, FAILED]`. Reads/writes `?status=` via `useSearchParams`, removing `cursor` on change (US-003 AC, FR-003). Wrapped in a `<nav aria-label="Filter by status">`.
- **`JobDetail`** — consumes `useJob(id)`. On `error?.status === 404`, renders the not-found panel with a back-to-list link (US-005 AC). Otherwise renders header (back link + inline `<img className="h-8 opacity-90" alt="Rescale">` + name + `StatusPill` + created/updated mono), action panel (`StatusUpdateControl` + `DeleteConfirmation`), history panel (`StatusHistory`).
- **`StatusUpdateControl`** — local `useState<StatusType | null>(selected)` keyed off `id` (resets on detail navigation via `useEffect(() => setSelected(null), [id])`). Wraps four `FilterPill`-styled options in `<div role="radiogroup" aria-labelledby="…">`; each option is `role="radio"` with `aria-checked`, **roving tabindex** (only the selected option is `tabIndex={0}`, others `-1`), arrow-key navigation between options, Space/Enter to select. `Apply update` button below — disabled (and `aria-disabled`) until `selected !== null`. On Apply, fires `useUpdateStatus(id).mutate(selected)`. On success, resets `selected`. Mutation errors → `ErrorBanner role="alert"` at the top of the panel.
- **`StatusHistory`** — consumes `useStatuses(id, cursor)`. Renders timeline (vertical 1 px stone rail + 19 px round well per token) per row. Pagination via the shared `Pagination`, cursor in **component state** (history pagination doesn't need URL state — it's a sub-view of a detail page).
- **`DeleteConfirmation`** — **disclosure pattern**. Collapsed: a `Delete job` button with `aria-expanded="false"` and `aria-controls` pointing at the panel ID. Expanded: an inline panel with confirm copy + `Yes, delete` / `Cancel`. On expand, focus moves to `Cancel` (safe default). On Escape inside the panel, collapse and return focus to the trigger. On confirm: `useDeleteJob().mutate(id, { onSuccess: () => navigate('/jobs') })`. Errors render `ErrorBanner` inside the panel; we stay on the detail page (US-008 AC). No focus trap — disclosures don't trap; only modals do.

## Styling

### Tailwind v4 — CSS-first configuration

Tailwind v4 prefers configuration via `@theme` blocks in CSS, not a JS config file. The `@tailwindcss/vite` plugin reads `index.css` directly. We follow the v4 idiom: no `tailwind.config.ts` is needed. Brand tokens and font families live in `@theme`; the paper-grid is a plain utility class.

### `src/index.css`

```css
@import "tailwindcss";

@theme {
  --color-rescale-ink:          #1B1B1B;
  --color-rescale-blue:         #489ABD;
  --color-rescale-blue-soft:    #E8F2F8;
  --color-rescale-blue-strong:  #336F8B;

  --font-display: "Fraunces", serif;
  --font-sans:    "IBM Plex Sans", system-ui, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, monospace;
}

.paper-grid {
  background-image:
    linear-gradient(to right,  rgba(28,25,23,0.025) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(28,25,23,0.025) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

The `@theme` token names map to utilities automatically: `--color-rescale-ink` → `bg-rescale-ink` / `text-rescale-ink`; `--font-display` → `font-display`. Vite plugin: `@tailwindcss/vite` registered in `vite.config.ts`.

### `index.html`

Loads Google Fonts (Fraunces + IBM Plex Sans + IBM Plex Mono in one stylesheet), sets `<title>Job Management Dashboard · Rescale</title>`, wires favicons:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## Responsive Design

The UI must render correctly across mobile and desktop. Tailwind v4's default breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280) drive the responsive rules.

### Breakpoint strategy (mobile-first)

Default styles target mobile (<640 px). `md:`-prefixed utilities upgrade to tablet/desktop. No `xl:` rules — the design caps at the existing 1100 px max-width column.

### Per-surface rules

| Surface | <640 px (mobile) | 640–1023 px (tablet) | ≥1024 px (desktop) |
| --- | --- | --- | --- |
| **Page padding** | `px-4` | `px-6` | `px-8` |
| **Brand header** | logo `h-8`, label `OPS · INTERNAL` hidden, version on its own row | logo `h-9`, label inline | logo `h-10`, label + version inline (current design) |
| **Page title** | `text-3xl` | `text-4xl` | `text-[40px]` |
| **Create form** | input + button stack vertically (`flex-col gap-2`) | inline (`md:flex-row`) | inline |
| **Filter pills** | horizontal scroll-snap row (`overflow-x-auto snap-x`) | wrap as needed | inline (current design) |
| **Job table** | **semantic card list** — `<ul>` of `<article>` cards: `<h3>` (name → detail link) + `<dl>` for status / ID / created_at. **No `role="table"`** — fake ARIA tables announce as 0-column when the role chain is incomplete. Cards swap in via Tailwind `md:hidden` / `hidden md:table`. | true `<table>` | true `<table>` |
| **Pagination** | full-width buttons stacked, caption above | inline (current design) | inline |
| **Detail header** | back link + logo on row 1, name on row 2, pill + timestamps stack | back link + logo + name in a wrap; pill below | current design |
| **StatusUpdateControl** | 2-column grid of pill toggles (`grid-cols-2`), Apply button full-width | 4-in-a-row | 4-in-a-row |
| **StatusHistory timeline** | rail + markers stay; timestamp wraps below the pill | inline | inline |
| **DeleteConfirmation** | confirm/cancel buttons full-width stacked | inline | inline |

### Mechanisms

- **Mobile job list = card list, not horizontal-scroll table.** Horizontal scroll on a primary surface is a UX failure; we render the same data as a `<ul>` of `Panel`s under `md:`. Headings are visually hidden but keep table semantics for screen readers.
- **No fixed pixel widths** on layout containers. Use `max-w-[1100px] mx-auto w-full` for the page column.
- **Touch targets** ≥ 44×44 px on mobile. Buttons get `py-3` at base, `md:py-2` at desktop. Filter pills similarly.
- **Tap-friendly affordances.** Hover-only effects (e.g., row hover) get an active-state equivalent on mobile.
- **Type scale** uses Tailwind's responsive variants — the page-title scale above is the largest case.
- **`<meta name="viewport" content="width=device-width, initial-scale=1">`** in `index.html`.
- **Paper-grid background** stays at 32 px tile across breakpoints — already subtle enough to not interfere on small screens.

### Verification

- **Visual** — Playwright runs with **two** viewports configured as projects in `playwright.config.ts`: `mobile` (390×844, iPhone-13 emulation) and `desktop` (1280×800). Tablet width (768) is the breakpoint inflection — the desktop project at 1280 covers the table side; the mobile project at 390 covers the card-list side. Adding a third tablet project would 1.5× the E2E runtime for negligible coverage gain (NFR-008's <4 min budget is the binding constraint).
- **Critical-path E2E coverage** — every per-flow spec runs at both viewports. Each spec adds one assertion verifying the breakpoint-specific DOM (e.g., `await expect(page.getByRole('table')).toBeVisible()` on desktop; `await expect(page.locator('[data-list="cards"]')).toBeVisible()` on mobile).
- **Manual checklist** — README adds a short "Responsive smoke" section: open `/jobs` and `/jobs/:id` at 360, 768, 1024, 1440 widths in DevTools and confirm no horizontal scroll, no clipped controls, all touch targets reachable.

### What does NOT change

- Visual identity (Drafting Table tokens, Rescale brand colors, fonts) is the same across breakpoints.
- The two-route SPA structure is the same.
- Status-pill glyphs scale with text; no separate mobile glyph set.

## Build & Deployment

### `vite.config.ts`

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/setup.ts'],
    coverage: {
      include: ['src/features/jobs/**', 'src/lib/**'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      reporter: ['text', 'html'],
    },
  },
});
```

### Build-warning hygiene (NFR-009)

`npm run build` is wrapped to fail on TypeScript or Vite warnings: the script is `"build": "tsc --noEmit && vite build"`. `tsc --noEmit` exits non-zero on any TS error/warning; Vite's prod build similarly exits non-zero on resolution failures. CI assertion is implicit — image build fails if `npm run build` does.

### Multi-stage `Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### `nginx.conf`

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

### `Dockerfile.playwright`

```dockerfile
FROM mcr.microsoft.com/playwright:v1.58.2-jammy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
USER pwuser
CMD ["npx", "playwright", "test"]
```

### `docker-compose.yml` additions

```yaml
  frontend:
    build: ./frontend
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost/ >/dev/null || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 10
    ports:
      - "8080:80"

  vitest:
    profiles: ["test"]
    build:
      context: ./frontend
      target: builder
    command: ["npm", "run", "test:unit", "--", "--coverage"]
    environment:
      CI: "true"

  playwright:
    profiles: ["test"]
    build:
      context: ./frontend
      dockerfile: Dockerfile.playwright
    depends_on:
      frontend:
        condition: service_healthy
    environment:
      PLAYWRIGHT_TEST_BASE_URL: http://frontend:80
```

**DB reset is orchestrated by the host Makefile, not by Playwright.** The original draft put `globalSetup` inside the Playwright container, which forced a host Docker-socket mount — a privilege escalation that also breaks on rootless Docker, Podman, and CI runners with restricted socket access (jeopardizing NFR-008's "cold from a fresh clone" promise). The Makefile `test` target invokes `docker compose exec -T backend python manage.py flush --no-input` between the frontend health-check and the playwright run. The Playwright container then just runs tests — no privileged volume, no socket exposure. Constraint locked in requirements (`docker compose exec backend python manage.py flush --no-input`) is satisfied; only the *invocation site* moves.

### `Makefile` updates

```makefile
test: | .env
	docker compose build
	docker compose up -d db backend
	docker compose exec -T -e COVERAGE_FILE=/tmp/.coverage backend pytest -q -p no:cacheprovider
	docker compose --profile test run --rm vitest
	docker compose up -d frontend
	docker compose exec -T backend python manage.py flush --no-input
	docker compose --profile test run --rm playwright
	docker compose --profile test down -v

up: | .env build
	docker compose up -d db backend frontend
```

## Testing Strategy

| Layer | Tool | Runs in | Scope |
| --- | --- | --- | --- |
| Unit | Vitest 4 + RTL | `vitest` service (builder stage) | hooks, helpers, primitive components |
| E2E | Playwright 1.58.2-jammy | `playwright` service | per-flow user journeys against the live stack |

### Unit tests (Vitest)

- **Setup**: `src/setup.ts` imports `@testing-library/jest-dom/vitest`. happy-dom env from `vite.config.ts`.
- **`renderWithProviders`**: wraps children in `<QueryClientProvider>` (fresh QueryClient per test, `retry: false`) + `<MemoryRouter>` with optional `initialEntries`.
- **Targets** (FR-014). The strategy: unit-test the typed seam (`lib/`), the data hooks (`jobs.hooks.ts`), and the small components with non-trivial logic (`StatusPill`, `CreateJobForm`). Page-level integration is covered end-to-end by Playwright across both viewports — duplicating it as `JobList.test.tsx` / `JobDetail.test.tsx` would be slower mock-heavy duplication of the same assertions.
  - `lib/cursor.test.ts` — null in/out; full URL with `cursor=…`; missing cursor param; malformed URL; backend-internal hostname (`http://backend:8000/api/jobs/?cursor=abc`) → `'abc'`.
  - `lib/api-client.test.ts` — 2xx/204/4xx/5xx envelope parsing; non-envelope JSON → generic `ApiError`; `fetch` reject → `ApiError(0, 'Network error')`.
  - `features/jobs/jobs.hooks.test.ts` — `useJobs` calls `fetchJobs` with the right query string; key stable across renders; `placeholderData` retains previous on cursor change; `useCreateJob.onSuccess` invalidates `['jobs']`; `useUpdateStatus.onSuccess` populates detail cache (`getQueryData(keys.detail(id))` returns the PATCH response) and invalidates list + history precisely (not the umbrella).
  - `components/StatusPill.test.tsx` — renders glyph + label per state; accessible name matches state.
  - `features/jobs/CreateJobForm.test.tsx` — empty/whitespace input disables submit; 400 with `errors[0].loc` containing `'name'` flips input to error variant; form clears + re-focuses input on success.
- **Mocking**: `vi.stubGlobal('fetch', vi.fn())` per suite via a shared `mockFetch(...)` helper in `test-utils/` — avoids copy-paste drift across hook tests. No MSW.
- **Coverage gate**: 70% lines/statements/functions/branches on `src/features/jobs/**` and `src/lib/**` (FR-014, NFR-006). Enforced in `make test` via `npm run test:unit -- --coverage` exiting non-zero on threshold miss.

### E2E (Playwright)

- **`playwright.config.ts`**: `workers: 1`, `baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL`, **two chromium projects** (`mobile` 390×844 with iPhone-13 emulation, `desktop` 1280×800). No `globalSetup` — DB flush is orchestrated by the Makefile before the playwright container is invoked (see Build & Deployment §).
- **DB reset**: orchestrated by the host Makefile via `docker compose exec -T backend python manage.py flush --no-input` between the frontend bring-up and the playwright run. No `globalSetup` inside the container, no Docker socket mount.
- **Per-flow specs** (FR-015), each running at both `mobile` and `desktop` projects:
  - `create.spec.ts`: navigate to `/jobs`, type a name, submit, assert row appears with PENDING pill. **+ `@axe-core/playwright` smoke** on the list page (FR-022, NFR-001).
  - `update.spec.ts`: seed via `request.post('/api/jobs/', …)`, navigate to detail, click RUNNING + Apply, assert header pill + new history entry. **+ axe smoke** on the detail page (radiogroup is the highest-risk a11y surface).
  - `delete.spec.ts`: seed, navigate to detail, click Delete, expand confirmation, click Yes, assert URL is `/jobs` and row is gone. **+ axe smoke** on the expanded delete-confirm panel (disclosure + focus management).
  - `filter-sort.spec.ts`: seed two jobs in different statuses, click `RUNNING` filter, assert only one row, assert URL has `?status=RUNNING`. Verifies the responsive DOM swap: `getByRole('table')` on desktop, `[data-list="cards"]` on mobile.
- **`fixtures.ts`**: extends `test` with `seedJob({ name }: …) => Promise<Job>` using `request` fixture against the same baseURL — no FE flow on the seed path.

## Security, Performance, Observability

### Security

- Same-origin via nginx proxy (FR-002, NFR-007). No CORS, no third-party scripts beyond Google Fonts.
- No `dangerouslySetInnerHTML`. All user input is rendered through React's text node escaping.
- `name` is rendered with React; no Markdown, no rich text.
- No client-side credentials/tokens stored — there is no auth in scope.

### Performance (NFR-003)

- Bundle target <250 KB gzipped. Major contributors: React 18 (~45 KB), TanStack Query 5 (~15 KB), React Router 7 (~25 KB). Hand-rolled UI components add little. Tailwind v4 generates atomic CSS with JIT — measured at build, not bundled JS.
- `placeholderData: keepPreviousData` keeps the table painted while the next page loads.
- Vite's prod build hashes assets; nginx serves with default cache headers. We don't add a CDN.

### Observability

- v1: zero FE telemetry. Browser console for runtime errors only (locked).
- React error boundary at the router level renders a generic error panel — prevents whole-tree unmounts (NFR-005).

## Dependencies (locked)

`package.json` exact pins (illustrative; `^` not used):

| Package | Version | Why |
| --- | --- | --- |
| react / react-dom | 18.3.x | Locked stack |
| react-router | 7.x | Data router |
| @tanstack/react-query | 5.x | Server state |
| tailwindcss | 4.x | Styling |
| @tailwindcss/vite | 4.x | v4 plugin |
| vite | 8.x | Build |
| typescript | 5.x | Strict TS |
| vitest | 4.x | Unit runner |
| @vitest/coverage-v8 | 4.x | Coverage gate |
| @testing-library/react | 16.x | Component testing |
| @testing-library/jest-dom | 6.x | DOM matchers |
| happy-dom | latest | Vitest environment |
| @playwright/test | 1.58.2 | Pinned to image tag |
| @axe-core/playwright | latest | a11y smoke |

No `lodash`, no `date-fns`, no `axios`, no form lib (ADR-FE-2/4).

## Open Questions (deferred)

All open questions from requirements have defaults locked. None blocks implementation. If the user wants to revisit:

- A toast layer if inline banners feel under-emphasized in clickthrough.
- Prefetch on row hover via `queryClient.prefetchQuery(keys.detail(id))` — easy add later.

## Glossary

- **`keys`** — the query-key factory in `jobs.queries.ts`. Single source of truth; never inline `['jobs', …]` in a component.
- **Two-step status update** — user clicks a `FilterPill`-like toggle to *select* a target state, then clicks `Apply update`. No PATCH fires until Apply.
- **paper-grid** — the faint drafting-paper background defined in `index.css`, applied to the `<body>` via a className.

---

When approved, set `status: approved` and run `/spec:tasks frontend`.
