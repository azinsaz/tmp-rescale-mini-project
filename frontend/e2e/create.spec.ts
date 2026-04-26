import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

test('creates a job and shows it in the list with PENDING pill', async ({ page }, testInfo) => {
  await page.goto('/jobs');

  const name = `E2E Job ${Date.now()}`;
  await page.getByLabel(/new job name/i).fill(name);
  await page.getByRole('button', { name: /create job/i }).click();

  // Table on desktop, cards on mobile — scope to whichever is visible
  const list =
    testInfo.project.name === 'mobile'
      ? page.locator('[data-list="cards"]')
      : page.getByRole('table');

  await expect(list.getByText(name)).toBeVisible();
  // Scope PENDING pill to the specific row/card containing our job name
  const item =
    testInfo.project.name === 'mobile'
      ? list.locator('article').filter({ hasText: name })
      : list.locator('tr').filter({ hasText: name });
  await expect(item.getByRole('status', { name: 'PENDING' })).toBeVisible();
});

test('list page is accessible (axe smoke)', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByRole('button', { name: /create job/i }).waitFor();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations).toEqual([]);
});
