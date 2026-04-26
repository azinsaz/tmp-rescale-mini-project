import type { ApiError } from '../lib/api-client';
import Button from './Button';

interface ErrorBannerProps {
  error: ApiError | Error | null;
  onRetry?: () => void;
}

export default function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  if (!error) return null;
  const detail = error.message || 'Something went wrong';
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded border border-red-200 bg-red-50 px-4 py-3"
    >
      <div>
        <p className="mb-0.5 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-red-700">
          Error
        </p>
        <p className="font-mono text-sm text-red-900">{detail}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" type="button" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      ) : null}
    </div>
  );
}
