import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

test.skip(process.env.SMART_AUTOMATION_FAILURE_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const inbox = '/action-center?vehicle_scope=fleet&source_feature=automation_failure';
const operator = 'synthetic-automation-operator';
const detail = '/api/v1/automations/history/602';
const history = '/api/v1/automations/51/history';
const now = process.env.SMART_AUTOMATION_NOW ?? '';

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
  await page.route(url => [detail, history, '/api/v1/automations', '/api/v1/action-center'].includes(url.pathname), async route => {
    const request = route.request();
    const headers = await request.allHeaders();
    expect(request.method()).toBe('GET');
    if (new URL(request.url()).pathname === '/api/v1/action-center') {
      expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    }
    await forwardLocalApiFixture(route, api, { ...headers, 'x-test-subject': subject });
  });
  return api;
}

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`operator reviews the exact latest automation outcome: ${variant.theme}`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.clock.setFixedTime(new Date(now));
    await seedBrowserState(page, variant.theme, inbox);
    const api = await installFixtures(page, operator, variant.theme, variant.pack);
    await page.goto(inbox);
    await waitForHarnessReady(page, api);
    await expect(page.getByText('Review repeated automation failures', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Synthetic scheduled check recorded 2 failed or partial runs in a row.')).toBeVisible();
    await expect(page.getByText('1/2 actions failed', { exact: true })).toHaveCount(0);
    const [response] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname === detail),
      page.getByRole('button', { name: 'Open latest execution' }).press('Enter'),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page).toHaveURL(url => url.pathname === '/automations/history' && url.searchParams.get('history_id') === '602');
    const dialog = page.getByRole('dialog', { name: 'Execution details' });
    await expect(dialog.getByText('1/2 actions failed', { exact: true })).toBeVisible();
    await expect(dialog.getByText('1/1 actions failed', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('synthetic private', { exact: false })).toHaveCount(0);
    const outsideRange = new URL(page.url());
    outsideRange.searchParams.set('from', '2001-01-01');
    outsideRange.searchParams.set('to', '2001-01-02');
    const [emptyHistory] = await Promise.all([
      page.waitForResponse(item => {
        const url = new URL(item.url());
        return url.pathname === history && url.searchParams.get('since')?.startsWith('2001-01-01') === true;
      }),
      page.goto(outsideRange.toString()),
    ]);
    expect(await emptyHistory.json()).toMatchObject({ items: [], total: 0, summary: { total_executions: 0 } });
    await expect(dialog.getByText('1/2 actions failed', { exact: true })).toBeVisible();
    await dialog.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(url => !url.searchParams.has('history_id') && url.searchParams.get('automation_id') === '51');
    await assertMockApiComplete(page, api);

    const foreign = await browser.newContext({ viewport: { width: variant.width, height: variant.height } });
    try {
      const peer = await foreign.newPage();
      await peer.clock.setFixedTime(new Date(now));
      await seedBrowserState(peer, variant.theme, inbox);
      const peerApi = await installFixtures(peer, 'synthetic-automation-peer', variant.theme, variant.pack);
      await peer.goto(inbox);
      await waitForHarnessReady(peer, peerApi);
      await expect(peer.getByRole('button', { name: 'Open latest execution' })).toHaveCount(0);
      await assertMockApiComplete(peer, peerApi);
    } finally {
      await foreign.close();
    }
  });
}
