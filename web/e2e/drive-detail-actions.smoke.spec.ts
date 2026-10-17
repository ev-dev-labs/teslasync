import { expect, test } from '@playwright/test';
import type { CreateShareResponse, ShareToken } from '../src/types/sharing';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from './driveDetailFixtures';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic drive action fixtures');

test('drive report retains its action controls', async ({ page }) => {
  test.setTimeout(60_000);
  const path = `/drives/${DRIVE_DETAIL_ID}`;
  await seedBrowserState(page, 'dark', path);
  const mocks = await installApiMocks(page, 'populated', 'dark');
  await installDriveDetailMocks(page, 'dark', mocks, { populatedLedger: true });
  const token = 'synthetic-drive-share';
  let shares: ShareToken[] = [];
  const requests: unknown[] = [];
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/shares`, (route) =>
    fulfillApiFixture(route, mocks, { json: shares }));
  await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}/share`, async (route) => {
    expect(route.request().method()).toBe('POST');
    requests.push(route.request().postDataJSON());
    const url = new URL(`/s/${token}`, page.url()).href;
    shares = [{
      id: 1, token, drive_id: DRIVE_DETAIL_ID, created_by: null,
      title: 'Synthetic commute', description: null, include_map: true,
      include_telemetry: true, include_speed: false, views: 0,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }];
    await fulfillApiFixture(route, mocks, {
      json: { id: 1, token, url } satisfies CreateShareResponse,
    });
  });
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const report = page.locator('main');
  await expect(report.getByRole('group', { name: 'Drive summary', exact: true })).toBeVisible();
  await report.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog');
  await expect(share).toBeVisible();
  await share.getByRole('textbox', { name: 'Share title' }).fill('Synthetic commute');
  await share.getByRole('switch', { name: 'Include speed data', exact: true }).click();
  await share.getByRole('switch', { name: 'Include detailed telemetry (battery, power)' }).click();
  await share.getByRole('combobox', { name: 'Link expires after' }).selectOption('7');
  await share.getByRole('button', { name: 'Generate link', exact: true }).click();
  await expect.poll(() => requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    title: 'Synthetic commute', include_speed: false, include_telemetry: true, expires_in_days: 7,
  });
  await expect(share.getByText('Synthetic commute', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await report.getByRole('button', { name: 'Replay', exact: true }).click();
  await waitForHarnessReady(page, mocks);
  await expect(page).toHaveURL(new RegExp(`/drives/${DRIVE_DETAIL_ID}/replay$`));
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await assertMockApiComplete(page, mocks);
});
