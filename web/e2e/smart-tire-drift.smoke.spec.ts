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
  test(`cold gauge drift appears only for its owner and can be cleared: ${variant.theme} ${variant.pack}`, async ({ page }) => {
    test.skip(process.env.SMART_TIRE_REAL_BACKEND !== '1', 'Requires the mounted handlers and disposable PostgreSQL');
    test.setTimeout(150_000);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    const owner = `synthetic-cold-review-${variant.width}`;
    const headers = { 'x-test-subject': owner, 'x-teslasync-expected-principal': `subject:${owner}` };
    const url = '/tire-differential-drift?vehicle_id=7';
    const endpoint = '/api/v1/tire-pressure/cold-checks';
    const inbox = '/action-center?vehicle_id=7&source_feature=cold_tire_drift';
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
    await page.route(path => path.pathname === '/api/v1/tire-pressure' || path.pathname === '/api/v1/tire-pressure/latest',
      route => fulfillApiFixture(route, api, { json: [] }));
    await page.route(path => path.pathname === endpoint || path.pathname.startsWith('/api/v1/action-center'), route => {
      const request = route.request();
      expect(request.headers()['x-teslasync-expected-principal']).toBe(`subject:${owner}`);
      return forwardLocalApiFixture(route, api, { ...request.headers(), ...headers });
    });
    const writes: string[] = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|smart-delivery|tire-pressure|action-center)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.goto(url);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private cold tire checks' });
    await panel.getByRole('button', { name: 'Review private cold checks' }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    const add = panel.getByRole('button', { name: 'Record a cold gauge check' });
    const common = [2.70, 2.78, 2.74, 2.82, 2.76];
    const drop = [0, 0.04, 0.09, 0.17, 0.23];
    const reference = Date.now();
    for (let i = 0; i < common.length; i++) {
      await add.press('Enter');
      await panel.getByLabel(/^Reading time/).fill(new Date(reference + (2 * i - 9) * 86400_000).toISOString().slice(0, 16));
      await panel.getByLabel('Ambient temperature (°C)').fill(String(7 + i % 2));
      await panel.getByLabel('Front left (bar)').fill((common[i] - drop[i]).toFixed(2));
      await panel.getByLabel('Front right (bar)').fill(common[i].toFixed(2));
      await panel.getByLabel('Rear left (bar)').fill((common[i] - 0.09).toFixed(2));
      await panel.getByLabel('Rear right (bar)').fill((common[i] - 0.08).toFixed(2));
      const save = panel.getByRole('button', { name: 'Save private cold check' });
      await expect(save).toBeDisabled();
      await panel.getByRole('checkbox', { name: /I used the same gauge/ }).press('Space');
      await save.click();
      await expect(save).toHaveCount(0);
      await expect(add).toBeFocused();
      if (i < common.length - 1) await expect(panel.getByText(/No current repeated drift/)).toBeVisible();
    }
    await expect(panel.getByText(/Front left fell by at least/)).toBeVisible();
    const other = 'synthetic-cold-other';
    const foreign = await page.request.get(`${endpoint}?vehicle_id=7`, {
      headers: { 'x-test-subject': other, 'x-teslasync-expected-principal': `subject:${other}` },
    });
    expect(await foreign.json()).toMatchObject({ data: { series_id: 0, drift: null } });

    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Check one tire manually', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Front left fell by at least/)).toBeVisible();
    await page.getByRole('button', { name: 'Review private cold checks' }).click();
    await expect(page).toHaveURL(/\/tire-differential-drift\?vehicle_id=7#cold-tire-review$/);
    await expect(panel.getByText(/Front left fell by at least/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const remove = panel.getByRole('button', { name: 'Turn off and clear readings' });
    const dialog = page.getByRole('dialog');
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(remove).toBeFocused();
    await remove.press('Enter');
    await dialog.getByRole('button', { name: 'Turn off and clear readings' }).click();
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(add).toBeFocused();
    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Check one tire manually', { exact: true })).toHaveCount(0);
    expect(writes).toEqual([...Array.from({ length: 5 }, () => `POST ${endpoint}`), `DELETE ${endpoint}`]);
    await assertMockApiComplete(page, api);
  });
}
