import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture';

test.use({
  serviceWorkers: 'allow',
  ...(process.env.SMART_RAIN_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_RAIN_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/security-access?vehicle_id=7';
const rainEndpoint = '/api/v1/security/window-rain';
const openReview = 'Review window rain watch';
const startWatch = 'Set up an outdoor watch';

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
  await page.route(url => url.pathname === rainEndpoint ||
    url.pathname.startsWith('/api/v1/smart-delivery') || url.pathname.startsWith('/api/v1/smart-charging'),
  async route => {
    const headers = await route.request().allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    await forwardLocalApiFixture(route, api, headers);
  });
  return api;
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`consented outdoor window and rain alert: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(150_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-rain-${variant.name}`;
    const foreign = `synthetic-rain-foreign-${variant.name}`;
    const signIn = (subject: string) => context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/window-rain?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const latest = async (): Promise<{ forecasts: number; payload: { kind: string; token: string } | null }> =>
      (await context.request.post(`${origin}/__fixture/window-rain?phase=latest`)).json();
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
    await installSyntheticSubscription(page, `rain-${variant.name}`);
    const api = await installFixtures(page, owner, variant.theme, variant.pack);
    await page.goto(reviewPath);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private window rain watch', exact: true });
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(frontendErrors).toEqual([]);
    expect(writes).toEqual([]);
    await panel.getByRole('button', { name: startWatch }).press('Enter');
    await expect(panel.getByLabel('Maximum watch duration')).toBeFocused();
    const confirm = panel.getByRole('button', { name: 'Confirm watch and enable push' });
    await expect(confirm).toBeDisabled();
    await panel.getByRole('link', { name: 'Verify this browser in personal delivery settings' }).click();
    await page.getByRole('button', { name: 'Connect this browser' }).click();
    await expect.poll(async () => {
      const { payload } = await latest();
      return payload?.kind === 'verify' && payload.token !== prior.payload?.token;
    }).toBe(true);
    const verification = (await latest()).payload;
    await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true);
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'));
    if (!worker) throw new Error('Personal delivery worker did not start');
    expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' });
    await clearNotifications(worker);

    await page.goto(reviewPath);
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await panel.getByRole('button', { name: startWatch }).press('Enter');
    await expect(panel.getByText('This browser is verified for personal delivery.')).toBeVisible();
    const outdoor = panel.getByRole('switch', { name: /^This vehicle is parked outdoors/ });
    const sharing = panel.getByRole('switch', { name: /^Allow Open-Meteo/ });
    const terms = panel.getByRole('switch', { name: /^This watch is for personal/ });
    for (const toggle of [outdoor, sharing, terms]) await expect(toggle).not.toBeChecked();
    await sharing.press('Space');
    await terms.press('Space');
    await expect(confirm).toBeDisabled();
    await tick('closed');
    expect(await latest()).toEqual({ payload: verification, forecasts: prior.forecasts });
    await outdoor.press('Space');
    await confirm.press('Enter');
    await expect(panel.getByText(/^Watching this confirmed park/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Confirm a new outdoor watch' })).toBeFocused();
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true });
    await page.close();

    await tick('closed');
    expect(await latest()).toEqual({ payload: verification, forecasts: prior.forecasts });
    await tick('due');
    const after = await latest();
    expect(after.forecasts).toBe(prior.forecasts + 1);
    expect(after.payload?.kind).toBe('window-rain');
    expect(Object.keys(after.payload ?? {}).sort()).toEqual(['kind', 'token']);
    await tick('due');
    expect(await latest()).toEqual(after);
    await signIn(foreign);
    expect(await dispatchPush(worker, after.payload)).toEqual({ status: 404, notification: 'not-called' });
    await signIn(owner);
    expect(await dispatchPush(worker, after.payload)).toEqual({ status: 200, notification: 'shown' });
    await expect.poll(() => notifications(worker)).toHaveLength(1);
    const [notice] = await notifications(worker);
    expect(notice.title).toBe('Check your parked vehicle’s window');
    const deliveryPath = notice.data?.url;
    expect(deliveryPath).toMatch(/^\/security-access\?vehicle_id=7&rain_vehicle_id=7&rain_plan_id=\d+#window-rain$/);
    if (typeof deliveryPath !== 'string') throw new Error('Notification did not link to the watch');

    const next = await context.newPage();
    await next.setViewportSize({ width: variant.width, height: variant.height });
    await next.clock.setFixedTime(new Date('2026-11-20T17:16:00Z'));
    await seedBrowserState(next, variant.theme, deliveryPath, { allowServiceWorkers: true });
    const nextApi = await installFixtures(next, owner, variant.theme, variant.pack);
    await next.goto(deliveryPath);
    await waitForHarnessReady(next, nextApi);
    const detail = next.getByRole('region', { name: 'Private window rain watch', exact: true });
    await expect(detail.getByText(/Front driver’s window was observed open at/)).toBeVisible();
    await expect(detail.getByText(/Open-Meteo forecast received at/)).toBeVisible();
    await expect(detail.getByText(/^If safe, check the window in person/)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Pause watch' })).toHaveCount(0);
    await next.goto(deliveryPath.replace('rain_vehicle_id=7', 'rain_vehicle_id=8'));
    await expect(detail.getByText(/Select the vehicle for this watch/)).toBeVisible();
    await expect(detail.getByText(/was observed open at/)).toHaveCount(0);

    await tick('expiry');
    await next.clock.setFixedTime(new Date('2026-11-20T18:15:00Z'));
    await next.goto(deliveryPath);
    await expect(detail.getByText(/^Expired\./)).toBeVisible();
    await detail.getByRole('link', { name: 'Manage this watch' }).click();
    await detail.getByRole('button', { name: 'Turn off and clear watch' }).press('Enter');
    await expect(detail.getByText(/^Off\./)).toBeVisible();
    await expect(detail.getByRole('button', { name: startWatch })).toBeFocused();
    await next.goto(deliveryPath);
    await expect(detail.getByText(/This private watch is no longer available/)).toBeVisible();
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true });
    expect(frontendErrors).toEqual([]);
    expect(writes.filter(write => !/^POST \/api\/v1\/smart-delivery\/(devices\/lookup|devices\/\d+\/verify|deliveries\/claim)$/.test(write))).toEqual([
      'POST /api/v1/smart-delivery/devices', `PUT ${rainEndpoint}`, `DELETE ${rainEndpoint}`,
    ]);
  });
}
