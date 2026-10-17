import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  mockAppSettings, seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import { observedAt } from './vehicle-systems.fixtures';
import {
  expectedDelta, matchedClimate, matchedDepartures, matchedExpected,
  preconditioningPath, supportedBandIds, type TemperaturePreference,
} from './vehicle-systems-preconditioning.supported.fixtures';

function metric(brief: Locator, id: string) {
  return brief.locator(`[data-operational-metric="${id}"]`);
}

async function reading(brief: Locator, id: string, value: string, state = 'value') {
  const item = metric(brief, id);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

function checkRequest(route: Route, params: Record<string, string>) {
  expect(route.request().method()).toBe('GET');
  const url = new URL(route.request().url());
  expect([...url.searchParams.keys()].sort()).toEqual(Object.keys(params).sort());
  expect(Object.fromEntries(url.searchParams)).toEqual(params);
}

async function setup(
  page: Page, theme: 'light' | 'dark', width: number, temperature: TemperaturePreference,
) {
  expect(ROUTE_REGISTRY.some(route => route.path === '/preconditioning-effectiveness')).toBe(true);
  await page.setViewportSize({ width, height: 1000 });
  await page.clock.setFixedTime(new Date(observedAt));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, theme, preconditioningPath);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Supported preconditioning contracts require E2E_MOCKS enabled');
  await page.route(url => url.pathname === '/api/v1/settings', async route => {
    checkRequest(route, {});
    await fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, unit_of_temp: temperature },
    });
  });
  let climateReads = 0;
  await page.route(url => url.pathname === '/api/v1/climate', async route => {
    checkRequest(route, { vehicle_id: '7' });
    climateReads += 1;
    await fulfillApiFixture(route, mocks, { json: matchedClimate });
  });
  return { mocks, climateReads: () => climateReads };
}

async function review(page: Page, brief: Locator) {
  await brief.scrollIntoViewIfNeeded();
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  await expect(brief.locator('xpath=..')).toHaveAttribute('data-source-period-kind', 'unknown');
  await expect(brief).toContainText('Not a live-state observation');
  const rows = brief.locator('[data-operational-metric]');
  const retained = await rows.evaluateAll(nodes => nodes.map(node => ({
    label: node.firstElementChild?.firstElementChild?.textContent?.trim() ?? '',
    value: node.querySelector('[data-operational-value]')?.textContent?.trim() ?? '',
    detail: node.lastElementChild?.textContent?.trim() ?? '',
  })));
  const description = (await brief.locator('p').first().textContent())?.trim() ?? '';
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toHaveCount(1);
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer).toHaveAccessibleName(/ details$/);
  expect(description).not.toBe('');
  await expect(drawer).toHaveAccessibleDescription(description);
  await expect(drawer.getByText('Operational metrics', { exact: true })).toBeVisible();
  for (const row of retained) {
    expect(row.label).not.toBe('');
    expect(row.value).not.toBe('');
    await expect(drawer.getByText(row.label, { exact: true }).first()).toBeAttached();
    await expect(drawer.getByText(row.value, { exact: true }).first()).toBeAttached();
    if (row.detail) await expect(drawer.getByText(row.detail, { exact: true }).first()).toBeAttached();
  }
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function climateResolved(page: Page) {
  const climate = page.getByTestId('preconditioning-climate-source-summary');
  await expect(climate).toContainText('Returned evidence');
  for (const id of ['returned', 'unique', 'thermal', 'known-hvac']) {
    await reading(climate, id, '6');
  }
  const disposition = page.getByTestId('preconditioning-climate-disposition-summary');
  for (const [index, value] of ['0', '0', '0', '0', '0', '0', '0', '4', '2'].entries()) {
    await reading(disposition, `outcome-${index}`, value);
  }
  await expect(page.getByTestId('preconditioning-climate-disposition'))
    .toContainText('6 timestamp-valid rows become 6 unique timestamps plus 0 duplicates.');
}

async function comparisonCards(
  section: Locator, temperature: TemperaturePreference, kind: 'readiness' | 'improvement',
) {
  const active = kind === 'readiness' ? 3 : 13;
  const control = kind === 'readiness' ? 14 : 1;
  const difference = kind === 'readiness' ? 11 : 12;
  await expect(section.locator('article')).toHaveCount(3);
  for (const label of ['Common-support pooled strata', 'Cold-start stratum']) {
    const card = section.locator('article').filter({ has: section.page().getByText(label, { exact: true }) });
    await expect(card).toContainText('1 active · 1 explicit-off control');
    for (const value of [
      expectedDelta(active, temperature), expectedDelta(control, temperature),
      expectedDelta(difference, temperature, true), '2.08%',
      'Low-confidence observational support',
    ]) await expect(card.getByText(value, { exact: true }).first()).toBeVisible();
  }
  const hot = section.locator('article')
    .filter({ has: section.page().getByText('Hot-start stratum', { exact: true }) });
  await expect(hot).toContainText('1 active · 0 explicit-off control');
  await expect(hot).toContainText('Insufficient support for comparison');
  await expect(hot.getByText('—', { exact: true })).toHaveCount(4);
  await section.scrollIntoViewIfNeeded();
  const chart = section.locator(`[data-chart-key="preconditioning-effectiveness-${kind}"]`);
  await expect(chart).toHaveAttribute('data-chart-state', 'ready');
  await expect(section.locator('.recharts-surface').first()).toBeVisible();
  // Overall and cold each have two real bars; hot has no published operands.
  await expect(section.locator('.recharts-bar-rectangle .recharts-rectangle')).toHaveCount(4);
  const chartRows = chart.locator('table tbody tr');
  await expect(chartRows).toHaveCount(3);
  for (const [index, label] of [
    'Common-support pooled strata', 'Hot-start stratum', 'Cold-start stratum',
  ].entries()) {
    const cells = await chartRows.nth(index).locator('td').allTextContents();
    expect(cells[0]).toBe(label);
    if (index === 1) {
      expect(cells.slice(1)).toEqual(['—', '—']);
    } else {
      expect(Number(cells[1])).toBeCloseTo(temperature === 'F' ? active * 9 / 5 : active, 10);
      expect(Number(cells[2])).toBeCloseTo(temperature === 'F' ? control * 9 / 5 : control, 10);
    }
  }
}

async function matchedEvidence(page: Page, temperature: TemperaturePreference) {
  await climateResolved(page);
  for (const id of supportedBandIds) {
    await expect(page.getByTestId(id)).toHaveAttribute('data-operational-brief', 'true');
  }
  const brief = page.getByTestId('preconditioning-evidence');
  await reading(brief, 'classified-departures', '3');
  await reading(brief, 'hvac-active-share', '66.67%');
  await reading(brief, 'hvac-off-control', '1');
  await reading(brief, 'readiness-difference', expectedDelta(matchedExpected.readinessDifferenceC, temperature, true));
  await reading(brief, 'improvement-difference', expectedDelta(matchedExpected.improvementDifferenceC, temperature, true));
  await reading(brief, 'comparison-confidence', '2.08%');
  await expect(metric(brief, 'classified-departures')).toContainText('3 of 3 unique valid drives');
  await expect(metric(brief, 'hvac-active-share')).toContainText('2 classified departures');
  const drives = page.getByTestId('preconditioning-drive-source-summary');
  for (const id of ['returned', 'valid', 'overlap']) await reading(drives, id, '3');
  await reading(drives, 'span', '2.00 h');
  const dispositions = page.getByTestId('preconditioning-departure-disposition-summary');
  for (const id of ['outside', 'empty', 'samples', 'span', 'stale', 'target', 'band', 'unknown']) {
    await reading(dispositions, id, '0');
  }
  await reading(dispositions, 'active', '2');
  await reading(dispositions, 'control', '1');
  const availability = page.getByTestId('preconditioning-availability-summary');
  for (const [id, value] of [
    ['climate', '6'], ['drives', '3'], ['timestamps', '6'], ['overlap', '3'],
    ['window', '3'], ['thermal', '3'], ['classified', '3'], ['active', '2'], ['control', '1'],
  ]) await reading(availability, id, value);
  const join = page.getByTestId('preconditioning-join-summary');
  for (const [index, value] of ['3', '3', '3', '6', '6', '0', '2', '2', '0.42 h', '0.08 h', '0.08 h'].entries()) {
    await reading(join, `join-${index}`, value);
  }
  await expect(page.getByTestId('preconditioning-join-support'))
    .toContainText('No climate-row reuse is observed in the returned windows');
  const confidence = page.getByTestId('preconditioning-confidence-summary');
  for (const [index, value] of ['1', '2', '16.67%', '12.50%', '2.08%'].entries()) {
    await reading(confidence, `confidence-${index}`, value);
  }
  await expect(page.getByTestId('preconditioning-threshold-confidence'))
    .toContainText('Confidence is descriptive support, not statistical significance');
  const strata = page.getByTestId('preconditioning-strata');
  await expect(strata.locator('article')).toHaveCount(2);
  const cold = strata.locator('article').filter({ has: page.getByText('Cold-start stratum', { exact: true }) });
  await expect(cold.getByText('1', { exact: true })).toHaveCount(2);
  await expect(cold).toContainText(expectedDelta(11, temperature, true));
  await expect(cold).toContainText(expectedDelta(12, temperature, true));
  const hot = strata.locator('article').filter({ has: page.getByText('Hot-start stratum', { exact: true }) });
  await expect(hot.getByText('1', { exact: true })).toHaveCount(1);
  await expect(hot.getByText('0', { exact: true })).toHaveCount(1);
  await expect(hot.getByText('—', { exact: true })).toHaveCount(2);
  await expect(hot).toContainText('both observational groups are required in this stratum');
  const directory = page.getByTestId('preconditioning-departure-directory');
  await expect(directory).toContainText('Showing 3 of 3 departures; 0 omitted by the 80-departure model cap.');
  await expect(directory.locator('ol > li')).toHaveCount(3);
  for (const [index, group] of ['Explicit-off control', 'HVAC-active', 'HVAC-active'].entries()) {
    const row = directory.locator('ol > li').nth(index);
    await expect(row.getByText(group, { exact: true })).toBeAttached();
    await expect(row.getByText('0.42 h', { exact: true })).toBeAttached();
    await expect(row.getByText('0.08 h', { exact: true })).toBeAttached();
  }
  await comparisonCards(page.getByTestId('preconditioning-readiness-comparison'), temperature, 'readiness');
  await comparisonCards(page.getByTestId('preconditioning-improvement-comparison'), temperature, 'improvement');
  const hourly = page.locator('[data-chart-key="preconditioning-effectiveness-hourly"]');
  await expect(hourly).toHaveAttribute('data-chart-state', 'ready');
  await expect(hourly.locator('.recharts-surface')).toBeVisible();
  await expect(hourly.locator('table tbody tr')).toHaveCount(24);
  const occupiedHours = await hourly.locator('table tbody tr').evaluateAll(rows =>
    rows.map(row => Array.from(row.querySelectorAll('td'), cell => cell.textContent?.trim() ?? ''))
      .filter(cells => Number(cells[1]) + Number(cells[2]) > 0));
  expect(occupiedHours).toHaveLength(3);
  expect(occupiedHours.reduce((sum, cells) => sum + Number(cells[1]), 0)).toBe(2);
  expect(occupiedHours.reduce((sum, cells) => sum + Number(cells[2]), 0)).toBe(1);
  expect(occupiedHours.map(cells => cells[3]).sort()).toEqual(
    [3, 3, 14].map(value => expectedDelta(value, temperature)).sort(),
  );
  expect(occupiedHours.map(cells => cells[4]).sort()).toEqual(
    [11, 13, 1].map(value => expectedDelta(value, temperature, true)).sort(),
  );
  const distribution = page.locator('[data-chart-key="preconditioning-effectiveness-distribution"]');
  await expect(distribution).toHaveAttribute('data-chart-state', 'ready');
  await expect(distribution.locator('.recharts-surface')).toBeVisible();
  await expect(distribution.locator('table tbody tr')).toHaveCount(5);
  const bins = await distribution.locator('table tbody tr').evaluateAll(rows =>
    rows.map(row => Array.from(row.querySelectorAll('td'), cell => cell.textContent?.trim() ?? '')));
  expect(bins.map(cells => cells.slice(1))).toEqual([
    ['0', '0', '0'], ['0', '1', '1'], ['0', '0', '0'], ['0', '0', '0'], ['2', '0', '2'],
  ]);
  expect(bins[0]?.[0]).toBe(`Below ${expectedDelta(0, temperature)}`);
  expect(bins[4]?.[0]).toBe(`At least ${expectedDelta(10, temperature)}`);
}

function fulfilledCount(mocks: MockApiController, path: string) {
  return mocks.requests.filter(request => request.path === path && request.disposition === 'fulfilled').length;
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440] as const) {
    for (const temperature of ['C', 'F'] as const) {
      test(`preconditioning publishes only cold matched support and preserves real charts Review Refresh ${width} ${theme} ${temperature}`, async ({ page }) => {
        const { mocks, climateReads } = await setup(page, theme, width, temperature);
        let driveReads = 0;
        await page.route(url => url.pathname === '/api/v1/drives', async route => {
          checkRequest(route, { vehicle_id: '7', limit: '1000' });
          driveReads += 1;
          await fulfillApiFixture(route, mocks, { json: matchedDepartures });
        });
        const diagnostics = monitorPage(page);
        await page.goto(preconditioningPath);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        await matchedEvidence(page, temperature);
        await review(page, page.getByTestId('preconditioning-evidence'));
        await review(page, page.getByTestId('preconditioning-confidence-summary'));
        const before = { climate: climateReads(), drives: driveReads };
        await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
        await expect.poll(climateReads).toBeGreaterThan(before.climate);
        await expect.poll(() => driveReads).toBeGreaterThan(before.drives);
        await waitForHarnessReady(page, mocks);
        await matchedEvidence(page, temperature);
        expect(fulfilledCount(mocks, '/api/v1/climate')).toBeGreaterThanOrEqual(2);
        expect(fulfilledCount(mocks, '/api/v1/drives')).toBeGreaterThanOrEqual(2);
        await assertMockApiComplete(page, mocks);
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
      });

      test(`preconditioning resolved climate survives independent held failed drives and real source Retry ${width} ${theme} ${temperature}`, async ({ page }) => {
        const { mocks, climateReads } = await setup(page, theme, width, temperature);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let failDrives = true;
        let driveReads = 0;
        await page.route(url => url.pathname === '/api/v1/drives', async route => {
          checkRequest(route, { vehicle_id: '7', limit: '1000' });
          driveReads += 1;
          await held;
          await fulfillApiFixture(route, mocks, failDrives
            ? { status: 400, json: { error: 'Synthetic drive-history source unavailable' } }
            : { json: matchedDepartures });
        });
        const diagnostics = monitorPage(page);
        try {
          await page.goto(preconditioningPath);
          // Intentionally do not invoke the settled harness helper during a held request.
          await expect.poll(() => driveReads).toBeGreaterThan(0);
          await climateResolved(page);
          await expect(page.getByTestId('preconditioning-drive-source-summary')).toContainText('Loading source');
          expect(mocks.requests.some(request => request.path === '/api/v1/drives'
            && request.disposition === 'pending')).toBe(true);
          const brief = page.getByTestId('preconditioning-evidence');
          for (const id of ['readiness-difference', 'improvement-difference']) {
            await expect(metric(brief, id)).toHaveAttribute('data-value-state', 'missing');
            await expect(metric(brief, id).locator('[data-operational-value]')).toHaveCount(0);
          }
          for (const id of ['preconditioning-readiness-comparison', 'preconditioning-improvement-comparison', 'preconditioning-strata']) {
            await expect(page.getByTestId(id)).toBeAttached();
            await expect(page.getByTestId(id).locator('.recharts-surface')).toHaveCount(0);
          }
          await review(page, page.getByTestId('preconditioning-climate-source-summary'));
          release();
          const errors = page.getByTestId('preconditioning-initial-errors');
          await expect(errors).toContainText('Drive-history query failed');
          await expect(errors).not.toContainText('Climate-history query failed');
          await expect(page.getByTestId('preconditioning-source-coverage')).toContainText('Unavailable');
          await climateResolved(page);
          await reading(page.getByTestId('preconditioning-drive-source-summary'), 'returned', '—', 'missing');
          for (const id of ['readiness-difference', 'improvement-difference']) {
            await reading(brief, id, '—', 'missing');
          }
          for (const id of ['preconditioning-readiness-comparison', 'preconditioning-improvement-comparison']) {
            await expect(page.getByTestId(id)).toContainText('A required source is unavailable');
          }
          const before = { climate: climateReads(), drives: driveReads };
          failDrives = false;
          await errors.getByRole('button', { name: 'Retry', exact: true }).click();
          await expect.poll(() => driveReads).toBeGreaterThan(before.drives);
          await waitForHarnessReady(page, mocks);
          await expect(errors).toHaveCount(0);
          expect(climateReads(), 'source Retry must not refetch resolved climate').toBe(before.climate);
          await expectThemeApplied(page, theme);
          await matchedEvidence(page, temperature);
          await review(page, brief);
          await assertMockApiComplete(page, mocks);
          await expectNoHorizontalOverflow(page);
          expect(diagnostics.pageErrors).toEqual([]);
          expect(diagnostics.brokenResources).toEqual([]);
          expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
          for (const failure of diagnostics.failedDataRequests) {
            expect(failure).toMatch(/^400 (fetch|xhr) .*\/api\/v1\/drives\?vehicle_id=7&limit=1000$/);
          }
          for (const message of diagnostics.consoleErrors) {
            expect(message).toMatch(/^Failed to load resource: the server responded with a status of 400/);
          }
        } finally {
          release();
        }
      });
    }
  }
}
