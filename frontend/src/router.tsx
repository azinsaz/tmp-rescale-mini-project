import { createBrowserRouter, redirect } from 'react-router';
import RootErrorBoundary from './components/RootErrorBoundary';
import JobDetailDrawer from './features/jobs/JobDetailDrawer';
import JobsListPage from './pages/JobsListPage';
import NotFoundPage from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, loader: () => redirect('/jobs') },
      {
        path: '/jobs',
        element: <JobsListPage />,
        children: [
          // Nested route: list stays mounted; drawer renders into <Outlet />.
          { path: ':id', element: <JobDetailDrawer /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
