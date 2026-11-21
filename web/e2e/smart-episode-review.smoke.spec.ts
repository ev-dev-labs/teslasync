import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, waitForHarnessReady,
} from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/media-player?vehicle_id=7#episode-review';
const review = '/api/v1/media/episode-review';
const callback = '/api/v1/media/spotify/callback';
const episode = 'https://open.spotify.com/episode/AAAAAAAAAAAAAAAAAAAAAA';
const now = '2026-11-20T17:15:00Z';

const bridgePolicy = /\blocation = \/spotify-episode-bridge\.html \{[\s\S]*?add_header Content-Security-Policy "([^"]+)"/
  .exec(readFileSync('nginx.conf', 'utf8'))?.[1];
const loaderFixture = `
window.onSpotifyIframeApiReady({createController(placeholder, options, complete) {
  const frame = document.createElement('iframe');
  frame.width = options.width;
  frame.height = options.height;
  placeholder.replaceWith(frame);
  const handlers = {};
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow) handlers[event.data?.type]?.({data: event.data});
  });
  complete({
    addListener(event, handler) { handlers[event] = handler; },
    loadEntity(uri, video, seconds) {
      if (video !== false || options.uri || options.url || !/^spotify:episode:[A-Za-z0-9]{22}$/.test(uri)) return;
      frame.src = 'https://open.spotify.com/embed/episode/' + uri.slice(16) + '?t=' + seconds;
    },
  });
}});`;
const playerFixture = `<!doctype html>
<button id="paused">Report paused</button><button id="wrong">Play from zero</button><button id="play">Play at saved position</button>
<script>
const uri = 'spotify:episode:AAAAAAAAAAAAAAAAAAAAAA';
const notify = (type, extras) => parent.postMessage({type, playingURI: uri, ...extras}, '*');
notify('ready');
const start = (position, isPaused) => {
  notify('playback_started');
  notify('playback_update', {position, isPaused, isBuffering:false, duration:1500000});
};
document.getElementById('paused').onclick = () => start(600000, true);
document.getElementById('wrong').onclick = () => start(0, false);
document.getElementById('play').onclick = () => start(600750, false);
</script>`;

test.use({
  timezoneId: 'UTC',
  // The local server serves an inert worker; Playwright's blocking shim touches Navigator in opaque frames.
  serviceWorkers: 'allow',
  ...(process.env.SMART_EPISODE_REAL_BACKEND === '1' ? { headless: false } : {}),
});
test.skip(process.env.SMART_EPISODE_REAL_BACKEND !== '1', 'Requires mounted handlers, local Spotify wire fixture and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`review private episode fit without treating navigation as playback: ${variant.name}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-episode-${variant.name}`;
    const writes: string[] = [];
    const applicationErrors: string[] = [];
    const providerPaths: string[] = [];
    const bridgeErrors: string[] = [];
    page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /spotify|frame|content security policy/i.test(message.text())) {
        bridgeErrors.push(message.text());
      }
    });
    page.on('requestfailed', request => {
      const { hostname, pathname } = new URL(request.url());
      if (hostname === 'open.spotify.com' || pathname.startsWith('/spotify-episode-bridge.')) {
        bridgeErrors.push(`${hostname}${pathname}: ${request.failure()?.errorText}`);
      }
    });
    page.on('request', request => {
      const { hostname, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') applicationErrors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (hostname.endsWith('.spotify.com')) providerPaths.push(`${request.method()} ${hostname}${pathname}`);
    });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const api = await installSyntheticMediaShell(page, subject, route, now, variant);
    await page.route(url => [review, callback].includes(url.pathname), async intercepted => {
      const headers = await intercepted.request().allHeaders();
      const url = new URL(intercepted.request().url());
      if (url.pathname === review) {
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
      }
      await forwardLocalApiFixture(intercepted, api, headers);
    });
    await page.route('https://accounts.spotify.com/authorize?**', async intercepted => {
      const params = new URL(intercepted.request().url()).searchParams;
      expect(params.get('scope')).toBe('user-read-playback-position');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('state')).toMatch(/^episode\.[a-zA-Z0-9_-]{43}$/);
      const target = new URL(callback, origin);
      target.searchParams.set('state', params.get('state')!);
      target.searchParams.set('code', 'synthetic-episode-code');
      await intercepted.fulfill({
        contentType: 'text/html',
        headers: { 'referrer-policy': 'no-referrer' },
        body: `<a href="${target.href.replaceAll('&', '&amp;')}">Authorize synthetic progress read</a>`,
      });
    });
    await page.route('https://open.spotify.com/**', intercepted => intercepted.abort());
    await page.route('**/spotify-episode-bridge.html', async intercepted => {
      if (!bridgePolicy) throw new Error('Production Spotify bridge policy is missing');
      const response = await intercepted.fetch();
      await intercepted.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': bridgePolicy } });
    });
    await page.route('https://open.spotify.com/embed/iframe-api/v1', async intercepted => {
      expect(await intercepted.request().headerValue('referer')).toBeNull();
      await intercepted.fulfill({ contentType: 'application/javascript', body: loaderFixture });
    });
    await page.route('https://open.spotify.com/embed/episode/**', async intercepted => {
      expect(intercepted.request().url()).toBe('https://open.spotify.com/embed/episode/AAAAAAAAAAAAAAAAAAAAAA?t=600');
      expect(await intercepted.request().headerValue('referer')).toBeNull();
      await intercepted.fulfill({ contentType: 'text/html', body: playerFixture });
    });

    await page.goto(route);
    await waitForHarnessReady(page, api);
    const panel = page.getByRole('region', { name: 'Episode for your next drive' });
    const off = panel.getByText('Off. Confirm a drive and one episode to check the fit.');
    const fits = panel.getByText('The remaining episode fits the estimated drive.');
    const spotifyLink = panel.getByRole('link', { name: 'Open episode in Spotify' });
    const loadPlayer = panel.getByRole('button', { name: 'Load Spotify player at saved position' });
    const closePlayer = panel.getByRole('button', { name: 'Close Spotify player' });
    const bridge = panel.locator('iframe[title="Spotify episode player"]');
    const player = panel.frameLocator('iframe[title="Spotify episode player"]').frameLocator('iframe[title="Spotify player"]');
    const ready = panel.getByText('Spotify player ready. Playback at the saved position is not confirmed.');
    const observed = panel.getByText('Spotify reported playback near the saved position.');
    await expect(off).toBeVisible();
    expect(writes).toEqual([]);
    expect(providerPaths).toEqual([]);
    const fillDrive = async () => {
      await panel.getByLabel('Minutes until departure').fill('45');
      await panel.getByLabel('Estimated drive length (minutes)').fill('15');
    };
    await fillDrive();
    await panel.getByLabel('Episode title').fill('Synthetic manual episode');
    await panel.getByLabel('Episode duration (seconds)').fill('1500');
    const check = panel.getByRole('button', { name: 'Confirm drive and check fit' });
    await check.press('Enter');
    await expect(panel.getByText('Playback progress is unknown. A fit was not assumed.')).toBeVisible();
    await expect(spotifyLink).toHaveCount(0);
    await panel.getByLabel('Known position (seconds)').fill('600');
    await check.press('Enter');
    await expect(fits).toBeVisible();
    await expect(spotifyLink).toHaveCount(0);
    await expect(loadPlayer).toHaveCount(0);
    expect(providerPaths).toEqual([]);

    await panel.getByRole('combobox', { name: 'Episode progress source' }).selectOption('spotify');
    await panel.getByLabel('Exact Spotify episode link').fill(episode);
    await panel.getByRole('button', { name: 'Confirm drive and authorize progress read' }).press('Enter');
    await page.getByRole('link', { name: 'Authorize synthetic progress read' }).click();
    await expect(page).toHaveURL(/\/media-player\?spotify_episode=reviewed&vehicle_id=7#episode-review$/);
    await expect(fits).toBeVisible();
    await expect(spotifyLink).toHaveAttribute('href', episode);
    const readRevision = page.waitForResponse(response => new URL(response.url()).pathname === review &&
      response.request().method() === 'GET' && response.status() === 200);
    await page.reload();
    const { data: revision } = await (await readRevision).json() as { data: { id: number } };
    await expect(fits).toBeVisible();
    await expect(spotifyLink).toBeVisible();
    await expect(loadPlayer).toBeVisible();
    await expect(bridge).toHaveCount(0);
    expect(providerPaths).toEqual(['GET accounts.spotify.com/authorize']);
    await loadPlayer.press('Enter');
    await expect(bridge).toHaveAttribute('sandbox', 'allow-scripts');
    try {
      await expect(ready).toBeVisible();
    } catch (error) {
      throw new Error(JSON.stringify({
        bridgeErrors, providerPaths, frameURLs: page.frames().map(frame => frame.url()),
        status: await panel.getByRole('status').allTextContents(),
      }), { cause: error });
    }
    await expect(closePlayer).toBeFocused();
    const bridgeStorage = await panel.frameLocator('iframe[title="Spotify episode player"]').locator('body').evaluate(() => {
      try {
        return { origin: window.origin, accessible: !!window.localStorage };
      } catch {
        return { origin: window.origin, accessible: false };
      }
    });
    expect(bridgeStorage).toEqual({ origin: 'null', accessible: false });
    await page.evaluate(() => window.postMessage({
      protocol: 'teslasync-spotify-episode-v1', type: 'observed',
      uri: 'spotify:episode:AAAAAAAAAAAAAAAAAAAAAA', positionMs: 600_000,
    }, window.location.origin));
    await player.getByRole('button', { name: 'Report paused' }).click();
    await expect(ready).toBeVisible();
    await expect(observed).toHaveCount(0);
    await player.getByRole('button', { name: 'Play from zero' }).click();
    await expect(panel.getByText('Spotify did not report playback near the saved position.')).toBeVisible();
    await player.getByRole('button', { name: 'Play at saved position' }).click();
    await expect(observed).toHaveCount(0);
    await closePlayer.click();
    await expect(bridge).toHaveCount(0);
    await loadPlayer.press('Enter');
    await expect(ready).toBeVisible();
    await player.getByRole('button', { name: 'Play at saved position' }).click();
    await expect(observed).toBeVisible();
    const clearLabel = 'Turn off and clear episode review';
    const clear = panel.getByRole('button', { name: clearLabel });
    const dialog = page.getByRole('dialog', { name: clearLabel });
    await clear.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(clear).toBeFocused();
    await expect(spotifyLink).toBeVisible();
    if (variant.name === 'desktop') {
      await closePlayer.click();
      const revoke = new URL(review, origin);
      revoke.searchParams.set('vehicle_id', '7');
      revoke.searchParams.set('review_id', String(revision.id));
      const otherClient = await context.request.delete(revoke.href, { headers: { 'X-TeslaSync-Expected-Principal': `subject:${subject}` } });
      expect(otherClient.status()).toBe(204);
      await expect(fits).toBeVisible();
      await expect(loadPlayer).toBeEnabled();
      await loadPlayer.press('Enter');
    } else {
      await clear.press('Enter');
      await dialog.getByRole('button', { name: clearLabel }).click();
    }
    await expect(off).toBeVisible();
    await expect(spotifyLink).toHaveCount(0);
    await expect(bridge).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(applicationErrors).toEqual([]);
    expect(providerPaths).toEqual([
      'GET accounts.spotify.com/authorize',
      'GET open.spotify.com/embed/iframe-api/v1',
      'GET open.spotify.com/embed/episode/AAAAAAAAAAAAAAAAAAAAAA',
      'GET open.spotify.com/embed/iframe-api/v1',
      'GET open.spotify.com/embed/episode/AAAAAAAAAAAAAAAAAAAAAA',
    ]);
    expect(writes).toEqual([
      `PUT ${review}`, `PUT ${review}`, `PUT ${review}`, ...(variant.name === 'mobile' ? [`DELETE ${review}`] : []),
    ]);
  });
}
