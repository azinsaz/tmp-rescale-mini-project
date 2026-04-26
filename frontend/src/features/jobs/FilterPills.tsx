import { useSearchParams } from 'react-router';
import FilterPill from '../../components/FilterPill';
import { STATUS_VALUES, type StatusType } from './jobs.types';

const ALL = 'ALL' as const;
type FilterValue = typeof ALL | StatusType;
const FILTERS: FilterValue[] = [ALL, ...STATUS_VALUES];

export default function FilterPills() {
  const [params, setParams] = useSearchParams();
  const current = (params.get('status') as StatusType | null) ?? ALL;

  function select(next: FilterValue) {
    const np = new URLSearchParams(params);
    if (next === ALL) np.delete('status');
    else np.set('status', next);
    np.delete('cursor'); // filter changes invalidate cursor
    setParams(np);
  }

  return (
    <nav aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
        Filter
      </span>
      {FILTERS.map((value) => (
        <FilterPill key={value} active={current === value} onClick={() => select(value)}>
          {value === ALL ? 'All' : value}
        </FilterPill>
      ))}
    </nav>
  );
}
