import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router';
import LoadingLine from '../../components/LoadingLine';
import StatusPill from '../../components/StatusPill';
import { ApiError } from '../../lib/api-client';
import Button from '../../components/Button';
import { useConfirmDelete } from './ConfirmDeleteDialog';
import { useJob } from './jobs.hooks';
import StatusHistory from './StatusHistory';
import StatusQuickChange from './StatusQuickChange';

/** Right-anchored drawer for job detail. Mounted by the `/jobs/:id` route.
 *
 * The list page stays mounted as the parent route, so opening/closing the
 * drawer doesn't refetch the list or reset scroll position.
 */
export default function JobDetailDrawer() {
  const { id } = useParams<{ id: string }>();
  const numericId = id !== undefined ? Number(id) : Number.NaN;
  const navigate = useNavigate();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  function close() {
    navigate('/jobs', { replace: false });
  }

  // Body scroll lock for the drawer's lifetime.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Focus the panel on mount so Escape works immediately even if the user
  // hasn't tabbed inside yet.
  useEffect(() => {
    queueMicrotask(() => panelRef.current?.focus());
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close drawer"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 bg-stone-900/30"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-stone-200 bg-stone-50 shadow-2xl outline-none animate-[drawer-in_240ms_cubic-bezier(0.16,1,0.3,1)] md:w-[480px]"
      >
        <DrawerBody jobId={numericId} titleId={titleId} onClose={close} />
      </div>
    </div>,
    document.body,
  );
}

interface BodyProps {
  jobId: number;
  titleId: string;
  onClose: () => void;
}

function DrawerBody({ jobId, titleId, onClose }: BodyProps) {
  const query = useJob(jobId);
  const confirm = useConfirmDelete();

  const isNotFound =
    !Number.isFinite(jobId) || (query.error instanceof ApiError && query.error.status === 404);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
            Job {Number.isFinite(jobId) ? <span className="font-mono">#{jobId}</span> : null}
          </p>
          {query.data ? (
            <h2
              id={titleId}
              className="truncate font-display text-2xl font-medium tracking-tight text-rescale-ink"
            >
              {query.data.name}
            </h2>
          ) : (
            <h2 id={titleId} className="font-display text-2xl text-stone-500">
              {isNotFound ? 'Not found' : 'Loading…'}
            </h2>
          )}
        </div>
        <button
          type="button"
          aria-label="Close drawer"
          onClick={onClose}
          className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ×
          </span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {query.isLoading ? <LoadingLine /> : null}

        {isNotFound ? (
          <div className="rounded border border-stone-200 bg-white p-5">
            <p className="font-sans text-sm text-stone-700">No job exists at this ID.</p>
          </div>
        ) : null}

        {!isNotFound && query.isError ? (
          <p role="alert" className="font-mono text-sm text-red-700">
            {query.error?.message ?? 'Could not load job.'}
          </p>
        ) : null}

        {query.data ? (
          <div className="flex flex-col gap-5">
            <section className="rounded border border-stone-200 bg-white p-4">
              <p className="mb-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
                Status
              </p>
              <StatusQuickChange jobId={query.data.id} currentStatus={query.data.current_status} />
              <p className="mt-3 font-sans text-xs text-stone-500">
                Click the pill to change. Updates apply immediately.
              </p>
            </section>

            <section className="rounded border border-stone-200 bg-white p-4">
              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
                    Created
                  </dt>
                  <dd className="font-mono text-xs text-stone-700">
                    <time dateTime={query.data.created_at}>{query.data.created_at}</time>
                  </dd>
                </div>
                <div>
                  <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
                    Updated
                  </dt>
                  <dd className="font-mono text-xs text-stone-700">
                    <time dateTime={query.data.updated_at}>{query.data.updated_at}</time>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded border border-stone-200 bg-white p-4">
              <p className="mb-3 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
                Status history
              </p>
              <StatusHistory jobId={query.data.id} />
            </section>
          </div>
        ) : null}
      </div>

      {query.data ? (
        <footer className="border-t border-stone-200 bg-white px-5 py-3">
          <Button
            type="button"
            variant="danger"
            onClick={() =>
              confirm.open({
                id: query.data!.id,
                name: query.data!.name,
                navigateOnSuccess: '/jobs',
              })
            }
          >
            Delete job
          </Button>
        </footer>
      ) : null}

      {/* Indicator for screen readers when the StatusPill in header would be missing */}
      {query.data ? (
        <span className="sr-only">
          Current status: <StatusPill state={query.data.current_status} />
        </span>
      ) : null}
    </>
  );
}
