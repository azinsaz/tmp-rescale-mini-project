import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface FilterPillProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  active: boolean;
  children: ReactNode;
}

export default function FilterPill({ active, children, className = '', ...rest }: FilterPillProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-pressed={active}
      className={`inline-flex items-center rounded px-3 py-2 font-sans text-xs font-medium tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60 focus-visible:ring-offset-1 ${
        active
          ? 'bg-stone-900 text-white'
          : 'bg-transparent text-stone-600 hover:bg-stone-100 hover:text-rescale-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}
