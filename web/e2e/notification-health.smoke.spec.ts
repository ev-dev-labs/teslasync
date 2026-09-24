import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

test('legacy notification analysis routes land on the matching unified section', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/notifications/health');
  const mocks = await installApiMocks(page);

  for (const [legacy, section, label] of [
    ['/alert-fatigue', 'fatigue', 'Alert Fatigue'],
    ['/notification-burn-rate', 'burn-rate', 'Notification Burn Rate'],
    ['/notification-latency', 'latency', 'Notification Latency'],
  ]) {
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`/notifications/health#${section}$`));
    await waitForHarnessReady(page, mocks);
    await expect(page.getByRole('region', { name: label, exact: true })).toBeVisible();
  }

  await expect(page.getByRole('navigation', { name: 'Notification health sections' })
    .getByRole('link')).toHaveCount(3);
  await assertMockApiComplete(page, mocks);
});

test('Studio offers typed system and place rules without a saved place', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/notifications/studio');
  const mocks = await installApiMocks(page);
  await page.goto('/notifications/studio');
  await expect(page.getByRole('tab', { name: 'System service' })).toBeVisible();
  await page.getByRole('tab', { name: 'System service' }).click();
  await expect(page.getByLabel('Service', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Vehicles', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Place event' }).click();
  await expect(page.getByText('No places configured')).toBeVisible();
  await expect(page.getByLabel('Place', { exact: true })).toBeDisabled();
  await assertMockApiComplete(page, mocks);
});
