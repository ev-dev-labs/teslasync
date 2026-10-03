import { expect, test, type Page } from '@playwright/test';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from './driveDetailFixtures';
import { assertMockApiComplete, installApiMocks, mockDrive, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

const path = `/drives/${DRIVE_DETAIL_ID}`;
const sectionIds = ['journey', 'overview', 'route', 'telemetry', 'energy', 'supervised', 'physics', 'diagnostics'];
test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic canonical drive evidence');

async function expectDriveSections(page: Page) {
  const main = page.locator('main');
  for (const role of ['tablist', 'tab', 'tabpanel'] as const) {
    await expect(main.getByRole(role, { includeHidden: true })).toHaveCount(0);
  }
  for (const id of sectionIds) {
    const section = main.locator(`#${id}`);
    await expect(section).toHaveCount(1);
    await expect(section).toBeVisible();
  }
  for (const id of ['energy-evidence', 'cost-estimate', 'fsd-evidence', 'silent-counter',
    'battery-trace', 'speed-distribution', 'power-trace', 'elevation-trace', 'temperature-trace',
    'tire-trace', 'physics-debrief', 'physics-ledger',
    'gear-theater', 'road-analysis', 'why-ended']) {
    await expect(main.locator(`section#${id}`)).toBeVisible();
  }
  // ADR-015: the fixture has AI off; deterministic evidence remains visible.
  for (const id of ['speed-insights', 'coaching']) {
    await expect(main.locator(`section#${id}`)).toHaveCount(1);
    await expect(main.locator(`section#${id}`)).toBeEmpty();
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    test(`complete drive detail remains responsive at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      await installDriveDetailMocks(page, theme, mocks);
      const diagnostics = monitorPage(page);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      await expectDriveSections(page);
      const summary = page.getByRole('group', { name: 'Drive summary', exact: true });
      await expect(summary).toBeVisible();
      await expect(page.locator('main')).toContainText('Home');
      await expect(page.locator('main')).toContainText('Office');
      await expect(summary).not.toContainText(/NaN|undefined|Infinity/);
      const journeyTable = page.locator('#journey').getByRole('table', { name: 'Drive timeline', exact: true });
      const journeyBounds = await journeyTable.evaluate(table => {
        const scroller = table.parentElement;
        if (!scroller) throw new Error('Journey table scroll container is missing');
        return { width: scroller.clientWidth, contentWidth: scroller.scrollWidth };
      });
      expect(journeyBounds.contentWidth).toBeLessThanOrEqual(journeyBounds.width + 1);
      const powerTable = page.locator('main').getByRole('table', { name: 'Power profile', exact: true });
      await expect(powerTable.getByRole('row', { name: /Max power/ })).toContainText('19 kW');
      await expect(powerTable.getByRole('row', { name: /Max regen/ })).toContainText('-4 kW');
      await expect(powerTable.getByRole('row', { name: /Mean sampled power/ })).toContainText('4.74 kW');
      await expect(powerTable).not.toContainText(/\b18700\b|\b9200\b|\b4200\b/);
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`drive-detail-${width}-${theme}.png`),
        fullPage: true,
      });
      await assertMockApiComplete(page, mocks);
    });
  }

  test(`drive detail retains section shells with null observations in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedBrowserState(page, theme, path);
    const mocks = await installApiMocks(page, 'populated', theme);
    await installDriveDetailMocks(page, theme, mocks, { partial: true });
    const diagnostics = monitorPage(page);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    await expectDriveSections(page);
    await expect(page.getByRole('group', { name: 'Drive summary', exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/NaN|undefined|Infinity/);
    await expectNoHorizontalOverflow(page);
    expect(diagnostics.pageErrors).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`drive-detail-null-${theme}.png`),
      fullPage: true,
    });
    await assertMockApiComplete(page, mocks);
  });

  test(`drive detail respects saved imperial units in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBrowserState(page, theme, path);
    const mocks = await installApiMocks(page, 'populated', theme);
    await installDriveDetailMocks(page, theme, mocks, { imperial: true });
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    await expectDriveSections(page);
    const summary = page.getByRole('group', { name: 'Drive summary', exact: true });
    const distance = (await summary.textContent() ?? '').match(/Distance\s*([\d.]+)\s*mi/);
    expect(distance).not.toBeNull();
    expect(Number(distance![1])).toBeCloseTo(mockDrive.distance_m / 1609.344, 1);
    await expect(summary).not.toContainText(/\bkm\b/);
    await expectNoHorizontalOverflow(page);
    await summary.screenshot({ path: test.info().outputPath(`drive-detail-imperial-${theme}.png`) });
    await assertMockApiComplete(page, mocks);
  });
}
