import { expect, test } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/ownership/subscription-roi?vehicle_id=7';
const endpoint = '/api/v1/subscription-roi/renewal';
const early = '2026-03-09T12:59:00Z';
const due = '2026-03-09T13:00:00Z';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_SUBSCRIPTION_RENEWAL_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_SUBSCRIPTION_RENEWAL_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6', subscriptionId: '1' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint', subscriptionId: '2' },
] as const) {
  test(`review the stored price and observed usage before renewal: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-renewal-${variant.name}`;
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
      const response = await context.request.post(`${origin}/__fixture/subscription-renewal?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (now: string, target: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, target, now, variant);
      await page.route(url => url.pathname === '/api/v1/action-center', async intercepted => {
        const headers = await intercepted.request().allHeaders();
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.route(url => url.pathname.replace(/\/$/, '') === '/api/v1/subscription-roi', intercepted => fulfillApiFixture(intercepted, api, {
        json: { vehicle_id: 7, window: { from: '2026-01-01T00:00:00Z', to: now, days: 180 }, items: [], evidence: [], currency: 'USD' },
      }));
      await page.route(url => url.pathname === '/api/v1/subscription-roi/subscriptions', async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const principal = headers['x-teslasync-expected-principal'];
        if (principal) expect(principal).toBe(`subject:${subject}`);
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const url = new URL(intercepted.request().url());
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
        expect(url.searchParams.get('subscription_id')).toBe(variant.subscriptionId);
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(target);
      await waitForHarnessReady(page, api);
      return { page, api, panel: page.getByRole('region', { name: 'Private subscription renewal review' }) };
    };

    await tick('early');
    const settings = await open(early, `${route}#private-renewal`);
    await settings.panel.getByLabel('Recurring subscription').selectOption(variant.subscriptionId);
    await expect(settings.panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await settings.panel.getByRole('button', { name: 'Set up renewal review' }).press('Enter');
    const renewal = settings.panel.getByLabel('Recorded renewal date').and(settings.panel.locator('input[type="date"]'));
    await expect(renewal).toBeFocused();
    await renewal.fill('2026-03-16');
    await settings.panel.getByLabel('Renewal time zone').fill('America/New_York');
    await settings.panel.getByLabel('Days before renewal to review').fill('7');
    const consent = settings.panel.getByRole('switch', { name: /Use my recorded renewal date and price of .*13\.37 USD/ });
    const submit = settings.panel.getByRole('button', { name: 'Confirm private renewal review' });
    await expect(submit).toBeDisabled();
    await consent.press('Space');
    await submit.press('Enter');
    await expect(settings.panel.getByText(/^Active\. Waiting/)).toBeVisible();
    await expect(settings.panel.getByRole('button', { name: 'Edit renewal settings' })).toBeFocused();
    await tick('early');
    await assertMockApiComplete(settings.page, settings.api);
    await settings.page.close();

    await tick('due');
    const { page, api, panel } = await open(due, '/action-center?vehicle_id=7&source_feature=subscription_renewal');
    await expect(page.getByRole('heading', { name: 'Review the recorded subscription renewal' })).toBeVisible();
    await page.getByRole('button', { name: 'Open private renewal review' }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/ownership/subscription-roi\\?vehicle_id=7&subscription_id=${variant.subscriptionId}#private-renewal$`));
    const finding = panel.getByRole('heading', { name: 'Review the recorded subscription renewal' });
    await expect(finding).toBeVisible();
    await expect(panel.getByText(/\$13\.37 USD/, { exact: false })).toBeVisible();
    await expect(panel.getByText(/^40\.5(?:0+)?\s*km$/)).toBeVisible();
    await expect(panel.getByText(/^Recorded on 2 days/)).toBeVisible();
    await expect(panel.getByText(/does not prove that the subscription caused it/)).toBeVisible();
    await panel.getByRole('button', { name: 'Dismiss this renewal review' }).press('Enter');
    await expect(finding).toHaveCount(0);
    await expect(panel.getByText('Dismissed for this renewal date.')).toBeVisible();
    await panel.getByRole('button', { name: 'Pause renewal review' }).press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear renewal review';
    const clear = panel.getByRole('button', { name: clearLabel });
    const dialog = page.getByRole('dialog', { name: clearLabel });
    await clear.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(clear).toBeFocused();
    await clear.press('Enter');
    await dialog.getByRole('button', { name: clearLabel }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(panel.getByLabel('Recurring subscription')).toHaveValue(variant.subscriptionId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `PUT ${endpoint}`, `DELETE ${endpoint}`]);
    expect(errors).toEqual([]);
    expect(externalOrigins).toEqual([]);
  });
}
