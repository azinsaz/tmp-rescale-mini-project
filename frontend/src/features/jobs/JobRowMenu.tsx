import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useConfirmDelete } from './ConfirmDeleteDialog';
import type { Job } from './jobs.types';

/** Trailing per-row actions menu (kebab). Currently exposes Delete only. */
export default function JobRowMenu({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const menuId = useId();
  const confirm = useConfirmDelete();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => itemRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: globalThis.MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function close() {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') setOpen(false);
  }

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <span onClick={stop}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${job.name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
      >
        <span aria-hidden="true" className="font-mono text-base leading-none">
          ⋯
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`Actions for ${job.name}`}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              onClick={stop}
              style={{ position: 'fixed', top: pos.top, right: pos.right }}
              className="z-40 min-w-[160px] rounded-md border border-stone-200 bg-white p-1 shadow-lg"
            >
              <button
                ref={itemRef}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  confirm.open({ id: job.id, name: job.name });
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-sans text-sm text-red-700 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
              >
                Delete…
              </button>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
