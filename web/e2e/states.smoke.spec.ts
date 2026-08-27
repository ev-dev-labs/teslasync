import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { FIXTURE_MATRIX } from './routeRegistry';

for (const { route, scenario } of FIXTURE_MATRIX) {
  test(`${route.name} renders the ${scenario} fixture`, async ({ page }) => {
    await seedBrowserState(page, 'dark', route.path);
    const mockApi = await installApiMocks(page, scenario);
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText(/page failed to load/i)).toHaveCount(0);

    if (scenario === 'loading') {
      await expect.poll(() => mockApi?.delayed.size ?? 0, {
        message: `${route.name} loading scenario did not delay any route data request`,
      }).toBeGreaterThan(0);
    } else if (scenario === 'error') {
      await expect(page.getByText(/failure|could not|unable|unavailable|error/i).first()).toBeVisible();
    }
    await waitForHarnessReady(page, mockApi);
    await assertMockApiComplete(page, mockApi);
  });
}
