import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  fulfillApiMock,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { expectNoRuntimeFailures, monitorPage } from './qualityAssertions';

for (const signalShape of ['null', 'missing'] as const) {
  test(`Alert Studio handles null lists and ${signalShape} signal metadata without a render crash`, async ({ page }) => {
    await seedBrowserState(page, 'dark', '/notifications/studio');
    const mocks = await installApiMocks(page);
    const diagnostics = monitorPage(page);

    for (const path of ['/notifications', '/alerts/metrics', '/geofences']) {
      await page.route(`**/api/v1${path}`, route =>
        fulfillApiMock(route, mocks, { contentType: 'application/json', body: 'null' }));
    }
    await page.route(/\/api\/v1\/signals\/\d+\/available$/, route =>
      fulfillApiMock(route, mocks, {
        json: {
          vehicle_id: 7, count: 0, source: 'protomodel',
          ...(signalShape === 'null' ? { signals: null } : {}),
        },
      }));

    await page.goto('/notifications/studio', { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mocks);
    await expect(page.getByRole('tab', { name: 'System service' })).toBeVisible();
    await page.getByRole('tab', { name: 'Place event' }).click();
    await expect(page.getByText('No places configured')).toBeVisible();
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
    for (const path of ['/notifications', '/alerts/metrics', '/geofences', '/signals/7/available']) {
      expect(mocks?.seen.has(`GET ${path}`), `null fixture was not requested: ${path}`).toBe(true);
    }
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mocks);
  });
}
