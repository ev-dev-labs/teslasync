import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import {
  expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from './qualityAssertions';
import { fsdObservatoryGridFixture } from './fsdObservatoryGridFixtures';

test.skip(process.env.E2E_MOCKS === '0', 'Requires isolated observatory evidence fixtures');
const path = '/fsd?from=2026-07-28&to=2026-08-26';
const frameOf = (table: Locator) => table.locator('xpath=ancestor::*[@data-grid-frame][1]');

async function expectEmbeddedGridFooter(table: Locator) {
  const frame = frameOf(table);
  await expect(frame).toHaveAttribute('data-grid-variant', 'embedded');
  await expect(frame.locator('[data-grid-footer]')).toBeVisible();
  await expect(frame.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(1);
  const geometry = await frame.evaluate(node => {
    const viewport = node.querySelector('[data-grid-viewport]');
    const footer = node.querySelector('[data-grid-footer]');
    if (!viewport || !footer) throw new Error('Missing embedded grid viewport/footer');
    const view = viewport.getBoundingClientRect();
    const foot = footer.getBoundingClientRect();
    return {
      outsideScroll: !viewport.contains(footer), gap: foot.y - view.bottom,
      widthDifference: Math.abs(foot.width - view.width),
      leftDifference: Math.abs(foot.x - view.x),
    };
  });
  expect(geometry.outsideScroll).toBe(true);
  expect(Math.abs(geometry.gap)).toBeLessThanOrEqual(1);
  expect(geometry.widthDifference).toBeLessThanOrEqual(1);
  expect(geometry.leftDifference).toBeLessThanOrEqual(1);
}

async function setup(page: Page, theme: 'light' | 'dark', mode: 'evidence' | 'paging' | 'empty' = 'evidence') {
  await seedBrowserState(page, theme, path);
  const mocks = await installApiMocks(page, 'populated', theme);
  await page.route('**/api/v1/analytics/fsd?*', route =>
    fulfillApiFixture(route, mocks, { json: fsdObservatoryGridFixture(mode) }));
  return mocks;
}

async function expectLocalScroll(table: Locator, width: number) {
  const viewport = frameOf(table).locator('[data-grid-viewport]');
  const geometry = await viewport.evaluate(node => {
    node.scrollLeft = node.scrollWidth;
    return {
      width: node.clientWidth, scrollWidth: node.scrollWidth, scrollLeft: node.scrollLeft,
      overflow: getComputedStyle(node).overflowX,
    };
  });
  expect(['auto', 'scroll']).toContain(geometry.overflow);
  if (width === 390) {
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
    expect(geometry.scrollLeft).toBeGreaterThan(0);
  }
  await viewport.evaluate(node => { node.scrollLeft = 0; });
}

async function captureGrid(page: Page, table: Locator, label: string) {
  await frameOf(table).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`${label}-left.png`) });
  for (const name of ['Reported FSD', label.startsWith('journal') ? 'Evidence' : 'Firmware']) {
    const header = table.getByRole('columnheader', { name, exact: true });
    await header.evaluate(node => node.scrollIntoView({ block: 'nearest', inline: 'center' }));
    await expect(header).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`${label}-${name.replaceAll(' ', '-')}.png`) });
  }
  const viewport = frameOf(table).locator('[data-grid-viewport]');
  await viewport.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await expect(table.getByRole('columnheader').last()).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath(`${label}-right.png`) });
  await viewport.evaluate(node => { node.scrollLeft = 0; });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440, 1920]) {
    test(`observatory grids preserve counter evidence at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const diagnostics = monitorPage(page);
      const mocks = await setup(page, theme);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const panel = page.getByTestId('fsd-observatory');
      const journal = panel.getByRole('table', { name: 'Stitched journal', exact: true });
      const commute = panel.getByRole('table', { name: 'Commute stories', exact: true });
      await expect(journal).toBeVisible();
      await expect(journal.locator('caption')).toHaveText('Stitched journal');
      await expect(commute.locator('caption')).toHaveText('Commute stories');
      await expect(journal.getByRole('columnheader')).toHaveText([
        'Date / time', 'Route', 'Reported FSD', 'Evidence', 'Firmware', 'Notes',
      ]);
      await expect(commute.getByRole('columnheader')).toHaveText([
        'Route', 'Route drives', 'Firmware', 'Chapter drives', 'Reported FSD',
        'FSD share', 'Unknown drives', 'Ambiguous drives', 'Counter resets',
      ]);
      const rows = journal.locator('tbody tr');
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0).getByTestId('fsd-observatory-drive-fsd')).toHaveText('0.00 km');
      await expect(rows.nth(1).getByTestId('fsd-observatory-drive-fsd')).toHaveText('~1.61 km');
      await expect(rows.nth(2)).toContainText('Ambiguous');
      await expect(rows.nth(2).getByTestId('fsd-observatory-drive-fsd')).toHaveText('~1.61 km');
      await expect(rows.nth(3)).toContainText('Not measured');
      await expect(rows.nth(3)).toContainText('Unknown firmware');
      await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', '/drives/9000');
      await expect(rows.nth(0).getByRole('link')).toHaveText('Aug 26, 2026, 03:15 PM');
      const reset = rows.nth(4);
      await expect(reset.getByRole('cell').nth(2)).toHaveText('—');
      await expect(reset.getByTestId('fsd-observatory-reset')).toHaveText(
        'Break in the stitch — not travelled FSD (SelfDrivingMilesSinceReset).');
      await expect(reset).not.toContainText('999');
      const chapters = commute.locator('tbody tr');
      await expect(chapters).toHaveCount(4);
      await expect(chapters.nth(0).getByRole('cell')).toHaveText([
        'Home → Office', '12', '2026.26.1', '3', '0.00 km', '0.00%', '0', '1', '0',
      ]);
      await expect(chapters.nth(1).getByRole('cell')).toHaveText([
        'Home → Office', '12', '2026.30.2', '9', '1.61 km', '50.25%', '2', '2', '1',
      ]);
      await expect(chapters.nth(2).getByRole('cell')).toHaveText([
        'Unknown chapter', '7', 'Unknown firmware', '9', 'Not measured', '—', '2', '2', '1',
      ]);
      await expect(chapters.nth(3).getByRole('cell')).toHaveText([
        'Empty chapters', '1,234', 'Unknown firmware', '—', 'Not measured', '—', '—', '—', '—',
      ]);
      await expect(panel.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(2);
      for (const table of [journal, commute]) {
        await expectEmbeddedGridFooter(table);
        await expectLocalScroll(table, width);
      }
      await expectNoHorizontalOverflow(page);
      await captureGrid(page, journal, `journal-${width}-${theme}`);
      await captureGrid(page, commute, `commute-${width}-${theme}`);
      const journalFrame = frameOf(journal);
      const columnsButton = journalFrame.getByRole('button', { name: 'Reorder or hide columns' });
      await columnsButton.focus();
      await page.keyboard.press('Enter');
      await expect(columnsButton).toHaveAttribute('aria-expanded', 'true');
      const menu = journalFrame.getByRole('menu', { name: 'Reorder or hide columns' });
      const firmwareToggle = menu.getByRole('checkbox', { name: 'Show or hide Firmware', exact: true });
      await firmwareToggle.focus();
      await page.keyboard.press('Space');
      await expect(firmwareToggle).not.toBeChecked();
      await expect(journal.getByRole('columnheader', { name: 'Firmware', exact: true })).toHaveCount(0);
      await firmwareToggle.locator('xpath=ancestor::label').click();
      await expect(firmwareToggle).toBeChecked();
      await menu.getByRole('button', { name: 'Move Firmware up', exact: true }).click();
      await expect(journal.getByRole('columnheader').nth(3)).toHaveText('Firmware');
      await menu.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(columnsButton).toHaveAttribute('aria-expanded', 'false');
      await expect(journal.getByRole('columnheader').nth(4)).toHaveText('Firmware');
      const driveLink = journal.getByRole('link', { name: 'Aug 26, 2026, 03:15 PM' });
      await expect(driveLink).toBeVisible();
      await driveLink.focus();
      await expect(driveLink).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(journal.locator('a[href="/drives/9001"]')).toBeFocused();
      const search = journalFrame.getByPlaceholder('Search loaded rows', { exact: true });
      await search.fill('Journal route 4');
      await expect(journal.locator('tbody tr')).toHaveCount(1);
      await expect(journal.locator('tbody tr')).toContainText('Unknown');
      await search.fill('');
      await expect(journal.locator('tbody tr')).toHaveCount(5);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });
  }
}

test('integrated pagination counts 52 firmware chapters instead of 26 routes', async ({ page }) => {
  const mocks = await setup(page, 'dark', 'paging');
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const panel = page.getByTestId('fsd-observatory');
  const commute = panel.getByRole('table', { name: 'Commute stories', exact: true });
  const frame = frameOf(commute);
  await expect(commute.locator('tbody tr')).toHaveCount(25);
  await expect(frame.getByRole('navigation')).toContainText('Showing 1–25 of 52');
  await frame.getByRole('button', { name: 'Next page', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(commute.locator('tbody tr')).toHaveCount(25);
  await expect(frame.getByRole('navigation')).toContainText('Showing 26–50 of 52');
  await frame.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(commute.locator('tbody tr')).toHaveCount(2);
  await expect(commute.locator('tbody tr').first()).toContainText('Commute route 26');
  await frame.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
  await expect(commute.locator('tbody tr')).toHaveCount(50);
  await expect(frame.getByRole('navigation')).toContainText('Showing 1–50 of 52');
  await frame.getByRole('combobox', { name: 'Rows per page' }).selectOption('100');
  await expect(commute.locator('tbody tr')).toHaveCount(52);
  await expect(frame.getByRole('navigation')).toContainText('Showing 1–52 of 52');
  const journal = panel.getByRole('table', { name: 'Stitched journal', exact: true });
  const journalFrame = frameOf(journal);
  await expect(journal.locator('tbody tr')).toHaveCount(25);
  await expect(journalFrame.getByRole('navigation')).toContainText('Showing 1–25 of 53');
  await journalFrame.getByRole('combobox', { name: 'Rows per page' }).selectOption('100');
  await expect(journal.locator('tbody tr')).toHaveCount(53);
  await expect(journal.getByTestId('fsd-observatory-reset')).toContainText('not travelled FSD');
  await expect(panel.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(2);
  await expectEmbeddedGridFooter(commute);
  await expectEmbeddedGridFooter(journal);
  await expectNoHorizontalOverflow(page);
  await panel.screenshot({ path: test.info().outputPath('observatory-52-chapters.png') });
  await assertMockApiComplete(page, mocks);
});

async function checkEmpty(page: Page, theme: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: 900 });
  const mocks = await setup(page, theme, 'empty');
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const panel = page.getByTestId('fsd-observatory');
  await expect(panel.getByRole('heading', { name: 'Stitched journal', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Commute stories', exact: true })).toBeVisible();
  await expect(panel).toContainText('No completed drives in this period to journal.');
  await expect(panel).toContainText('Not enough repeated routes yet for a commute story.');
  await expect(panel.getByRole('table')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await panel.getByRole('heading', { name: 'Commute stories', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`observatory-empty-${width}-${theme}.png`) });
  await assertMockApiComplete(page, mocks);
}

test('empty observatory retains journal and commute headings with honest absence', async ({ page }) => {
  await checkEmpty(page, 'light', 1440);
});

test('distance and numeric preferences convert only display values', async ({ page }) => {
  const mocks = await setup(page, 'light');
  await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, {
    json: { ...mockAppSettings, mode: 'light', unit_of_length: 'mi', locale: 'de-DE', decimal_precision: 1 },
  }));
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const panel = page.getByTestId('fsd-observatory');
  const journal = panel.getByRole('table', { name: 'Stitched journal', exact: true });
  await expect(journal.getByTestId('fsd-observatory-drive-fsd').nth(0)).toHaveText('0,0 mi');
  await expect(journal.getByTestId('fsd-observatory-drive-fsd').nth(1)).toHaveText('~1,0 mi');
  const commute = panel.getByRole('table', { name: 'Commute stories', exact: true });
  await expect(commute.locator('tbody tr').nth(1).getByRole('cell').nth(5)).toHaveText('50,3%');
  await expect(commute.locator('tbody tr').nth(3).getByRole('cell').nth(1)).toHaveText('1.234');
  await panel.screenshot({ path: test.info().outputPath('observatory-display-preferences.png') });
  await assertMockApiComplete(page, mocks);
});

async function checkLoading(page: Page, theme: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: 900 });
  const mocks = await setup(page, theme);
  let release: () => void = () => { throw new Error('Loading gate was not initialized'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/analytics/fsd?*', async route => {
    await gate;
    await fulfillApiFixture(route, mocks, { json: fsdObservatoryGridFixture() });
  });
  await page.goto(path);
  const panel = page.getByTestId('fsd-observatory');
  try {
    await expect(panel.getByRole('heading', { name: 'FSD observatory', exact: true })).toBeVisible();
    await expect(panel.getByRole('status', { name: 'Loading supervised self-driving telemetry' })).toBeVisible();
    await expect(panel.getByRole('table')).toHaveCount(0);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`observatory-loading-${width}-${theme}.png`) });
  } finally {
    release();
  }
  await waitForHarnessReady(page, mocks);
  await expect(panel.getByRole('table')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
}

test('loading observatory keeps its shell and replaces skeleton with both grids', async ({ page }) => {
  await checkLoading(page, 'dark', 1440);
});

async function checkInitialError(page: Page, theme: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: 900 });
  const mocks = await setup(page, theme);
  let failing = true;
  await page.route('**/api/v1/analytics/fsd?*', route => fulfillApiFixture(route, mocks, failing
    ? { status: 400, json: { error: 'Synthetic invalid observatory request' } }
    : { json: fsdObservatoryGridFixture() }));
  await page.goto(path);
  const panel = page.getByTestId('fsd-observatory');
  await expect(panel.getByRole('heading', { name: 'FSD observatory', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(panel.getByRole('table')).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`observatory-initial-error-${width}-${theme}.png`) });
  await expectNoHorizontalOverflow(page);
  failing = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).focus();
  await page.keyboard.press('Enter');
  await waitForHarnessReady(page, mocks);
  await expect(panel.getByRole('table')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
}

test('initial error preserves observatory shell and retry restores both grids', async ({ page }) => {
  await checkInitialError(page, 'light', 1440);
});

async function checkRetainedStale(page: Page, theme: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: 900 });
  const mocks = await setup(page, theme);
  let failing = false;
  await page.route('**/api/v1/analytics/fsd?*', route => fulfillApiFixture(route, mocks, failing
    ? { status: 400, json: { error: 'Synthetic invalid observatory refresh' } }
    : { json: fsdObservatoryGridFixture() }));
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const panel = page.getByTestId('fsd-observatory');
  await expect(panel.getByRole('table')).toHaveCount(2);
  failing = true;
  await page.getByRole('button', { name: /Refresh data/ }).click();
  await expect(page.getByTestId('stale-refresh-warning')).toBeVisible();
  await expect(panel.getByRole('table', { name: 'Stitched journal', exact: true }).locator('tbody tr')).toHaveCount(5);
  await expect(panel.getByRole('table', { name: 'Commute stories', exact: true }).locator('tbody tr')).toHaveCount(4);
  await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  const warning = page.getByTestId('stale-refresh-warning');
  await warning.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`observatory-retained-stale-${width}-${theme}.png`) });
  await captureGrid(page, panel.getByRole('table', { name: 'Stitched journal', exact: true }), `journal-stale-${width}-${theme}`);
  await captureGrid(page, panel.getByRole('table', { name: 'Commute stories', exact: true }), `commute-stale-${width}-${theme}`);
  await expectNoHorizontalOverflow(page);
  failing = false;
  await page.getByTestId('stale-refresh-warning').getByRole('button', { name: 'Refresh', exact: true }).click();
  await waitForHarnessReady(page, mocks);
  await expect(page.getByTestId('stale-refresh-warning')).toHaveCount(0);
  await assertMockApiComplete(page, mocks);
}

test('failed background refresh retains journal and chapter rows with stale warning', async ({ page }) => {
  await checkRetainedStale(page, 'dark', 1440);
});

test('journal honors user date locale and display timezone instead of browser defaults', async ({ page }) => {
  const mocks = await setup(page, 'light');
  await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, {
    json: {
      ...mockAppSettings, mode: 'light', locale: 'de-DE',
      tz_display_default: 'user', timezone_user: 'America/Los_Angeles', time_format_default: 'absolute',
    },
  }));
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const panel = page.getByTestId('fsd-observatory');
  const firstDate = panel.getByRole('table', { name: 'Stitched journal', exact: true })
    .locator('tbody tr').first().getByRole('link');
  await panel.screenshot({ path: test.info().outputPath('observatory-user-date-preferences.png') });
  const expected = await page.evaluate(() => new Date('2026-08-26T15:15:00Z').toLocaleString('de-DE', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }));
  await expect(firstDate).toHaveText(expected);
  await expect(firstDate).toHaveAttribute('href', '/drives/9000');
  await page.reload();
  await waitForHarnessReady(page, mocks);
  await expect(firstDate).toHaveText(expected);
  await expect(firstDate).toHaveAttribute('href', '/drives/9000');
  await assertMockApiComplete(page, mocks);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    const states = [
      { name: 'loading', baseline: 'dark', run: checkLoading },
      { name: 'initial-error', baseline: 'light', run: checkInitialError },
      { name: 'retained-stale', baseline: 'dark', run: checkRetainedStale },
      { name: 'empty', baseline: 'light', run: checkEmpty },
    ] as const;
    for (const state of states) {
      if (width === 1440 && theme === state.baseline) continue;
      test(`observatory ${state.name} state at ${width}px ${theme}`, async ({ page }) => {
        await state.run(page, theme, width);
      });
    }
  }
}
