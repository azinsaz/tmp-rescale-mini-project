import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from './api-client';
import {
  clearFetchMock,
  mockFetchOnce,
  mockFetchReject,
  mockResponse,
} from '../test-utils/mockFetch';

describe('api-client', () => {
  afterEach(clearFetchMock);

  it('parses 2xx JSON body', async () => {
    mockFetchOnce(mockResponse({ status: 200, body: { id: 1, name: 'X' } }));
    await expect(apiGet<{ id: number; name: string }>('/api/jobs/1/')).resolves.toEqual({
      id: 1,
      name: 'X',
    });
  });

  it('returns undefined on 204', async () => {
    mockFetchOnce(mockResponse({ status: 204 }));
    await expect(apiDelete('/api/jobs/1/')).resolves.toBeUndefined();
  });

  it('raises typed ApiError on 400 with envelope errors[]', async () => {
    mockFetchOnce(
      mockResponse({
        status: 400,
        body: {
          detail: 'Validation failed',
          errors: [{ loc: ['body', 'name'], msg: 'Name cannot be empty', type: 'value_error' }],
        },
      }),
    );
    await expect(apiPost('/api/jobs/', { name: '' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      detail: 'Validation failed',
    });
  });

  it('exposes fieldError() lookup on validation envelope', async () => {
    mockFetchOnce(
      mockResponse({
        status: 400,
        body: {
          detail: 'Validation failed',
          errors: [{ loc: ['body', 'name'], msg: 'Name cannot be empty', type: 'value_error' }],
        },
      }),
    );
    try {
      await apiPost('/api/jobs/', { name: '' });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).fieldError('name')).toBe('Name cannot be empty');
    }
  });

  it('raises ApiError(404) on 404 envelope', async () => {
    mockFetchOnce(mockResponse({ status: 404, body: { detail: 'Job not found' } }));
    await expect(apiGet('/api/jobs/9999/')).rejects.toMatchObject({
      status: 404,
      detail: 'Job not found',
    });
  });

  it('raises generic ApiError on 500 with no envelope', async () => {
    mockFetchOnce(mockResponse({ status: 500, text: '<html>oops</html>' }));
    await expect(apiGet('/api/jobs/')).rejects.toMatchObject({
      status: 500,
      detail: 'Something went wrong',
    });
  });

  it('raises generic ApiError when 4xx body is JSON without detail', async () => {
    mockFetchOnce(mockResponse({ status: 422, body: { unexpected: true } }));
    await expect(apiPatch('/api/jobs/1/', {})).rejects.toMatchObject({
      status: 422,
      detail: 'Something went wrong',
    });
  });

  it('raises ApiError(0, "Network error") on fetch reject', async () => {
    mockFetchReject(new TypeError('Failed to fetch'));
    await expect(apiGet('/api/jobs/')).rejects.toMatchObject({
      status: 0,
      detail: 'Network error',
    });
  });
});
