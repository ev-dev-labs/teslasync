import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
  type MockApiController,
} from './mockApi';
import { expectDialogsInsideViewport } from './qualityAssertions';

test.beforeEach(async ({ page }) => {
  await seedBrowserState(page, 'dark');
});

test('shell and command palette are keyboard operable', async ({ page }) => {
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const trigger = page.getByRole('button', { name: /search pages, commands/i });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const palette = page.locator('[data-command-palette-panel]');
  await expect(palette).toBeVisible();
  const search = palette.getByRole('combobox', { name: /search pages, commands/i });
  await expect(search).toBeFocused();
  await search.fill('Data Repair');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/data-repair$/);
  await expect(page.locator('main')).toBeVisible();
  await assertMockApiComplete(page, mockApi);
});

test('filters and tabs support keyboard-only use', async ({ page }) => {
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/drives', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const filter = page.getByRole('combobox', { name: /search drives/i });
  await filter.focus();
  await filter.fill('Office');
  await expect(filter).toBeFocused();

  await page.goto('/data-repair', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const selected = page.getByRole('tab', { selected: true });
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/quarantine/i);
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { selected: true })).toHaveText(/case queue/i);
  await assertMockApiComplete(page, mockApi);
});

test('Data Repair table, drawer, and dialog preserve focus and actions', async ({ page }) => {
  const mockApi: MockApiController | null = await installApiMocks(page, 'populated');
  await page.goto('/data-repair', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const review = page.getByRole('button', { name: /review case 301/i });
  await review.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: /case #/i });
  await expect(drawer).toBeVisible();
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(review).toBeFocused();

  const checkbox = page.getByRole('checkbox').last();
  await checkbox.focus();
  await page.keyboard.press('Space');
  const dismiss = page.getByRole('button', { name: /dismiss selected/i });
  await dismiss.focus();
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: /dismiss/i });
  await expect(confirm).toBeVisible();
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await assertMockApiComplete(page, mockApi);
});
