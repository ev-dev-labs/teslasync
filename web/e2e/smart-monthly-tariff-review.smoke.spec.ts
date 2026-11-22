import { expect, test } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/ownership/tariff-lab?vehicle_id=7#monthly-tariff-review';
const endpoint = '/api/v1/tariff-lab/monthly-review';
const early = '2026-12-02T13:59:00Z';
const due = '2026-12-02T14:00:00Z';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_MONTHLY_TARIFF_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_MONTHLY_TARIFF_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`show a private unchanged-schedule estimate after local release: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-tariff-${variant.name}`;
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
      const response = await context.request.post(`${origin}/__fixture/monthly-tariff-review?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (instant: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, instant, variant);
      await page.route(url => [endpoint, '/api/v1/tariff-lab/tariffs', '/api/v1/geofences'].includes(url.pathname), async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const url = new URL(intercepted.request().url());
        if (url.pathname === endpoint) {
          expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
          expect(url.searchParams.get('vehicle_id')).toBe('7');
        }
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      return { page, api, panel: page.getByRole('region', { name: 'Monthly tariff review' }) };
    };

    await tick('early');
    const enrollment = await open(early);
    const form = enrollment.panel;
    await expect(form.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByRole('button', { name: 'Set up monthly tariff review' }).press('Enter');
    const zone = form.getByLabel(/^Charging place time zone/);
    await expect(zone).toBeFocused();
    await zone.fill('America/New_York');
    await form.getByLabel('Reviewed charging place').selectOption({ label: 'Synthetic charging place' });
    await form.getByLabel('Current saved tariff').selectOption({ label: 'Synthetic current' });
    await form.getByLabel('Alternative saved tariff').selectOption({ label: 'Synthetic alternative' });
    const minimum = form.getByLabel('Minimum net monthly saving');
    await minimum.fill('5.00');
    await minimum.press('Tab');
    const fee = form.getByLabel('One-time switch fee (zero if none)');
    await fee.fill('2.00');
    await fee.press('Tab');
    const confirm = form.getByRole('button', { name: 'Confirm private tariff review' });
    await expect(confirm).toBeDisabled();
    const consent = form.getByRole('switch', { name: /^Both saved tariffs apply at this place/ });
    await expect(consent).toBeEnabled();
    await consent.press('Space');
    await expect(confirm).toBeEnabled();
    await confirm.press('Enter');
    await expect(form.getByText(/^Learning\./)).toBeVisible();
    await expect(form.getByRole('button', { name: 'Edit tariff review' })).toBeFocused();
    await tick('early');
    await assertMockApiComplete(enrollment.page, enrollment.api);
    await enrollment.page.close();

    await tick('due');
    const { page, api, panel } = await open(due);
    const findings = panel.getByRole('heading', { name: 'Estimated savings at the same charging times' });
    await expect(findings).toBeVisible();
    await expect(panel.getByText('$5.00 to $10.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('$29.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('$17.00 to $22.00', { exact: true })).toBeVisible();
    await expect(panel.getByText('$9.00 / $12.00 over 30 days', { exact: true })).toBeVisible();
    await expect(panel.getByText('All 4 observed sessions at this place:', { exact: false })).toBeVisible();
    await expect(panel.getByText(/Charging times and energy stay the same/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Review charging invoices' })).toHaveAttribute('href', '/ownership/charging-reconciliation?vehicle_id=7');
    const dismiss = panel.getByRole('button', { name: 'Dismiss this tariff comparison' });
    await expect(dismiss).toBeEnabled();
    await dismiss.press('Enter');
    await expect(findings).toHaveCount(0);
    await page.reload();
    await expect(panel.getByText(/^Active\. Insufficient evidence/)).toBeVisible();
    await expect(findings).toHaveCount(0);
    const pause = panel.getByRole('button', { name: 'Pause tariff review' });
    await expect(pause).toBeEnabled();
    await pause.press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear tariff review';
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
