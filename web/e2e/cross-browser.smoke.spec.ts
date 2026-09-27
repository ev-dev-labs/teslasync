import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import {
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  monitorPage,
} from './qualityAssertions';

for (const path of ['/', '/data-repair']) {
  test(`critical route loads in secondary engine: ${path}`, async ({ page }) => {
    await seedBrowserState(page, 'dark', path);
    const mockApi = await installApiMocks(page, 'populated');
    const diagnostics = process.env.E2E_MOCKS === '0' ? monitorPage(page) : null;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
    await waitForHarnessReady(page, mockApi);
    await expectNoHorizontalOverflow(page);
    if (diagnostics) await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mockApi);
  });
}

test('installed mobile navigation opens and follows a shortcut in secondary engines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const sidebar = page.locator('[data-role="sidebar"]');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-sidebar-open', 'true');
  await expect(sidebar.getByRole('navigation', { name: 'Sections and shortcuts' })).toBeVisible();
  await sidebar.getByRole('link', { name: 'All pages' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(sidebar).toHaveAttribute('data-sidebar-open', 'false');
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
});
