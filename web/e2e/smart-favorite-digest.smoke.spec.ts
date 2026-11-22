import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, waitForHarnessReady,
} from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/media-player?vehicle_id=7#favorite-digest';
const endpoint = '/api/v1/media/favorite-digest';
const now = '2026-11-20T17:15:00Z';
const due = '2026-11-23T09:00:00Z';

test.use({ timezoneId: 'UTC', ...(process.env.SMART_FAVORITE_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_FAVORITE_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`publish a private weekly shortlist with the browser closed and save only an explicit favorite: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-favorites-${variant.name}`;
    const writes: string[] = [];
    const applicationErrors: string[] = [];
    const providerPaths: string[] = [];
    context.on('request', request => {
      const { hostname, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') applicationErrors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (hostname.endsWith('.spotify.com') || hostname === 'music.youtube.com') providerPaths.push(pathname);
    });
    await context.route('https://*.spotify.com/**', intercepted => intercepted.abort());
    await context.route('https://music.youtube.com/**', intercepted => intercepted.abort());
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: 'setup' | 'due') => {
      const response = await context.request.post(`${origin}/__fixture/favorite-digest?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (at: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => applicationErrors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, at, variant);
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(new URL(intercepted.request().url()).searchParams.get('vehicle_id')).toBe('7');
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      const panel = page.getByRole('region', { name: 'Weekly favorites shortlist' });
      return { page, api, panel };
    };
    await tick('setup');
    const enrolled = await open(now);
    await expect(enrolled.panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await enrolled.panel.getByRole('button', { name: 'Set up weekly shortlist' }).press('Enter');
    const zone = enrolled.panel.getByLabel('Shortlist time zone');
    await expect(zone).toBeFocused();
    await zone.fill('UTC');
    const confirm = enrolled.panel.getByRole('button', { name: 'Confirm private weekly shortlist' });
    await expect(confirm).toBeDisabled();
    await enrolled.panel.getByRole('switch', { name: 'Review local playback from completed drives for this vehicle each week.' }).press('Space');
    await confirm.press('Enter');
    await expect(enrolled.panel.getByText(/^Active\. No shortlist/)).toBeVisible();
    await expect(enrolled.panel.getByRole('button', { name: 'Change shortlist time zone' })).toBeFocused();
    await assertMockApiComplete(enrolled.page, enrolled.api);
    await enrolled.page.close();

    await tick('due');
    const { page, api, panel } = await open(due);
    await expect(panel.getByRole('heading', { name: 'Possible favorites' })).toBeVisible();
    await expect(panel.getByText('Observed in 3 separate drives across 3 dates.')).toBeVisible();
    await expect(panel.getByText(/cannot identify who chose or heard it/)).toBeVisible();
    const saved = panel.getByRole('heading', { name: 'Confirmed local favorites' });
    await expect(saved).toHaveCount(0);
    const select = panel.getByRole('button', { name: 'Choose Synthetic repeated recording as a local favorite' });
    const dialog = page.getByRole('dialog', { name: 'Confirm local favorite' });
    await select.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(select).toBeFocused();
    expect(writes).toEqual([`PUT ${endpoint}`]);
    await select.press('Enter');
    await dialog.getByRole('button', { name: 'Confirm local favorite' }).press('Enter');
    await expect(saved).toBeVisible();
    await page.reload();
    await expect(saved).toBeVisible();
    await panel.getByRole('button', { name: 'Pause weekly shortlist' }).press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    await expect(saved).toBeVisible();
    const clearLabel = 'Turn off and delete local favorites';
    await panel.getByRole('button', { name: clearLabel }).press('Enter');
    await page.getByRole('dialog', { name: clearLabel }).getByRole('button', { name: clearLabel }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    await expect(saved).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`PUT ${endpoint}`, `POST ${endpoint}`, `PUT ${endpoint}`, `DELETE ${endpoint}`]);
    expect(applicationErrors).toEqual([]);
    expect(providerPaths).toEqual([]);
  });
}
