import { vi } from 'vitest';

interface MockResponseInit {
  status?: number;
  body?: unknown;
  text?: string;
}

/**
 * Build a Response-shape that the api-client treats correctly.
 * - 204: returns undefined body
 * - 2xx with body: JSON
 * - 4xx/5xx with envelope body: typed ApiError
 * - rawText forces non-JSON parse failure (generic ApiError)
 */
export function mockResponse({ status = 200, body, text }: MockResponseInit): Response {
  const init: globalThis.ResponseInit = { status };
  if (text !== undefined) return new Response(text, init);
  if (status === 204) return new Response(null, init);
  return new Response(JSON.stringify(body ?? {}), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function mockFetchOnce(...responses: Response[]) {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function mockFetchReject(error: unknown) {
  const fn = vi.fn().mockRejectedValue(error);
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function clearFetchMock() {
  vi.unstubAllGlobals();
}
