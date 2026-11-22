import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from './driveDetailFixtures';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, mockDrive,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

const route = `/drives/${DRIVE_DETAIL_ID}`;
const review = `/api/v1/media/drive-track/${DRIVE_DETAIL_ID}`;
const library = `${review}/spotify`;
const callback = '/api/v1/media/spotify/callback';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_DRIVE_TRACK_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_DRIVE_TRACK_REAL_BACKEND !== '1', 'Requires mounted handlers, PostgreSQL and a local Spotify wire fixture');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`look up one drive instant and save only after library consent: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-drive-track-${variant.name}`;
    const writes: string[] = [];
    const errors: string[] = [];
    let reads = 0;
    let authorizations = 0;
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
    await installDriveDetailMocks(page, variant.theme, api, { partial: true });
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
    await page.route(url => url.pathname === `/api/v1${route}`, intercepted => fulfillApiFixture(intercepted, api, {
      json: {
        ...mockDrive, id: DRIVE_DETAIL_ID, start_ts: '2026-11-20T15:41:00Z', end_ts: '2026-11-20T15:44:00Z',
        duration_s: 180, positions: null, telemetry: null,
      },
    }));
    await page.route(url => [review, library, `${library}/save`, callback].includes(url.pathname), async intercepted => {
      const url = new URL(intercepted.request().url());
      const headers = await intercepted.request().allHeaders();
      if (url.pathname !== callback) {
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
      }
      if (url.pathname === review && intercepted.request().method() === 'GET' && failReviewRead) {
        return fulfillApiFixture(intercepted, api, {
          status: 503, headers: { 'Retry-After': '0' }, json: { error: 'Synthetic review outage', code: 'UPSTREAM_BREAKER_OPEN' },
        });
      }
      if (url.pathname === review && intercepted.request().method() === 'PUT') {
        const { started_at, ended_at, ...change } = intercepted.request().postDataJSON();
        expect(change).toEqual({ confirmed: true, expected_review_id: expect.any(Number), offset_s: expect.any(Number) });
        expect(new Date(started_at).toISOString()).toBe('2026-11-20T15:41:00.000Z');
        expect(new Date(ended_at).toISOString()).toBe('2026-11-20T15:44:00.000Z');
      }
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.route('https://accounts.spotify.com/authorize?**', async intercepted => {
      authorizations++;
      const params = new URL(intercepted.request().url()).searchParams;
      expect(params.get('scope')).toBe('user-library-modify');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('code_challenge')).toMatch(/^[a-zA-Z0-9_-]{43}$/);
      const state = params.get('state');
      expect(state).toMatch(/^library\.[a-zA-Z0-9_-]{43}$/);
      const target = new URL(callback, origin);
      target.searchParams.set('state', state!);
      target.searchParams.set('code', 'synthetic-library-code');
      await intercepted.fulfill({
        contentType: 'text/html', headers: { 'referrer-policy': 'no-referrer' },
        body: `<a href="${target.href.replaceAll('&', '&amp;')}">Authorize synthetic Spotify library</a>`,
      });
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'What was playing?', exact: true });
    const open = panel.getByRole('button', { name: 'Open private track lookup' });
    const off = panel.getByText('Off. Choose a moment to look up a track.');
    await expect(open).toBeVisible();
    expect(reads).toBe(0);
    await open.press('Enter');
    await expect(off).toBeVisible();
    const offset = panel.getByLabel('Seconds after the start of this drive');
    const lookup = panel.getByRole('button', { name: 'Look up this time' });
    await expect(lookup).toBeDisabled();
    await offset.fill('15');
    await lookup.press('Enter');
    await expect(panel.getByText('No track could be confirmed at that time. Nearby tracks were not substituted.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Authorize Spotify library' })).toHaveCount(0);
    await offset.fill('67');
    await lookup.press('Enter');
    await expect(panel.getByText('Synthetic first · Synthetic artist')).toBeVisible();
    expect(authorizations).toBe(0);
    expect(writes, errors.join('\n')).toEqual([`PUT ${review}`, `PUT ${review}`]);
    const authorize = 'Authorize Spotify library';
    await panel.getByRole('button', { name: authorize }).click();
    await page.getByRole('dialog', { name: authorize }).getByRole('button', { name: authorize }).click();
    await page.getByRole('link', { name: 'Authorize synthetic Spotify library' }).click();
    await expect(page).toHaveURL(/\/drives\/412\?spotify_library=connected#drive-track-review$/);
    await expect(panel.getByText('Spotify library authorization is active for this lookup.')).toBeVisible();
    await panel.getByLabel('Exact Spotify track link').fill('https://open.spotify.com/track/AAAAAAAAAAAAAAAAAAAAAA');
    const save = 'Save track to Spotify library';
    const saveButton = panel.getByRole('button', { name: save });
    const saveDialog = page.getByRole('dialog', { name: save });
    await saveButton.click();
    await saveDialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(saveButton).toBeFocused();
    expect(writes, errors.join('\n')).toEqual([`PUT ${review}`, `PUT ${review}`, `POST ${library}`]);
    await saveButton.press('Enter');
    await saveDialog.getByRole('button', { name: save }).click();
    const saved = panel.getByText('Spotify confirmed the track was saved to your library.');
    await expect(saved).toBeVisible();
    await page.reload();
    await expect(saved).toBeVisible();
    const clear = 'Turn off and clear lookup';
    await panel.getByRole('button', { name: clear }).click();
    failReviewRead = true;
    const cleared = page.waitForResponse(response => new URL(response.url()).pathname === review && response.request().method() === 'DELETE');
    await page.getByRole('dialog', { name: clear }).getByRole('button', { name: clear }).click();
    expect((await cleared).status()).toBe(204);
    const retry = panel.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 25_000 });
    await expect(saved).toHaveCount(0);
    await expect(panel.getByText('Synthetic first · Synthetic artist')).toHaveCount(0);
    failReviewRead = false;
    await retry.click();
    await expect(off).toBeVisible();
    await expect(panel.getByText('Synthetic first · Synthetic artist')).toHaveCount(0);
    expect(authorizations).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(errors).toEqual([]);
    expect(writes).toEqual([`PUT ${review}`, `PUT ${review}`, `POST ${library}`, `POST ${library}/save`, `DELETE ${review}`]);
  });
}
