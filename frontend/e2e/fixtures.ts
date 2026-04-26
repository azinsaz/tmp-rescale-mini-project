import { test as base, expect, type APIRequestContext } from '@playwright/test';

interface Job {
  id: number;
  name: string;
  current_status: string;
  created_at: string;
  updated_at: string;
}

export interface Fixtures {
  seedJob: (name: string) => Promise<Job>;
  patchStatus: (id: number, status_type: string) => Promise<Job>;
}

export const test = base.extend<Fixtures>({
  seedJob: async ({ request }: { request: APIRequestContext }, use) => {
    await use(async (name: string) => {
      const res = await request.post('/api/jobs/', { data: { name } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()) as Job;
    });
  },
  patchStatus: async ({ request }: { request: APIRequestContext }, use) => {
    await use(async (id: number, status_type: string) => {
      const res = await request.patch(`/api/jobs/${id}/`, { data: { status_type } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()) as Job;
    });
  },
});

export { expect };
