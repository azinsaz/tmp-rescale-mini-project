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
import StatusPill from '../../components/StatusPill';
import { useUpdateStatus } from './jobs.hooks';
import { STATUS_VALUES, type StatusType } from './jobs.types';

interface Props {
  jobId: number;
  currentStatus: StatusType;
  /** Visual size of the trigger pill. */
  size?: 'sm' | 'md';
}

/** Pill-shaped trigger that opens a `role="menu"` of statuses.
 *
 * Picking a status fires an optimistic `useUpdateStatus`. Errors roll back
 * via the hook and surface as a small red caption under the pill (the row
 * stays compact — no full ErrorBanner, which would shove the layout).
 */
export default function StatusQuickChange({ jobId, currentStatus, size = 'md' }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const menuId = useId();
  const mutation = useUpdateStatus(jobId);

  // Position the floating menu directly under the trigger. Uses fixed
  // positioning so it doesn't get clipped by table overflow:hidden.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 160),
    });
  }, [open]);

  // Reposition on scroll/resize while open. Cheap — just recalculates.
  useEffect(() => {
    if (!open) return;
    const reflow = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
    };
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open]);

  // Default focus: the current status. Falls back to first.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(STATUS_VALUES.indexOf(currentStatus), 0);
    setFocusedIndex(idx);
    queueMicrotask(() => itemRefs.current[idx]?.focus());
  }, [open, currentStatus]);

  // Close on outside click / Escape (Escape handled in onKeyDown for focus return).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: globalThis.MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function close() {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  function move(delta: number) {
    const next = (focusedIndex + delta + STATUS_VALUES.length) % STATUS_VALUES.length;
    setFocusedIndex(next);
    itemRefs.current[next]?.focus();
  }

  function pick(s: StatusType) {
    if (s !== currentStatus) mutation.mutate(s);
    close();
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIndex(0);
      itemRefs.current[0]?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = STATUS_VALUES.length - 1;
      setFocusedIndex(last);
      itemRefs.current[last]?.focus();
      return;
    }
    if (e.key === 'Tab') {
      // Tab leaves the menu — just close.
      setOpen(false);
    }
  }

  function stop(e: MouseEvent) {
    // Don't let the click bubble to a clickable parent row.
    e.stopPropagation();
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5" onClick={stop}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Change status — current: ${currentStatus}`}
        data-testid={`status-trigger-${jobId}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="group inline-flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60 focus-visible:ring-offset-1"
      >
        <StatusPill state={currentStatus} size={size} />
        <span
          aria-hidden="true"
          className="font-mono text-[10px] text-stone-500 group-hover:text-stone-700"
        >
          ▾
        </span>
      </button>
      {mutation.isError ? (
        <span role="alert" className="font-mono text-[10.5px] text-red-700">
          Update failed — try again
        </span>
      ) : null}
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Change status"
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              onClick={stop}
              style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
              className="z-40 flex flex-col gap-1 rounded-md border border-stone-200 bg-white p-1 shadow-lg"
            >
              {STATUS_VALUES.map((value, i) => {
                const checked = value === currentStatus;
                return (
                  <button
                    key={value}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    tabIndex={i === focusedIndex ? 0 : -1}
                    onClick={() => pick(value)}
                    className={`flex items-center justify-between gap-3 rounded px-2 py-2 text-left transition-colors hover:bg-stone-100 focus:bg-stone-100 focus:outline-none ${
                      checked ? 'bg-stone-50' : ''
                    }`}
                  >
                    <StatusPill state={value} size="sm" />
                    {checked ? (
                      <span aria-hidden="true" className="font-mono text-xs text-stone-500">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
