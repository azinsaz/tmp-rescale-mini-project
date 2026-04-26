/**
 * Backend returns the next-page link as a full URL with `?cursor=…`.
 * Extract the cursor value via URLSearchParams; tolerate absolute (incl. internal-host)
 * and theoretically-relative URLs.
 */
export function parseCursorFromNextUrl(next: string | null): string | null {
  if (!next) return null;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    return new URL(next, base).searchParams.get('cursor');
  } catch {
    return null;
  }
}
