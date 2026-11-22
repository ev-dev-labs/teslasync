import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures } from './mockApi';
import { openSharedPlanning, sharedPlanningLayouts } from './shared-planning.fixture';

test.skip(process.env.SMART_SHARED_TRIP_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const endpoint = '/api/v1/smart-charging/shared-trips';
const unavailable = 'A comparison needs two eligible, confirmed vehicles with current battery evidence.';

async function tick(page: Page, stage: 'start' | 'stale' | 'fresh') {
  const result = await page.request.post(`/__fixture/shared-trip-clock?stage=${stage}`);
  expect(result.status()).toBe(204);
}

async function nominate(page: Page, slot: number, vehicleId: number, subject: string) {
  const nomination = page.getByRole('group', { name: `Nomination ${slot}`, exact: true });
  await nomination.getByLabel('Nominated vehicle').selectOption(String(vehicleId));
  await nomination.getByLabel('Exact participant sign-in identity').fill(subject);
}

async function confirm(page: Page, maintenance: 'clear' | 'unverified') {
  await page.getByRole('button', { name: 'Review and confirm' }).click();
  await page.getByLabel('Estimated minimum battery use (%)').fill('12');
  await page.getByLabel('Estimated maximum battery use (%)').fill('20');
  await page.getByLabel('Minimum battery reserve on return (%)').fill('15');
  await page.getByLabel('Is the vehicle available for the shared departure?').selectOption('clear');
  await page.getByLabel('Is the vehicle clear of overdue maintenance for this departure?').selectOption(maintenance);
  const [saved] = await Promise.all([
    page.waitForResponse(item => item.request().method() === 'PUT' && new URL(item.url()).pathname.includes(`${endpoint}/`)),
    page.getByRole('button', { name: 'Confirm participation' }).click(),
  ]);
  expect(saved.status()).toBe(204);
  await expect(page.getByRole('button', { name: 'Compare vehicles' })).toBeVisible();
}

for (const layout of sharedPlanningLayouts) {
  test(`consented private shared trip comparison and revocation: ${layout.theme}`, async ({ page, browser }) => {
    test.setTimeout(150_000);
    await tick(page, 'start');
    const ownerApi = await openSharedPlanning(page, 'synthetic-trip-operator', layout, 'trips');
    await page.getByRole('button', { name: 'Create shared trip' }).click();
    await page.getByLabel(/Shared departure \(/).fill('2030-01-21T14:00');
    await nominate(page, 1, 7, 'synthetic-trip-a');
    await nominate(page, 2, 8, 'synthetic-trip-b');
    await page.getByRole('button', { name: 'Add nomination' }).click();
    await nominate(page, 3, 9, 'synthetic-trip-c');
    const save = page.getByRole('button', { name: 'Save trip and invitations' });
    await expect(save).toBeEnabled();
    await expect(page.getByLabel(/Shared departure \(/)).toHaveValue('2030-01-21T14:00');
    const [saved] = await Promise.all([
      page.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === endpoint),
      save.click(),
    ]);
    expect(saved.status()).toBe(201);
    const payload = await saved.json() as { data: { id: number } };
    const comparison = `${endpoint}/${payload.data.id}/comparison`;
    const notConsented = async (viewer: string) => {
      const response = await page.request.get(comparison, {
        headers: { 'X-Test-Subject': viewer, 'X-TeslaSync-Expected-Principal': `subject:${viewer}` },
      });
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain('options');
    };
    await notConsented('synthetic-trip-operator');
    await notConsented('synthetic-trip-outsider');
    await notConsented('synthetic-trip-a');
    await assertMockApiComplete(page, ownerApi);

    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
    try {
      const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
      const aApi = await openSharedPlanning(a, 'synthetic-trip-a', layout, 'trips');
      await expect(a.getByRole('button', { name: 'Create shared trip' })).toHaveCount(0);
      await confirm(a, 'clear');
      const cApi = await openSharedPlanning(c, 'synthetic-trip-c', layout, 'trips');
      await confirm(c, 'unverified');
      await a.getByRole('button', { name: 'Compare vehicles' }).click();
      await expect(a.getByText(unavailable, { exact: false })).toBeVisible();

      const bApi = await openSharedPlanning(b, 'synthetic-trip-b', layout, 'trips');
      await confirm(b, 'clear');
      const refresh = a.getByRole('button', { name: 'Refresh comparison' });
      const [compared] = await Promise.all([
        a.waitForResponse(item => new URL(item.url()).pathname === comparison),
        refresh.click(),
      ]);
      expect(compared.status()).toBe(200);
      expect((await compared.json()).data.comparison.options).toMatchObject([
        { vehicle_id: 8, return_low_pct: 60, return_high_pct: 68, reserve_pct: 15 },
        { vehicle_id: 7, return_low_pct: 50, return_high_pct: 58, reserve_pct: 15 },
      ]);
      await expect(a.getByText(/^Vehicle 8: estimated return/)).toBeVisible();
      await expect(a.getByText(/^Vehicle 7: estimated return/)).toBeVisible();
      await expect(a.getByText(/^Vehicle 9: estimated return/)).toHaveCount(0);
      await expect(a.getByText('synthetic-trip-b', { exact: false })).toHaveCount(0);

      await tick(a, 'stale');
      await refresh.click();
      await expect(a.getByText(unavailable, { exact: false })).toBeVisible();
      await tick(a, 'fresh');
      await refresh.click();
      await expect(a.getByText(/^Vehicle 8: estimated return/)).toBeVisible();
      await b.getByRole('button', { name: 'Withdraw vehicle' }).click();
      await b.getByRole('dialog').getByRole('button', { name: 'Withdraw vehicle' }).click();
      await expect(b.getByText('No upcoming shared departures are awaiting or using your confirmation.')).toBeVisible();
      await notConsented('synthetic-trip-b');
      await refresh.click();
      await expect(a.getByText(unavailable, { exact: false })).toBeVisible();
      await assertMockApiComplete(a, aApi);
      await assertMockApiComplete(b, bApi);
      await assertMockApiComplete(c, cApi);
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }

    await page.getByRole('button', { name: 'Cancel trip' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel trip' }).click();
    await expect(page.getByText('You have no upcoming shared trips.')).toBeVisible();
  });
}
