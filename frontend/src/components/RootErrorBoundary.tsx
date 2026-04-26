import { Link, useRouteError } from 'react-router';

export default function RootErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-16 md:px-8">
      <section role="alert" className="rounded-md border border-red-200 bg-red-50 p-8 shadow-sm">
        <p className="mb-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-red-700">
          Error
        </p>
        <h1 className="mb-2 font-display text-3xl font-medium tracking-tight text-rescale-ink">
          Something went wrong
        </h1>
        <p className="mb-6 font-mono text-sm text-stone-700">{message}</p>
        <Link
          to="/jobs"
          className="font-sans text-sm text-rescale-blue hover:text-rescale-blue-strong"
        >
          ← Back to job list
        </Link>
      </section>
    </main>
  );
}
