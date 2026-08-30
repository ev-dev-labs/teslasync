import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { attachDiagnostics, expectNoRuntimeFailures, monitorPage } from './qualityAssertions';

const TRANSITION_DESTINATIONS = ['/vehicles', '/drives', '/charging', '/battery', '/data-repair'] as const;
const READINESS_BUDGET_PER_ROUTE_MS = 15_000;

test('critical SPA route transitions remain healthy', async ({ page }, testInfo) => {
  testInfo.setTimeout((TRANSITION_DESTINATIONS.length + 1) * READINESS_BUDGET_PER_ROUTE_MS);
  await seedBrowserState(page, 'dark');
  const mockApi = await installApiMocks(page, 'populated');
  const diagnostics = monitorPage(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  for (const destination of TRANSITION_DESTINATIONS) {
    await page.evaluate((path) => {
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, destination);
    await expect(page).toHaveURL(new RegExp(`${destination.replace('/', '\\/')}$`));
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
    await waitForHarnessReady(page, mockApi);
  }

  await attachDiagnostics(testInfo, diagnostics);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(page, mockApi);
});
