import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`mileage projection is elected, private and removable: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_WARRANTY_REAL_BACKEND !== '1', 'Requires the mounted handlers and disposable PostgreSQL');
    test.setTimeout(150_000);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    const owner = `synthetic-warranty-browser-${variant.width}`;
    const headers = { 'x-test-subject': owner, 'x-teslasync-expected-principal': `subject:${owner}` };
    const warrantyAPI = '/api/v1/warranty-command/warranties';
    const warranty = await page.request.post(warrantyAPI, {
      headers,
      data: {
        vehicle_id: 7, kind: 'basic', label: 'Synthetic documented warranty', currency: 'USD',
        start_at: new Date(Date.now() - 365 * 86400_000).toISOString(),
        start_odometer_m: 2_000_000, term_s: 730 * 86400, term_distance_m: 79_000_000,
      },
    });
    expect(warranty.status(), await warranty.text()).toBe(201);
    const { id } = await warranty.json() as { id: number };
    const reminder = `${warrantyAPI}/${id}/reminder`;
    const warrantyPage = `/ownership/warranty-command?vehicle_id=7&warranty_id=${id}#warranty-mileage`;
    const actionCenter = '/action-center?vehicle_id=7&source_feature=warranty_distance';
    await seedBrowserState(page, variant.theme, warrantyPage);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Missing isolated API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject: owner, capabilities: {} },
    }));
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${owner}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(url => url.pathname === '/api/v1/warranty-command', route => fulfillApiFixture(route, api, {
      json: { currency: 'USD', coverages: [], claims: [], active_count: 1 },
    }));
    const writes: string[] = [];
    await page.route(url => url.pathname === warrantyAPI || url.pathname === reminder ||
      url.pathname.startsWith('/api/v1/action-center'), route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${owner}`);
      if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`);
      return forwardLocalApiFixture(route, api, { ...request.headers(), 'x-test-subject': owner });
    });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|smart-delivery)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto(warrantyPage);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private warranty mileage reminder' });
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    const enable = panel.getByRole('button', { name: 'Enable private mileage reminder' });
    await enable.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Nothing is sent outside TeslaSync/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(enable).toBeFocused();
    expect(writes).toEqual([]);
    await enable.press('Enter');
    await dialog.getByRole('button', { name: 'Enable private mileage reminder' }).click();
    await expect(panel.getByText(/^Enabled\. No current distance-first estimate/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Turn off mileage reminder' })).toBeFocused();

    await page.goto(actionCenter);
    expect((await page.request.post('/__fixture/warranty-tick')).status()).toBe(204);
    await page.reload();
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Review the approaching warranty distance limit', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/the distance limit may arrive between/)).toBeVisible();
    await page.getByRole('button', { name: 'Review warranty terms' }).click();
    await expect(page).toHaveURL(new RegExp(`/ownership/warranty-command\\?vehicle_id=7&warranty_id=${id}#warranty-mileage$`));
    await expect(panel.getByText(/the distance limit may arrive between/)).toBeVisible();
    await expect(panel.getByText(/11 observation days/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const foreign = 'synthetic-warranty-foreign';
    const denied = await page.request.get(`${reminder}?vehicle_id=7`, {
      headers: { 'x-test-subject': foreign, 'x-teslasync-expected-principal': `subject:${foreign}` },
    });
    expect(denied.status()).toBe(404);
    const disable = panel.getByRole('button', { name: 'Turn off mileage reminder' });
    await disable.press('Enter');
    await dialog.getByRole('button', { name: 'Turn off mileage reminder' }).click();
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(enable).toBeFocused();
    await page.goto(actionCenter);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Review the approaching warranty distance limit', { exact: true })).toHaveCount(0);
    expect(writes).toEqual([`PUT ${reminder}`, `DELETE ${reminder}`]);
    await assertMockApiComplete(page, api);
  });
}
