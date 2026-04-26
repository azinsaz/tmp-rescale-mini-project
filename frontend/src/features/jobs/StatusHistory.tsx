import { useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingLine from '../../components/LoadingLine';
import Pagination from '../../components/Pagination';
import StatusPill from '../../components/StatusPill';
import { parseCursorFromNextUrl } from '../../lib/cursor';
import { useStatuses } from './jobs.hooks';

export default function StatusHistory({ jobId }: { jobId: number }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const query = useStatuses(jobId, cursor);

  if (query.isLoading) return <LoadingLine />;
  if (query.isError) {
    return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  if (!data) return null;
  const rows = data.results;

  return (
    <div className="flex flex-col gap-4">
      <ol className="relative ml-2 flex flex-col gap-4 border-l border-stone-200 pl-6">
        {rows.map((entry) => (
          <li key={entry.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-[31px] top-1 flex h-[19px] w-[19px] items-center justify-center rounded-full border border-stone-200 bg-white"
            >
              <span className="block h-2 w-2 rounded-full bg-stone-300" />
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill state={entry.status_type} size="sm" />
              <time dateTime={entry.timestamp} className="font-mono text-xs text-stone-500">
                {entry.timestamp}
              </time>
            </div>
          </li>
        ))}
      </ol>
      <Pagination
        hasPrev={!!data.previous}
        hasNext={!!data.next}
        onPrev={() => setCursor(parseCursorFromNextUrl(data.previous) ?? undefined)}
        onNext={() => setCursor(parseCursorFromNextUrl(data.next) ?? undefined)}
      />
    </div>
  );
}
