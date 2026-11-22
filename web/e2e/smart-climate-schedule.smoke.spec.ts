import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

test.skip(process.env.SMART_CLIMATE_SCHEDULE_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

const reviewPath = '/preconditioning-effectiveness?vehicle_id=7';
const actionPath = `${reviewPath}&climate_review_vehicle_id=7#scheduled-climate-review`;
const inbox = '/action-center?vehicle_id=7&source_feature=climate_schedule';
const endpoint = '/api/v1/climate/scheduled-review';
const owner = 'synthetic-climate-schedule-owner';
const peer = 'synthetic-climate-schedule-peer';

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
  await page.route(url => url.pathname === endpoint || url.pathname === '/api/v1/action-center', async route => {
    const request = route.request();
    const headers = await request.allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    expect(new URL(request.url()).searchParams.get('vehicle_id')).toBe('7');
    await forwardLocalApiFixture(route, api, headers);
  });
  await page.route(url => /^\/api\/v1\/automations(?:\/(?:\d+\/)?history)?$/.test(url.pathname), async route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(['/api/v1/automations', '/api/v1/automations/51/history']).toContain(new URL(request.url()).pathname);
    await forwardLocalApiFixture(route, api, await request.allHeaders());
  });
  await page.route(url => url.pathname === '/api/v1/climate' || url.pathname === '/api/v1/drives', route => {
    expect(route.request().method()).toBe('GET');
    return fulfillApiFixture(route, api, { json: [] });
  });
  return api;
}

for (const variant of [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`consented private climate review: ${variant.theme}`, async ({ page, context, browser }) => {
    test.setTimeout(100_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    await context.addCookies([{ name: 'personal_test_subject', value: owner, url: origin }]);
    const setup = await context.request.post(`${origin}/__fixture/climate-schedule?phase=setup`);
    expect(setup.status(), await setup.text()).toBe(204);
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'));
    await seedBrowserState(page, variant.theme, reviewPath);
    const api = await installFixtures(page, owner, variant.theme, variant.pack);
    const writes: string[] = [];
    context.on('request', request => {
      const { pathname } = new URL(request.url());
      if (request.method() !== 'GET' && /\/(climate|automations|smart-delivery|commands?|action-center)\b/.test(pathname)) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto(reviewPath);
    await waitForHarnessReady(page, api);
    const review = page.getByRole('region', { name: 'Private scheduled climate review', exact: true });
    await review.getByRole('button', { name: 'Review scheduled climate' }).press('Enter');
    await expect(review.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await review.getByRole('button', { name: 'Set up schedule review' }).press('Enter');
    const schedule = review.getByRole('combobox', { name: 'Scheduled climate automation' });
    await expect(schedule).toBeFocused();
    await schedule.selectOption('51');
    const save = review.getByRole('button', { name: 'Confirm private review' });
    await expect(save).toBeDisabled();
    await review.getByRole('switch', { name: /^I want a private weekly review/ }).press('Space');
    await save.press('Enter');
    await expect(review.getByText(/^Learning\./)).toBeVisible();
    await expect(review.getByRole('button', { name: 'Change reviewed schedule' })).toBeFocused();
    await assertMockApiComplete(page, api);
    await page.close();

    const tick = await context.request.post(`${origin}/__fixture/climate-schedule`);
    expect(tick.status(), await tick.text()).toBe(204);
    const next = await context.newPage();
    await next.setViewportSize({ width: variant.width, height: variant.height });
    await next.clock.setFixedTime(new Date('2026-11-09T15:00:00Z'));
    await seedBrowserState(next, variant.theme, inbox);
    const nextApi = await installFixtures(next, owner, variant.theme, variant.pack);
    await next.goto(inbox);
    await waitForHarnessReady(next, nextApi);
    await expect(next.getByText('Review a recurring climate schedule', { exact: true })).toHaveCount(1);
    await next.getByRole('button', { name: 'Review scheduled climate' }).click();
    await expect(next).toHaveURL(url => `${url.pathname}${url.search}${url.hash}` === actionPath);
    const detail = next.getByRole('region', { name: 'Private scheduled climate review', exact: true });
    await expect(detail.getByText(/Climate started near 3 matching/)).toBeVisible();
    await expect(detail.getByRole('listitem')).toHaveCount(3);
    const [history] = await Promise.all([
      next.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/automations/51/history'),
      detail.getByRole('link', { name: /View the schedule.s run history/ }).click(),
    ]);
    expect(history.ok()).toBe(true);
    const data: { items: { automation_id: number }[] } = await history.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect([...new Set(data.items.map(row => row.automation_id))]).toEqual([51]);
    await expect(next).toHaveURL(url => url.pathname === '/automations/history' && url.searchParams.get('automation_id') === '51');
    await expect(next.getByRole('combobox', { name: 'Filter executions by rule' })).toHaveValue('51');
    await expect(next.getByRole('button', { name: /^Synthetic Monday cabin(?: #\d+)?$/ }).first()).toBeVisible();
    await expect(next.getByRole('button', { name: /^Foreign cabin(?: #\d+)?$/ })).toHaveCount(0);
    await assertMockApiComplete(next, nextApi);
    await next.goBack();
    await expect(detail.getByText(/Climate started near 3 matching/)).toBeVisible();

    const foreign = await browser.newContext({ viewport: { width: variant.width, height: variant.height } });
    try {
      await foreign.addCookies([{ name: 'personal_test_subject', value: peer, url: origin }]);
      const direct = await foreign.newPage();
      await seedBrowserState(direct, variant.theme, actionPath);
      const directApi = await installFixtures(direct, peer, variant.theme, variant.pack);
      await direct.goto(actionPath);
      await waitForHarnessReady(direct, directApi);
      const foreignPanel = direct.getByRole('region', { name: 'Private scheduled climate review', exact: true });
      await expect(foreignPanel.getByText(/^Off\./)).toBeVisible();
      await expect(foreignPanel.getByRole('link', { name: /run history/ })).toHaveCount(0);
      await assertMockApiComplete(direct, directApi);
    } finally {
      await foreign.close();
    }

    await detail.getByRole('button', { name: 'Turn off and clear review' }).press('Enter');
    await expect(detail.getByText(/^Off\./)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Set up schedule review' })).toBeFocused();
    await assertMockApiComplete(next, nextApi);
    expect(writes).toEqual([`PUT ${endpoint}`, `DELETE ${endpoint}`]);
  });
}
