import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import {
  assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';

test.use({
  timezoneId: 'America/New_York',
  ...(process.env.SMART_CLIP_HEADED === '1' ? { headless: false } : {}),
});
test.afterAll(async () => { await closeMockApiFixtures(); });

const route = '/dashcam?vehicle_id=7';
const clipName = '2026-03-08_00-30-00-front.webm';

async function syntheticVideo(page: Page) {
  return Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('Canvas required for synthetic video');
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const recorded = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (event) => resolve(event.data);
    });
    recorder.start();
    paint.fillRect(0, 0, 32, 32);
    await new Promise(resolve => setTimeout(resolve, 150));
    recorder.stop();
    const video = await recorded;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await video.arrayBuffer())];
  }));
}

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`private retention requires an actual imported clip and confirmed deadline: ${variant.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    let subject = 'synthetic-retention-owner';
    let impersonating = false;
    let holdIdentity: Promise<void> | undefined;
    const writes: string[] = [];
    page.on('request', request => {
      const { pathname, search } = new URL(request.url());
      expect(search).not.toContain('2026-03-08_00-30');
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${pathname}`);
      }
    });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.clock.setFixedTime(new Date('2026-03-08T06:00:00Z'));
    await seedBrowserState(page, variant.theme, route);
    const api = await installApiMocks(page, 'populated', variant.theme);
    if (!api) throw new Error('Synthetic authenticated fleet required');
    api.navPins = [...DEFAULT_PINNED_NAV_PATHS, '@navigation-initialized'].map((path, index) => ({
      id: index + 1, item_type: 'navigation', item_id: path, position: index, pinned_at: '2026-03-08T05:30:00Z',
    }));
    await page.route('**/api/v1/system/auth-mode', async intercepted => {
      await holdIdentity;
      return fulfillApiFixture(intercepted, api, {
        json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, impersonating },
      });
    });
    await page.route('**/api/v1/vehicles', intercepted => fulfillApiFixture(intercepted, api, {
      json: [7, 12].map(id => ({
        id, vehicle_id: id, vin: `5YJMOCK00000000${id}`, display_name: `Synthetic vehicle ${id}`,
        model: 'Model Y', state: 'online', timezone: 'UTC',
      })),
    }));
    await page.route(url => url.pathname === '/api/v1/vehicles/12/state', intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, {
        json: { live: false, state: { vehicle_id: 12, state: 'asleep', updated_at: '2026-03-08T05:30:00Z' } },
      });
    });
    await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, intercepted => {
      if (intercepted.request().method() !== 'GET') return intercepted.fallback();
      return fulfillApiFixture(intercepted, api, {
        json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: variant.pack, app_wide: true },
      });
    });
    await page.goto(route);
    await waitForHarnessReady(page, api);
    const region = page.getByRole('region', { name: 'Private clip retention', exact: true });
    const recommendation = region.getByRole('button', { name: 'Review clip retention' });
    const selectClip = () => page.getByRole('list', { name: 'Imported clips' }).getByRole('button', { name: new RegExp(clipName) }).click();
    await expect(region.getByText('No clip is due for retention review.')).toBeVisible();
    await expect(region.getByRole('button', { name: 'Record known deadline' })).toHaveCount(0);

    const bytes = await syntheticVideo(page);
    expect(bytes.byteLength).toBeGreaterThan(0);
    await page.getByLabel('Video file(s)').setInputFiles({ name: clipName, mimeType: 'video/webm', buffer: bytes });
    await page.getByLabel('event.json (optional)').setInputFiles({
      name: 'event.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ reason: 'sentry_aware_object_detection' })),
    });
    await page.getByRole('button', { name: 'Import 1 clip(s)' }).click();
    await selectClip();
    await expect(region.getByText('Off: no confirmed deadline.')).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    await region.getByRole('button', { name: 'Record known deadline' }).press('Enter');
    const deadline = region.getByLabel('Known retention deadline (America/New_York)');
    const confirm = region.getByRole('switch', { name: /^I know this is the source clip/ });
    const save = region.getByRole('button', { name: 'Save deadline' });
    await expect(deadline).toBeFocused();
    await deadline.fill('2026-03-08T02:30');
    await expect(save).toBeDisabled();
    await confirm.press('Space');
    await save.press('Enter');
    await expect(region.getByText(/Skipped and repeated clock times are not valid/)).toBeVisible();
    await deadline.fill('2026-11-01T01:30');
    await confirm.press('Space');
    await save.press('Enter');
    await expect(region.getByText(/Skipped and repeated clock times are not valid/)).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    await deadline.fill('2026-03-08T07:30');
    await expect(confirm).not.toBeChecked();
    await confirm.press('Space');
    await save.press('Enter');
    await expect(region.getByRole('button', { name: 'Edit deadline' })).toBeFocused();
    await expect(recommendation).toBeVisible();

    await page.reload();
    await recommendation.press('Enter');
    await expect(region.getByRole('region', { name: 'Selected clip' })).toBeFocused();
    await expect(region.getByText(/Deadline you confirmed:/)).toContainText('7:30');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      region.getByRole('button', { name: 'Download original clip' }).press('Enter'),
    ]);
    expect(download.suggestedFilename()).toBe(clipName);
    expect(await readFile(await download.path())).toEqual(bytes);
    await expect(recommendation).toBeVisible();

    await region.getByRole('button', { name: 'Snooze one hour' }).click();
    await expect(recommendation).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-03-08T07:01:00Z'));
    await page.reload();
    await recommendation.click();
    await region.getByRole('button', { name: 'Pause reminder' }).click();
    await expect(recommendation).toHaveCount(0);
    await region.getByRole('button', { name: 'Resume reminder' }).click();
    await expect(recommendation).toBeVisible();

    impersonating = true;
    let releaseIdentity!: () => void;
    holdIdentity = new Promise<void>(resolve => { releaseIdentity = resolve; });
    const verifying = page.waitForRequest('**/api/v1/system/auth-mode');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    try {
      await verifying;
      await expect(recommendation).toHaveCount(0);
      await expect(region.getByText('Deadline you confirmed:')).toHaveCount(0);
      await expect(region.getByRole('button', { name: 'Edit deadline' })).toHaveCount(0);
    } finally {
      holdIdentity = undefined;
      releaseIdentity();
    }
    await expect(region.getByText('Private reminders are available only in your own verified sign-in session.')).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Edit deadline' })).toHaveCount(0);
    impersonating = false;
    subject = 'synthetic-retention-foreign';
    await page.reload();
    await selectClip();
    await expect(region.getByText('Off: no confirmed deadline.')).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    subject = 'synthetic-retention-owner';
    await page.goto('/dashcam?vehicle_id=12');
    await expect(region.getByText('No clip is due for retention review.')).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    await page.goto(route);
    await recommendation.click();
    await page.clock.setFixedTime(new Date('2026-03-08T11:31:00Z'));
    await page.reload();
    await selectClip();
    await expect(region.getByText(/The recorded deadline has passed/)).toBeVisible();
    await expect(region.getByRole('button', { name: 'Download original clip' })).toHaveCount(0);
    await region.getByRole('button', { name: 'Clear reminder' }).click();
    await expect(region.getByText('Off: no confirmed deadline.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Redaction' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await region.getByRole('button', { name: 'Record known deadline' }).click();
    await deadline.fill('2026-03-08T13:30');
    await confirm.press('Space');
    await save.press('Enter');
    await expect(recommendation).toBeVisible();
    await page.getByRole('list', { name: 'Imported clips' }).getByRole('button', { name: 'Delete clip' }).click();
    await expect(page.getByText('No clips imported yet')).toBeVisible();
    await expect(recommendation).toHaveCount(0);
    await page.reload();
    await expect(region.getByText('No clip is due for retention review.')).toBeVisible();
    await assertMockApiComplete(page, api);
    expect(api.requests.some(request => request.path === '/system/auth-mode' || request.path === '/api/v1/system/auth-mode')).toBe(true);
    expect(writes).toEqual([]);
  });
}
