import { Outlet } from 'react-router';
import Panel from '../components/Panel';
import { ConfirmDeleteProvider } from '../features/jobs/ConfirmDeleteDialog';
import CreateJobForm from '../features/jobs/CreateJobForm';
import FilterPills from '../features/jobs/FilterPills';
import JobList from '../features/jobs/JobList';

export default function JobsListPage() {
  return (
    <ConfirmDeleteProvider>
      <main className="mx-auto w-full max-w-[1100px] px-4 py-8 md:px-8 md:py-10">
        <header className="mb-8 flex flex-col gap-4 border-b border-stone-200 pb-6">
          <div className="flex flex-wrap items-center gap-3">
            <img src="/rescale-logo.png" alt="Rescale" className="h-8 md:h-10" />
          </div>
          <div>
            <p className="mb-1 font-sans text-[10.5px] font-medium uppercase tracking-[0.14em] text-stone-500">
              Dashboard
            </p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-rescale-ink md:text-[40px]">
              Job Management
            </h1>
          </div>
        </header>

        <Panel className="flex flex-col gap-6 p-5 md:p-6">
          <CreateJobForm />
          <FilterPills />
          <JobList />
        </Panel>
      </main>
      {/* Drawer renders here when /jobs/:id matches. */}
      <Outlet />
    </ConfirmDeleteProvider>
  );
}
