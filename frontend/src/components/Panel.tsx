import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface PanelProps extends ComponentPropsWithoutRef<'section'> {
  children: ReactNode;
}

export default function Panel({ children, className = '', ...rest }: PanelProps) {
  return (
    <section
      {...rest}
      className={`rounded-md border border-stone-200 bg-white shadow-[0_1px_0_rgba(28,25,23,0.02),0_1px_3px_rgba(28,25,23,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}
