export type StatusType = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export const STATUS_VALUES: readonly StatusType[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;

export interface Job {
  id: number;
  name: string;
  current_status: StatusType;
  created_at: string;
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

/** Allow-list mirrors backend `JOB_SORT_VALUES` in `jobs/api.py`. */
export type SortKey =
  | 'created_at'
  | '-created_at'
  | 'updated_at'
  | '-updated_at'
  | 'name'
  | '-name';

export const SORT_VALUES: readonly SortKey[] = [
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
  'name',
  '-name',
] as const;

export const DEFAULT_SORT: SortKey = '-created_at';

export function isSortKey(v: string | null | undefined): v is SortKey {
  return v != null && (SORT_VALUES as readonly string[]).includes(v);
}
