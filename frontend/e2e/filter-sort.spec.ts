import { test, expect } from './fixtures';

test('filtering by RUNNING shows only the running job; URL reflects ?status=RUNNING', async ({
  page,
  seedJob,
  patchStatus,
}, testInfo) => {
  const a = await seedJob(`Pending one ${Date.now()}`);
  const b = await seedJob(`Running one ${Date.now()}`);
  await patchStatus(b.id, 'RUNNING');

  await page.goto('/jobs');
  // Scope to the filter nav — accessible name "RUNNING" also appears on row
  // status pills (aria-label="Change status — current: RUNNING").
  await page
    .getByRole('navigation', { name: 'Filter by status' })
    .getByRole('button', { name: 'RUNNING' })
    .click();

  await expect(page).toHaveURL(/\?status=RUNNING/);

  const list =
    testInfo.project.name === 'mobile'
      ? page.locator('[data-list="cards"]')
      : page.getByRole('table');
  await expect(list.getByText(b.name)).toBeVisible();
  await expect(list.getByText(a.name)).toHaveCount(0);
});

test('responsive DOM swap: table on desktop, cards on mobile', async ({
  page,
  seedJob,
}, testInfo) => {
  await seedJob(`Visible ${Date.now()}`);
  await page.goto('/jobs');

  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('[data-list="cards"]')).toBeVisible();
    await expect(page.getByRole('table')).not.toBeVisible();
  } else {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-list="cards"]')).not.toBeVisible();
  }
});

test('sort by name asc orders alphabetically; toggling flips direction', async ({
  page,
  seedJob,
}, testInfo) => {
  const stamp = Date.now();
  // Names start with `!` so they sort to the very top of the alphabetical
  // list under the shared DB the test run accumulates. Without that we'd
  // get pushed past the cursor's first page.
  const prefix = `!sort-${stamp}`;
  await seedJob(`${prefix}-zzz`);
  await seedJob(`${prefix}-aaa`);
  await seedJob(`${prefix}-mmm`);

  await page.goto('/jobs');

  if (testInfo.project.name === 'mobile') {
    await page.getByLabel('Sort', { exact: true }).selectOption('name');
    // After picking 'name', URL is ?sort=-name (direction kept). Toggle to asc.
    await expect(page).toHaveURL(/sort=-name/);
    await page.getByRole('button', { name: 'Sort ascending' }).click();
  } else {
    await page.getByRole('button', { name: /^Name/ }).click();
  }

  await expect(page).toHaveURL(/sort=name(?!-)/);

  const list =
    testInfo.project.name === 'mobile'
      ? page.locator('[data-list="cards"]')
      : page.locator('table');
  // Read OUR rows in DOM order; assert ascending.
  const escaped = prefix.replace(/[!.*+?^${}()|[\]\\]/g, '\\$&');
  const ours = await list.getByText(new RegExp(`${escaped}-(aaa|mmm|zzz)`)).allTextContents();
  expect(ours).toEqual([`${prefix}-aaa`, `${prefix}-mmm`, `${prefix}-zzz`]);
});

test('deep-link ?sort=-name loads with name desc selected', async ({ page, seedJob }, testInfo) => {
  // `~` sorts after all letters/digits in PG default collation, so
  // descending order puts our rows at the very top of page 1.
  const stamp = Date.now();
  const prefix = `~deepsort-${stamp}`;
  await seedJob(`${prefix}-alpha`);
  await seedJob(`${prefix}-zeta`);

  await page.goto('/jobs?sort=-name');
  const list =
    testInfo.project.name === 'mobile'
      ? page.locator('[data-list="cards"]')
      : page.locator('table');
  const escaped = prefix.replace(/[~.*+?^${}()|[\]\\]/g, '\\$&');
  const ours = await list.getByText(new RegExp(`${escaped}-(alpha|zeta)`)).allTextContents();
  expect(ours[0]).toContain('zeta');
});
