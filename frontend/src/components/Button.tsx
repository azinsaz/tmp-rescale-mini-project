import { forwardRef, type ComponentPropsWithoutRef } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-rescale-ink text-white hover:bg-stone-800 active:bg-stone-900 focus-visible:ring-rescale-blue/60',
  ghost:
    'bg-transparent text-rescale-ink hover:bg-stone-100 active:bg-stone-200 focus-visible:ring-rescale-blue/60',
  danger:
    'border border-red-300 bg-white text-red-700 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-400/60',
};

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, className = '', children, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      ref={ref}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded font-sans text-sm font-medium px-4 py-3 md:py-2 transition-colors ${FOCUS} ${VARIANTS[variant]} ${
        isDisabled ? 'opacity-40 cursor-not-allowed' : ''
      } ${className}`}
    >
      {children}
      {loading ? <span className="font-mono text-xs">…</span> : null}
    </button>
  );
});

export default Button;
