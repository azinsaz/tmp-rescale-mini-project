# Future improvements

The current implementation is scoped to the take-home spec — a working
dashboard, evaluable in `make test`, designed for a millions-of-jobs
target. This document captures the work that would graduate it from a
take-home submission to a production service. Items are grouped by
concern and roughly ordered by leverage.

For every item we record the **gap** (what is missing today), the
**proposed change**, and the **trade-offs** — the things that get worse
or harder when the change lands. Where the change is large enough to
warrant its own ADR, that is called out.

---

## Table of contents

1. [Authentication and authorization](#1-authentication-and-authorization)
2. [Multi-tenancy via Postgres Row-Level Security](#2-multi-tenancy-via-postgres-row-level-security)
3. [Secrets management](#3-secrets-management)
4. [Container registry, CD pipeline, and cloud deployment](#4-container-registry-cd-pipeline-and-cloud-deployment)
5. [Soft delete / archive instead of hard delete](#5-soft-delete--archive-instead-of-hard-delete)
6. [Per-status partial indexes](#6-per-status-partial-indexes)
7. [Connection pooling (PgBouncer) and worker scaling](#7-connection-pooling-pgbouncer-and-worker-scaling)
8. [Observability — metrics, traces, structured log shipping](#8-observability--metrics-traces-structured-log-shipping)
9. [Rate limiting and abuse protection](#9-rate-limiting-and-abuse-protection)
10. [Real-time updates (SSE / WebSocket)](#10-real-time-updates-sse--websocket)
11. [Background processing for actual job execution](#11-background-processing-for-actual-job-execution)
12. [API versioning, ETags, conditional requests](#12-api-versioning-etags-conditional-requests)
13. [Frontend hardening — virtualization, optimistic mutations, bundle budget](#13-frontend-hardening--virtualization-optimistic-mutations-bundle-budget)
14. [Schema evolution: state-machine constraints on status transitions](#14-schema-evolution-state-machine-constraints-on-status-transitions)
15. [Disaster recovery: backups, point-in-time restore, runbooks](#15-disaster-recovery-backups-point-in-time-restore-runbooks)
16. [Accessibility and i18n](#16-accessibility-and-i18n)
17. [Richer commit messages and PR descriptions](#17-richer-commit-messages-and-pr-descriptions)

---

## 1. Authentication and authorization

**Gap.** The API is open. Anyone who can reach `/api/jobs/` can list,
create, update, and delete jobs. There is no concept of identity, no
audit trail tied to a principal, and no notion of permission scope.

**Proposed change.** Two-layer approach: identity at the edge, RBAC at
the service layer.

- **Identity.** OIDC/OAuth2 via an external IdP (Auth0, Okta, Cognito, or
  a self-hosted Keycloak). The frontend redirects to the IdP for
  login; the IdP returns an opaque session cookie or a short-lived JWT.
  Same-origin cookies pair naturally with the existing nginx-proxied
  setup ([ADR-016](./ADR.md#adr-016--nginx-api-reverse-proxy-relative-urls-only)),
  so we don't need to add CORS or a token-bearer layer.
- **Authorization.** A single Django middleware injects `request.user`
  and `request.tenant_id`; service functions accept `actor` as a kwarg
  and check role-scoped permissions before any state change. Endpoints
  decorate with `@require_permission("jobs:write")` etc.
- **Audit.** Every state-changing service function records `actor_id`
  alongside the existing `job_created` / `status_appended` /
  `job_deleted` log lines. With JSON-format logs this becomes a
  query-able audit trail.

**Trade-offs.**

- Adds a hard dependency on the IdP — local dev needs a test IdP
  (Keycloak in compose) or a `DEV_AUTH_BYPASS=1` mode that injects a
  fake principal.
- Service functions take an extra `actor` argument; tests have to thread
  a fixture user through every call. The cost is real but well-bounded.
- Cookie-based auth needs CSRF protection. Django ships CSRF middleware;
  the FE wires `X-CSRFToken` from the cookie on mutating requests.

---

## 2. Multi-tenancy via Postgres Row-Level Security

**Gap.** Today `Job` and `JobStatus` rows have no tenant column. A
multi-tenant deployment would require either application-level
filtering on every query (easy to forget; one missed filter is a data
leak) or schema-per-tenant (operationally painful at scale).

**Proposed change.** Add `tenant_id` to both tables and enforce
isolation with PostgreSQL Row-Level Security (RLS).

```sql
-- One-time, per-table:
ALTER TABLE jobs_job ADD COLUMN tenant_id BIGINT NOT NULL;
ALTER TABLE jobs_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON jobs_job
  USING (tenant_id = current_setting('app.tenant_id')::bigint);

-- Same for jobs_jobstatus, with tenant_id denormalized from the parent.
```

The application sets `app.tenant_id` per request via
`SET LOCAL app.tenant_id = ...` inside a transaction (or a
`SessionContext` middleware that runs `SET app.tenant_id = ...` on
every connection check-out). RLS then enforces isolation at the
*database* layer — even a missed `WHERE` clause in app code can't leak
data across tenants.

**Indexes.** Every existing composite index gains `tenant_id` as the
leading column: `(tenant_id, -created_at, -id)` etc. Tenants pay the
storage cost of one extra column in every index; in exchange, every
tenant-scoped query is a tight scan over its own subtree of the btree.

**Trade-offs.**

- RLS adds query planning cost; you must `ANALYZE` after enabling it,
  and some queries that were index-only are no longer eligible.
- Migrations get harder — backfilling `tenant_id` on existing rows
  requires a planned downtime window or a careful online migration.
- Bypassing RLS for admin operations (cross-tenant reports, support
  tooling) requires a separate Postgres role with `BYPASSRLS`. The
  application's normal role does *not* have that grant.
- Connection pooling complicates the `SET LOCAL` story. With PgBouncer
  in transaction mode you must set the GUC inside the same transaction
  as the query; with session mode the connection check-out boundary is
  the right place. Either is workable, but it's a real coordination
  cost.

This is a large enough change to warrant its own ADR when it lands.

---

## 3. Secrets management

**Gap.** `.env` files generated from `.env.example` carry the
PostgreSQL password and `JOBS_SECRET_KEY` in plaintext on the host.
That's appropriate for local dev — it is never appropriate for
staging or production.

**Proposed change.** Adopt a managed secrets store and inject at
runtime, never at build time.

- **AWS**: SSM Parameter Store (or Secrets Manager for rotation).
  Backend container reads secrets at boot via the AWS SDK using its
  task IAM role. No secrets on disk; rotation is a parameter-store
  rotation event the application notices on the next read.
- **GCP**: Secret Manager + Workload Identity. Same shape.
- **Kubernetes**: `ExternalSecrets` operator pulling from any of the
  above into Kubernetes `Secret` resources, mounted as env or files.

The `entrypoint.sh` learns one new path: "if `SECRETS_PROVIDER` is
set, fetch and export; otherwise read from environment as today." Local
dev keeps the `.env` flow.

**Trade-offs.**

- Boot-time dependency on the secrets store — if it's down, the
  service can't start. Mitigated by fail-fast plus a circuit breaker
  in the entrypoint.
- Secrets rotation requires either a process restart (simple,
  disruptive) or a watcher that reloads (complex). Most production
  Django services restart on rotation; the latency cost is small.
- Cost — Secrets Manager rotation features have per-secret pricing.
  For low-secret-count services Parameter Store is the right answer.

---

## 4. Container registry, CD pipeline, and cloud deployment

**Gap.** `cd.yml` exists but is a scaffold. There is no real
registry push, no smoke-test against a staging environment, no
production target.

**Proposed change.** Three concrete additions:

1. **Registry push.** On a SemVer tag, `cd.yml` builds the backend
   and frontend images, tags them as
   `ghcr.io/<owner>/jobs-backend:vX.Y.Z` (and `:latest`) and
   `ghcr.io/<owner>/jobs-frontend:vX.Y.Z`, and pushes via OIDC-issued
   tokens (no long-lived registry credentials in CI).
2. **Smoke test against the pushed images.** A separate job pulls the
   tagged images, brings them up via `docker compose up`, runs `make
   test` (or a lighter smoke subset), and only proceeds if green.
3. **Deploy.** Concretely: AWS ECS Fargate behind an ALB. The Fargate
   task definition references the ECR/GHCR image tag; deployment is a
   `aws ecs update-service --force-new-deployment`. Blue/green via
   CodeDeploy or simple rolling per-task replacement; the API has no
   long-lived sessions so rolling is fine.
   Alternatives: GCP Cloud Run (the simplest fit — single-container,
   request-driven, scales to zero), or Kubernetes (more operational
   surface, more flexibility).

The `Makefile` exposes a `make deploy ENV=staging` for the local
inverse, but production deploys should always go through CI.

**Trade-offs.**

- Cost: ECS/Fargate on a small instance is cheap; Cloud Run is cheaper
  at idle but has cold-start latency on the async stack we'd want to
  measure first.
- Static frontend is best served from a CDN (S3+CloudFront, GCS+CDN)
  rather than nginx in a container. The current nginx-as-proxy pattern
  (ADR-016) needs to be split: a CDN serves the SPA bundle; an API
  origin serves `/api/*`. That's a contract change worth ADR-ing.

---

## 5. Soft delete / archive instead of hard delete

**Gap.** `DELETE /api/jobs/<id>/` is a hard delete with `ON DELETE
CASCADE` on `JobStatus`. The original take-home spec wording asks for
this verbatim, and the data model didn't have an `is_archived` column
or a `deleted_at` field, so we shipped what the spec describes — but
in any production setting, hard-deleting jobs *and* their status
history is wrong:

- It destroys the audit trail. "What did this job do before someone
  deleted it?" becomes unanswerable.
- It is not recoverable from a fat-fingered click.
- It removes data that downstream systems (billing, reporting,
  retention) might still reference.

**Proposed change.** Replace hard delete with archive.

```python
class Job(models.Model):
    ...
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(User, null=True, on_delete=SET_NULL)

    class Meta:
        indexes = [
            # Partial: every list/filter query already filters
            # is_archived=False, so the partial index is the right shape.
            models.Index(
                fields=["-created_at", "-id"],
                name="idx_job_active_created",
                condition=Q(is_archived=False),
            ),
            # ... matching partial indexes for the other sort dimensions.
        ]

class JobManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_archived=False)

    def including_archived(self):
        return super().get_queryset()
```

`DELETE /api/jobs/<id>/` flips `is_archived=True` and stamps
`archived_at`. `JobStatus` rows are *not* touched — they remain the
audit trail. A new endpoint (admin-only) restores: `POST
/api/jobs/<id>/restore/`.

**Trade-offs.**

- Storage grows monotonically. Add a retention job that hard-deletes
  archived rows older than N days (configurable per tenant once
  multi-tenancy lands).
- Every existing query has to filter `is_archived=False` — done once
  in the default manager and tested with a regression suite that
  asserts archived rows never leak into list/detail/history responses.
- Partial indexes on the active subset are a real win (see §6).

This was deliberately *not* shipped in the take-home because the spec
literally says "delete." It is the first thing that should change in
production.

---

## 6. Per-status partial indexes

**Gap.** [`docs/perf.md`](./perf.md) Q2 (filter by status) shows the
planner walking the `(-created_at, -id)` index and discarding rows
whose `current_status` doesn't match the filter. At 4% selectivity
this scans ~400 rows for a 21-row page; at 1% selectivity, ~2,100
rows.

**Proposed change.** One partial index per status the UI surfaces:

```sql
CREATE INDEX idx_job_failed_created
  ON jobs_job (created_at DESC, id DESC)
  WHERE current_status = 'FAILED';

CREATE INDEX idx_job_running_created
  ON jobs_job (created_at DESC, id DESC)
  WHERE current_status = 'RUNNING';
-- ... etc.
```

Each partial index is small (only the rows for that status) and the
filtered list scan reads exactly 21 rows.

**Trade-offs.**

- Four indexes is meaningful write amplification on the hot table.
  Every insert / status change touches all four (well, two, if the
  partial conditions are mutually exclusive).
- Currently we don't ship this because the seed numbers comfortably
  clear the spec bar. The right time to add it is when filtered list
  latency shows up in the SLO.

---

## 7. Connection pooling (PgBouncer) and worker scaling

**Gap.** `uvicorn --workers 1` is the right default at this scope
([ADR-008](./ADR.md#adr-008--single-uvicorn-worker-single-connection-pool))
but caps throughput at one CPU core. As traffic grows we scale workers
horizontally — and hit `max_connections` on Postgres almost
immediately.

**Proposed change.** Add PgBouncer in transaction-pooling mode in
front of Postgres. Backend connection strings point at PgBouncer; the
application's pool size becomes a fan-out parameter, not a connection
ceiling. Documented gotchas (named prepared statements, advisory locks
across transactions) get explicit treatment in the connection layer.

**Trade-offs.**

- One more service to operate. Managed Postgres offerings (AWS RDS
  Proxy, GCP AlloyDB) ship pooling out of the box and are usually the
  right answer.
- Transaction pooling forbids `SET SESSION` and named prepared
  statements; psycopg's defaults are compatible but the team must
  internalize the constraint.

---

## 8. Observability — metrics, traces, structured log shipping

**Gap.** Logging is in good shape (text/dev, JSON/prod, rotated). What
we don't have: metrics (request rate / latency / error rate per
endpoint), distributed traces, or a log-shipping pipeline.

**Proposed change.** OpenTelemetry-everything.

- **Metrics.** `prometheus-client` exposing `/metrics` (RED metrics
  per endpoint plus DB query timing). Scrape from Prometheus or the
  cloud's managed equivalent.
- **Traces.** OpenTelemetry instrumentation for Django + psycopg + the
  ASGI app. Spans per request, per service-function call, per DB
  query. Export to OTLP (Honeycomb, Lightstep, or Tempo).
- **Log shipping.** JSON logs to stderr, container runtime captures
  them, ship to a log store (CloudWatch, Datadog, Loki). The
  `RotatingFileHandler` is for local dev and disappears in prod.

**Trade-offs.**

- Every span is a small allocation; high-cardinality attributes
  (per-job-id) blow up trace store cost. We start with low-cardinality
  attributes (endpoint, status, tenant) and tighten from there.
- Exporters add a small per-request latency. Negligible for HTTP-bound
  work; worth measuring.

---

## 9. Rate limiting and abuse protection

**Gap.** A naive client can hammer `POST /api/jobs/` and create
unbounded rows. The take-home doesn't ask for protection here, but
production demands it.

**Proposed change.** Two layers.

- **Edge.** ALB/CloudFront/Cloud Armor rate-limits per IP. Standard
  WAF rules block obvious abuse patterns.
- **Application.** A small Django middleware that rate-limits per
  authenticated principal (once auth lands) using a Redis counter
  with sliding windows. `django-ratelimit` is a reasonable
  off-the-shelf component; rolling it into the existing logging
  middleware is a few dozen lines.

**Trade-offs.**

- Adds Redis to the stack. Worth the cost — a rate-limit store is
  also a cache, a pub/sub for invalidation, and a session store.

---

## 10. Real-time updates (SSE / WebSocket)

**Gap.** The list refetches on mutations and on filter/sort changes,
not when someone *else* changes a job. Operators monitoring live jobs
must refresh.

**Proposed change.** Server-Sent Events on `/api/jobs/stream`. The
backend emits a `status_appended` event whenever a `JobStatus` row is
appended (Django's `post_save` signal feeds an in-memory or Redis
pub/sub channel; an ASGI handler subscribes and writes events). The
frontend's `useJobs` hook listens and invalidates the matching cache
entry.

**Trade-offs.**

- SSE is simpler than WebSocket and one-way is exactly the shape we
  need.
- Requires an event bus (Redis pub/sub or PG `LISTEN/NOTIFY`). The
  application becomes stateful from a connection perspective —
  load-balancer affinity matters.

---

## 11. Background processing for actual job execution

The current API tracks a job's *state*; it doesn't *run* anything. A
real Rescale-shaped product would dispatch the job to a worker
fleet, monitor progress, and update `JobStatus` from the worker
itself. Out of scope here, but the right shape is Celery (or RQ, or
Temporal for more complex workflows) plus a worker container that
shares the database. The PATCH endpoint then becomes "request a state
change" rather than "set state directly."

---

## 12. API versioning, ETags, conditional requests

**Gap.** `/api/jobs/` has no version prefix. Adding a breaking change
in the future means coordinating with every client.

**Proposed change.**

- **Versioning.** Mount the router at `/api/v1/`. New incompatible
  versions get `/api/v2/`. Clients pin a version; deprecation windows
  are explicit.
- **ETags.** `GET /api/jobs/<id>/` returns `ETag: W/"<id>-<updated_at>"`.
  `PATCH` accepts `If-Match` and 412s on stale tags. Eliminates the
  "two operators race-update the same job" footgun.

---

## 13. Frontend hardening — virtualization, optimistic mutations, bundle budget

A handful of follow-ups worth doing in one cohesive pass:

- **Virtualization** for the (rare) case where a single page wants
  hundreds of rows on screen. `@tanstack/react-virtual` keeps the
  bundle small.
- **Optimistic mutations.** Status updates and deletes feel instant if
  the client mutates the cache before the server confirms, with rollback
  on failure. Already in place for `StatusQuickChange` (per-row pill
  popover); should extend to the drawer's status update and to delete.
- **Bundle budget.** `vite-bundle-visualizer` in CI; hard fail if the
  main bundle exceeds N KB (gzipped). The current bundle is small but
  unguarded.
- **Skeletons** instead of "Loading…" lines. Out of scope for v1
  (calm-text matches the design language), but worth the polish later.

---

## 14. Schema evolution: state-machine constraints on status transitions

**Gap.** Today any status can transition to any status. Reality is more
constrained: `COMPLETED → PENDING` is almost certainly a bug;
`FAILED → RUNNING` may or may not be valid depending on retry
semantics.

**Proposed change.** Encode the legal transitions as a check
constraint in PostgreSQL or as a service-layer guard:

```python
LEGAL_TRANSITIONS = {
    StatusType.PENDING: {StatusType.RUNNING, StatusType.FAILED},
    StatusType.RUNNING: {StatusType.COMPLETED, StatusType.FAILED},
    StatusType.COMPLETED: set(),
    StatusType.FAILED: {StatusType.PENDING},  # retry
}
```

The service layer checks before append; the API returns 409 Conflict
on illegal transitions (a new error code, but well within the locked
envelope).

**Trade-offs.**

- The matrix is a product decision. Encoding the wrong matrix is
  worse than no matrix.
- Migrating existing data may surface illegal historical transitions
  that need a one-off cleanup.

---

## 15. Disaster recovery: backups, point-in-time restore, runbooks

Production-grade Postgres is backed up *automatically* (managed
Postgres on RDS/Cloud SQL) with PITR enabled. The application has no
say in this, but the team needs:

- A documented RTO/RPO target.
- A quarterly restore drill — backup is worthless if you've never
  tested the restore.
- Runbooks for the common incidents (DB unreachable, slow query,
  status-update latency spike, deploy rollback).

---

## 16. Accessibility and i18n

**Gap.** The current frontend is keyboard-navigable, has correct ARIA
roles, and survives axe-core smoke tests in Playwright. What it
doesn't have: full WCAG 2.2 AA conformance audit, translations, RTL
support, or a screen-reader test pass.

**Proposed change.**

- **Audit.** Run a manual screen-reader pass (NVDA + VoiceOver). Fix
  whatever fails. axe-core catches structural issues but not "this
  control announces wrong."
- **i18n.** `react-intl` or `lingui`. Strings move to message
  catalogs; the date/time formatting we already do via `Intl` is i18n-
  aware out of the box.
- **RTL.** Tailwind's logical properties (`ms-*`, `me-*`, `start`,
  `end`) handle most cases; the design tokens already lean on them.

---

## 17. Richer commit messages and PR descriptions

**Gap.** The commit log on this repo is intentionally terse — short
subject lines, almost no bodies. That is consistent with my personal
preference for keeping rationale in the diff and the PR description
rather than the commit body, but in this take-home the PR descriptions
are also thin, which means the *why* behind several non-obvious
choices lives only in the ADR and CLAUDE.md rather than in the git
history itself. A new contributor running `git log -p` would not
recover the full reasoning chain.

**Proposed change.** Adopt a lightweight Conventional Commits-style
contract enforced by a commit hook, with bodies expected on anything
non-trivial:

- Subject: `<type>(<scope>): <imperative summary>` capped at ~72
  chars (e.g., `feat(jobs): denormalize current_status on PATCH`).
- Body: one short paragraph on **why**, plus a `Refs:` line pointing
  to the relevant ADR / spec task / GitHub issue.
- PR description template that mirrors the commit body and adds a
  test-plan checklist (the GitHub PR template in this repo is a
  starting point, but the body sections are not enforced).

The reason this didn't happen in the take-home is honest: I did not
spend the time to instruct Claude on the commit-message conventions I
would have applied to a production repo. The model defaults to
short, descriptive subjects (which matches my personal preference and
is captured in my global Claude memory), and I let that default ride
because the gating criterion was `make test` passing on a cold
machine, not commit archaeology. On a real project, the
prompt-engineering investment for commit conventions is small and
the payoff compounds — every future bisect, every future onboard
benefits — so it would land in the first sprint.

**Trade-offs.**

- Slightly more friction per commit. Mitigated by a `commitlint` hook
  and a PR template that pre-fills the structure.
- The model occasionally produces verbose bodies that need trimming;
  a one-line "keep it under 6 lines, lead with *why*" instruction in
  CLAUDE.md handles this.
- None of this changes the runtime; it is purely a process
  investment.
