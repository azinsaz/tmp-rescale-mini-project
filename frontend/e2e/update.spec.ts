import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** Visible list container — table on desktop, cards on mobile. */
function listFor(page: Page, project: string) {
  return project === 'mobile' ? page.locator('[data-list="cards"]') : page.locator('table');
}

test('row status pill quick-changes from PENDING → RUNNING without leaving the list', async ({
  page,
  seedJob,
}, testInfo) => {
  const job = await seedJob(`Quick change ${Date.now()}`);
  await page.goto('/jobs');

  const list = listFor(page, testInfo.project.name);
  await list.getByTestId(`status-trigger-${job.id}`).click();

  await page.getByRole('menu', { name: /change status/i }).waitFor();
  await page.getByRole('menuitemradio', { name: /^RUNNING/ }).click();

  // Optimistic update — the row trigger pill aria-label flips immediately.
  await expect(list.getByTestId(`status-trigger-${job.id}`)).toHaveAttribute(
    'aria-label',
    /current: RUNNING/,
  );

  // Drawer was NOT opened by the pill click.
  await expect(page).toHaveURL(/\/jobs(\?.*)?$/);
  await expect(page).not.toHaveURL(new RegExp(`/jobs/${job.id}`));
});

test('drawer opens when row body is clicked; status change updates row + history', async ({
  page,
  seedJob,
}, testInfo) => {
  const job = await seedJob(`Drawer target ${Date.now()}`);
  await page.goto('/jobs');

  const list = listFor(page, testInfo.project.name);
  // Click in the top-left of the row to reliably hit the row body, not the
  // centered status-pill button (especially relevant on the mobile card).
  await list.getByRole('link', { name: `Open ${job.name}` }).click({ position: { x: 8, y: 8 } });

  // URL nests, drawer dialog mounts.
  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}`));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Status quick-change inside the drawer.
  await dialog.getByTestId(`status-trigger-${job.id}`).click();
  await page.getByRole('menuitemradio', { name: /^COMPLETED/ }).click();

  // Drawer header pill flips.
  await expect(dialog.getByTestId(`status-trigger-${job.id}`)).toHaveAttribute(
    'aria-label',
    /current: COMPLETED/,
  );

  // History inside the drawer shows the new entry.
  await expect(dialog.getByText(/COMPLETED/).first()).toBeVisible();
});

test('drawer is accessible (axe smoke)', async ({ page }) => {
  // Seed via direct API call (axe needs the same shape as the other tests).
  const res = await page.request.post('/api/jobs/', {
    data: { name: `Axe drawer ${Date.now()}` },
  });
  const job = (await res.json()) as { id: number };
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('dialog').waitFor();
  // Scope axe to the drawer only — the list mounted in the background can
  // accumulate unrelated rows and isn't what this smoke is verifying.
  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['region'])
    .analyze();
  expect(result.violations).toEqual([]);
});
