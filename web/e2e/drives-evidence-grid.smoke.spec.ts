import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings, mockDrive, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectIntegratedGridFooter, expectNoHorizontalOverflow } from './qualityAssertions';
import { createReviewPreference } from './widget-design-packs.mock';
import { driveGridResponse } from './driveGridFixture';

const evidenceDrives = Array.from({ length: 4 }, (_, index) => ({
  ...mockDrive,
  id: 101 + index,
  start_ts: `2026-08-${25 - index}T08:00:00.000Z`,
  end_ts: `2026-08-${25 - index}T08:32:00.000Z`,
  start_address: index === 1 ? 'Office' : 'Home',
  distance_m: index === 3 ? 57500 : 28750,
}));

const driveColumns = ['route', 'date', 'distance', 'duration', 'energy', 'status', 'actions'];

test('drive paging loads the selected batch size beyond row 1,000', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedBrowserState(page, 'light', '/drives');
  const mocks = await installApiMocks(page, 'populated', 'light');
  const count = 1054;
  const start = Date.parse('2026-08-25T08:00:00Z');
  const rows = Array.from({ length: count }, (_, index) => ({
    ...mockDrive,
    id: 2000 + index,
    start_ts: new Date(start - index * 60_000).toISOString(),
    end_ts: new Date(start + (32 - index) * 60_000).toISOString(),
    distance_m: index === count - 1 ? 220000 : mockDrive.distance_m,
  }));
  const requested: Array<{ limit: string | null; offset: string | null }> = [];
  let releaseNextPage = () => {};
  const nextPageResponse = new Promise<void>(resolve => { releaseNextPage = resolve; });
  await page.route('**/api/v1/drives?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('view') === 'page') {
      const limit = params.get('limit');
      const offset = params.get('offset');
      requested.push({ limit, offset });
      if (limit === '50' && offset === '50') await nextPageResponse;
    }
    return fulfillApiFixture(route, mocks, { json: driveGridResponse(rows, params) });
  });
  await page.goto('/drives?from=2026-08-01&to=2026-08-31&size=25&page=41');
  await waitForHarnessReady(page, mocks);
  const grid = page.locator('[data-drive-evidence-grid]');
  const body = grid.getByRole('table', { name: 'Drive evidence' }).locator('tbody');
  const footer = grid.getByRole('navigation', { name: 'Pagination' });
  await expect(footer).toContainText('Showing 1,001–1,025 of 1,054');
  await expect(body.locator('a[href="/drives/3000"]')).toBeVisible();
  expect(requested).toContainEqual({ limit: '25', offset: '1000' });
  expect(requested.every(request => request.limit === '25')).toBe(true);

  await footer.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
  await expect(footer).toContainText('Showing 1–50 of 1,054');
  await expect(body.locator('a[href="/drives/2000"]')).toBeVisible();
  expect(requested).toContainEqual({ limit: '50', offset: '0' });
  const nextPage = footer.getByRole('button', { name: 'Next page' });
  try {
    await nextPage.click();
    await expect.poll(() => requested).toContainEqual({ limit: '50', offset: '50' });
    await expect(nextPage).toBeFocused();
    await expect(body.locator('a[href="/drives/2000"]')).toHaveCount(0);
  } finally {
    releaseNextPage();
  }
  await expect(footer).toContainText('Showing 51–100 of 1,054');
  await expect(body.locator('a[href="/drives/2050"]')).toBeVisible();

  await grid.getByRole('spinbutton', { name: 'Minimum Distance (km)' }).fill('200');
  await expect(grid.getByText('1 matching / 1,054 in range')).toBeVisible();
  await expect(body.locator('a[href="/drives/3053"]')).toBeVisible();
  await expect(footer).toContainText('Showing 1–1 of 1');
  await expect(page).not.toHaveURL(/[?&]page=/);
  await assertMockApiComplete(page, mocks);
});

async function showOptionalColumns(page: Page, ...optional: string[]) {
  await page.addInitScript(order => {
    localStorage.setItem('teslasync.table.drives:evidence.columns', JSON.stringify({ order, hidden: [] }));
  }, [...driveColumns, ...optional]);
}

for (const [theme, pack, width] of [['light', 'quiet', 390], ['dark', 'terminal', 1440]] as const) {
  test(`shared Drive grid follows the ${pack} app design and saved accent in ${theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await seedBrowserState(page, theme, '/drives');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/settings/widget-design-pack', route => fulfillApiFixture(route, mocks, {
      json: { ...createReviewPreference(), pack_id: pack, app_wide: true },
    }));
    await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, mode: theme, theme: 'custom', custom_primary: '#9c6ade', custom_accent: '#c0842b', font_scale: 1.1 },
    }));
    await page.route('**/api/v1/drives?*', route => fulfillApiFixture(route, mocks, {
      json: driveGridResponse(evidenceDrives, new URL(route.request().url()).searchParams),
    }));
    await page.goto('/drives?from=2026-08-01&to=2026-08-31&size=1');
    await waitForHarnessReady(page, mocks);
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
    const frame = page.locator('[data-drive-evidence-grid] [data-grid-frame]');
    await expect(page.getByRole('heading', { name: 'Drive history', exact: true })).toHaveCount(1);
    await expect(frame.locator('[data-grid-heading]')).toHaveCount(0);
    await expect(frame.locator('[data-grid-tools]')).toBeVisible();
    expect(await frame.evaluate(node => getComputedStyle(node).getPropertyValue('--theme-accent').trim())).toBe('#9c6ade');
    if (width === 390) {
      await expect(frame.locator('[data-mobile-table] [data-card]')).toHaveCount(1);
      await expect(frame.getByRole('table')).toHaveCount(0);
      await frame.getByRole('button', { name: 'Filter & sort' }).click();
      const tools = page.getByRole('dialog', { name: 'Filter & sort' });
      await tools.getByRole('combobox', { name: 'Column' }).selectOption('route');
      await tools.getByRole('button', { name: 'Text condition' }).click();
      await tools.getByRole('textbox', { name: 'Filter Route' }).fill('Office →');
      await expect(page).toHaveURL(/grid_route=/);
      await tools.getByRole('button', { name: 'Done', exact: true }).click();
    } else {
      const table = frame.getByRole('table', { name: 'Drive evidence' });
      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'Route', exact: true })).toHaveAttribute('data-grid-identity', 'true');
      await frame.getByRole('combobox', { name: 'Filter by column' }).selectOption('route');
      await frame.locator('[data-grid-tools]').getByRole('textbox', { name: 'Filter Route' }).fill('Office →');
      await expect(page).toHaveURL(/grid_route=/);
      await frame.getByRole('combobox', { name: 'Sort by' }).selectOption('distance');
      await expect(table.getByRole('columnheader', { name: 'Distance (km)' })).toHaveAttribute('aria-sort', 'descending');
      await expect(page).toHaveURL(/grid_route=Office/);
      await expect(frame.locator('a[href="/drives/102"]')).toBeVisible();
      const views = page.getByRole('dialog', { name: 'Saved views', exact: true });
      await frame.getByRole('button', { name: 'Saved views', exact: true }).click();
      await views.getByRole('textbox', { name: 'View name' }).fill('Office routes');
      await views.getByRole('button', { name: 'Save current view' }).click();
      await expect(views.getByRole('button', { name: 'Office routes', exact: true })).toBeVisible();
      await views.getByRole('button', { name: 'Close', exact: true }).click();
      await frame.locator('[data-grid-tools]').getByRole('textbox', { name: 'Filter Route' }).clear();
      await expect(frame.locator('a[href="/drives/104"]')).toBeVisible();
      await frame.getByRole('button', { name: 'Saved views', exact: true }).click();
      await views.getByRole('button', { name: 'Office routes', exact: true }).click();
      await expect(page).toHaveURL(/from=2026-08-01&to=2026-08-31/);
      await expect(page).toHaveURL(/grid_route=Office/);
    }
    await expect(frame.getByText('1 matching / 4 in range', { exact: true })).toBeVisible();
    await expect(frame.locator('a[href="/drives/102"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await frame.locator('[data-grid-tools]').scrollIntoViewIfNeeded();
    await frame.screenshot({ path: test.info().outputPath(`app-grid-${pack}-${theme}.png`) });
    await assertMockApiComplete(page, mocks);
  });
}

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
        return fulfillApiFixture(route, mocks, {
          json: driveGridResponse([...evidenceDrives, ...priorDrives], params),
        });
      });
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);
      const overview = page.getByTestId('drives-overview');
      await overview.scrollIntoViewIfNeeded();
      const cards = overview.locator('[data-operational-metric]');
      await expect(cards).toHaveCount(6);
      await expect(cards.first().locator('[data-operational-value]')).toHaveText('4');
      await overview.getByRole('button', { name: 'Review details', exact: true }).click();
      const details = page.getByRole('dialog', { name: 'Overview details', exact: true });
      await expect(details.locator('[role="group"][aria-label] span[title]')).toHaveCount(5);
      await expect(details.getByRole('group', { name: 'Efficiency grade', exact: true }).locator('span[title]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(cards.locator('[data-role="metric-comparison"]')).toHaveCount(0);
      const values = await cards.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        const value = node.querySelector('[data-operational-value]')!.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), width: box.width, valueX: value.x, valueY: value.y };
      }));
      for (const value of values) expect(value.width).toBeGreaterThanOrEqual(200);
      for (const column of new Set(values.map(value => value.x))) {
        const rowValues = values.filter(value => value.x === column);
        expect(Math.max(...rowValues.map(value => value.valueX)) - Math.min(...rowValues.map(value => value.valueX))).toBeLessThanOrEqual(1);
      }
      for (const row of new Set(values.map(value => value.y))) {
        const rowValues = values.filter(value => value.y === row);
        expect(Math.max(...rowValues.map(value => value.valueY)) - Math.min(...rowValues.map(value => value.valueY))).toBeLessThanOrEqual(1);
      }
      await overview.screenshot({ path: test.info().outputPath(`drive-overview-mixed-${width}-${theme}.png`) });
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
    test(`drive evidence aligns and filters at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/drives');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);

      const region = page.getByRole('region', { name: 'Drive list' });
      const brief = page.getByTestId('drives-operational-brief');
      if (width < 640) {
        const title = brief.getByRole('heading', { name: 'Activity, efficiency, and exceptions in context' });
        await expect(title).toBeVisible();
        const geometry = await title.evaluate(node => ({
          width: node.clientWidth, contentWidth: node.scrollWidth,
          height: node.clientHeight, contentHeight: node.scrollHeight,
        }));
        expect(geometry.contentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width + 1);
        expect(geometry.contentHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.height + 1);
      }
      const metrics = brief.getByRole('listitem');
      await expect(metrics).toHaveCount(6);
      if (width >= 1920) {
        const rows = await metrics.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
        // OperationalBrief balances its six facts into two banks of three.
        expect(new Set(rows).size).toBe(2);
        for (const row of new Set(rows)) expect(rows.filter(y => y === row)).toHaveLength(3);
      }

      const pageHeader = page.locator('[data-role="page-header"]');
      await expect(pageHeader).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const shadow = await pageHeader.evaluate((node) => getComputedStyle(node).boxShadow);
      expect(shadow === 'none' || shadow.replaceAll('rgba(0, 0, 0, 0)', '').replaceAll('0px', '').replace(/[,\s]/g, '') === '').toBe(true);
      const overview = page.getByTestId('drives-overview');
      await overview.scrollIntoViewIfNeeded();
      const overviewGeometry = await overview.locator('[data-operational-metric]').evaluateAll((cards) => cards.map(card => {
        const bounds = card.getBoundingClientRect();
        const value = card.querySelector('[data-operational-value]')!;
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
      if (width >= 1920) expect(new Set(overviewGeometry.map(item => item.row)).size).toBe(2);
      await overview.screenshot({ path: test.info().outputPath(`drive-overview-${width}-${theme}.png`) });
      await region.scrollIntoViewIfNeeded();
      const frame = region.locator('[data-grid-frame]');
      const frameWidth = await frame.evaluate(node => node.getBoundingClientRect().width);
      if (frameWidth <= 781) {
        await expect(frame.locator('[data-mobile-table]')).toBeVisible();
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
        await expect(table.getByRole('spinbutton', { name: 'Minimum Distance (km)' })).toBeVisible();
        await expect(page.getByTestId('drives-filters')).toHaveCount(0);
        const exports = region.getByRole('button', { name: 'Export list', exact: true });
        await expect(exports).toHaveCount(1);
        await exports.click();
        await expect(page.getByRole('menuitem', { name: 'Download as CSV' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Download as JSON' })).toBeVisible();
        await exports.press('Escape');
        const columnMenu = region.getByRole('button', { name: 'Reorder or hide columns' });
        await expect(region.getByRole('heading', { name: 'Drive history', exact: true })).toHaveCount(0);
        const [exportBox, columnsBox] = await Promise.all([exports, columnMenu].map(item => item.boundingBox()));
        expect(Math.abs((exportBox!.y + exportBox!.height / 2) - (columnsBox!.y + columnsBox!.height / 2))).toBeLessThanOrEqual(2);
        await expect(frame.getByRole('combobox', { name: 'Filter by column' })).toHaveValue('');
        await expect(frame.getByRole('combobox', { name: 'Sort by' })).toHaveValue('date');
        expect(await table.locator('thead th[data-column-key]').evaluateAll(cells =>
          cells.map(cell => cell.getAttribute('data-column-key')))).toEqual(driveColumns);
        for (const key of ['distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'energy', 'regen', 'batteryUsed']) {
          await expect(table.locator(`tbody [data-column-key="${key}"] [data-indicator]`)).toHaveCount(0);
        }

        const geometry = await table.evaluate((node) => {
          const headerCheckbox = node.querySelector('thead .checkbox-indicator')!.getBoundingClientRect();
          const checkbox = node.querySelector('tbody .checkbox-indicator')!.getBoundingClientRect();
          const row = node.querySelector('tbody tr')!.getBoundingClientRect();
          const header = node.querySelector('thead th[data-column-key="route"]')!.getBoundingClientRect();
          const cell = node.querySelector('tbody td[data-column-key="route"]')!.getBoundingClientRect();
          return {
            checkboxX: Math.abs(headerCheckbox.x - checkbox.x),
            checkboxCenter: Math.abs(checkbox.y + checkbox.height / 2 - (row.y + row.height / 2)),
            textX: Math.abs(header.x - cell.x),
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
        const minimum = table.getByRole('spinbutton', { name: 'Minimum Distance (km)' });
        await minimum.fill('100000');
        await expect(table.getByText('No drives match these filters')).toBeVisible();
        await minimum.clear();
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
    await showOptionalColumns(page, 'speed', 'efficiency', 'outsideTemp', 'startBattery', 'battery', 'batteryUsed');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/settings', (route) => fulfillApiFixture(route, mocks, {
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
    await expect(row.locator('[data-column-key="distance"]')).toHaveText('17.86 mi');
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
    await expect(row.locator('[data-column-key="distance"]')).toHaveText('17.86 mi');
    await table.screenshot({ path: test.info().outputPath(`imperial-${theme}.png`), animations: 'disabled' });
    await expectNoHorizontalOverflow(page);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`drive value filters combine and persist across pages in ${theme}`, async ({ page }) => {
    const width = theme === 'light' ? 1024 : 1440;
    await page.setViewportSize({ width, height: 900 });
    await seedBrowserState(page, theme, '/drives');
    await showOptionalColumns(page, 'start');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/drives?*', (route) => fulfillApiFixture(route, mocks, {
      json: driveGridResponse(evidenceDrives, new URL(route.request().url()).searchParams),
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
      await showOptionalColumns(restoredPage, 'start');
      const restoredMocks = await installApiMocks(restoredPage, 'populated', theme);
      await restoredPage.route('**/api/v1/drives?*', (route) => fulfillApiFixture(route, restoredMocks, {
        json: driveGridResponse(evidenceDrives, new URL(route.request().url()).searchParams),
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
    await page.route('**/api/v1/drives?*', (route) => fulfillApiFixture(route, mocks, {
      json: driveGridResponse(evidenceDrives, new URL(route.request().url()).searchParams),
    }));
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
    const toolbar = frame.locator('[data-grid-tools]');
    await expect(toolbar).toHaveCount(1);
    const exports = toolbar.getByRole('button', { name: 'Export list', exact: true });
    const menu = toolbar.getByRole('button', { name: 'Reorder or hide columns' });
    const bounds = await Promise.all([exports, menu].map((item) => item.boundingBox()));
    const [exportButton, columns] = bounds.map((box) => box!.y + box!.height / 2);
    expect(Math.abs(exportButton - columns)).toBeLessThanOrEqual(2);
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
