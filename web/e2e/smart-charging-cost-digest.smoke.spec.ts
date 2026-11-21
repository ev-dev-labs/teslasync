import { expect, test } from '@playwright/test';
import { cardLayoutWorkspaceSources } from './cardLayoutWorkspaceSources';
import { catalogueCostBreakdown } from './dashboardWidgetFixtures';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, waitForHarnessReady,
} from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/analytics/tco?vehicle_id=7#charging-cost-digest';
const endpoint = '/api/v1/analytics/tco/charging-cost-digest';
const early = '2026-11-02T13:59:00Z';
const due = '2026-11-02T14:00:00Z';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_CHARGING_COST_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_CHARGING_COST_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`publish only after local release with no browser open: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-cost-${variant.name}`;
    const writes: string[] = [];
    const applicationErrors: string[] = [];
    const externalOrigins: string[] = [];
    await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, intercepted => intercepted.abort());
    context.on('request', request => {
      const { protocol, origin: target, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') applicationErrors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (/^https?:$/.test(protocol) && target !== origin) externalOrigins.push(target);
    });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: 'early' | 'due') => {
      const response = await context.request.post(`${origin}/__fixture/charging-cost-digest?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (at: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, at, variant);
      await page.route(url => ['/api/v1/analytics/tco', '/api/v1/analytics/tco/ledger'].includes(url.pathname),
        intercepted => {
          if (intercepted.request().method() !== 'GET') return intercepted.fallback();
          const { pathname, searchParams } = new URL(intercepted.request().url());
          expect(searchParams.get('vehicle_id')).toBe('7');
          return fulfillApiFixture(intercepted, api, {
            json: pathname.endsWith('/ledger') ? cardLayoutWorkspaceSources['/analytics/tco/ledger']
              : catalogueCostBreakdown(at, '2026-09-01T04:00:00Z'),
          });
        });
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(new URL(intercepted.request().url()).searchParams.get('vehicle_id')).toBe('7');
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      return { page, api, panel: page.getByRole('region', { name: 'Monthly charging cost change' }) };
    };
    await tick('early');
    const enrolled = await open(early);
    await expect(enrolled.panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await enrolled.panel.getByRole('button', { name: 'Set up monthly review' }).press('Enter');
    const zone = enrolled.panel.getByLabel(/^Review time zone/);
    await expect(zone).toBeFocused();
    await zone.fill('America/New_York');
    await enrolled.panel.getByLabel(/^Currency used on your charging bills/).fill('USD');
    const amount = enrolled.panel.getByLabel('Minimum material cost change');
    await amount.fill('1.001');
    await amount.press('Tab');
    await expect(enrolled.panel.getByText(/whole billing increments/)).toBeVisible();
    const confirm = enrolled.panel.getByRole('button', { name: 'Confirm private monthly review' });
    const consent = enrolled.panel.getByRole('switch', { name: 'Review local driving and charging bills for this vehicle each month.' });
    await consent.press('Space');
    await expect(confirm).toBeDisabled();
    await amount.fill('1.00');
    await amount.press('Tab');
    await expect(confirm).toBeDisabled();
    await consent.press('Space');
    await confirm.press('Enter');
    await expect(enrolled.panel.getByText(/^Active\. There is no current comparison/)).toBeVisible();
    await expect(enrolled.panel.getByRole('button', { name: 'Edit monthly review' })).toBeFocused();
    await tick('early');
    await assertMockApiComplete(enrolled.page, enrolled.api);
    await enrolled.page.close();

    await tick('due');
    const { page, api, panel } = await open(due);
    const findings = panel.getByRole('heading', { name: 'What changed across the two months?' });
    await expect(findings).toBeVisible();
    await expect(panel.getByText(/Time zone: America\/New_York\. Amounts in USD\. Expires/)).toBeVisible();
    await expect(panel.getByText(/4 of 4 observed sessions had a usable bill/)).toHaveCount(2);
    await expect(panel.getByText('$16.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('$10.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('$3.00', { exact: true })).toHaveCount(2);
    await expect(panel.getByText(/not proof of cause or driving efficiency/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Review charging sessions' })).toHaveAttribute('href', '/charging?vehicle_id=7');
    expect(writes).toEqual([`PUT ${endpoint}`]);
    await panel.getByRole('button', { name: 'Dismiss this monthly comparison' }).press('Enter');
    await expect(findings).toHaveCount(0);
    await page.reload();
    await expect(panel.getByText(/^Active\. There is no current comparison/)).toBeVisible();
    await expect(findings).toHaveCount(0);
    const pause = panel.getByRole('button', { name: 'Pause monthly review' });
    await expect(pause).toBeEnabled();
    const paused = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'PUT');
    await pause.press('Enter');
    expect((await paused).status()).toBe(204);
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear monthly review';
    const clear = panel.getByRole('button', { name: clearLabel });
    const dialog = page.getByRole('dialog', { name: clearLabel });
    await expect(clear).toBeEnabled();
    await clear.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(clear).toBeFocused();
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `PUT ${endpoint}`]);
    await clear.press('Enter');
    await dialog.getByRole('button', { name: clearLabel }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `PUT ${endpoint}`, `DELETE ${endpoint}`]);
    expect(applicationErrors).toEqual([]);
    expect(externalOrigins).toEqual([]);
  });
}
