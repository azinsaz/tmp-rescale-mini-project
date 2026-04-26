import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';

interface InputProps extends Omit<ComponentPropsWithoutRef<'input'>, 'children'> {
  error?: string | undefined;
  label?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, label, id: providedId, className = '', ...rest },
  ref,
) {
  const reactId = useId();
  const id = providedId ?? reactId;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label ? (
        <label
          htmlFor={id}
          className="font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500"
        >
          {label}
        </label>
      ) : null}
      <input
        {...rest}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`rounded border bg-white px-3 py-2 font-sans text-sm text-rescale-ink placeholder:text-stone-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rescale-blue/60 focus-visible:ring-offset-1 ${
          error ? 'border-red-500' : 'border-stone-300 focus-visible:border-rescale-blue'
        }`}
      />
      {error ? (
        <p id={errorId} className="font-mono text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
