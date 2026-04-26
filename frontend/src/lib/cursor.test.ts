import { describe, expect, it } from 'vitest';
import { parseCursorFromNextUrl } from './cursor';

describe('parseCursorFromNextUrl', () => {
  it('returns null for null input', () => {
    expect(parseCursorFromNextUrl(null)).toBeNull();
  });

  it('extracts cursor from a full host URL', () => {
    expect(parseCursorFromNextUrl('http://localhost:8080/api/jobs/?cursor=cD0xMDA%3D')).toBe(
      'cD0xMDA=',
    );
  });

  it('extracts cursor from a backend-internal hostname', () => {
    expect(parseCursorFromNextUrl('http://backend:8000/api/jobs/?cursor=abc')).toBe('abc');
  });

  it('returns null when the cursor param is missing', () => {
    expect(parseCursorFromNextUrl('http://localhost:8080/api/jobs/')).toBeNull();
  });

  it('returns null on a malformed URL string', () => {
    expect(parseCursorFromNextUrl('not a url')).toBeNull();
  });
});
