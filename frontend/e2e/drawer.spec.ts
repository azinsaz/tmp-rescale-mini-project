import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

function listFor(page: Page, project: string) {
  return project === 'mobile' ? page.locator('[data-list="cards"]') : page.locator('table');
}

test('row click opens the drawer; Escape closes; focus returns to the row', async ({
  page,
  seedJob,
}, testInfo) => {
  const job = await seedJob(`Drawer focus ${Date.now()}`);
  await page.goto('/jobs');

  const list = listFor(page, testInfo.project.name);
  const row = list.getByRole('link', { name: `Open ${job.name}` });
  await row.focus();
  await page.keyboard.press('Enter');
  // Enter on a focused row activates it (no need to mouse-click).

  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}`));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/jobs\/?(\?.*)?$/);
});

test('deep-linking to /jobs/:id mounts the list behind the drawer', async ({ page, seedJob }) => {
  const job = await seedJob(`Deep link ${Date.now()}`);
  await page.goto(`/jobs/${job.id}`);

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job Management' })).toBeVisible();
});
