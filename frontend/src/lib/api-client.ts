import type { ApiErrorBody } from '../features/jobs/jobs.types';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly errors?: ApiErrorBody['errors'];

  constructor(status: number, detail: string, errors?: ApiErrorBody['errors']) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    if (errors !== undefined) this.errors = errors;
  }

  /** Returns the first validation error for the given field path, if any. */
  fieldError(field: string): string | undefined {
    return this.errors?.find((e) => e.loc.includes(field))?.msg;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' } }),
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (res.ok) {
    return (await res.json()) as T;
  }

  let parsed: ApiErrorBody | undefined;
  try {
    parsed = (await res.json()) as ApiErrorBody;
  } catch {
    /* fall through to generic */
  }

  if (parsed && typeof parsed.detail === 'string') {
    throw new ApiError(res.status, parsed.detail, parsed.errors);
  }
  throw new ApiError(res.status, 'Something went wrong');
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('POST', path, body);
export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>('PATCH', path, body);
export const apiDelete = (path: string): Promise<void> => request<void>('DELETE', path);
