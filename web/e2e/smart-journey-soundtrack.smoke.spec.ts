import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { ChecklistRun, DepartureAdvice, JourneyReport } from '../src/api/hooks/useJourney';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';

const route = '/journeys?vehicle_id=7';
const review = '/api/v1/media/journey-soundtrack/1';
const journeys = '/api/v1/journey/sessions';
const disclosure = 'Open private soundtrack review';
const start = '2026-11-20T15:15:00Z';
const end = '2026-11-20T16:15:00Z';
const unrelated: Record<string, JourneyReport | ChecklistRun | DepartureAdvice> = {
  [`${journeys}/1/report`]: {
    session_id: 1, status: 'completed', started_at: start, ended_at: end, duration_s: 3600,
    distance_m: null, fixes: 0, plans: 0, replans: 0, detour: null, route_factor: null, route_trips: 0,
    checklist: null, evidence: [],
  },
  [`${journeys}/1/checklist`]: { id: 1, session_id: 1, run_at: start, items: [] },
  [`${journeys}/1/departure`]: { session_id: 1, slots: [], recommended_at: null, charge: null, evidence: [] },
};

test.use({ timezoneId: 'UTC', ...(process.env.SMART_SOUNDTRACK_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_SOUNDTRACK_REAL_BACKEND !== '1', 'Requires mounted handlers and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`review the observed soundtrack of one completed journey: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-soundtrack-${variant.name}`;
    const writes: string[] = [];
    const errors: string[] = [];
    let reads = 0;
    let failReviewRead = false;
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') errors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (pathname === review && request.method() === 'GET') reads++;
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    await page.clock.setFixedTime(new Date('2026-11-20T17:15:00Z'));
    await seedBrowserState(page, variant.theme, route);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Missing isolated API fixtures');
    api.navPins = [...DEFAULT_PINNED_NAV_PATHS, '@navigation-initialized'].map((path, index) => ({
      id: index + 1, item_type: 'navigation', item_id: path, position: index, pinned_at: '2026-11-20T17:00:00Z',
    }));
    await page.route('**/api/v1/system/auth-mode', intercepted => fulfillApiFixture(intercepted, api, {
      json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject },
    }));
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(url => [journeys, `${journeys}/1`, review].includes(url.pathname), async intercepted => {
      const url = new URL(intercepted.request().url());
      const headers = await intercepted.request().allHeaders();
      if (url.pathname === review) {
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
        if (intercepted.request().method() === 'GET' && failReviewRead) {
          return fulfillApiFixture(intercepted, api, {
            status: 503, headers: { 'Retry-After': '0' }, json: { error: 'Synthetic review outage', code: 'UPSTREAM_BREAKER_OPEN' },
          });
        }
      }
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.route(url => Object.hasOwn(unrelated, url.pathname), intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, { json: unrelated[new URL(intercepted.request().url()).pathname] });
    });
    await page.route(url => url.pathname === '/api/v1/waitoracle/sites' && !url.search, intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, { json: [] });
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Journey soundtrack', exact: true });
    const open = panel.getByRole('button', { name: disclosure });
    const off = panel.getByText('Off. Confirm to read playback evidence for this journey.');
    const tracks = panel.getByRole('list', { name: 'Observed soundtrack' });
    await expect(open).toBeVisible();
    expect(reads).toBe(0);
    await open.press('Enter');
    await expect(off).toBeVisible();
    const enable = panel.getByRole('button', { name: 'Enable private review' });
    const consent = page.getByRole('dialog', { name: 'Enable private review' });
    await enable.click();
    await consent.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(enable).toBeFocused();
    expect(writes, errors.join('\n')).toEqual([]);
    await enable.press('Enter');
    await consent.getByRole('button', { name: 'Enable private review' }).click();
    await expect(panel.getByText(/^Confirmed playback in 2 of 2 matched drives/)).toBeVisible();
    const list = tracks.getByRole('listitem');
    await expect(list).toHaveCount(2);
    await expect(list.nth(0)).toContainText('Synthetic opening track');
    await expect(list.nth(1)).toContainText('Synthetic closing track');
    await expect(panel.getByText(/Synthetic (radio|parked track|unattested track|other vehicle track|after the journey)/)).toHaveCount(0);

    await page.reload();
    await open.click();
    await expect(list).toHaveCount(2);
    failReviewRead = true;
    const paused = page.waitForResponse(response => new URL(response.url()).pathname === review && response.request().method() === 'PATCH');
    await panel.getByRole('button', { name: 'Pause review' }).click();
    expect((await paused).status()).toBe(204);
    const retry = panel.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 25_000 });
    await expect(tracks).toHaveCount(0);
    await expect(panel.getByText(/^Confirmed playback/)).toHaveCount(0);
    failReviewRead = false;
    await retry.click();
    await expect(panel.getByText('Review paused.')).toBeVisible();
    await expect(tracks).toHaveCount(0);
    const clear = 'Turn off and clear review';
    await panel.getByRole('button', { name: clear }).click();
    await page.getByRole('dialog', { name: clear }).getByRole('button', { name: clear }).click();
    await expect(off).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(errors).toEqual([]);
    expect(writes).toEqual([`PUT ${review}`, `PATCH ${review}`, `DELETE ${review}`]);
  });
}
