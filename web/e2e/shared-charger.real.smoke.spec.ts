import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { openSharedPlanning, sharedPlanningLayouts } from './shared-planning.fixture';

test.skip(process.env.SMART_SHARED_CHARGER_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const endpoint = '/api/v1/smart-charging/shared-chargers';
const swap = '2030-01-21T12:31:00Z';

async function confirmVehicle(page: Page, vehicleId: number, plugged: boolean) {
  await page.getByLabel('Available from').fill('2030-01-21T12:00');
  await page.getByLabel('Departure deadline').fill('2030-01-21T14:00');
  await page.getByLabel('Estimated energy needed (Wh)').fill('3000');
  await page.getByLabel('Conservative charging power (W)').fill('6000');
  await page.getByLabel('Currently plugged into this charger?').selectOption(plugged ? 'yes' : 'no');
  if (!plugged) await page.getByRole('switch', { name: /Show me one private in-app reminder/ }).click();
  const [response] = await Promise.all([
    page.waitForResponse(item => item.request().method() === 'PUT' && new URL(item.url()).pathname.endsWith(`/vehicles/${vehicleId}`)),
    page.getByRole('button', { name: 'Confirm my vehicle for this revision' }).click(),
  ]);
  expect(response.status()).toBe(204);
}

async function tick(page: Page, stage: 'start' | 'swap', count: number) {
  const response = await page.request.post(`/__fixture/shared-charger-clock?stage=${stage}`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ published: count });
}

for (const variant of sharedPlanningLayouts) {
  test(`consented private shared charger order and one swap: ${variant.theme}`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    await tick(page, 'start', 0);
    const operator = await openSharedPlanning(page, 'synthetic-charger-operator', variant, 'chargers');
    await page.getByRole('button', { name: 'New shared charger plan' }).click();
    await page.getByLabel('Reviewed charging place').selectOption('9');
    await page.getByLabel('Plan expires at').fill('2030-01-21T15:00');
    await page.getByRole('combobox', { name: /^Vehicle A\b/ }).selectOption('7');
    await page.getByLabel('Vehicle A sign-in subject').fill('synthetic-charger-a');
    await page.getByRole('combobox', { name: /^Vehicle B\b/ }).selectOption('8');
    await page.getByLabel('Vehicle B sign-in subject').fill('synthetic-charger-b');
    await page.getByLabel('Offer one private swap reminder').selectOption('second');
    const [saved] = await Promise.all([
      page.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === endpoint),
      page.getByRole('button', { name: 'Authorize plan' }).click(),
    ]);
    expect(saved.status()).toBe(201);
    await expect(page.getByText('No active invitations on this page for your signed-in account.')).toBeVisible();
    await assertMockApiComplete(page, operator);

    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      const a = await first.newPage();
      const b = await second.newPage();
      const aApi = await openSharedPlanning(a, 'synthetic-charger-a', variant, 'chargers');
      await expect(a.getByRole('button', { name: 'New shared charger plan' })).toHaveCount(0);
      await confirmVehicle(a, 7, true);
      await expect(a.getByText('No actionable order is available.', { exact: false })).toBeVisible();
      await expect(a.getByText(/^First:/)).toHaveCount(0);
      const bApi = await openSharedPlanning(b, 'synthetic-charger-b', variant, 'chargers');
      await confirmVehicle(b, 8, false);
      await expect(b.getByText(/^First: Synthetic plugged EV/)).toBeVisible();
      await expect(b.getByText(/^Second: Synthetic arriving EV/)).toBeVisible();
      await expect(b.getByText('Your private swap reminder')).toHaveCount(0);

      await tick(b, 'swap', 1);
      await tick(b, 'swap', 0);
      await b.clock.setFixedTime(new Date(swap));
      await b.reload();
      await waitForHarnessReady(b, bApi);
      await expect(b.getByText('Your private swap reminder', { exact: true })).toHaveCount(1);
      await expect(b.getByText('Your private swap reminder', { exact: true })).toBeVisible();
      await a.clock.setFixedTime(new Date(swap));
      await a.reload();
      await waitForHarnessReady(a, aApi);
      await expect(a.getByText(/^First: Synthetic plugged EV/)).toBeVisible();
      await expect(a.getByText('Your private swap reminder')).toHaveCount(0);

      await b.getByRole('button', { name: 'Withdraw from plan' }).click();
      await b.getByRole('dialog').getByRole('button', { name: 'End shared plan' }).click();
      await expect(b.getByText('No active invitations on this page for your signed-in account.')).toBeVisible();
      await a.reload();
      await waitForHarnessReady(a, aApi);
      await expect(a.getByText(/^First:/)).toHaveCount(0);
      await assertMockApiComplete(a, aApi);
      await assertMockApiComplete(b, bApi);
    } finally {
      await first.close();
      await second.close();
    }
  });
}
