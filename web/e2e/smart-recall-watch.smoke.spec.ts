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
  test(`consent, private recall match and VIN verification link: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_RECALL_REAL_BACKEND !== '1', 'Requires the mounted handlers and disposable PostgreSQL');
    test.setTimeout(150_000);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    const owner = `synthetic-recall-${variant.width}`;
    const headers = { 'x-test-subject': owner, 'x-teslasync-expected-principal': `subject:${owner}` };
    const url = '/maintenance?vehicle_id=7';
    const endpoint = '/api/v1/service-intelligence/recall-watch';
    const inbox = '/action-center?vehicle_id=7&source_feature=recall_watch';
    await seedBrowserState(page, variant.theme, url);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Missing isolated API fixtures');
    await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject: owner, capabilities: {} },
    }));
    await page.route(path => path.pathname === '/api/v1/settings/widget-design-pack' && !path.search, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${owner}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(path => ['/api/v1/maintenance', '/api/v1/maintenance/records'].includes(path.pathname) &&
      path.searchParams.get('vehicle_id') === '7', route => fulfillApiFixture(route, api, { json: [] }));
    await page.route(path => path.pathname === endpoint || path.pathname.startsWith('/api/v1/action-center'), route => {
      const request = route.request();
      expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${owner}`);
      return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers });
    });
    const writes: string[] = [];
    const legacy: string[] = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|smart-delivery|service-intelligence|action-center)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
      if (pathname.startsWith('/api/v1/service-intelligence/vehicles/')) legacy.push(pathname);
    });
    const tick = async (published: number, requests: number) => {
      const response = await page.request.post('/__fixture/recall-tick');
      expect(response.status(), await response.text()).toBe(200);
      expect(await response.json()).toEqual({ published, requests });
    };

    await page.goto(url);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private recall watch' });
    await panel.getByRole('button', { name: 'Review private recall watch' }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await tick(0, 0);
    await panel.getByRole('button', { name: 'Set up recall watch' }).press('Enter');
    await panel.getByLabel('Tesla model').selectOption('Model Y');
    await panel.getByRole('textbox', { name: /^Model year/ }).fill('2024');
    const save = panel.getByRole('button', { name: 'Save private recall watch' });
    await expect(save).toBeDisabled();
    await panel.getByRole('checkbox', { name: /^I verified this model/ }).press('Space');
    await expect(save).toBeDisabled();
    await panel.getByRole('checkbox', { name: /^Check the U.S. NHTSA catalog/ }).press('Space');
    await save.click();
    await expect(panel.getByText(/Waiting for the first catalog check/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Edit recall watch' })).toBeFocused();
    await page.goto('about:blank');
    await tick(1, 1);
    await tick(0, 0);
    const foreign = 'synthetic-recall-foreign';
    const result = await page.request.get(`${endpoint}?vehicle_id=7`, {
      headers: { 'x-test-subject': foreign, 'x-teslasync-expected-principal': `subject:${foreign}` },
    });
    expect(await result.json()).toMatchObject({ data: { id: 0, matches: [] } });

    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('NHTSA campaign 26V123000', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/An open recall for this VIN is not confirmed/)).toBeVisible();
    await page.getByRole('button', { name: 'Review private recall watch' }).click();
    await expect(page).toHaveURL(/\/maintenance\?vehicle_id=7#recall-watch$/);
    await expect(panel.getByText(/replace the synthetic latch/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Open NHTSA campaign' })).toHaveAttribute('href', 'https://www.nhtsa.gov/recalls?nhtsaId=26V123000');
    await expect(panel.getByRole('link', { name: /Verify VIN on Tesla/ })).toHaveAttribute('href', 'https://service.tesla.com/en-US/vin-recall-search');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const remove = panel.getByRole('button', { name: 'Turn off and clear recall watch' });
    const dialog = page.getByRole('dialog');
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(remove).toBeFocused();
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Turn off and clear recall watch' }).click();
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Set up recall watch' })).toBeFocused();
    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('NHTSA campaign 26V123000', { exact: true })).toHaveCount(0);
    await tick(0, 0);
    expect(legacy).toEqual([]);
    expect(writes).toEqual([`PUT ${endpoint}`, `DELETE ${endpoint}`]);
    await assertMockApiComplete(page, api);
  });
}
