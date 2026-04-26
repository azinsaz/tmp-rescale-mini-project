import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-16 md:px-8">
      <section className="rounded-md border border-stone-200 bg-white p-8 shadow-sm">
        <p className="mb-2 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
          404
        </p>
        <h1 className="mb-2 font-display text-3xl font-medium tracking-tight text-rescale-ink">
          Not found
        </h1>
        <p className="mb-6 text-stone-600">The page you requested does not exist.</p>
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
