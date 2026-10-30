import { expect, test, type Locator, type Page } from '@playwright/test';
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
  test(`drive pricing distinguishes a loaded unset rate from unavailable settings in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedBrowserState(page, theme, path);
    const mocks = await installApiMocks(page, 'populated', theme);
    await installDriveDetailMocks(page, theme, mocks);
    await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, mode: theme, base_cost_per_kwh: 0 },
    }));
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const cost = page.locator('#overview').getByText('Drive cost', { exact: true }).locator('..');
    await expect(cost).toContainText('No rate configured');
    await expect(cost).not.toContainText('$0');
  });

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
      minimumFractionDigits: 2, maximumFractionDigits: 2,
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
      const summary = page.getByTestId('drive-canonical-summary');
      await expect(summary).toBeVisible();
      await expect(summary.locator('[data-overview-metric="odometer"]')).toHaveCount(1);
      await expect(summary.getByText('Start odometer', { exact: true })).toHaveCount(0);
      await expect(summary.getByText('End odometer', { exact: true })).toHaveCount(0);
      const metricSurfaces = await summary.locator('[data-overview-metric]').evaluateAll(elements =>
        elements.map(element => ({
          border: getComputedStyle(element).borderTopWidth,
          background: getComputedStyle(element).backgroundColor,
          nestedFrames: element.querySelectorAll('[class~="border"]').length,
        })));
      expect(metricSurfaces).toHaveLength(7);
      expect(metricSurfaces.every(surface =>
        surface.border === '0px' && surface.background === 'rgba(0, 0, 0, 0)' && surface.nestedFrames === 0)).toBe(true);
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
      const journeyTable = page.locator('#journey').getByRole('list', { name: 'Drive timeline', exact: true });
      const journeyBounds = await journeyTable.evaluate(table => {
        const scroller = table.parentElement;
        if (!scroller) throw new Error('Journey table scroll container is missing');
        return { width: scroller.clientWidth, contentWidth: scroller.scrollWidth };
      });
      expect(journeyBounds.contentWidth).toBeLessThanOrEqual(journeyBounds.width + 1);
      const powerSummary = page.locator('main').getByRole('group', { name: 'Power summary', exact: true });
      for (const [label, value] of [['Max power (kW)', '19'], ['Max regen (kW)', '-4'], ['Observed power (time-weighted) (kW)', '5.93']]) {
        const term = powerSummary.getByRole('term').filter({ hasText: label });
        await expect(term).toBeVisible();
        await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText(value);
      }

      await expect(powerSummary).not.toContainText(/\b18700\b|\b9200\b|\b4200\b/);
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
    await expect(page.getByTestId('drive-canonical-summary')).toBeVisible();
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
    const summary = page.getByTestId('drive-canonical-summary');
    const distance = (await summary.textContent() ?? '').match(/Distance:\s*([\d.]+)\s*mi/);
    expect(distance).not.toBeNull();
    expect(Number(distance![1])).toBeCloseTo(mockDrive.distance_m / 1609.344, 1);
    await expect(summary).not.toContainText(/\bkm\b/);
    await expectNoHorizontalOverflow(page);
    await summary.screenshot({ path: test.info().outputPath(`drive-detail-imperial-${theme}.png`) });
    await assertMockApiComplete(page, mocks);
  });
}

async function expectDiscoverableOverlaps(chart: Locator, keys: readonly string[], coincident: readonly number[]) {
  const curves = chart.locator('.recharts-line-curve');
  await expect(curves).toHaveCount(keys.length);
  const strokes = await curves.evaluateAll(elements => elements.map(element => ({
    shape: element.getAttribute('d'), dash: element.getAttribute('stroke-dasharray'),
  })));
  expect(strokes.every(stroke => stroke.shape && stroke.dash)).toBe(true);
  expect(new Set(strokes.map(stroke => stroke.dash)).size).toBe(keys.length);
  expect(new Set(coincident.map(index => strokes[index].shape)).size).toBe(1);
  const toggle = chart.locator(`button[data-series-key="${keys[keys.length - 1]}"]`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(curves).toHaveCount(keys.length - 1);
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(curves).toHaveCount(keys.length);
}

async function hoverChart(page: Page, section: Locator) {
  await section.scrollIntoViewIfNeeded();
  const bounds = await section.locator('.recharts-wrapper').boundingBox();
  if (!bounds) throw new Error('The rendered chart must have measurable bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 3);
  const tooltip = section.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  return tooltip;
}

for (const { theme, width, imperial } of [
  { theme: 'light', width: 390, imperial: false },
  { theme: 'dark', width: 1280, imperial: true },
] as const) {
  test(`BUG3 presentation evidence at ${width}px in ${theme} with ${imperial ? 'imperial' : 'metric'} units`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedBrowserState(page, theme, path);
    await page.addInitScript(() => localStorage.setItem('teslasync-theme', 'tesla-red'));
    const mocks = await installApiMocks(page, 'populated', theme, 'comfortable', 'tesla-red');
    await installDriveDetailMocks(page, theme, mocks, { presentation: true, imperial });
    const diagnostics = monitorPage(page);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    await expectDriveSections(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('teslasync-theme'))).toBe('tesla-red');

    const power = page.locator('#power-trace');
    await expect(power.locator('[data-chart-summary-item="sample-mean-power"] dt'))
      .toHaveText('Observed power (time-weighted) (kW)');
    await expect(power.locator('[data-chart-summary-item="sample-mean-power"] dd')).toHaveText('8.75');
    await expect(power.locator('[data-chart-summary-item="avg-power"] dd')).toHaveText('9.60');
    await expect(power.locator('[data-chart-summary-item="max-regen"] dd')).toHaveText('-10');

    const temperatures = page.locator('#temperature-trace');
    const tempUnit = imperial ? '°F' : '°C';
    const outside = imperial ? '68.5' : '20.3';
    for (const [id, label, value] of [
      ['outside', 'Outside temperature', outside],
      ['inside', 'Inside temperature', imperial ? '71.1' : '21.7'],
      ['driver', 'Driver temperature', imperial ? '72.0' : '22.2'],
      ['passenger', 'Passenger temperature', imperial ? '72.0' : '22.2'],
    ]) {
      const item = temperatures.locator(`[data-chart-summary-item="${id}"]`);
      await expect(item.locator('dt')).toHaveText(`${label} (average) (${tempUnit})`);
      await expect(item.locator('dd')).toHaveText(value);
    }
    await expect(temperatures.locator('[data-chart-summary-item="fan"] dd')).toHaveText('Avg 0.4 · Max 4');
    await expectDiscoverableOverlaps(temperatures, ['outsideTemp', 'insideTemp', 'driverTemp', 'passengerTemp'], [2, 3]);
    const temperatureTooltip = await hoverChart(page, temperatures);
    await expect(temperatureTooltip).toContainText(outside);
    await expect(temperatureTooltip).not.toContainText(`${outside}0`);
    await page.mouse.move(0, 0);

    const pressure = page.locator('#tire-trace');
    await expect(pressure.locator('[data-chart-summary-item] dd')).toHaveText(
      Array.from({ length: 4 }, () => imperial ? '42.00' : '2.90'),
    );
    await pressure.scrollIntoViewIfNeeded();
    const tickLabels = pressure.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value');
    await expect(tickLabels.first()).toBeVisible();
    const ticks = (await tickLabels.allTextContents()).map(text => Number(text.replaceAll(',', '')));
    const measuredPressure = imperial ? 42 : 2.89579794;
    expect(ticks.every(value => Number.isFinite(value) && Math.abs(value - measuredPressure) < measuredPressure / 4)).toBe(true);
    expect(Math.max(...ticks) - Math.min(...ticks)).toBeLessThan(measuredPressure / 2);
    await expectDiscoverableOverlaps(pressure, ['tireFl', 'tireFr', 'tireRl', 'tireRr'], [0, 1, 2, 3]);

    const elevation = page.locator('#elevation-trace');
    const elevationUnit = imperial ? 'ft' : 'm';
    await expect(elevation.locator('[data-chart-summary-item] dt')).toHaveText([
      `Elevation gain (${elevationUnit})`, `Elevation loss (${elevationUnit})`, `Net elevation (${elevationUnit})`,
    ]);
    await expect(elevation.locator('[data-chart-summary-item] dd')).toHaveText(
      imperial ? ['100.00', '50.00', '50.00'] : ['30.48', '15.24', '15.24'],
    );
    await expect(elevation.getByRole('button', { name: `Elevation (${elevationUnit})`, exact: true })).toBeVisible();
    await expect(await hoverChart(page, elevation)).toContainText(imperial ? '150.00' : '45.72');
    await page.mouse.move(0, 0);

    const evidence = page.locator('#energy-evidence').getByRole('table');
    const alignment = await evidence.evaluate(table => {
      const headers = Array.from(table.querySelectorAll('thead th'));
      return Array.from(table.querySelectorAll('tbody tr')).flatMap(row => Array.from(row.children).map((cell, index) => {
        const style = getComputedStyle(cell);
        const header = headers[index];
        return {
          cellAlignment: style.textAlign, headerAlignment: getComputedStyle(header).textAlign,
          offset: Math.abs(cell.getBoundingClientRect().left + Number.parseFloat(style.paddingLeft)
            - header.getBoundingClientRect().left - Number.parseFloat(getComputedStyle(header).paddingLeft)),
        };
      }));
    });
    expect(alignment.length).toBeGreaterThan(0);
    for (const cell of alignment) {
      expect(['left', 'start']).toContain(cell.cellAlignment);
      expect(['left', 'start']).toContain(cell.headerAlignment);
      expect(cell.offset).toBeLessThanOrEqual(1);
    }
    for (const name of ['Range (ideal, start → end)', 'Range (rated, start → end)', 'Range (estimated, start → end)']) {
      await expect(evidence.getByRole('rowheader', { name, exact: true })).toBeVisible();
    }

    const supervised = page.locator('#fsd-evidence');
    const neutral = await supervised.getByRole('rowheader', { name: 'Reported distance', exact: true })
      .locator('span').evaluate(element => getComputedStyle(element).color);
    for (const name of ['Open FSD insights', 'After firmware 2026.30.2']) {
      const link = supervised.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveCSS('color', neutral);
    }
    for (const name of ['Reported distance', 'Share of drive', 'Evidence window']) {
      const geometry = await supervised.getByRole('rowheader', { name, exact: true }).evaluate(header => {
        const label = header.querySelector('span');
        const icon = label?.querySelector('svg');
        const text = label && Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        if (!label || !icon || !text) throw new Error('Evidence row needs an inline icon and its label');
        const range = document.createRange();
        range.selectNodeContents(text);
        const textBounds = range.getBoundingClientRect();
        const iconBounds = icon.getBoundingClientRect();
        return {
          centerOffset: Math.abs(iconBounds.y + iconBounds.height / 2 - textBounds.y - textBounds.height / 2),
          gap: textBounds.left - iconBounds.right,
        };
      });
      expect(geometry.centerOffset).toBeLessThanOrEqual(2);
      expect(geometry.gap).toBeGreaterThanOrEqual(4);
    }
    await expectNoHorizontalOverflow(page);
    expect(diagnostics.pageErrors).toEqual([]);
    await assertMockApiComplete(page, mocks);
  });
}
