import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

test.skip(process.env.SMART_INCIDENT_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const endpoint = '/api/v1/action-center';
const inbox = '/action-center?vehicle_scope=fleet&source_feature=system_health&state=all';
const operator = 'synthetic-incident-operator';
const outage = 'Estimates paused: HERE traffic flow';
const recovery = 'Estimates resumed: HERE traffic flow';
const layouts = [
  { title: 'desktop light', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { title: 'mobile dark', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const;

async function openInbox(page: Page, subject: string, layout: typeof layouts[number]) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await seedBrowserState(page, layout.theme, inbox);
  const api = await installApiMocks(page, 'populated', layout.theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: layout.pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === endpoint || url.pathname.startsWith(`${endpoint}/`), async route => {
    const headers = await route.request().allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    await forwardLocalApiFixture(route, api, { ...headers, 'x-test-subject': subject });
  });
  await page.goto(inbox);
  await waitForHarnessReady(page, api);
  return api;
}

for (const layout of layouts) {
  test(`operator acknowledges one outage and receives one recovery: ${layout.title}`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    const api = await openInbox(page, operator, layout);
    const paused = page.getByRole('article', { name: outage, exact: true });
    const resumed = page.getByRole('article', { name: recovery, exact: true });
    await expect(paused).toHaveCount(1);
    await expect(paused.getByText(/reported that it was unavailable/)).toBeVisible();
    await expect(resumed).toHaveCount(0);
    await paused.getByRole('button', { name: 'Acknowledge', exact: true }).press('Enter');
    const [acknowledged] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname.endsWith('/actions') && item.request().method() === 'POST'),
      page.getByRole('dialog').getByRole('button', { name: 'Acknowledge', exact: true }).click(),
    ]);
    expect(acknowledged.ok()).toBe(true);
    await expect(paused.getByText('Acknowledged', { exact: true })).toBeVisible();
    expect((await page.request.post('/__fixture/here-recovery')).status()).toBe(204);
    await page.reload();
    await waitForHarnessReady(page, api);
    await expect(paused).toHaveCount(1);
    await expect(paused.getByText('Acknowledged', { exact: true })).toBeVisible();
    await expect(resumed).toHaveCount(1);
    await expect(resumed.getByText(/fresh, usable response/)).toBeVisible();
    await expect(resumed.getByRole('button', { name: 'Acknowledge', exact: true })).toBeEnabled();
    await assertMockApiComplete(page, api);

    const other = await browser.newContext();
    try {
      const peer = await other.newPage();
      const peerApi = await openInbox(peer, 'synthetic-other-operator', layout);
      await expect(peer.getByRole('article', { name: outage, exact: true })).toHaveCount(0);
      await expect(peer.getByRole('article', { name: recovery, exact: true })).toHaveCount(0);
      await assertMockApiComplete(peer, peerApi);
    } finally {
      await other.close();
    }
  });
}
