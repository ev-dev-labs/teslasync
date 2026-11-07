import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { VehicleLiveSignalsResponse } from '../src/api/hooks/useTelemetry';
import { PACK_APPEARANCES, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { writePackReviewGallery } from './widget-design-packs.gallery';

const widgets = [
  ['climate-control-panel', 'Climate control'], ['weather-at-car', 'Weather at car'],
  ['new-cabin-comfort', 'Cabin comfort and occupancy'],
] as const;
const directory = fileURLToPath(new URL('../test-results/widget-design-packs/climate-review/', import.meta.url));
const captures: string[] = [];

test.beforeAll(async () => { await mkdir(directory, { recursive: true }); });
test.afterAll(async () => {
  await closeMockApiFixtures();
  await writePackReviewGallery(directory, widgets, captures, false);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`shared climate readouts at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const mocks = await installPackReview(page, theme, width, false, widgets);
      const timestamp = new Date(await page.evaluate(() => Date.now()) - 10_000).toISOString();
      const envelope = (value: number | boolean | string, kind = 'ValueKindFloat') => ({
        value, kind, timestamp, ts: timestamp, source: 'l1', age_ms: 10_000,
      });
      const cabin: VehicleLiveSignalsResponse = { vehicle_id: 7, at: timestamp, signals: {
        InsideTemp: envelope(21), OutsideTemp: envelope(18),
        SeatHeaterLeft: envelope(1), SeatHeaterRight: envelope(0),
        ClimateSeatCoolingFrontLeft: envelope(0), ClimateSeatCoolingFrontRight: envelope(2),
        DriverSeatOccupied: envelope(true, 'ValueKindBool'),
        DriverSeatBelt: envelope(true, 'ValueKindBool'), HvacFanSpeed: envelope(3),
      } };
      await page.route(url => url.pathname === '/api/v1/signals/7/live', route =>
        fulfillApiFixture(route, mocks, { json: cabin }));
      await page.goto('/');
      await waitForHarnessReady(page, mocks);
      const saved = await page.evaluate(() => localStorage.getItem('teslasync-dashboards'));
      for (const pack of Object.keys(packNames) as PackId[]) {
        await selectReviewPack(page, pack);
        for (const [id] of widgets) {
          const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
          await expect(panel).toBeVisible();
          await expect(panel.locator('[data-widget-pack]').first()).toHaveAttribute('data-widget-pack', pack);
          await expect(panel).toContainText(id === 'weather-at-car' ? /18\s*°C/ : /21(?:\.0+)?\s*°C/);
          const readout = panel.locator('[data-climate-readout]');
          if (pack === 'classic') {
            await expect(readout).toHaveCount(0);
          } else {
            await expect(readout).toHaveCount(1);
            await expect(readout).toHaveAttribute('data-climate-readout', PACK_APPEARANCES[pack]);
            await expect(readout.locator('svg')).toHaveAttribute('aria-hidden', 'true');
            await expect(readout.locator('circle[stroke-dasharray]')).toHaveAttribute('stroke-dasharray', '285 371');
          }
          await expect(panel.getByRole('meter')).toHaveCount(0);
          await expect(panel.getByRole('slider')).toHaveCount(0);
          if (id === 'new-cabin-comfort') {
            await expect(panel).not.toContainText('Never updated');
            await expect(panel.getByRole('region', { name: 'Occupancy and belts' })).toContainText('Buckled');
            await expect(panel.locator('[data-cabin-signal="PassengerSeatBelt"]')).toContainText('Unknown');
            await expect(panel.getByRole('region', { name: 'Observation limits' })).toContainText('both remain unknown');
          }
          await panel.scrollIntoViewIfNeeded();
          expect(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 2),
            `${pack}/${id} horizontal overflow`).toBe(false);
          const file = `${theme}-${width}-${pack}-${id}.png`;
          await panel.screenshot({ path: `${directory}${file}`, animations: 'disabled' });
          captures.push(file);
        }
      }
      expect(failures).toEqual([]);
      expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
      expect(await page.evaluate(() => localStorage.getItem('teslasync-dashboards'))).toEqual(saved);
      await assertMockApiComplete(page, mocks);
    });
  }
}
