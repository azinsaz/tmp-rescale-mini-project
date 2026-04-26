interface LoadingLineProps {
  label?: string;
}

export default function LoadingLine({ label = 'Loading…' }: LoadingLineProps) {
  return (
    <div role="status" aria-live="polite" className="font-mono text-sm text-stone-500">
      {label}
    </div>
  );
}
