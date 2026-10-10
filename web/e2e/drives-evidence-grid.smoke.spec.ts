import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings, mockDrive, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectIntegratedGridFooter, expectNoHorizontalOverflow } from './qualityAssertions';

const evidenceDrives = Array.from({ length: 4 }, (_, index) => ({
  ...mockDrive,
  id: 101 + index,
  start_ts: `2026-08-${25 - index}T08:00:00.000Z`,
  end_ts: `2026-08-${25 - index}T08:32:00.000Z`,
  start_address: index === 1 ? 'Office' : 'Home',
  distance_m: index === 3 ? 57500 : 28750,
}));

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1920]) {
    test(`drive overview aligns mixed comparison slots at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/drives');
      const mocks = await installApiMocks(page, 'populated', theme);
      const priorDrives = evidenceDrives.slice(0, 2).map((drive, index) => ({
        ...drive,
        id: 201 + index,
        start_ts: `2026-07-${25 - index}T08:00:00.000Z`,
        end_ts: `2026-07-${25 - index}T08:32:00.000Z`,
      }));
      await page.route('**/api/v1/drives?*', route => {
        const params = new URL(route.request().url()).searchParams;
        const start = Date.parse(params.get('start') ?? '1970-01-01');
        const end = Date.parse(params.get('end') ?? '2100-01-01');
        return fulfillApiFixture(route, mocks, {
          json: [...evidenceDrives, ...priorDrives].filter(drive => {
            const at = Date.parse(drive.start_ts);
            return at >= start && at < end;
          }),
        });
      });
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);
      const overview = page.getByTestId('drives-overview');
      await overview.scrollIntoViewIfNeeded();
      const cards = overview.locator('[data-role="metric-card"]');
      await expect(cards).toHaveCount(6);
      await expect(cards.first().locator('[data-role="metric-value"]')).toHaveText('4');
      await expect(overview.locator('[data-role="metric-comparison"]')).toHaveCount(5);
      await expect(cards.nth(3).locator('[data-role="metric-comparison"]')).toHaveCount(0);
      const values = await cards.locator('[data-role="metric-value"]').evaluateAll(nodes =>
        nodes.map(node => {
          const bounds = node.getBoundingClientRect();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }),
      );
      for (let column = 0; column < 3; column++) {
        expect(Math.abs(values[column].x - values[column + 3].x)).toBeLessThanOrEqual(1);
      }
      for (const row of [values.slice(0, 3), values.slice(3)]) {
        expect(Math.max(...row.map(value => value.y)) - Math.min(...row.map(value => value.y)))
          .toBeLessThanOrEqual(1);
      }
      await overview.screenshot({ path: test.info().outputPath(`drive-overview-mixed-${width}-${theme}.png`) });
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920, 2560]) {
    test(`drive evidence aligns and filters at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/drives');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);

      const region = page.getByRole('region', { name: 'Drive list' });
      const brief = page.getByTestId('drives-operational-brief');
      const metrics = brief.getByRole('listitem');
      await expect(metrics).toHaveCount(6);
      if (width >= 1920) {
        const rows = await metrics.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
        expect(new Set(rows).size).toBe(1);
      }

      const pageHeader = page.locator('[data-role="page-header"]');
      await expect(pageHeader).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const shadow = await pageHeader.evaluate((node) => getComputedStyle(node).boxShadow);
      expect(shadow === 'none' || shadow.replaceAll('rgba(0, 0, 0, 0)', '').replaceAll('0px', '').replace(/[,\s]/g, '') === '').toBe(true);
      const overview = page.getByTestId('drives-overview');
      await overview.scrollIntoViewIfNeeded();
      const overviewGeometry = await overview.locator('[data-role="metric-card"]').evaluateAll((cards) => cards.map(card => {
        const bounds = card.getBoundingClientRect();
        const value = card.querySelector('[data-role="metric-value"]')!;
        const valueBounds = value.getBoundingClientRect();
        const inline = getComputedStyle(value.parentElement!).display === 'grid';
        return {
          column: Math.round(bounds.x),
          row: Math.round(bounds.y),
          valueX: inline ? valueBounds.x + valueBounds.width / 2 : valueBounds.x,
          valueY: inline ? valueBounds.y + valueBounds.height / 2 : valueBounds.y,
          inline,
          comparison: card.querySelector('[data-role="metric-comparison"]') != null,
        };
      }));
      expect(overviewGeometry).toHaveLength(6);
      expect(overviewGeometry[3].comparison).toBe(false);
      for (const column of new Set(overviewGeometry.map(item => item.column))) {
        const values = overviewGeometry.filter(item => item.column === column).map(item => item.valueX);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }
      for (const row of new Set(overviewGeometry.map(item => item.row))) {
        const values = overviewGeometry.filter(item => item.row === row).map(item => item.valueY);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }
      if (width >= 1920) expect(overviewGeometry.every(item => item.inline)).toBe(true);
      await overview.screenshot({ path: test.info().outputPath(`drive-overview-${width}-${theme}.png`) });
      await region.scrollIntoViewIfNeeded();
      if (width < 1024) {
        await expect(region.getByRole('table')).toHaveCount(0);
        await expect(region.getByRole('link').first()).toBeVisible();
        const pagination = page.getByRole('navigation', { name: 'Pagination', exact: true });
        const controls = [
          pagination.getByRole('button', { name: 'First page', exact: true }),
          pagination.getByRole('button', { name: 'Previous page', exact: true }),
          pagination.locator('button[aria-current="page"]'),
          pagination.getByRole('button', { name: 'Next page', exact: true }),
          pagination.getByRole('button', { name: 'Last page', exact: true }),
        ];
        await expect(pagination).toBeVisible();
        const boxes = await Promise.all(controls.map(control => control.boundingBox()));
        expect(boxes.every(Boolean)).toBe(true);
        const centers = boxes.map(box => box!.y + box!.height / 2);
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
        if (width < 640) {
          for (const box of boxes) {
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
          }
          await pagination.screenshot({ path: test.info().outputPath(`drive-pagination-${width}-${theme}.png`) });
        }
      } else {
        const table = region.getByRole('table', { name: 'Drive evidence' });
        await expect(table).toBeVisible();
        await expectIntegratedGridFooter(table);
        await expect(table.getByRole('spinbutton')).toHaveCount(0);
        await expect(page.getByTestId('drives-filters')).toHaveCount(0);
        const exports = region.getByRole('button', { name: 'Export list', exact: true });
        await expect(exports).toHaveCount(1);
        await exports.click();
        await expect(page.getByRole('menuitem', { name: 'Download as CSV' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Download as JSON' })).toBeVisible();
        await exports.press('Escape');
        const columnMenu = region.getByRole('button', { name: 'Reorder or hide columns' });
        const title = region.getByRole('heading', { name: /Drive evidence/ });
        await expect(title).toHaveCount(1);
        await expect.poll(async () => {
          const bounds = await Promise.all([title, exports, columnMenu].map((item) => item.boundingBox()));
          if (bounds.some(box => box == null)) return Infinity;
          const centers = bounds.map(box => box!.y + box!.height / 2);
          return Math.max(...centers) - Math.min(...centers);
        }).toBeLessThanOrEqual(2);
        for (const key of ['start', 'destination', 'startBattery', 'battery', 'batteryUsed', 'maxSpeed', 'avgPower', 'outsideTemp', 'regen']) {
          await expect(table.locator(`thead th[data-column-key="${key}"]`)).toHaveCount(1);
        }
        await expect(table.locator('tbody tr').first().locator('td[data-column-key="startBattery"]')).toHaveText('78.00');
        await expect(table.locator('tbody tr').first().locator('td[data-column-key="battery"]')).toHaveText('68.00');
        await expect(table.locator('tbody tr').first().locator('td[data-column-key="batteryUsed"]')).toHaveText('10.00');
        for (const label of ['Energy', 'Regen', 'FSD']) {
          await expect(table.getByRole('button', { name: `${label} filter`, exact: true })).toBeVisible();
        }
        for (const key of ['distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'energy', 'regen', 'batteryUsed']) {
          await expect(table.locator(`tbody [data-column-key="${key}"] [data-indicator]`)).toHaveCount(0);
        }

        const geometry = await table.evaluate((node) => {
          const headerCheckbox = node.querySelector('thead .checkbox-indicator')!.getBoundingClientRect();
          const checkbox = node.querySelector('tbody .checkbox-indicator')!.getBoundingClientRect();
          const row = node.querySelector('tbody tr')!.getBoundingClientRect();
          const header = node.querySelector('thead th[data-column-key="date"] button')!.getBoundingClientRect();
          const link = node.querySelector('tbody a[href^="/drives/"]')!.getBoundingClientRect();
          return {
            checkboxX: Math.abs(headerCheckbox.x - checkbox.x),
            checkboxCenter: Math.abs(checkbox.y + checkbox.height / 2 - (row.y + row.height / 2)),
            textX: Math.abs(header.x - link.x),
            rowHeight: row.height,
          };
        });
        expect(geometry.checkboxX).toBeLessThanOrEqual(1);
        expect(geometry.checkboxCenter).toBeLessThanOrEqual(1);
        expect(geometry.textX).toBeLessThanOrEqual(1);
        expect(geometry.rowHeight).toBeLessThanOrEqual(56);

        await table.screenshot({ path: test.info().outputPath(`evidence-${width}-${theme}.png`) });
        await brief.screenshot({ path: test.info().outputPath(`posture-${width}-${theme}.png`) });
        await region.screenshot({ path: test.info().outputPath(`ledger-${width}-${theme}.png`) });
        await table.getByRole('button', { name: 'Distance (km) filter', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Distance (km) filter' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('checkbox', { name: '28.75 km' })).toBeChecked();
        await dialog.getByRole('button', { name: 'Number condition' }).click();
        await dialog.getByRole('spinbutton').fill('100000');
        await expect(table.getByText('No drives match these filters')).toBeVisible();
        await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(table.locator('tbody a[href^="/drives/"]').first()).toBeVisible();
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page);
      await region.getByRole('button', { name: 'Quick view drive' }).first().click();
      const drawer = page.getByRole('dialog', { name: /Home/ });
      await expect(drawer).toBeVisible();
      const footer = drawer.locator('[data-drawer-footer]');
      const footerMatchesTheme = await footer.evaluate((node) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--surface-1)';
        node.appendChild(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        const actual = getComputedStyle(node).backgroundColor;
        probe.remove();
        return expected === actual;
      });
      expect(footerMatchesTheme).toBe(true);
      await expect(footer.getByRole('button', { name: 'Open drive details' })).toBeVisible();
      await drawer.screenshot({ path: test.info().outputPath(`preview-${width}-${theme}.png`) });
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`drive grid uses saved miles and Fahrenheit preferences in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBrowserState(page, theme, '/drives');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/settings', (route) => route.fulfill({
      json: { ...mockAppSettings, mode: theme, unit_of_length: 'mi', unit_of_temp: 'F' },
    }));
    await page.goto('/drives?from=2026-08-01&to=2026-08-31');
    await waitForHarnessReady(page, mocks);
    const table = page.getByRole('table', { name: 'Drive evidence' });
    await expect(table.locator('thead th[data-column-key="distance"]')).toContainText('Distance (mi)');
    await expect(table.locator('thead th[data-column-key="speed"]')).toContainText('Avg speed (mph)');
    await expect(table.locator('thead th[data-column-key="efficiency"]')).toContainText('Efficiency (Wh/mi)');
    await expect(table.locator('thead th[data-column-key="outsideTemp"]')).toContainText('Outside temp (°F)');
    const row = table.locator('tbody tr').first();
    await expect(row.locator('[data-column-key="distance"]')).toHaveText('17.86');
    await expect(row.locator('[data-column-key="speed"]')).toHaveText('33');
    await expect(row.locator('[data-column-key="efficiency"]')).toHaveText('287');
    await expect(row.locator('[data-column-key="outsideTemp"]')).toHaveText('69.80');
    await expect(row.locator('[data-column-key="efficiency"] [data-range]')).toHaveAttribute('data-range', 'info');
    await expect(row.locator('[data-column-key="startBattery"] [data-range]')).toHaveAttribute('data-range', 'good');
    await table.getByRole('button', { name: 'Distance (mi) filter', exact: true }).click();
    const filter = page.getByRole('dialog', { name: 'Distance (mi) filter' });
    await expect(filter.getByRole('checkbox', { name: '17.86 mi' })).toBeChecked();
    await filter.getByRole('button', { name: 'Number condition' }).click();
    await filter.getByRole('spinbutton').fill('20');
    await expect(table.getByText('No drives match these filters')).toBeVisible();
    await filter.getByRole('button', { name: 'Clear', exact: true }).click();
    await filter.getByRole('button', { name: 'Done' }).click();
    await expect(table.getByRole('button', { name: 'Distance (mi) filter', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(row.locator('[data-column-key="distance"]')).toHaveText('17.86');
    await table.screenshot({ path: test.info().outputPath(`imperial-${theme}.png`), animations: 'disabled' });
    await expectNoHorizontalOverflow(page);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`drive value filters combine and persist across pages in ${theme}`, async ({ page }) => {
    const width = theme === 'light' ? 1024 : 1440;
    await page.setViewportSize({ width, height: 900 });
    await seedBrowserState(page, theme, '/drives');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/drives?*', (route) => fulfillApiFixture(route, mocks, {
      json: evidenceDrives,
    }));
    await page.goto('/drives?from=2026-08-01&to=2026-08-31&size=1&page=2');
    await waitForHarnessReady(page, mocks);
    const table = page.getByRole('table', { name: 'Drive evidence' });
    const distance = page.getByRole('dialog', { name: 'Distance (km) filter' });
    await expect(table.locator('tbody a[href^="/drives/"]')).toHaveCount(1);
    await table.getByRole('button', { name: 'Distance (km) filter', exact: true }).click();
    await expect(distance.getByRole('spinbutton')).toHaveCount(0);
    await expect(distance.getByRole('checkbox', { name: '28.75 km' }).locator('..')).toHaveText(/28\.75 km\s*3/);
    await expect(distance.getByRole('checkbox', { name: '57.50 km' })).toBeChecked();
    const box = await distance.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
    await distance.screenshot({ path: test.info().outputPath(`value-filter-${theme}.png`) });
    await distance.getByRole('checkbox', { name: 'Select all shown values' }).locator('..').click();
    await expect(table.getByText('No drives match these filters')).toBeVisible();
    await expect(distance.getByRole('checkbox', { name: '57.50 km' })).toBeVisible();
    await distance.getByRole('textbox', { name: 'Search values' }).fill('57');
    await expect(distance.getByRole('group', { name: 'Available values' }).getByRole('checkbox')).toHaveCount(1);
    await distance.getByRole('checkbox', { name: '57.50 km' }).locator('..').click();
    await expect(table.locator('tbody a[href="/drives/104"]')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]page=2/);
    await distance.getByRole('button', { name: 'Done' }).click();

    await table.getByRole('button', { name: 'Start filter', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start filter', exact: true });
    await start.getByRole('checkbox', { name: 'Home', exact: true }).locator('..').click();
    await expect(table.getByText('No drives match these filters')).toBeVisible();
    await expect(start.getByRole('checkbox', { name: 'Home', exact: true })).toBeVisible();
    await start.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(table.locator('tbody a[href="/drives/104"]')).toBeVisible();
    await expect(table.getByRole('button', { name: 'Distance (km) filter', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await start.getByRole('button', { name: 'Done' }).click();
    const savedUrl = page.url();
    await assertMockApiComplete(page, mocks);
    const restoredPage = await page.context().newPage();
    try {
      await restoredPage.setViewportSize({ width, height: 900 });
      await seedBrowserState(restoredPage, theme, '/drives');
      const restoredMocks = await installApiMocks(restoredPage, 'populated', theme);
      await restoredPage.route('**/api/v1/drives?*', (route) => fulfillApiFixture(route, restoredMocks, {
        json: evidenceDrives,
      }));
      await restoredPage.goto(savedUrl);
      await waitForHarnessReady(restoredPage, restoredMocks);
      const restoredTable = restoredPage.getByRole('table', { name: 'Drive evidence' });
      await expect(restoredTable.locator('tbody a[href="/drives/104"]')).toBeVisible();
      await expect(restoredTable.getByRole('button', { name: 'Distance (km) filter', exact: true }))
        .toHaveAttribute('aria-pressed', 'true');
      await restoredTable.getByRole('button', { name: 'Distance (km) filter', exact: true }).click();
      const restoredDistance = restoredPage.getByRole('dialog', { name: 'Distance (km) filter' });
      await restoredDistance.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(restoredTable.locator('tbody a[href="/drives/101"]')).toBeVisible();
      await restoredDistance.getByRole('button', { name: 'Done' }).click();
      await expectNoHorizontalOverflow(restoredPage);
      await assertMockApiComplete(restoredPage, restoredMocks);
    } finally {
      await restoredPage.close();
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`drive grid has readable selection and a single toolbar in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBrowserState(page, theme, '/drives');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/drives?*', (route) => route.fulfill({ json: evidenceDrives }));
    await page.goto('/drives?from=2026-08-01&to=2026-08-31');
    await waitForHarnessReady(page, mocks);
    const frame = page.locator('[data-drive-evidence-grid]');
    const table = frame.getByRole('table', { name: 'Drive evidence' });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(4);
    await frame.screenshot({ path: test.info().outputPath(`polished-grid-${theme}.png`) });
    await rows.nth(1).getByRole('checkbox').locator('..').click();
    await page.mouse.move(0, 0);
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    expect(await rows.nth(1).locator('td').first().evaluate((node) => getComputedStyle(node).boxShadow)).toContain('inset');
    const selectionMatchesTheme = await rows.nth(1).evaluate((node) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--control-bg)';
      document.body.appendChild(probe);
      const result = getComputedStyle(node).backgroundColor === getComputedStyle(probe).backgroundColor;
      probe.remove();
      return result;
    });
    expect(selectionMatchesTheme).toBe(true);
    await expect(frame.getByRole('region', { name: 'Bulk actions', exact: true })).toHaveCount(0);
    const title = frame.getByRole('heading', { name: /Drive evidence/ });
    const exports = frame.getByRole('button', { name: 'Export list', exact: true });
    const menu = frame.getByRole('button', { name: 'Reorder or hide columns' });
    const bounds = await Promise.all([title, exports, menu].map((item) => item.boundingBox()));
    const centers = bounds.map((box) => box!.y + box!.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
    await rows.nth(2).press('Space');
    await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
    await frame.screenshot({ path: test.info().outputPath(`polished-selected-${theme}.png`) });
    await table.getByRole('button', { name: 'Distance (km) filter', exact: true }).click();
    const filter = page.getByRole('dialog', { name: 'Distance (km) filter' });
    await filter.getByRole('checkbox', { name: '57.50 km' }).locator('..').click();
    await expect(filter.getByText('Active', { exact: true })).toBeVisible();
    await filter.screenshot({ path: test.info().outputPath(`polished-active-filter-${theme}.png`) });
    await expectNoHorizontalOverflow(page);
  });
}
