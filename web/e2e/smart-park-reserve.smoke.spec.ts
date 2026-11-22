import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { installCatalogueBatterySources } from './dashboardCatalogueBatteryFixtures';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture';
import { park, split } from './operationalbrief-contracts/battery.fixtures';

test.use({
  serviceWorkers: 'allow',
  ...(process.env.SMART_PARK_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_PARK_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/vampire-drain?vehicle_id=7';
const parkEndpoint = '/api/v1/charging/park-reserve';
const openReview = 'Review parked reserve';
const startPlan = 'Plan a long park';

async function installFixtures(page: Page, subject: string, theme: 'dark' | 'light', pack: string) {
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await installCatalogueBatterySources(page, api);
  for (const [path, json] of [['/api/v1/physics/park-truth', park], ['/api/v1/physics/vampire', split]] as const) {
    await page.route(url => url.pathname === path, route => fulfillApiFixture(route, api, { json }));
  }
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === parkEndpoint ||
    url.pathname.startsWith('/api/v1/smart-delivery') || url.pathname.startsWith('/api/v1/smart-charging'),
  async route => {
    const request = route.request();
    const headers = await request.allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    await forwardLocalApiFixture(route, api, headers);
  });
  return api;
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`parked reserve forecast and private reminder: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(150_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-park-${variant.name}`;
    const foreign = `synthetic-park-foreign-${variant.name}`;
    const signIn = (subject: string) => context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/park-reserve?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const latest = async () => {
      const response = await context.request.post(`${origin}/__fixture/park-reserve?phase=latest`);
      return response.status() === 200 ? await response.json() : null;
    };
    const writes: string[] = [];
    context.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|wake|charging|smart-delivery|smart-charging)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await context.grantPermissions(['notifications'], { origin });
    await signIn(owner);
    await tick('setup');
    const prior = await latest();
    await page.clock.setFixedTime(new Date('2026-11-20T17:00:00Z'));
    await seedBrowserState(page, variant.theme, reviewPath, { allowServiceWorkers: true });
    await installSyntheticSubscription(page, `park-${variant.name}`);
    const api = await installFixtures(page, owner, variant.theme, variant.pack);
    await page.goto(reviewPath);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private parked charge reserve', exact: true });
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await panel.getByRole('button', { name: startPlan }).press('Enter');
    await expect(panel.getByLabel(/^Planned return/)).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Save parked reserve plan' })).toBeDisabled();
    const pushSwitch = panel.getByRole('switch', { name: /^Send one private reminder/ });
    await expect(pushSwitch).not.toBeChecked();
    await pushSwitch.press('Space');
    await panel.getByRole('link', { name: 'Verify this browser in personal delivery settings' }).click();
    await page.getByRole('button', { name: 'Connect this browser' }).click();
    await expect.poll(async () => {
      const payload = await latest();
      return payload?.kind === 'verify' && payload.token !== prior?.token;
    }).toBe(true);
    const verification = await latest();
    await expect.poll(() => context.serviceWorkers().some(worker => worker.url().endsWith('/personal-delivery/sw.js'))).toBe(true);
    const worker = context.serviceWorkers().find(item => item.url().endsWith('/personal-delivery/sw.js'));
    if (!worker) throw new Error('Personal delivery worker did not start');
    expect(await dispatchPush(worker, verification)).toEqual({ status: 200, notification: 'shown' });
    await clearNotifications(worker);

    await page.goto(reviewPath);
    await panel.getByRole('button', { name: openReview }).press('Enter');
    await panel.getByRole('button', { name: startPlan }).press('Enter');
    await pushSwitch.press('Space');
    await expect(panel.getByText('This browser is verified for personal delivery.')).toBeVisible();
    await panel.getByLabel(/^Planned return/).fill('2026-11-22T17:00');
    await panel.getByLabel('Minimum return charge (%)').fill('28');
    const confirm = panel.getByRole('switch', { name: /^The vehicle is parked and unplugged/ });
    await expect(confirm).not.toBeChecked();
    await confirm.press('Space');
    await panel.getByRole('button', { name: 'Save parked reserve plan' }).press('Enter');
    await expect(panel.getByText(/^Active\. Waiting/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Change parked reserve plan' })).toBeFocused();
    expect(await latest()).toEqual(verification);
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true });
    await page.close();

    await tick('due');
    const payload = await latest();
    expect(payload?.kind).toBe('park-reserve');
    expect(Object.keys(payload).sort()).toEqual(['kind', 'token']);
    await tick('due');
    expect(await latest()).toEqual(payload);
    await signIn(foreign);
    expect(await dispatchPush(worker, payload)).toEqual({ status: 404, notification: 'not-called' });
    await signIn(owner);
    expect(await dispatchPush(worker, payload)).toEqual({ status: 200, notification: 'shown' });
    await expect.poll(() => notifications(worker)).toHaveLength(1);
    const [notice] = await notifications(worker);
    expect(notice.title).toBe('Review your parked charge reserve');
    const deliveryPath = notice.data?.url;
    expect(deliveryPath).toMatch(/^\/vampire-drain\?vehicle_id=7&park_vehicle_id=7&park_plan_id=\d+#park-reserve$/);
    if (typeof deliveryPath !== 'string') throw new Error('Notification did not link to the plan');

    const next = await context.newPage();
    await next.setViewportSize({ width: variant.width, height: variant.height });
    await next.clock.setFixedTime(new Date('2026-11-20T17:00:00Z'));
    await seedBrowserState(next, variant.theme, deliveryPath, { allowServiceWorkers: true });
    const nextApi = await installFixtures(next, owner, variant.theme, variant.pack);
    await next.goto(deliveryPath);
    await waitForHarnessReady(next, nextApi);
    const detail = next.getByRole('region', { name: 'Private parked charge reserve', exact: true });
    await expect(detail.getByText(/Estimated return charge: 24% to 30%.+3 parks/)).toBeVisible();
    const charging = detail.getByRole('link', { name: 'Review charging for this vehicle' });
    await expect(charging).toHaveAttribute('href', '/charging?vehicle_id=7');
    await next.goto(deliveryPath.replace('park_vehicle_id=7', 'park_vehicle_id=8'));
    await expect(detail.getByText(/Select the vehicle for this plan/)).toBeVisible();
    await expect(charging).toHaveCount(0);

    await tick('expiry');
    await next.clock.setFixedTime(new Date('2026-11-20T18:30:00Z'));
    await next.goto(deliveryPath);
    await expect(detail.getByText(/^Expired\./)).toBeVisible();
    await expect(charging).toHaveCount(0);
    await next.goto(`${reviewPath}#park-reserve`);
    await detail.getByRole('button', { name: 'Turn off and clear plan' }).press('Enter');
    await expect(detail.getByText(/^Off\./)).toBeVisible();
    await expect(detail.getByRole('button', { name: startPlan })).toBeFocused();
    await next.goto(deliveryPath);
    await expect(detail.getByText(/This private plan is no longer available/)).toBeVisible();
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true });
    expect(writes.filter(write => !/^POST \/api\/v1\/smart-delivery\/(devices\/lookup|devices\/\d+\/verify|deliveries\/claim)$/.test(write))).toEqual([
      'POST /api/v1/smart-delivery/devices', `PUT ${parkEndpoint}`, `DELETE ${parkEndpoint}`,
    ]);
  });
}
