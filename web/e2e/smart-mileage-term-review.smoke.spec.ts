import { expect, test } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/mileage-budget?vehicle_id=7#monthly-mileage-review';
const endpoint = '/api/v1/analytics/mileage-budget/review';
const early = '2026-04-02T12:59:00Z';
const due = '2026-04-02T13:00:00Z';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_MILEAGE_TERM_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_MILEAGE_TERM_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`review the recorded allowance after local monthly release: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-mileage-${variant.name}`;
    const writes: string[] = [];
    const errors: string[] = [];
    const externalOrigins: string[] = [];
    await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, intercepted => intercepted.abort());
    context.on('request', request => {
      const { protocol, origin: target, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') errors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (/^https?:$/.test(protocol) && target !== origin) externalOrigins.push(target);
    });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: 'early' | 'due') => {
      const response = await context.request.post(`${origin}/__fixture/mileage-term-review?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (now: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, now, variant);
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const url = new URL(intercepted.request().url());
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
        if (intercepted.request().method() === 'PUT') {
          expect(intercepted.request().postDataJSON()).toMatchObject({
            first_day: '2026-02-01', end_day: '2027-08-01', time_zone: 'America/New_York',
            opening_odometer_m: 8_000_000, allowance_m: 700_000, minimum_overage_m: 40_000,
          });
        }
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      return { page, api, panel: page.getByRole('region', { name: 'Monthly mileage review' }) };
    };

    await tick('early');
    const enrollment = await open(early);
    const form = enrollment.panel;
    await expect(form.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByRole('button', { name: 'Set up monthly mileage review' }).press('Enter');
    const start = form.getByLabel('First day of the term');
    await expect(start).toBeFocused();
    await start.fill('2026-02-01');
    await form.getByLabel('First day after the term').fill('2027-08-01');
    await form.getByLabel(/^Term time zone/).fill('America/New_York');
    for (const [label, value] of [
      ['Recorded odometer at term start', '8000'],
      ['Distance allowed over the entire term', '700'],
      ['Minimum projected overage to review', '40'],
    ]) {
      const input = form.getByLabel(label);
      await input.fill(value);
      await input.press('Tab');
    }
    const consent = form.getByRole('switch', { name: /^These are my recorded terms/ });
    const confirm = form.getByRole('button', { name: 'Confirm private mileage review' });
    await expect(confirm).toBeDisabled();
    await expect(consent).toBeEnabled();
    await consent.press('Space');
    await expect(confirm).toBeEnabled();
    const saved = enrollment.page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === endpoint);
    await confirm.press('Enter');
    expect((await saved).status()).toBe(204);
    await expect(form.getByText(/^Learning\./)).toBeVisible();
    await expect(form.getByRole('button', { name: 'Edit allowance terms' })).toBeFocused();
    await tick('early');
    await assertMockApiComplete(enrollment.page, enrollment.api);
    await enrollment.page.close();

    await tick('due');
    const { page, api, panel } = await open(due);
    const finding = panel.getByRole('heading', { name: 'Projected distance exceeds this allowance' });
    await expect(finding).toBeVisible();
    await expect(panel.getByText(/^116(?:\.0+)?\s*km$/)).toBeVisible();
    await expect(panel.getByText(/^700(?:\.0+)?\s*km$/)).toBeVisible();
    await expect(panel.getByText(/uses 9 days with odometer readings/)).toBeVisible();
    await expect(panel.getByText(/not reimbursable distance or any penalty/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Review recorded drives' })).toHaveAttribute('href', '/drives?vehicle_id=7');
    const dismiss = panel.getByRole('button', { name: 'Dismiss this mileage estimate' });
    await expect(dismiss).toBeEnabled();
    await dismiss.press('Enter');
    await expect(finding).toHaveCount(0);
    await page.reload();
    await expect(panel.getByText(/^Active\. On-budget/)).toBeVisible();
    const pause = panel.getByRole('button', { name: 'Pause mileage review' });
    await expect(pause).toBeEnabled();
    await pause.press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear mileage review';
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
    expect(errors).toEqual([]);
    expect(externalOrigins).toEqual([]);
  });
}
