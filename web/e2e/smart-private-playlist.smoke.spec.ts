import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';

const route = '/media-player?vehicle_id=7#playlist-review';
const review = '/api/v1/media/playlist-review';
const connect = '/api/v1/media/spotify/connection';
const callback = '/api/v1/media/spotify/callback';
const first = 'AAAAAAAAAAAAAAAAAAAAAA';
const second = 'BBBBBBBBBBBBBBBBBBBBBB';

test.use({
  timezoneId: 'UTC',
  ...(process.env.SMART_MEDIA_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_MEDIA_REAL_BACKEND !== '1', 'Requires mounted handlers, local Spotify wire fixture and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`preview, edit and explicitly save one private playlist: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-playlist-${variant.name}`;
    const writes: string[] = [];
    const applicationErrors: string[] = [];
    let providerVisits = 0;
    let failReviewRead = false;
    let holdIdentity: Promise<void> | undefined;
    page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') applicationErrors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
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
    await page.route('**/api/v1/system/auth-mode', async intercepted => {
      await holdIdentity;
      return fulfillApiFixture(intercepted, api, {
        json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject },
      });
    });
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.route(url => ['/api/v1/media', '/api/v1/media/latest'].includes(url.pathname), intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      const url = new URL(intercepted.request().url());
      expect(url.searchParams.get('vehicle_id')).toBe('7');
      return fulfillApiFixture(intercepted, api, { json: url.pathname.endsWith('/latest') ? null : [] });
    });
    await page.route(url => [review, `${review}/save`, connect, callback].includes(url.pathname), async intercepted => {
      const headers = await intercepted.request().allHeaders();
      const { pathname } = new URL(intercepted.request().url());
      if (pathname !== callback) {
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
      }
      if (pathname === review && intercepted.request().method() === 'GET' && failReviewRead) {
        return fulfillApiFixture(intercepted, api, {
          status: 503, headers: { 'Retry-After': '0' }, json: { error: 'Synthetic review outage', code: 'UPSTREAM_BREAKER_OPEN' },
        });
      }
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.route('https://accounts.spotify.com/authorize?**', async intercepted => {
      providerVisits++;
      const params = new URL(intercepted.request().url()).searchParams;
      expect(params.get('scope')).toBe('playlist-modify-private');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('code_challenge')).toMatch(/^[a-zA-Z0-9_-]{43}$/);
      const state = params.get('state');
      expect(state).toMatch(/^[a-zA-Z0-9_-]{43}$/);
      const target = new URL(callback, origin);
      target.searchParams.set('state', state!);
      target.searchParams.set('code', 'synthetic-code');
      await intercepted.fulfill({
        contentType: 'text/html',
        headers: { 'referrer-policy': 'no-referrer' },
        body: `<a href="${target.href.replaceAll('&', '&amp;')}">Authorize synthetic Spotify account</a>`,
      });
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Private drive playlist', exact: true });
    const off = panel.getByText('Off. Confirm a drive to build a private preview.');
    await expect(off).toBeVisible();
    expect(writes, applicationErrors.join('\n')).toEqual([]);
    await panel.getByRole('button', { name: 'Confirm an upcoming drive' }).press('Enter');
    const departure = panel.getByLabel(/^Confirmed departure/);
    await expect(departure).toBeFocused();
    await departure.fill('2026-11-20T17:45');
    await panel.getByLabel('Estimated drive length (minutes)').fill('6');
    const build = panel.getByRole('button', { name: 'Build local preview' });
    await expect(build).toBeDisabled();
    await panel.getByRole('switch', { name: /^I confirmed this drive/ }).press('Space');
    await build.press('Enter');
    await expect(panel.getByText('Why this playlist?')).toBeVisible();
    await expect(panel.getByText('Synthetic first by Synthetic artist')).toBeVisible();
    expect(providerVisits).toBe(0);
    expect(writes, applicationErrors.join('\n')).toEqual([`PUT ${review}`]);

    await panel.getByRole('combobox', { name: 'Observed tracks to add' }).selectOption({ label: 'Synthetic third by Synthetic artist' });
    await panel.getByRole('button', { name: 'Add track' }).click();
    await expect(panel.getByText('Adjust the selected tracks to fit the drive length before saving.')).toBeVisible();
    await panel.getByRole('button', { name: 'Remove Synthetic third' }).click();
    const firstUp = panel.getByRole('button', { name: 'Move Synthetic first up' });
    await expect(firstUp).toBeEnabled();
    await firstUp.click();
    await expect(firstUp).toBeDisabled();
    await panel.getByRole('button', { name: 'Connect Spotify for private playlists' }).click();
    const authorize = page.getByRole('dialog', { name: 'Connect Spotify for private playlists' });
    await authorize.getByRole('button', { name: 'Connect Spotify for private playlists' }).click();
    await page.getByRole('link', { name: 'Authorize synthetic Spotify account' }).click();
    await expect(page).toHaveURL(/\/media-player\?spotify=connected&vehicle_id=7#playlist-review$/);
    await expect(panel.getByText('Spotify private playlist authorization is active.')).toBeVisible();
    await expect(firstUp).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Move Synthetic second up' })).toBeEnabled();
    expect(providerVisits).toBe(1);
    expect(writes, applicationErrors.join('\n')).toEqual([`PUT ${review}`, `POST ${connect}`]);

    const firstLink = panel.getByLabel('Spotify track link for Synthetic first');
    const playlistName = panel.getByLabel('Playlist name');
    await firstLink.fill(`https://open.spotify.com/track/${first}`);
    await playlistName.fill('Synthetic drive mix');
    let releaseIdentity!: () => void;
    holdIdentity = new Promise<void>(resolve => { releaseIdentity = resolve; });
    const verifying = page.waitForRequest('**/api/v1/system/auth-mode');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    try {
      await verifying;
      await expect(panel.getByText('Synthetic first by Synthetic artist')).toHaveCount(0);
      await expect(panel.getByText(/^Confirmed departure:/)).toHaveCount(0);
      await expect(firstLink).toHaveCount(0);
      await expect(playlistName).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Save private playlist' })).toHaveCount(0);
    } finally {
      holdIdentity = undefined;
      releaseIdentity();
    }
    await expect(firstUp).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Move Synthetic second up' })).toBeEnabled();
    await expect(firstLink).toHaveValue(`https://open.spotify.com/track/${first}`);
    await expect(playlistName).toHaveValue('Synthetic drive mix');
    expect(writes, applicationErrors.join('\n')).toEqual([`PUT ${review}`, `POST ${connect}`]);

    await panel.getByLabel('Spotify track link for Synthetic second').fill(`https://open.spotify.com/track/${second}`);
    const save = panel.getByRole('button', { name: 'Save private playlist' });
    const saveDialog = page.getByRole('dialog', { name: 'Save private playlist' });
    await save.click();
    await saveDialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(save).toBeFocused();
    expect(writes, applicationErrors.join('\n')).toEqual([`PUT ${review}`, `POST ${connect}`]);
    await save.press('Enter');
    await saveDialog.getByRole('button', { name: 'Save private playlist' }).click();
    const saved = panel.getByText('Spotify confirmed creation of your private playlist and its tracks.');
    await expect(saved).toBeVisible();
    await page.reload();
    await expect(saved).toBeVisible();
    const disconnect = 'Disconnect Spotify';
    await panel.getByRole('button', { name: disconnect }).click();
    await page.getByRole('dialog', { name: disconnect }).getByRole('button', { name: disconnect }).click();
    await expect(panel.getByText('Spotify private playlist authorization is active.')).toHaveCount(0);
    const clear = 'Turn off and clear preview';
    await panel.getByRole('button', { name: clear }).click();
    failReviewRead = true;
    const cleared = page.waitForResponse(response => new URL(response.url()).pathname === review && response.request().method() === 'DELETE');
    await page.getByRole('dialog', { name: clear }).getByRole('button', { name: clear }).click();
    expect((await cleared).status()).toBe(204);
    const retry = panel.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 25_000 });
    await expect(saved).toHaveCount(0);
    await expect(panel.getByText('Synthetic first by Synthetic artist')).toHaveCount(0);
    failReviewRead = false;
    await retry.click();
    await expect(off).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(applicationErrors).toEqual([]);
    expect(writes).toEqual([`PUT ${review}`, `POST ${connect}`, `POST ${review}/save`, `DELETE ${connect}`, `DELETE ${review}`]);
  });
}
