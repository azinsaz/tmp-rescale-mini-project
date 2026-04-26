import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  keys,
  qs,
  relativeTime,
  useCreateJob,
  useDeleteJob,
  useJob,
  useJobs,
  useUpdateStatus,
} from './jobs.hooks';
import { clearFetchMock, mockFetchOnce, mockResponse } from '../../test-utils/mockFetch';
import type { Job } from './jobs.types';

const job1: Job = {
  id: 1,
  name: 'Sim A',
  current_status: 'PENDING',
  created_at: '2026-04-25T10:00:00Z',
  updated_at: '2026-04-25T10:00:00Z',
};

function makeWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

describe('qs', () => {
  it('skips undefined / null / empty values', () => {
    expect(qs({ status: undefined, cursor: 'abc' })).toBe('?cursor=abc');
    expect(qs({ status: null, cursor: '' })).toBe('');
    expect(qs({})).toBe('');
  });

  it('encodes set values', () => {
    expect(qs({ status: 'RUNNING', cursor: 'p=100' })).toBe('?status=RUNNING&cursor=p%3D100');
  });
});

describe('keys', () => {
  it('keeps every key under the umbrella prefix', () => {
    expect(keys.all).toEqual(['jobs']);
    expect(keys.list({ status: 'PENDING' })[0]).toBe('jobs');
    expect(keys.detail(1)[0]).toBe('jobs');
    expect(keys.history(1)[0]).toBe('jobs');
  });
});

describe('relativeTime', () => {
  it('formats minutes ago', () => {
    const now = new Date('2026-04-25T10:30:00Z');
    expect(relativeTime('2026-04-25T10:25:00Z', now)).toMatch(/5 minutes ago/);
  });
});

describe('useJobs', () => {
  afterEach(clearFetchMock);

  it('calls fetchJobs with the right query string', async () => {
    const fetchMock = mockFetchOnce(
      mockResponse({ status: 200, body: { results: [job1], next: null, previous: null } }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useJobs({ status: 'RUNNING', cursor: 'abc' }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/?status=RUNNING&cursor=abc',
      expect.anything(),
    );
  });
});

describe('useJob', () => {
  afterEach(clearFetchMock);

  it('does not fetch when id is NaN', () => {
    const fetchMock = mockFetchOnce(mockResponse({ status: 200, body: job1 }));
    const { Wrapper } = makeWrapper();
    renderHook(() => useJob(Number.NaN), { wrapper: Wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useCreateJob', () => {
  afterEach(clearFetchMock);

  it('invalidates the umbrella ["jobs"] on success', async () => {
    mockFetchOnce(mockResponse({ status: 201, body: job1 }));
    const { Wrapper, client } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateJob(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('Sim A');
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });
});

describe('useUpdateStatus', () => {
  afterEach(clearFetchMock);

  it('writes detail cache and invalidates list + history precisely (NOT umbrella)', async () => {
    const updated = { ...job1, current_status: 'RUNNING' as const };
    mockFetchOnce(mockResponse({ status: 200, body: updated }));
    const { Wrapper, client } = makeWrapper();
    const invSpy = vi.spyOn(client, 'invalidateQueries');

    // Seed the detail cache so onMutate has something to snapshot.
    client.setQueryData(['jobs', 'detail', 1], job1);

    const { result } = renderHook(() => useUpdateStatus(1), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('RUNNING');
    });

    // Detail cache holds the server-of-record value after onSuccess.
    expect(client.getQueryData(['jobs', 'detail', 1])).toEqual(updated);

    const calls = invSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: ['jobs', 'list'] });
    expect(calls).toContainEqual({ queryKey: ['jobs', 'history', 1] });
    // umbrella must NOT be invalidated — that would clobber the setQueryData
    expect(calls).not.toContainEqual({ queryKey: ['jobs'] });
  });

  it('optimistically patches every list cache and rolls back on error', async () => {
    const { Wrapper, client } = makeWrapper();
    const listKey = ['jobs', 'list', { sort: '-created_at' }];
    const initialPage = { results: [job1], next: null, previous: null };
    client.setQueryData(listKey, initialPage);

    // Make the request fail.
    mockFetchOnce(mockResponse({ status: 500, body: { detail: 'boom' } }));

    const { result } = renderHook(() => useUpdateStatus(1), { wrapper: Wrapper });
    await act(async () => {
      try {
        await result.current.mutateAsync('RUNNING');
      } catch {
        /* expected */
      }
    });

    // After rollback the list cache must equal the original page.
    expect(client.getQueryData(listKey)).toEqual(initialPage);
  });
});

describe('useDeleteJob', () => {
  afterEach(clearFetchMock);

  it('204 resolves and invalidates umbrella', async () => {
    mockFetchOnce(mockResponse({ status: 204 }));
    const { Wrapper, client } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteJob(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });
});
