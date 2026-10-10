import { expect, test, type Page } from '@playwright/test';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from './driveDetailFixtures';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings, mockDrive, seedBrowserState, waitForHarnessReady } from './mockApi';
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
  test(`drive pricing stays unknown after settings failure and recovers through retry in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedBrowserState(page, theme, path);
    const mocks = await installApiMocks(page, 'populated', theme);
    await installDriveDetailMocks(page, theme, mocks);
    let unavailable = true;
    let lastFailureAt = 0;
    await page.route('**/api/v1/settings', (route) => {
      if (unavailable) {
        lastFailureAt = Date.now();
        return fulfillApiFixture(route, mocks, {
          status: 429,
          headers: { 'Retry-After': '1' },
          json: { error: 'Settings rate limited', code: 'RATE_LIMITED' },
        });
      }
      return fulfillApiFixture(route, mocks, {
        json: { ...mockAppSettings, mode: theme, decimal_precision: 1, base_cost_per_kwh: 0.15 },
      });
    });
    const diagnostics = monitorPage(page);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    await expect.poll(() => page.locator('main').evaluate(element => element.clientWidth)).toBeGreaterThan(300);
    await expect.poll(() => page.locator('main').evaluate(element => element.clientHeight)).toBeGreaterThan(300);
    const overview = page.locator('#overview');
    const cost = overview.getByText('Drive cost', { exact: true }).locator('..');
    await expect(cost).toContainText('—');
    await expect(cost).not.toContainText('$');
    const retry = overview.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await expect(overview.getByText('Odometer (from → to)', { exact: true })).toBeVisible();

    unavailable = false;
    await expect.poll(() => Date.now() - lastFailureAt).toBeGreaterThanOrEqual(1100);
    await retry.click();
    const expectedCost = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(mockDrive.energy_used_wh / 1000 * 0.15);
    await expect(cost).toContainText(`$${expectedCost}`);
    await expect(retry).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(diagnostics.pageErrors).toEqual([]);
    await assertMockApiComplete(page, mocks);
  });

  for (const width of [390, 1440]) {
    test(`drive section links preserve shell chrome at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      await installDriveDetailMocks(page, theme, mocks);
      const diagnostics = monitorPage(page);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const navigation = main.getByRole('navigation', { name: 'Drive report sections' });
      const originalTop = await main.evaluate(element => element.getBoundingClientRect().top);

      for (const id of ['overview', 'telemetry', 'energy']) {
        const link = navigation.locator(`a[href="#${id}"]`);
        if (id === 'energy') {
          await link.focus();
          await link.press('Enter');
        } else {
          await link.click();
        }
        await expect(page).toHaveURL(new RegExp(`#${id}$`));
        await expect.poll(async () => {
          const sectionTop = await main.locator(`#${id}`).evaluate(element => element.getBoundingClientRect().top);
          const navigationBottom = await navigation.evaluate(element => element.getBoundingClientRect().bottom);
          return sectionTop - navigationBottom;
        }).toBeGreaterThanOrEqual(-1);
        await expect.poll(() => main.evaluate(element => element.parentElement?.scrollTop)).toBe(0);
        const currentTop = await main.evaluate(element => element.getBoundingClientRect().top);
        expect(Math.abs(currentTop - originalTop)).toBeLessThanOrEqual(1);
      }

      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }

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
      await expect(summary.locator('[data-drive-metric="odometer"]')).toHaveCount(1);
      await expect(summary.getByText('Start odometer', { exact: true })).toHaveCount(0);
      await expect(summary.getByText('End odometer', { exact: true })).toHaveCount(0);
      const metricSurfaces = await summary.locator('[data-drive-metric]').evaluateAll(elements =>
        elements.map(element => ({
          border: getComputedStyle(element).borderTopWidth,
          background: getComputedStyle(element).backgroundColor,
          nestedFrames: element.querySelectorAll('[class~="border"]').length,
        })));
      expect(metricSurfaces).toHaveLength(7);
      expect(metricSurfaces.every(surface =>
        surface.border === '1px' && surface.background !== 'rgba(0, 0, 0, 0)' && surface.nestedFrames === 0)).toBe(true);
      const nestedTables = page.locator('main [data-table-variant]');
      await expect(nestedTables.first()).toBeVisible();
      expect(await nestedTables.evaluateAll(elements =>
        elements.every(element => element.getAttribute('data-table-variant') === 'embedded'))).toBe(true);
      if (width >= 768) {
        const ledgerTables = page.locator('main #physics-ledger').getByRole('table');
        const ledgerValue = await ledgerTables.nth(0).locator('tbody tr').first().locator('td').first().boundingBox();
        const reconciledValue = await ledgerTables.nth(1).locator('tbody tr').first().locator('td').first().boundingBox();
        if (!ledgerValue || !reconciledValue) throw new Error('Both ledger value columns must render');
        expect(Math.abs(ledgerValue.x - reconciledValue.x)).toBeLessThanOrEqual(1);
      }
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
      if (width === 390 || width === 1440) {
        for (const id of ['journey', 'energy-evidence', 'physics-ledger', 'gear-theater', 'why-ended']) {
          await page.locator(`main #${id}`).scrollIntoViewIfNeeded();
          await page.screenshot({ path: test.info().outputPath(`drive-detail-${id}-${width}-${theme}.png`) });
        }
        await expectNoHorizontalOverflow(page);
      }
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
