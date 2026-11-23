import { expect, test } from '@playwright/test';
import { fulfillApiFixture, installApiMocks, mockAppSettings, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const vehicleTimezone = 'America/Argentina/Buenos_Aires';
const day = '2026-09-14';
const dayLog = {
  vehicle_id: 7, date: day, timezone: 'UTC',
  day_start: `${day}T00:00:00Z`, day_end: '2026-09-15T00:00:00Z',
  events: [], sources: [], total_events: 0, truncated: false,
  limit: 2000, offset: 0, layers: [],
  summary: {
    drive_count: 0, charge_count: 0, drive_duration_s: null,
    drive_distance_m: null, energy_added_wh: null, energy_used_wh: null,
  },
};

for (const [mode, zone, clock] of [
  ['vehicle', vehicleTimezone, '01:05:06 AM'],
  ['user', 'Asia/Tokyo', '01:05:06 PM'],
  ['utc', 'UTC', '04:05:06 AM'],
] as const) {
  test(`day log clocks honor ${mode} display time without ordinary GMT offsets`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedBrowserState(page, 'dark', '/day-log');
    const mocks = await installApiMocks(page, 'populated', 'dark');
    await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, tz_display_default: mode, timezone_user: 'Asia/Tokyo' },
    }));
    await page.route('**/api/v1/vehicles', route => fulfillApiFixture(route, mocks, {
      json: [{ id: 7, display_name: 'Aurora', model: 'Model Y', state: 'online', timezone: vehicleTimezone }],
    }));
    const scopes: (string | null)[] = [];
    await page.route('**/api/v1/day-log?*', route => {
      scopes.push(new URL(route.request().url()).searchParams.get('timezone'));
      return fulfillApiFixture(route, mocks, {
        json: {
          ...dayLog, total_events: 1,
          events: [{ id: 'entry', ts: `${day}T04:05:06Z`, type: 'online', layer: 'default', source: 'signal_log', vehicle_id: 7, payload: {} }],
        },
      });
    });
    await page.goto(`/day-log?date=${day}`);
    await waitForHarnessReady(page, mocks);
    await expect.poll(() => scopes).toContain(zone);
    const timeline = page.getByTestId('daylog-timeline');
    await expect(timeline.getByTestId('daylog-event-entry')).toContainText(clock);
    await expect(timeline).not.toContainText(/\bGMT[+-]/);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 390, 550, 1440]) {
    test(`day log header stays aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/day-log');
      const mocks = await installApiMocks(page, 'populated', theme);
      const dayRequests: URL[] = [];
      const scopes = () => dayRequests.map(url => [
        url.searchParams.get('vehicle_id'), url.searchParams.get('date'), url.searchParams.get('timezone'),
      ]);
      await page.route('**/api/v1/vehicles', (route) => fulfillApiFixture(route, mocks, {
        json: [{ id: 7, vehicle_id: 7, display_name: 'Aurora', model: 'Model Y',
          state: 'online', timezone: vehicleTimezone }],
      }));
      await page.route('**/api/v1/day-log?*', (route) => {
        dayRequests.push(new URL(route.request().url()));
        return fulfillApiFixture(route, mocks, { json: dayLog });
      });
      await page.goto('/day-log?date=2026-09-14');
      await waitForHarnessReady(page, mocks);
      const header = page.locator('[data-role="page-header"]');
      const date = header.getByTestId('daylog-date');
      await expect(date).toHaveValue('2026-09-14');
      await expect(header.locator('#daylog-timezone')).toHaveCount(0);
      await expect.poll(scopes).toContainEqual(['7', '2026-09-14', vehicleTimezone]);
      await expectNoHorizontalOverflow(page);
      const navigation = header.getByTestId('daylog-date-navigation');
      const navBox = await navigation.boundingBox();
      expect(navBox).not.toBeNull();
      const dateControls = ['daylog-prev', 'daylog-date', 'daylog-next', 'daylog-today'];
      for (const id of dateControls) {
        const box = await header.getByTestId(id).boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.y - navBox!.y)).toBeLessThanOrEqual(2);
        expect(box!.x + box!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 36);
      }
      const metadata = await header.locator('[data-action-group="metadata"]').boundingBox();
      const copy = await header.getByRole('button', { name: /copy link/i }).boundingBox();
      expect(Math.abs(metadata!.y + metadata!.height / 2 - copy!.y - copy!.height / 2)).toBeLessThanOrEqual(2);
      if (width < 640) {
        expect((await header.boundingBox())!.height).toBeLessThanOrEqual(265);
        expect(copy!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
        expect(copy!.y - navBox!.y - navBox!.height).toBeLessThanOrEqual(8);
      }
      if (width === 1440) {
        const workspace = page.locator('[data-role="workspace-header"]');
        await expect(workspace.getByRole('combobox', { name: 'Select vehicle' })).toBeVisible();
        await workspace.screenshot({ path: testInfo.outputPath('workspace-header.png') });
        const controls = [
          header.locator('[data-action-group="metadata"]'),
          date,
          header.getByRole('button', { name: /copy link/i }),
        ];
        const centers = await Promise.all(controls.map(async (control) => {
          const box = await control.boundingBox();
          if (!box) throw new Error('Header control is not visible');
          return box.y + box.height / 2;
        }));
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
      }
      await header.screenshot({ path: testInfo.outputPath('day-log-header.png') });
      await page.screenshot({ path: testInfo.outputPath('day-log-page.png'), fullPage: true });
      await date.focus();
      await expect(date).toBeFocused();
      await header.screenshot({ path: testInfo.outputPath('day-log-date-focused.png') });
      if (width === 1440) {
        const picker = page.locator('[data-role="workspace-header"]').getByRole('combobox', { name: 'Select vehicle' });
        await picker.click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('day-log-vehicle-open.png') });
        await page.keyboard.press('Escape');
        await expect(picker).toBeFocused();
      }
      await header.getByTestId('daylog-prev').click();
      await expect(date).toHaveValue('2026-09-13');
      await expect.poll(scopes).toContainEqual(['7', '2026-09-13', vehicleTimezone]);
      await header.getByTestId('daylog-next').click();
      await expect(date).toHaveValue('2026-09-14');
      await date.fill('2026-09-10');
      await expect(page).toHaveURL(/date=2026-09-10/);
      await expect.poll(scopes).toContainEqual(['7', '2026-09-10', vehicleTimezone]);
      await header.getByTestId('daylog-today').click();
      await expect(date).toHaveValue(await date.getAttribute('max') ?? '');
      await expect.poll(scopes).toContainEqual(['7', await date.inputValue(), vehicleTimezone]);
      await header.getByRole('button', { name: /copy link/i }).click();
      await expect(header.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    });
  }
}
