import type { KeyboardEvent, MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingLine from '../../components/LoadingLine';
import Pagination from '../../components/Pagination';
import { parseCursorFromNextUrl } from '../../lib/cursor';
import { relativeTime, useJobs } from './jobs.hooks';
import JobRowMenu from './JobRowMenu';
import StatusQuickChange from './StatusQuickChange';
import { DEFAULT_SORT, isSortKey, type Job, type SortKey, type StatusType } from './jobs.types';

const COLUMN_SORTS = {
  name: { asc: 'name', desc: '-name' },
  created_at: { asc: 'created_at', desc: '-created_at' },
  updated_at: { asc: 'updated_at', desc: '-updated_at' },
} as const satisfies Record<string, { asc: SortKey; desc: SortKey }>;

type SortableColumn = keyof typeof COLUMN_SORTS;

function parseSort(raw: string | null): { column: SortableColumn; desc: boolean } {
  const sort: SortKey = isSortKey(raw) ? raw : DEFAULT_SORT;
  const desc = sort.startsWith('-');
  const field = (desc ? sort.slice(1) : sort) as SortableColumn;
  return { column: field, desc };
}

export default function JobList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusType | null) ?? undefined;
  const cursor = params.get('cursor') ?? undefined;
  const sortRaw = params.get('sort');
  const sort: SortKey = isSortKey(sortRaw) ? sortRaw : DEFAULT_SORT;
  const { column: sortColumn, desc: sortDesc } = parseSort(sortRaw);

  const query = useJobs({
    ...(status !== undefined ? { status } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    sort,
  });

  function setCursor(next: string | null) {
    const np = new URLSearchParams(params);
    if (next) np.set('cursor', next);
    else np.delete('cursor');
    setParams(np);
  }

  function clearFilter() {
    const np = new URLSearchParams(params);
    np.delete('status');
    np.delete('cursor');
    setParams(np);
  }

  /** Apply a new sort. Resets cursor (cursors are sort-specific). */
  function applySort(next: SortKey) {
    const np = new URLSearchParams(params);
    if (next === DEFAULT_SORT) np.delete('sort');
    else np.set('sort', next);
    np.delete('cursor');
    setParams(np);
  }

  function openRow(job: Job) {
    navigate(`/jobs/${job.id}`);
  }

  if (query.isLoading) return <LoadingLine />;
  if (query.isError) {
    return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  if (!data) return null;
  const rows = data.results;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        <p className="font-mono text-sm text-stone-500">
          {status ? 'No jobs match this filter.' : 'No jobs yet — create one above.'}
        </p>
        {status ? (
          <button
            type="button"
            onClick={clearFilter}
            className="font-sans text-sm text-rescale-blue hover:text-rescale-blue-strong"
          >
            Clear filter
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MobileSortBar current={sort} onChange={applySort} />
      <DesktopTable
        rows={rows}
        sortColumn={sortColumn}
        sortDesc={sortDesc}
        onSort={applySort}
        onOpen={openRow}
      />
      <MobileCards rows={rows} onOpen={openRow} />
      <Pagination
        hasPrev={!!data.previous}
        hasNext={!!data.next}
        onPrev={() => setCursor(parseCursorFromNextUrl(data.previous))}
        onNext={() => setCursor(parseCursorFromNextUrl(data.next))}
      />
    </div>
  );
}

// ─── Desktop table ───────────────────────────────────────────────────────────

interface DesktopTableProps {
  rows: Job[];
  sortColumn: SortableColumn;
  sortDesc: boolean;
  onSort: (next: SortKey) => void;
  onOpen: (job: Job) => void;
}

function DesktopTable({ rows, sortColumn, sortDesc, onSort, onOpen }: DesktopTableProps) {
  return (
    <table className="hidden w-full border-collapse md:table">
      <thead>
        <tr className="border-b border-stone-200 text-left">
          <SortHeader
            column="name"
            label="Name"
            active={sortColumn}
            desc={sortDesc}
            onSort={onSort}
            defaultDesc={false}
          />
          <th
            scope="col"
            className="px-3 py-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500"
          >
            Status
          </th>
          <th
            scope="col"
            className="px-3 py-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500"
          >
            ID
          </th>
          <SortHeader
            column="created_at"
            label="Created"
            active={sortColumn}
            desc={sortDesc}
            onSort={onSort}
            defaultDesc
          />
          <SortHeader
            column="updated_at"
            label="Updated"
            active={sortColumn}
            desc={sortDesc}
            onSort={onSort}
            defaultDesc
          />
          <th scope="col" className="w-10 px-2 py-2">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((job) => (
          <Row key={job.id} job={job} onOpen={onOpen} />
        ))}
      </tbody>
    </table>
  );
}

interface SortHeaderProps {
  column: SortableColumn;
  label: string;
  active: SortableColumn;
  desc: boolean;
  onSort: (next: SortKey) => void;
  defaultDesc: boolean;
}

function SortHeader({ column, label, active, desc, onSort, defaultDesc }: SortHeaderProps) {
  const isActive = active === column;
  const ariaSort = isActive ? (desc ? 'descending' : 'ascending') : 'none';
  const arrow = !isActive ? '↕' : desc ? '↓' : '↑';

  function handle() {
    if (!isActive) {
      // First click on a new column: use the column's natural direction.
      onSort(defaultDesc ? COLUMN_SORTS[column].desc : COLUMN_SORTS[column].asc);
    } else {
      // Toggle direction.
      onSort(desc ? COLUMN_SORTS[column].asc : COLUMN_SORTS[column].desc);
    }
  }

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className="px-3 py-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500"
    >
      <button
        type="button"
        onClick={handle}
        className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:text-rescale-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
      >
        {label}
        <span aria-hidden="true" className={isActive ? 'text-rescale-ink' : 'text-stone-400'}>
          {arrow}
        </span>
      </button>
    </th>
  );
}

interface RowProps {
  job: Job;
  onOpen: (job: Job) => void;
}

function Row({ job, onOpen }: RowProps) {
  function rowKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      // Don't activate when the user pressed inside an interactive child.
      const target = e.target as HTMLElement;
      if (target.closest('button, a, [role="menu"]')) return;
      e.preventDefault();
      onOpen(job);
    }
  }

  function rowClick(e: MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="menu"]')) return;
    onOpen(job);
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      data-job-id={job.id}
      aria-label={`Open ${job.name}`}
      onClick={rowClick}
      onKeyDown={rowKeyDown}
      className="cursor-pointer border-b border-stone-100 outline-none transition-colors last:border-b-0 hover:bg-stone-50 focus-visible:bg-rescale-blue-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rescale-blue/60"
    >
      <td className="px-3 py-3 font-sans text-sm font-medium text-rescale-ink">{job.name}</td>
      <td className="px-3 py-3">
        <StatusQuickChange jobId={job.id} currentStatus={job.current_status} size="sm" />
      </td>
      <td className="px-3 py-3 font-mono text-xs text-stone-500">#{job.id}</td>
      <td className="px-3 py-3 font-mono text-xs text-stone-500">{relativeTime(job.created_at)}</td>
      <td className="px-3 py-3 font-mono text-xs text-stone-500">{relativeTime(job.updated_at)}</td>
      <td className="px-2 py-3 text-right">
        <JobRowMenu job={job} />
      </td>
    </tr>
  );
}

// ─── Mobile cards ────────────────────────────────────────────────────────────

interface MobileCardsProps {
  rows: Job[];
  onOpen: (job: Job) => void;
}

function MobileCards({ rows, onOpen }: MobileCardsProps) {
  return (
    <ul data-list="cards" className="flex flex-col gap-2 md:hidden" aria-label="Jobs">
      {rows.map((job) => (
        <li key={job.id}>
          <Card job={job} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function Card({ job, onOpen }: RowProps) {
  function articleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, [role="menu"]')) return;
      e.preventDefault();
      onOpen(job);
    }
  }
  function articleClick(e: MouseEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="menu"]')) return;
    onOpen(job);
  }
  return (
    <article
      role="link"
      tabIndex={0}
      data-job-id={job.id}
      aria-label={`Open ${job.name}`}
      onClick={articleClick}
      onKeyDown={articleKeyDown}
      className="cursor-pointer rounded border border-stone-200 bg-white p-3 outline-none transition-colors hover:bg-stone-50 focus-visible:bg-rescale-blue-soft focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-sans text-sm font-medium leading-tight text-rescale-ink">{job.name}</h3>
        <JobRowMenu job={job} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
          Status
        </dt>
        <dd>
          <StatusQuickChange jobId={job.id} currentStatus={job.current_status} size="sm" />
        </dd>
        <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
          ID
        </dt>
        <dd className="font-mono text-xs text-stone-700">#{job.id}</dd>
        <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
          Created
        </dt>
        <dd className="font-mono text-xs text-stone-700">{relativeTime(job.created_at)}</dd>
        <dt className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
          Updated
        </dt>
        <dd className="font-mono text-xs text-stone-700">{relativeTime(job.updated_at)}</dd>
      </dl>
    </article>
  );
}

// ─── Mobile sort bar ─────────────────────────────────────────────────────────

interface MobileSortBarProps {
  current: SortKey;
  onChange: (next: SortKey) => void;
}

function MobileSortBar({ current, onChange }: MobileSortBarProps) {
  const desc = current.startsWith('-');
  const field = (desc ? current.slice(1) : current) as SortableColumn;

  function setField(next: SortableColumn) {
    onChange(desc ? COLUMN_SORTS[next].desc : COLUMN_SORTS[next].asc);
  }
  function toggleDir() {
    onChange(desc ? COLUMN_SORTS[field].asc : COLUMN_SORTS[field].desc);
  }

  return (
    <div className="flex items-center gap-2 md:hidden">
      <label
        htmlFor="sort-select"
        className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500"
      >
        Sort
      </label>
      <select
        id="sort-select"
        value={field}
        onChange={(e) => setField(e.target.value as SortableColumn)}
        className="rounded border border-stone-300 bg-white px-2 py-1 font-sans text-sm text-rescale-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
      >
        <option value="created_at">Created</option>
        <option value="updated_at">Updated</option>
        <option value="name">Name</option>
      </select>
      <button
        type="button"
        onClick={toggleDir}
        aria-label={desc ? 'Sort ascending' : 'Sort descending'}
        title={desc ? 'Descending — click for ascending' : 'Ascending — click for descending'}
        className="inline-flex h-9 w-9 items-center justify-center rounded border border-stone-300 bg-white font-mono text-sm text-rescale-ink hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60"
      >
        {desc ? '↓' : '↑'}
      </button>
    </div>
  );
}
