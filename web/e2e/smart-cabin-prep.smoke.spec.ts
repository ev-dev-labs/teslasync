import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { clearNotifications, dispatchPush, installSyntheticSubscription, notifications } from './personalDeliveryFixture';

test.use({
  serviceWorkers: 'allow',
  ...(process.env.SMART_CABIN_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_CABIN_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/preconditioning-effectiveness?vehicle_id=7';
const deliveryPath = `${reviewPath}&cabin_vehicle_id=7#cabin-prep-reminder`;
const cabinEndpoint = '/api/v1/climate/cabin-prep';
const climateAction = '/commands?vehicle_id=7&cabin_vehicle_id=7#climate-controls';

async function installFixtures(page: Page, subject: string, theme: 'dark' | 'light', pack: string) {
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === cabinEndpoint ||
    url.pathname.startsWith('/api/v1/smart-delivery') || url.pathname.startsWith('/api/v1/smart-charging'),
  async route => {
    const request = route.request();
    const headers = await request.allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    if (new URL(request.url()).pathname === cabinEndpoint) {
      expect(new URL(request.url()).searchParams.get('vehicle_id')).toBe('7');
    }
    await forwardLocalApiFixture(route, api, headers);
  });
  await page.route(url => url.pathname === '/api/v1/climate' || url.pathname === '/api/v1/drives', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).searchParams.get('vehicle_id')).toBe('7');
    return fulfillApiFixture(route, api, { json: [] });
  });
  await page.route('**/api/v1/vehicles/7/commands/latest*', route => fulfillApiFixture(route, api, { json: [] }));
  return api;
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`consented and timely cabin reminder: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(150_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const owner = `synthetic-cabin-${variant.name}`;
    const foreign = `synthetic-cabin-foreign-${variant.name}`;
    const signIn = (subject: string) => context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: string) => {
      const response = await context.request.post(`${origin}/__fixture/cabin?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const latest = async () => {
      const response = await context.request.post(`${origin}/__fixture/cabin?phase=latest`);
      return response.status() === 200 ? await response.json() : null;
    };
    const writes: string[] = [];
    context.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/(commands?|climate|smart-delivery|smart-charging)(\/|$)/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await context.grantPermissions(['notifications'], { origin });
    await signIn(owner);
    await tick('setup');
    const prior = await latest();
    await page.clock.setFixedTime(new Date('2026-11-09T07:00:00Z'));
    await seedBrowserState(page, variant.theme, reviewPath, { allowServiceWorkers: true });
    await installSyntheticSubscription(page, `cabin-${variant.name}`);
    const api = await installFixtures(page, owner, variant.theme, variant.pack);
    await page.goto(reviewPath);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private cabin prep reminder', exact: true });
    await panel.getByRole('button', { name: 'Review cabin reminder' }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await panel.getByRole('button', { name: 'Set one morning reminder' }).press('Enter');
    await expect(panel.getByLabel(/^Morning departure/)).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Confirm cabin reminder' })).toBeDisabled();
    await panel.getByRole('link', { name: 'Verify a browser in personal delivery settings' }).click();
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
    await panel.getByRole('button', { name: 'Review cabin reminder' }).press('Enter');
    await panel.getByRole('button', { name: 'Set one morning reminder' }).press('Enter');
    await expect(panel.getByText('This browser is verified for personal delivery.')).toBeVisible();
    await panel.getByLabel(/^Morning departure/).fill('2026-11-09T08:00');
    const confirm = panel.getByRole('switch', { name: /^I confirm this one departure/ });
    await expect(confirm).not.toBeChecked();
    await confirm.press('Space');
    await panel.getByRole('button', { name: 'Confirm cabin reminder' }).press('Enter');
    await expect(panel.getByText(/^Active\. Waiting/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Review or change departure' })).toBeFocused();
    await tick('forecast');
    expect(await latest()).toEqual(verification);
    await assertMockApiComplete(page, api, { preserveServiceWorkers: true });
    await page.close();

    await tick('due');
    const payload = await latest();
    expect(payload?.kind).toBe('cabin-prep');
    expect(Object.keys(payload).sort()).toEqual(['kind', 'token']);
    await tick('due');
    expect(await latest()).toEqual(payload);
    await signIn(foreign);
    expect(await dispatchPush(worker, payload)).toEqual({ status: 404, notification: 'not-called' });
    await signIn(owner);
    expect(await dispatchPush(worker, payload)).toEqual({ status: 200, notification: 'shown' });
    await expect.poll(() => notifications(worker)).toEqual([
      { title: 'Review cabin preparation', data: { url: deliveryPath } },
    ]);

    const next = await context.newPage();
    await next.setViewportSize({ width: variant.width, height: variant.height });
    await next.clock.setFixedTime(new Date('2026-11-09T07:47:00Z'));
    await seedBrowserState(next, variant.theme, deliveryPath, { allowServiceWorkers: true });
    const nextApi = await installFixtures(next, owner, variant.theme, variant.pack);
    await next.goto(deliveryPath);
    await waitForHarnessReady(next, nextApi);
    const detail = next.getByRole('region', { name: 'Private cabin prep reminder', exact: true });
    await expect(detail.getByText(/Estimate: 9(?:\.0+)? min to 13(?:\.0+)? min.+4 comparable mornings/)).toBeVisible();
    await expect(detail.getByText(/^Act by/)).toBeVisible();
    const climate = detail.getByRole('link', { name: /Review this vehicle.s climate controls/ });
    await expect(climate).toHaveAttribute('href', climateAction);
    await climate.click();
    await expect(next).toHaveURL(url => `${url.pathname}${url.search}${url.hash}` === climateAction);
    await expect(next.getByRole('region', { name: 'Climate', exact: true })).toBeFocused();
    await next.goto(climateAction.replaceAll('=7', '=999'));
    await expect(next.getByTestId('vehicle-command-center')).toHaveCount(0);

    await tick('expiry');
    await next.clock.setFixedTime(new Date('2026-11-09T07:51:00Z'));
    await next.goto(deliveryPath);
    await expect(detail.getByText(/^Expired\./)).toBeVisible();
    await expect(climate).toHaveCount(0);
    await detail.getByRole('button', { name: 'Turn off and clear reminder' }).press('Enter');
    await expect(detail.getByText(/^Off\./)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Set one morning reminder' })).toBeFocused();
    await assertMockApiComplete(next, nextApi, { preserveServiceWorkers: true });
    expect(writes.filter(write => !/^POST \/api\/v1\/smart-delivery\/(devices\/lookup|devices\/\d+\/verify|deliveries\/claim)$/.test(write))).toEqual([
      'POST /api/v1/smart-delivery/devices', `PUT ${cabinEndpoint}`, `DELETE ${cabinEndpoint}`,
    ]);
  });
}
