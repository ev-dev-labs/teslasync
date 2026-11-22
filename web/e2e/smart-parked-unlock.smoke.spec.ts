import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture';

test.use({
  serviceWorkers: 'allow',
  ...(process.env.SMART_UNLOCK_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_UNLOCK_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/security-access?vehicle_id=7';
const endpoint = '/api/v1/security/parked-unlock';
const region = 'Private parked unlock reminders';
const openReview = 'Review parked unlock reminders';
const setup = 'Set up unlock reminders';

async function installFixtures(page: Page, subject: string, theme: 'dark' | 'light', pack: string) {
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/security', route => fulfillApiFixture(route, api, { json: [] }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === endpoint || url.pathname === '/api/v1/geofences' ||
    url.pathname.startsWith('/api/v1/smart-delivery') || url.pathname.startsWith('/api/v1/smart-charging'),
  async route => {
    const headers = await route.request().allHeaders();
    if (new URL(route.request().url()).pathname !== '/api/v1/geofences') {
      expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    }
    await forwardLocalApiFixture(route, api, headers);
  });
  return api;
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`parked unlock enrollment and private review at an explicitly chosen place: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(150_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-unlock-${variant.name}`;
    const foreign = `synthetic-unlock-foreign-${variant.name}`;
    const signIn = (subject: string) => context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/parked-unlock?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const latest = async (): Promise<{ count: number; payload: { kind: string; token: string } | null }> =>
      (await context.request.post(`${origin}/__fixture/parked-unlock?phase=latest`)).json();
    const writes: string[] = [];
    const frontendErrors: unknown[] = [];
    context.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/v1/web-errors') {
        frontendErrors.push(request.postDataJSON());
      } else if (request.method() !== 'GET' && pathname.startsWith('/api/v1/') && !pathname.startsWith('/api/v1/pinned')) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await context.grantPermissions(['notifications'], { origin });
    await signIn(owner);
    await tick('setup');
    const prior = await latest();
    await page.clock.setFixedTime(new Date('2026-11-20T17:15:00Z'));
    await seedBrowserState(page, variant.theme, reviewPath, { allowServiceWorkers: true });
    await installSyntheticSubscription(page, `unlock-${variant.name}`);
    const api = await installFixtures(page, owner, variant.theme, variant.pack);
    await page.goto(reviewPath);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: region, exact: true });
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await panel.getByRole('button', { name: setup }).press('Enter');
    const place = panel.getByLabel('Saved place to monitor');
    await expect(place).toBeFocused();
    await expect(place).toHaveValue('');
    await expect(place.getByRole('option', { name: 'Synthetic unreviewed place' })).toHaveCount(0);
    const enable = panel.getByRole('button', { name: 'Enable private unlock reminders' });
    await expect(enable).toBeDisabled();
    await panel.getByRole('link', { name: 'Verify this browser in personal delivery settings' }).click();
    await page.getByRole('button', { name: 'Connect this browser' }).click();
    await expect.poll(async () => {
      const { payload } = await latest();
      return payload?.kind === 'verify' && payload.token !== prior.payload?.token;
    }).toBe(true);
    const verification = await latest();
    await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true);
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'));
    if (!worker) throw new Error('Personal delivery worker did not start');
    expect(await dispatchPush(worker, verification.payload)).toEqual({ status: 200, notification: 'shown' });
    await clearNotifications(worker);
    await page.goto(reviewPath);
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await panel.getByRole('button', { name: setup }).press('Enter');
    await expect(panel.getByText('This browser is verified for personal delivery.')).toBeVisible();
    const consent = panel.getByRole('switch', { name: /^Monitor this vehicle/ });
    await expect(consent).toBeDisabled();
    await place.selectOption({ label: 'Synthetic monitored place' });
    await expect(consent).not.toBeChecked();
    await expect(enable).toBeDisabled();
    await consent.press('Space');
    await enable.press('Enter');
    await expect(panel.getByText(/^Active\. No current alert/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Change place or resume reminders' })).toBeFocused();
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true });
    await page.close();

    await tick('grace');
    expect(await latest()).toEqual(verification);
    await tick('due');
    const after = await latest();
    expect(after.count).toBe(verification.count + 1);
    expect(after.payload?.kind).toBe('parked-unlock');
    expect(Object.keys(after.payload ?? {}).sort()).toEqual(['kind', 'token']);
    await tick('due');
    expect(await latest()).toEqual(after);
    await signIn(foreign);
    expect(await dispatchPush(worker, after.payload)).toEqual({ status: 404, notification: 'not-called' });
    await signIn(owner);
    expect(await dispatchPush(worker, after.payload)).toEqual({ status: 200, notification: 'shown' });
    await expect.poll(() => notifications(worker)).toHaveLength(1);
    const [notice] = await notifications(worker);
    expect(notice.title).toBe('Check your parked vehicle');
    const path = notice.data?.url;
    expect(path).toMatch(/^\/security-access\?vehicle_id=7&unlock_vehicle_id=7&unlock_plan_id=\d+&unlock_park_id=\d+#parked-unlock$/);
    if (typeof path !== 'string') throw new Error('Notification did not link to the parked unlock review');

    const next = await context.newPage();
    await next.setViewportSize({ width: variant.width, height: variant.height });
    await next.clock.setFixedTime(new Date('2026-11-20T17:21:02Z'));
    await seedBrowserState(next, variant.theme, path, { allowServiceWorkers: true });
    const nextApi = await installFixtures(next, owner, variant.theme, variant.pack);
    await next.goto(path);
    await waitForHarnessReady(next, nextApi);
    const detail = next.getByRole('region', { name: region, exact: true });
    await expect(detail.getByText('Selected place: Synthetic monitored place')).toBeVisible();
    await expect(detail.getByText(/^Unlocked was observed from/)).toBeVisible();
    await expect(detail.getByText(/If safe, check the vehicle in person/)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Pause unlock reminders' })).toHaveCount(0);
    await next.goto(path.replace('unlock_vehicle_id=7', 'unlock_vehicle_id=8'));
    await expect(detail.getByText(/Select the vehicle for these reminders/)).toBeVisible();
    await expect(detail.getByText(/Unlocked was observed from/)).toHaveCount(0);
    await tick('locked');
    await next.clock.setFixedTime(new Date('2026-11-20T17:22:02Z'));
    await next.goto(path);
    await expect(detail.getByText(/This parked unlock review is no longer available/)).toBeVisible();
    await detail.getByRole('link', { name: 'Manage unlock reminders' }).click();
    await detail.getByRole('button', { name: 'Snooze unlock reminders for 15 minutes' }).press('Enter');
    await expect(detail.getByText(/^Snoozed until/)).toBeVisible();
    await detail.getByRole('button', { name: 'Pause unlock reminders' }).press('Enter');
    await expect(detail.getByText(/^Paused\./)).toBeVisible();
    await detail.getByRole('button', { name: 'Turn off and clear unlock reminders' }).press('Enter');
    await expect(detail.getByText(/^Off\./)).toBeVisible();
    await expect(detail.getByRole('button', { name: setup })).toBeFocused();
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true });
    expect(frontendErrors).toEqual([]);
    expect(writes.filter(write => !/^POST \/api\/v1\/smart-delivery\/(devices\/lookup|devices\/\d+\/verify|deliveries\/claim)$/.test(write))).toEqual([
      'POST /api/v1/smart-delivery/devices', `PUT ${endpoint}`, `PATCH ${endpoint}`, `PATCH ${endpoint}`, `DELETE ${endpoint}`,
    ]);
  });
}
