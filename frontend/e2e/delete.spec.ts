import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

function listFor(page: Page, project: string) {
  return project === 'mobile' ? page.locator('[data-list="cards"]') : page.locator('table');
}

test('deletes a job from the drawer footer; confirm modal then row disappears', async ({
  page,
  seedJob,
}) => {
  const name = `Delete via drawer ${Date.now()}`;
  const job = await seedJob(name);
  await page.goto(`/jobs/${job.id}`);

  // Drawer is the only role=dialog so far; click its Delete button.
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Delete job' }).click();

  // Confirm modal appears; it has its own labelled dialog.
  const confirm = page.getByRole('dialog', { name: /delete .*\?/i });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await confirm.getByRole('button', { name: 'Delete job' }).click();

  // Drawer + modal both close, URL returns to list, row gone.
  await expect(page).toHaveURL(/\/jobs\/?(\?.*)?$/);
  await expect(page.getByText(name)).toHaveCount(0);
});

test('row kebab menu opens a confirm modal; cancel preserves the row', async ({
  page,
  seedJob,
}, testInfo) => {
  const name = `Kebab cancel ${Date.now()}`;
  await seedJob(name);
  await page.goto('/jobs');

  const list = listFor(page, testInfo.project.name);
  await list.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: /delete/i }).click();

  const confirm = page.getByRole('dialog', { name: /delete .*\?/i });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  await expect(confirm).toHaveCount(0);
  await expect(list.getByText(name).first()).toBeVisible();
});

test('confirm modal is accessible (axe smoke)', async ({ page, seedJob }, testInfo) => {
  const name = `Axe confirm ${Date.now()}`;
  await seedJob(name);
  await page.goto('/jobs');
  const list = listFor(page, testInfo.project.name);
  await list.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: /delete/i }).click();
  await page.getByRole('dialog', { name: /delete .*\?/i }).waitFor();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['region'])
    .analyze();
  expect(result.violations).toEqual([]);
});
