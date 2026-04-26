import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import { useDeleteJob } from './jobs.hooks';

interface DeleteTarget {
  id: number;
  name: string;
  /** Where to navigate after a successful delete. Defaults to staying put. */
  navigateOnSuccess?: string;
}

interface ConfirmDeleteContextValue {
  open: (target: DeleteTarget) => void;
}

const ConfirmDeleteContext = createContext<ConfirmDeleteContextValue | null>(null);

/** Imperative opener used by row kebabs and the drawer footer. */
export function useConfirmDelete(): ConfirmDeleteContextValue {
  const ctx = useContext(ConfirmDeleteContext);
  if (!ctx) {
    throw new Error('useConfirmDelete must be used within <ConfirmDeleteProvider>');
  }
  return ctx;
}

/** Provider that mounts a single ConfirmDeleteDialog at the page root.
 *
 * Single instance avoids per-row dialog markup and keeps focus-return logic
 * in one place. The trigger that called `open` is restored on close via
 * `document.activeElement` snapshot.
 */
export function ConfirmDeleteProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((t: DeleteTarget) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setTarget(t);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    queueMicrotask(() => triggerRef.current?.focus?.());
  }, []);

  return (
    <ConfirmDeleteContext.Provider value={{ open }}>
      {children}
      {target ? <Dialog target={target} onClose={close} /> : null}
    </ConfirmDeleteContext.Provider>
  );
}

interface DialogProps {
  target: DeleteTarget;
  onClose: () => void;
}

function Dialog({ target, onClose }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const mutation = useDeleteJob();

  // Default focus on Cancel — destructive default is unsafe.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Body scroll lock for the modal lifetime.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      // Two-button focus trap: bounce between Cancel and Delete only.
      const els = [cancelRef.current, deleteRef.current].filter(Boolean) as HTMLElement[];
      if (els.length === 0) return;
      const idx = els.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const next = e.shiftKey
        ? els[(idx - 1 + els.length) % els.length]
        : els[(idx + 1) % els.length];
      next?.focus();
    }
  }

  function confirm() {
    mutation.mutate(target.id, {
      onSuccess: () => {
        onClose();
        if (target.navigateOnSuccess) navigate(target.navigateOnSuccess);
      },
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-md rounded-md border border-stone-200 bg-white p-6 shadow-xl"
      >
        <p className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-red-700">
          Delete
        </p>
        <h2
          id={titleId}
          className="mb-2 font-display text-xl font-medium tracking-tight text-rescale-ink"
        >
          Delete <span className="font-mono">{target.name}</span>?
        </h2>
        <p id={descId} className="mb-4 font-sans text-sm text-stone-700">
          This permanently removes the job and its full status history. This cannot be undone.
        </p>
        <ErrorBanner error={mutation.error ?? null} />
        <div className="mt-4 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button ref={cancelRef} type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={deleteRef}
            type="button"
            variant="danger"
            loading={mutation.isPending}
            onClick={confirm}
          >
            Delete job
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
