import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../../lib/api-client';
import type { CursorPage, Job, JobStatus, SortKey, StatusType } from './jobs.types';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a query string from defined values; skips `undefined`, `null`, and `''`. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}

/** Relative-time formatter using Intl.RelativeTimeFormat — no date library. */
const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RT_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSec = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of RT_UNITS) {
    if (abs >= secs || unit === 'second') {
      return RTF.format(Math.round(diffSec / secs), unit);
    }
  }
  return RTF.format(diffSec, 'second');
}

// ─── query keys ───────────────────────────────────────────────────────────────

export interface JobsListArgs {
  status?: StatusType;
  cursor?: string;
  sort?: SortKey;
}

export const keys = {
  all: ['jobs'] as const,
  list: (q: JobsListArgs) => ['jobs', 'list', q] as const,
  detail: (id: number) => ['jobs', 'detail', id] as const,
  history: (id: number, cursor?: string) => ['jobs', 'history', id, cursor ?? null] as const,
};

// ─── endpoint functions ───────────────────────────────────────────────────────

export const fetchJobs = (q: JobsListArgs) => apiGet<CursorPage<Job>>(`/api/jobs/${qs({ ...q })}`);

export const fetchJob = (id: number) => apiGet<Job>(`/api/jobs/${id}/`);

export const fetchStatuses = (id: number, cursor?: string) =>
  apiGet<CursorPage<JobStatus>>(`/api/jobs/${id}/statuses/${qs({ cursor })}`);

export const createJobApi = (name: string) => apiPost<Job>('/api/jobs/', { name });

export const updateStatusApi = (id: number, s: StatusType) =>
  apiPatch<Job>(`/api/jobs/${id}/`, { status_type: s });

export const deleteJobApi = (id: number) => apiDelete(`/api/jobs/${id}/`);

// ─── query hooks ──────────────────────────────────────────────────────────────

export function useJobs(args: JobsListArgs): UseQueryResult<CursorPage<Job>, ApiError> {
  return useQuery<CursorPage<Job>, ApiError>({
    queryKey: keys.list(args),
    queryFn: () => fetchJobs(args),
    placeholderData: (prev) => prev,
  });
}

export function useJob(id: number): UseQueryResult<Job, ApiError> {
  return useQuery<Job, ApiError>({
    queryKey: keys.detail(id),
    queryFn: () => fetchJob(id),
    enabled: Number.isFinite(id),
  });
}

export function useStatuses(
  id: number,
  cursor?: string,
): UseQueryResult<CursorPage<JobStatus>, ApiError> {
  return useQuery<CursorPage<JobStatus>, ApiError>({
    queryKey: keys.history(id, cursor),
    queryFn: () => fetchStatuses(id, cursor),
    enabled: Number.isFinite(id),
    placeholderData: (prev) => prev,
  });
}

// ─── mutation hooks ───────────────────────────────────────────────────────────

export function useCreateJob(): UseMutationResult<Job, ApiError, string> {
  const qc = useQueryClient();
  return useMutation<Job, ApiError, string>({
    mutationFn: (name) => createJobApi(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}

interface UpdateStatusContext {
  /** Snapshots of every list cache we touched, keyed by the actual queryKey. */
  listSnapshots: [readonly unknown[], CursorPage<Job> | undefined][];
  /** Snapshot of the detail cache (if present). */
  detailSnapshot: Job | undefined;
}

export function useUpdateStatus(
  id: number,
): UseMutationResult<Job, ApiError, StatusType, UpdateStatusContext> {
  const qc = useQueryClient();
  return useMutation<Job, ApiError, StatusType, UpdateStatusContext>({
    mutationFn: (s) => updateStatusApi(id, s),
    onMutate: async (next) => {
      // Optimistic update. Cancel in-flight refetches so they don't clobber
      // the optimistic write, snapshot every list+detail cache for rollback,
      // then patch them in place.
      await qc.cancelQueries({ queryKey: ['jobs', 'list'] });
      await qc.cancelQueries({ queryKey: keys.detail(id) });

      const listSnapshots = qc.getQueriesData<CursorPage<Job>>({
        queryKey: ['jobs', 'list'],
      });
      for (const [key, page] of listSnapshots) {
        if (!page) continue;
        qc.setQueryData<CursorPage<Job>>(key, {
          ...page,
          results: page.results.map((j) => (j.id === id ? { ...j, current_status: next } : j)),
        });
      }

      const detailSnapshot = qc.getQueryData<Job>(keys.detail(id));
      if (detailSnapshot) {
        qc.setQueryData<Job>(keys.detail(id), {
          ...detailSnapshot,
          current_status: next,
        });
      }

      return { listSnapshots, detailSnapshot };
    },
    onError: (_err, _next, ctx) => {
      // Roll back every snapshot we took.
      if (!ctx) return;
      for (const [key, page] of ctx.listSnapshots) {
        qc.setQueryData(key, page);
      }
      if (ctx.detailSnapshot !== undefined) {
        qc.setQueryData(keys.detail(id), ctx.detailSnapshot);
      }
    },
    onSuccess: (fresh) => {
      // Server-of-record wins: replace the detail cache with the fresh job.
      qc.setQueryData(keys.detail(id), fresh);
    },
    onSettled: () => {
      // Refetch list (so cursors/sort reflect the new updated_at) + history.
      // NOT umbrella — that would refetch detail and clobber the setQueryData.
      void qc.invalidateQueries({ queryKey: ['jobs', 'list'] });
      void qc.invalidateQueries({ queryKey: ['jobs', 'history', id] });
    },
  });
}

export function useDeleteJob(): UseMutationResult<void, ApiError, number> {
  const qc = useQueryClient();
  return useMutation<void, ApiError, number>({
    mutationFn: (id) => deleteJobApi(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}
