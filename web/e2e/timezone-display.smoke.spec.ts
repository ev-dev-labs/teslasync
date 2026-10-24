import { expect, test, type Page } from '@playwright/test';
import {
  assertMockApiComplete,
  fulfillApiFixture,
  installApiMocks,
  mockAppSettings,
  mockDrive,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires hermetic mock build');

// Midnight-crossing instant: 2025-03-09T06:30Z is Mar 9 in UTC,
// Mar 8 22:30 in America/Los_Angeles, Mar 9 15:30 in Asia/Tokyo.
const CROSSING_START = '2025-03-09T06:30:00.000Z';
const CROSSING_END = '2025-03-09T07:02:00.000Z';

const midnightDrive = {
  ...mockDrive,
  id: 901,
  start_ts: CROSSING_START,
  end_ts: CROSSING_END,
  start_address: 'Home',
  end_address: 'Office',
};

const timelineTransitions = {
  transitions: [
    {
      ts: CROSSING_START,
      from_state: 'offline',
      to_state: 'driving',
      trigger_field: null,
      trigger_value: null,
    },
  ],
};

const timelineSummary = {
  vehicle_id: 7,
  days: 2,
  total_seconds: 1920,
  by_state: [{ state: 'driving', total_seconds: 1920, percentage: 100, transition_count: 1 }],
};

const RAW_ISO = /20\d\d-\d\d-\d\dT\d\d:\d\d/;
const ZONE_NAMES = /America\/Los_Angeles|Asia\/Tokyo|\(UTC\)|\bUTC\b|GMT[+-]?\d/;

async function installZone(page: Page, zone: string) {
  await seedBrowserState(page, 'light', '/drives');
  const mocks = await installApiMocks(page, 'populated', 'light');
  await page.route('**/api/v1/settings', (route) =>
    fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, tz_display_default: 'user', timezone_user: zone },
    }),
  );
  await page.route('**/api/v1/drives?*', (route) =>
    fulfillApiFixture(route, mocks, { json: [midnightDrive] }),
  );
  await page.route('**/api/v1/vehicle-states/timeline?*', (route) =>
    fulfillApiFixture(route, mocks, { json: timelineTransitions }),
  );
  await page.route('**/api/v1/vehicle-states/summary?*', (route) =>
    fulfillApiFixture(route, mocks, { json: timelineSummary }),
  );
  return mocks;
}

for (const zone of ['America/Los_Angeles', 'Asia/Tokyo'] as const) {
  const expectedDay = zone === 'America/Los_Angeles' ? 'Mar 8, 2025' : 'Mar 9, 2025';
  const unexpectedDay = zone === 'America/Los_Angeles' ? 'Mar 9, 2025' : 'Mar 8, 2025';

  test(`drives follow ${zone} without raw ISO or zone names`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const mocks = await installZone(page, zone);
    await page.goto('/drives?from=2025-03-01&to=2025-03-31');
    await waitForHarnessReady(page, mocks);

    const expected = await page.evaluate(
      ([at, tz]) =>
        new Date(at).toLocaleString('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      [CROSSING_START, zone] as [string, string],
    );
    const region = page.getByRole('region', { name: 'Drive list' });
    await expect(region).toBeVisible();
    await expect(region.getByRole('link', { name: expected }).first()).toBeVisible();

    const mainText = (await page.locator('main').innerText()) ?? '';
    expect(mainText).not.toMatch(RAW_ISO);
    expect(mainText).not.toMatch(ZONE_NAMES);

    await region.getByRole('button', { name: 'Quick view drive' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(expected);
    const dialogText = (await dialog.innerText()) ?? '';
    expect(dialogText).not.toMatch(RAW_ISO);
    expect(dialogText).not.toMatch(ZONE_NAMES);
    await page.keyboard.press('Escape');

    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`timeline buckets the midnight crossing in ${zone} with end-inclusive range`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const mocks = await installZone(page, zone);
    await page.goto('/timeline?from=2025-03-08&to=2025-03-09');
    await waitForHarnessReady(page, mocks);

    const chart = page.getByRole('group', { name: 'Daily transition counts by vehicle state' });
    await expect(chart).toBeVisible();
    const figure = page.locator('figure', { has: chart });
    await expect(figure.getByRole('table')).toContainText(expectedDay);
    await expect(figure.getByRole('table')).not.toContainText(unexpectedDay);

    const summary = page.getByTestId('timeline-summary');
    await expect(summary).toBeVisible();
    await summary.getByRole('button', { name: 'Review details' }).click();
    const scopeDialog = page.getByRole('dialog', { name: 'Summary metrics details' });
    await expect(scopeDialog).toBeVisible();
    const scopeText = (await scopeDialog.innerText()) ?? '';
    expect(scopeText).toContain('Mar 8');
    expect(scopeText).toContain('2025');
    expect(scopeText).not.toContain('Mar 10');
    expect(scopeText).not.toMatch(RAW_ISO);
    expect(scopeText).not.toMatch(ZONE_NAMES);
    await page.keyboard.press('Escape');

    const mainText = (await page.locator('main').innerText()) ?? '';
    expect(mainText).not.toMatch(RAW_ISO);
    expect(mainText).not.toMatch(ZONE_NAMES);

    await page
      .getByRole('button', { name: /Inspect transition offline to driving/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const expectedTime = await page.evaluate(
      ([at, tz]) =>
        new Date(at).toLocaleString('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      [CROSSING_START, zone] as [string, string],
    );
    await expect(dialog).toContainText(expectedTime);
    const dialogText = (await dialog.innerText()) ?? '';
    expect(dialogText).not.toMatch(RAW_ISO);
    expect(dialogText).not.toMatch(ZONE_NAMES);
    await page.keyboard.press('Escape');

    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });
}
