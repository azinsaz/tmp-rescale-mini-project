import type { StatusType } from '../features/jobs/jobs.types';

type Variant = {
  glyph: 'circle-open' | 'triangle' | 'circle-filled' | 'cross';
  classes: string;
};

const VARIANTS: Record<StatusType, Variant> = {
  PENDING: {
    glyph: 'circle-open',
    classes: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  RUNNING: {
    glyph: 'triangle',
    classes: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  COMPLETED: {
    glyph: 'circle-filled',
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  FAILED: {
    glyph: 'cross',
    classes: 'bg-red-100 text-red-800 border-red-300',
  },
};

function Glyph({ kind }: { kind: Variant['glyph'] }) {
  // 10x10 viewBox, currentColor
  switch (kind) {
    case 'circle-open':
      return (
        <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'triangle':
      return (
        <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
          <path d="M2 1.5 L9 5 L2 8.5 Z" fill="currentColor" />
        </svg>
      );
    case 'circle-filled':
      return (
        <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
          <circle cx="5" cy="5" r="3.5" fill="currentColor" />
        </svg>
      );
    case 'cross':
      return (
        <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2.5 w-2.5">
          <path
            d="M2 2 L8 8 M8 2 L2 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

export interface StatusPillProps {
  state: StatusType;
  size?: 'sm' | 'md';
}

export default function StatusPill({ state, size = 'md' }: StatusPillProps) {
  const v = VARIANTS[state];
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  return (
    <span
      role="status"
      aria-label={state}
      className={`inline-flex items-center gap-1.5 rounded border font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] ${padding} ${v.classes}`}
    >
      <Glyph kind={v.glyph} />
      {state}
    </span>
  );
}
