import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, mockAppSettings, seedBrowserState, waitForHarnessReady,
} from './mockApi';

test.use({
  timezoneId: 'UTC',
  ...(process.env.SMART_SOFTWARE_WINDOW_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_SOFTWARE_WINDOW_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const route = '/software-updates?vehicle_id=7#software-window-review';
const endpoint = '/api/v1/software-updates/window-review';

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`software update advice needs confirmed details, fresh idle evidence and margin: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-software-${variant.name}`;
    let subject = owner;
    const signIn = async (changed: string) => {
      subject = changed;
      await context.addCookies([{ name: 'personal_test_subject', value: changed, url: origin }]);
    };
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/software-window?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const writes: string[] = [];
    const applicationErrors: string[] = [];
    page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') applicationErrors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await signIn(owner);
    await tick('setup');
    await page.clock.setFixedTime(new Date('2026-11-20T17:16:15Z'));
    await seedBrowserState(page, variant.theme, route);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Missing isolated API fixtures');
    api.navPins = [...DEFAULT_PINNED_NAV_PATHS, '@navigation-initialized'].map((path, index) => ({
      id: index + 1, item_type: 'navigation', item_id: path, position: index, pinned_at: '2026-11-20T17:00:00Z',
    }));
    await page.route('**/api/v1/system/auth-mode', intercepted => fulfillApiFixture(intercepted, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject },
    }));
    await page.route(url => url.pathname === '/api/v1/settings' && !url.search, intercepted =>
      fulfillApiFixture(intercepted, api, {
        json: { ...mockAppSettings, mode: variant.theme, timezone_user: 'America/New_York' },
      }));
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(url => url.pathname === '/api/v1/software-updates', intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      expect(new URL(intercepted.request().url()).searchParams.get('vehicle_id')).toBe('7');
      return fulfillApiFixture(intercepted, api, { json: [] });
    });
    await page.route(url => url.pathname === endpoint, async intercepted => {
      const headers = await intercepted.request().allHeaders();
      expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private software update window', exact: true });
    const off = panel.getByText(/^Off\. Confirm/);
    const fit = panel.getByText('The estimated update fits before your confirmed departure.');
    const edit = panel.getByRole('button', { name: 'Recheck or edit update details' });
    await expect(off).toBeVisible();
    await expect(fit).toHaveCount(0);
    expect(writes, applicationErrors.join('\n')).toEqual([]);
    await panel.getByRole('button', { name: 'Confirm update and departure' }).press('Enter');
    const departure = panel.getByLabel('Confirmed departure (America/New_York)');
    await expect(departure).toBeFocused();
    await page.clock.setFixedTime(new Date('2026-11-01T04:30:00Z'));
    await departure.fill('2026-11-01T01:30');
    await panel.getByLabel('Ready update version').fill('2026.40.2');
    await panel.getByLabel('Known installation estimate (minutes)').fill('40');
    const save = panel.getByRole('button', { name: 'Check this window' });
    await expect(save).toBeDisabled();
    const confirmed = panel.getByRole('switch', { name: /^I checked that this update/ });
    await confirmed.press('Space');
    await save.press('Enter');
    await expect(panel.getByText(/Skipped and repeated clock times are not valid/)).toBeVisible();
    expect(writes).toEqual([]);
    await page.clock.setFixedTime(new Date('2026-11-20T17:16:15Z'));
    await departure.fill('2026-11-20T14:15');
    await expect(confirmed).not.toBeChecked();
    await confirmed.press('Space');
    await save.press('Enter');
    await expect(panel.getByText(/^No current recommendation\. Recent observations/)).toBeVisible();
    await expect(edit).toBeFocused();
    await tick('idle');
    await page.reload();
    await expect(fit).toBeVisible();
    await expect(panel.getByText('Why this window?')).toBeVisible();
    await expect(panel.getByText(/includes a 30-minute margin/)).toBeVisible();
    await expect(panel.getByText(/prevent driving, and interrupt charging/)).toBeVisible();
    expect(writes).toEqual([`PUT ${endpoint}`]);
    await panel.getByRole('button', { name: 'Snooze 2 minutes' }).click();
    await expect(panel.getByText(/^Snoozed until/)).toBeVisible();
    await expect(fit).toHaveCount(0);
    await tick('resume');
    await page.clock.setFixedTime(new Date('2026-11-20T17:18:25Z'));
    await page.reload();
    await expect(fit).toBeVisible();

    await signIn(`synthetic-software-foreign-${variant.name}`);
    await page.reload();
    await expect(off).toBeVisible();
    await expect(panel.getByText(/2026\.40\.2/)).toHaveCount(0);
    await signIn(owner);
    await page.reload();
    await expect(fit).toBeVisible();
    await tick('scheduled');
    await page.reload();
    await expect(panel.getByText(/^Recent vehicle data may conflict/)).toBeVisible();
    await expect(fit).toHaveCount(0);
    await panel.getByRole('button', { name: 'Pause review' }).click();
    await expect(panel.getByText(/^Paused\. Confirm/)).toBeVisible();
    await panel.getByRole('button', { name: 'Turn off and clear' }).click();
    await page.getByRole('dialog', { name: 'Turn off and clear' }).getByRole('button', { name: 'Turn off and clear' }).click();
    await expect(off).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes, applicationErrors.join('\n')).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `PATCH ${endpoint}`, `DELETE ${endpoint}`]);
  });
}
