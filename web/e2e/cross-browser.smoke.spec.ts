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
