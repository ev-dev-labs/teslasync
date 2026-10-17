import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks, mockAppSettings,
  seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage, type PageDiagnostics,
} from '../qualityAssertions';
import {
  day, dayBounds, dayFixture, recordedDisplays, twinFixture, vehicle,
  type DayReading, type DistancePreference, type TwinReading,
} from './vehicles.fixtures';

type Mocks = Awaited<ReturnType<typeof installApiMocks>>;

function metric(brief: Locator, key: string): Locator {
  return brief.locator(`[data-operational-metric="${key}"]`);
}

async function expectValue(brief: Locator, key: string, value: string, state = 'value') {
  const item = metric(brief, key);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function installVehicleScope(
  page: Page, mocks: Mocks, theme: 'light' | 'dark', preference: DistancePreference = 'km',
) {
  await page.route('**/api/v1/vehicles', (route) => {
    expect(route.request().method()).toBe('GET');
    return fulfillApiFixture(route, mocks, { json: [vehicle] });
  });
  await page.route('**/api/v1/settings', (route) => {
    expect(route.request().method()).toBe('GET');
    return fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, mode: theme, unit_of_length: preference, decimal_precision: 2, locale: 'en-US' },
    });
  });
}

async function reviewDrawer(page: Page, brief: Locator, title: string, source: RegExp) {
  const valuesBefore = await brief.locator('[data-operational-value]').allTextContents();
  const detailsBefore = await brief.locator('[data-operational-metric]').evaluateAll((items) =>
    items.map((item) => item.lastElementChild?.textContent ?? ''));
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Vehicle contract requires a configured viewport');
  const cells = await brief.locator('[data-operational-metric]').evaluateAll((items) => items.map((item) => {
    const bounds = item.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, clientWidth: item.clientWidth, scrollWidth: item.scrollWidth };
  }));
  expect(cells).toHaveLength(6);
  for (const cell of cells) {
    expect(cell.clientWidth).toBeGreaterThan(0);
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
    expect(cell.left).toBeGreaterThanOrEqual(-1);
    expect(cell.right).toBeLessThanOrEqual(viewport.width + 1);
  }
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  await expect(drawer.getByText(source)).toHaveCount(1);
  await expect(drawer.getByText('Not scored', { exact: true })).toBeVisible();
  await expect(drawer.getByText('No current attention items.', { exact: true })).toBeVisible();
  for (const value of new Set(valuesBefore)) {
    await expect(drawer.getByText(value, { exact: true }).first()).toBeVisible();
  }
  for (const detail of detailsBefore) {
    expect(detail.length).toBeGreaterThan(0);
    await expect(drawer).toContainText(detail);
  }
  if (title === 'Day summary') {
    await expect(drawer.getByTestId('calculation-details')).toContainText(dayBounds);
    await expect(drawer.getByTestId('calculation-details')).toContainText(`${day} · UTC`);
  } else {
    await expect(drawer.getByTestId('calculation-details')).toContainText('Signal timestamp unknown');
  }
  const close = drawer.getByRole('button', { name: 'Close', exact: true });
  await expect(close.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close.first()).toBeFocused();
  await expectDialogsInsideViewport(page);
  const panel = drawer.locator('[data-drawer-panel]');
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(valuesBefore);
}

function expectSourceLedger(mocks: Mocks, paths: readonly string[]) {
  if (!mocks) throw new Error('Synthetic vehicle contracts require the strict mock harness');
  for (const path of paths) {
    const requests = mocks.requests.filter((request) => request.path === path);
    expect(requests.length, `source endpoint ${path} was never read`).toBeGreaterThan(0);
    expect(requests.every((request) => request.disposition === 'fulfilled'), path).toBe(true);
  }
}

function expectPlannedSourceFailures(diagnostics: PageDiagnostics, paths: readonly string[]) {
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.brokenResources).toEqual([]);
  expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
  for (const request of diagnostics.failedDataRequests) {
    expect(request).toMatch(/^503 fetch /);
    expect(paths).toContain(new URL(request.replace(/^503 fetch /, '')).pathname);
  }
  for (const message of diagnostics.consoleErrors) {
    expect(message).toMatch(/^Failed to load resource: the server responded with a status of 503 \([^)]+\)$/);
  }
}

async function fulfillDay(
  route: Route, mocks: Mocks, reading: DayReading, fail: boolean, gate?: Promise<void>,
) {
  const url = new URL(route.request().url());
  expect(route.request().method()).toBe('GET');
  expect(url.searchParams.get('vehicle_id')).toBe('7');
  expect(url.searchParams.get('timezone')).toBe('UTC');
  expect(url.searchParams.get('limit')).toBe('2000');
  expect(url.searchParams.has('layers')).toBe(false);
  expect(url.searchParams.has('vehicleId')).toBe(false);
  const selectedDay = url.searchParams.get('date');
  expect(selectedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (gate) await gate;
  await fulfillApiFixture(route, mocks, fail
    ? { status: 503, json: { error: 'Synthetic recorded-history refresh failure' } }
    : { json: dayFixture(reading, selectedDay!) });
}

const twinPaths = ['/security/latest', '/vehicles/7/state', '/charging-telemetry/latest'] as const;

async function installTwinSources(
  page: Page, mocks: Mocks, reading: TwinReading,
  fail: () => boolean = () => false, gate?: Promise<void>,
) {
  const fixture = twinFixture(reading);
  const sources = [
    { path: twinPaths[0], json: fixture.security },
    { path: twinPaths[1], json: fixture.state },
    { path: twinPaths[2], json: fixture.charging },
  ];
  for (const source of sources) {
    await page.route((url) => url.pathname === `/api/v1${source.path}`, async (route) => {
      const url = new URL(route.request().url());
      expect(route.request().method()).toBe('GET');
      expect([...url.searchParams.keys()]).toEqual(source.path === '/vehicles/7/state' ? [] : ['vehicle_id']);
      if (source.path !== '/vehicles/7/state') expect(url.searchParams.get('vehicle_id')).toBe('7');
      if (gate) await gate;
      const stateUnavailable = source.path === '/vehicles/7/state' && fixture.state === null;
      await fulfillApiFixture(route, mocks, fail() || stateUnavailable
        ? { status: 503, json: { error: 'Synthetic physical-state refresh failure' } }
        : { json: source.json });
    });
  }
  return fixture;
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    const dayCases: { reading: DayReading; preference: DistancePreference }[] = [
      { reading: 'recorded', preference: 'km' }, { reading: 'recorded', preference: 'mi' },
      { reading: 'zero', preference: 'km' }, { reading: 'unknown', preference: 'km' },
    ];
    for (const { reading, preference } of dayCases) {
      test(`day ledger brief ${reading}/${preference}, ${width}px/${theme}`, async ({ page }) => {
        test.skip(process.env.E2E_MOCKS === '0', 'This case supplies typed synthetic day-ledger operands');
        const diagnostics = monitorPage(page);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/day-log');
        const mocks = await installApiMocks(page, 'populated', theme);
        await installVehicleScope(page, mocks, theme, preference);
        await page.route((url) => url.pathname === '/api/v1/day-log',
          (route) => fulfillDay(route, mocks, reading, false));
        await page.goto(`/day-log?date=${day}`);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByTestId('day-log-summary');
        await expect(brief).toHaveAttribute('data-operational-brief', 'true');
        await expect(brief.locator('[data-operational-metric]')).toHaveCount(6);
        await expect(brief.getByText(dayBounds, { exact: true })).toBeVisible();
        await expect(brief.getByText(`Selected vehicle day · ${day} · UTC`, { exact: true })).toBeVisible();
        const sources = page.getByRole('table', { name: 'Sources', exact: true });
        await expect(sources).toBeVisible();
        await expect(page.getByText(/Signal feeds record transitions only/)).toBeVisible();
        if (reading === 'recorded') {
          await expect(brief.getByText('Recorded day summary', { exact: true })).toBeVisible();
          for (const [key, value] of Object.entries(recordedDisplays[preference])) {
            await expectValue(brief, key, value);
          }
          const timeline = page.getByTestId('daylog-timeline');
          const drive = timeline.getByTestId('daylog-event-drive:101:start');
          await expect(drive.getByRole('link', { name: 'Drive started', exact: true }))
            .toHaveAttribute('href', '/drives/101');
          await drive.getByRole('button', { name: 'Show details', exact: true }).click();
          await expect(drive.getByText('drives', { exact: true })).toBeVisible();
          await expect(drive.getByText('2026-09-14T08:00:00Z', { exact: true })).toBeVisible();
          await expect(drive.getByText('drive:101:start', { exact: true })).toBeVisible();
          await drive.getByRole('button', { name: 'Hide details', exact: true }).click();
          const charge = timeline.getByTestId('daylog-event-charge:201:end');
          await charge.scrollIntoViewIfNeeded();
          await expect(charge.getByRole('link', { name: 'Charge ended', exact: true }))
            .toHaveAttribute('href', '/charging/201');
          await page.getByTestId('daylog-search').fill('locked');
          await expect(page.getByTestId('daylog-count')).toHaveText('Showing 1 of 4 events');
          for (const [key, value] of Object.entries(recordedDisplays[preference])) {
            await expectValue(brief, key, value);
          }
          await page.getByTestId('daylog-show-all').click();
          await expect(page.getByTestId('daylog-count')).toHaveText('4 events');
          await page.getByTestId('daylog-clear-all').click();
          await expect(page.getByTestId('daylog-count')).toHaveText('Showing 0 of 4 events');
          await expectValue(brief, 'distance', recordedDisplays[preference].distance);
          await page.getByTestId('daylog-show-all').click();
        } else {
          await expect(brief.getByText('Some sources unavailable', { exact: true })).toBeVisible();
          await expectValue(brief, 'drives', '0');
          await expectValue(brief, 'charges', '0');
          for (const [key, unit] of [
            ['drive-time', 'h'], ['distance', 'km'],
            ['energy-added', 'kWh'], ['energy-used', 'kWh'],
          ]) {
            await expectValue(brief, key, reading === 'zero' ? `0.00 ${unit}` : '—',
              reading === 'zero' ? 'value' : 'missing');
          }
          await expect(sources.getByText('Unavailable', { exact: true })).toBeVisible();
          await expect(sources.getByText('No signal or table records occupant presence', { exact: true })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Open drives', exact: true })).toHaveAttribute('href', '/drives');
          await expect(page.getByRole('link', { name: 'Open live telemetry', exact: true }))
            .toHaveAttribute('href', '/live-monitor?vehicle_id=7');
        }
        await reviewDrawer(page, brief, 'Day summary', /Recorded drives and charging sessions for the selected vehicle day/);
        const controls = page.locator('[data-role="page-header"]');
        await controls.getByTestId('daylog-prev').click();
        await expect(controls.getByTestId('daylog-date')).toHaveValue('2026-09-13');
        await expect(page).toHaveURL(/date=2026-09-13/);
        await expect(brief.getByText(/Selected vehicle day · 2026-09-13 · UTC/)).toBeVisible();
        await controls.getByTestId('daylog-next').click();
        await expect(controls.getByTestId('daylog-date')).toHaveValue(day);
        await expectNoHorizontalOverflow(page);
        expectSourceLedger(mocks, ['/api/v1/day-log']);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });
    }

    for (const reading of ['reported', 'mixed', 'unknown', 'charging'] as const) {
      test(`physical-state brief ${reading}, ${width}px/${theme}`, async ({ page }) => {
        test.skip(process.env.E2E_MOCKS === '0', 'This case supplies independent typed physical-state snapshots');
        const diagnostics = monitorPage(page);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/digital-twin');
        const mocks = await installApiMocks(page, 'populated', theme);
        await installVehicleScope(page, mocks, theme);
        await installTwinSources(page, mocks, reading);
        await page.goto('/digital-twin');
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByTestId('digital-twin-summary');
        await expect(brief).toHaveAttribute('data-operational-brief', 'true');
        await expect(brief.locator('[data-operational-metric]')).toHaveCount(6);
        await expect(brief.getByText('Aurora · Latest vehicle signals', { exact: true })).toBeVisible();
        await expect(brief.getByText(/Source snapshots may differ in time/)).toBeVisible();
        await expect(brief.getByText('Signal timestamp unknown', { exact: true })).toBeVisible();
        if (reading === 'unknown') {
          await expect(brief.getByText('Mixed source availability', { exact: true })).toBeVisible();
          for (const key of ['twin-lock', 'twin-doors', 'twin-windows', 'twin-sentry', 'twin-port']) {
            await expectValue(brief, key, '—', 'missing');
          }
          await expect(metric(brief, 'twin-status')).toContainText('offline is the fallback when no source reports activity');
          await expect(metric(brief, 'twin-doors')).toContainText('0 of 6 states known');
          await expect(metric(brief, 'twin-windows')).toContainText('0 of 4 states known');
        } else {
          await expectValue(brief, 'twin-lock', 'Unlocked');
          await expectValue(brief, 'twin-sentry', 'Inactive');
          await expectValue(brief, 'twin-status', reading === 'charging' ? 'Charging' : 'Online');
          await expectValue(brief, 'twin-doors', reading === 'reported' ? '1' : '0');
          await expect(metric(brief, 'twin-doors')).toContainText(reading === 'mixed' ? '1 of 6 states known' : '6 of 6 states known');
          await expectValue(brief, 'twin-windows', reading === 'mixed' ? '—' : '2',
            reading === 'mixed' ? 'missing' : 'value');
          await expect(metric(brief, 'twin-windows')).toContainText(reading === 'mixed' ? '0 of 4 states known' : '4 of 4 states known');
          await expectValue(brief, 'twin-port', reading === 'charging' ? 'Charging' : '—',
            reading === 'charging' ? 'value' : 'missing');
          await expect(brief.getByText(reading === 'mixed' ? 'Mixed source availability' : 'Source snapshots available', { exact: true })).toBeVisible();
        }
        await reviewDrawer(page, brief, 'Physical-state summary', /Security, vehicle-state and charging snapshots; retained values remain visible after a refresh failure/);
        for (const heading of ['Live overview', 'Component state', 'Doors & openings', 'Windows', 'Security & status', 'Lights & signals']) {
          await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        }
        const paint = page.getByRole('radiogroup', { name: 'Vehicle paint color', exact: true });
        await expect(paint).toBeVisible();
        const radio = paint.getByRole('radio').nth(1);
        await radio.click();
        await expect(radio).toHaveAttribute('aria-checked', 'true');
        await expectValue(brief, 'twin-doors', reading === 'unknown' ? '—' : reading === 'reported' ? '1' : '0',
          reading === 'unknown' ? 'missing' : 'value');
        await expectNoHorizontalOverflow(page);
        expectSourceLedger(mocks, twinPaths.map((path) => `/api/v1${path}`));
        await assertMockApiComplete(page, mocks);
        if (reading === 'mixed' || reading === 'unknown') {
          expectPlannedSourceFailures(diagnostics, ['/api/v1/vehicles/7/state']);
        } else {
          await expectNoRuntimeFailures(diagnostics);
        }
      });
    }

    for (const root of ['day-log', 'digital-twin'] as const) {
      test(`${root} retains published source values on refresh failure, ${width}px/${theme}`, async ({ page }) => {
        test.skip(process.env.E2E_MOCKS === '0', 'This case deliberately fails only the real refresh endpoints');
        const diagnostics = monitorPage(page);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, `/${root}`);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installVehicleScope(page, mocks, theme);
        let fail = false;
        if (root === 'day-log') {
          await page.route((url) => url.pathname === '/api/v1/day-log',
            (route) => fulfillDay(route, mocks, 'recorded', fail));
        } else {
          await installTwinSources(page, mocks, 'reported', () => fail);
        }
        await page.goto(root === 'day-log' ? `/day-log?date=${day}` : '/digital-twin');
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByTestId(root === 'day-log' ? 'day-log-summary' : 'digital-twin-summary');
        const values = await brief.locator('[data-operational-value]').allTextContents();
        expect(values).toHaveLength(6);
        fail = true;
        await page.locator('[data-role="page-header"]').getByRole('button', { name: /Refresh/ }).click();
        await expect(brief.getByText(root === 'day-log' ? 'Retained recorded history' : 'Retained source snapshots', { exact: true }))
          .toBeVisible({ timeout: 20000 });
        expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(values);
        await reviewDrawer(page, brief, root === 'day-log' ? 'Day summary' : 'Physical-state summary',
          root === 'day-log' ? /Recorded drives and charging sessions/ : /Security, vehicle-state and charging snapshots/);
        await expectNoHorizontalOverflow(page);
        expectSourceLedger(mocks, root === 'day-log' ? ['/api/v1/day-log'] : twinPaths.map((path) => `/api/v1${path}`));
        await assertMockApiComplete(page, mocks);
        expectPlannedSourceFailures(diagnostics,
          root === 'day-log' ? ['/api/v1/day-log'] : twinPaths.map((path) => `/api/v1${path}`));
      });

      test(`${root} initial loading does not publish fabricated zero, ${width}px/${theme}`, async ({ page }) => {
        test.skip(process.env.E2E_MOCKS === '0', 'This case holds the actual source requests before publication');
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, `/${root}`);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installVehicleScope(page, mocks, theme);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        if (root === 'day-log') {
          await page.route((url) => url.pathname === '/api/v1/day-log',
            (route) => fulfillDay(route, mocks, 'recorded', false, gate));
        } else {
          await installTwinSources(page, mocks, 'reported', () => false, gate);
        }
        try {
          await page.goto(root === 'day-log' ? `/day-log?date=${day}` : '/digital-twin', { waitUntil: 'domcontentloaded' });
          const brief = page.getByTestId(root === 'day-log' ? 'day-log-summary' : 'digital-twin-summary');
          await expect(brief).toHaveAttribute('aria-busy', 'true');
          await expect(brief.locator('[data-operational-value]')).toHaveCount(0);
          await expect(page.getByTestId(root === 'day-log' ? 'daylog-timeline' : 'digital-twin-summary')).toBeVisible();
        } finally {
          release();
        }
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByTestId(root === 'day-log' ? 'day-log-summary' : 'digital-twin-summary');
        await expect(brief).not.toHaveAttribute('aria-busy', 'true');
        await expect(brief.locator('[data-operational-value]')).toHaveCount(6);
        await expectNoHorizontalOverflow(page);
        expectSourceLedger(mocks, root === 'day-log' ? ['/api/v1/day-log'] : twinPaths.map((path) => `/api/v1${path}`));
        await assertMockApiComplete(page, mocks);
      });

      test(`${root} failed initial source is retryable without invented measurements, ${width}px/${theme}`, async ({ page }) => {
        test.skip(process.env.E2E_MOCKS === '0', 'This case exercises a failed initial read and the existing Retry control');
        const diagnostics = monitorPage(page);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, `/${root}`);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installVehicleScope(page, mocks, theme);
        let fail = true;
        if (root === 'day-log') {
          await page.route((url) => url.pathname === '/api/v1/day-log',
            (route) => fulfillDay(route, mocks, 'recorded', fail));
        } else {
          await installTwinSources(page, mocks, 'reported', () => fail);
        }
        await page.goto(root === 'day-log' ? `/day-log?date=${day}` : '/digital-twin');
        const brief = page.getByTestId(root === 'day-log' ? 'day-log-summary' : 'digital-twin-summary');
        await expect(brief.getByText(root === 'day-log' ? 'History request failed' : 'Source request failed', { exact: true }))
          .toBeVisible({ timeout: 20000 });
        const missing = root === 'day-log'
          ? ['drives', 'charges', 'drive-time', 'distance', 'energy-added', 'energy-used']
          : ['twin-lock', 'twin-doors', 'twin-windows', 'twin-sentry', 'twin-port'];
        for (const key of missing) await expectValue(brief, key, '—', 'missing');
        fail = false;
        const retryScope = root === 'day-log' ? page.getByTestId('daylog-summary')
          : page.locator('[data-card]').filter({
            has: page.getByRole('heading', { name: 'Security & status', exact: true }),
          });
        await retryScope.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(brief.getByText(root === 'day-log' ? 'Recorded day summary' : 'Source snapshots available', { exact: true }))
          .toBeVisible({ timeout: 20000 });
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        await expectValue(brief, root === 'day-log' ? 'distance' : 'twin-doors', root === 'day-log' ? '25.12 km' : '1');
        await reviewDrawer(page, brief, root === 'day-log' ? 'Day summary' : 'Physical-state summary',
          root === 'day-log' ? /Recorded drives and charging sessions/ : /Security, vehicle-state and charging snapshots/);
        await expectNoHorizontalOverflow(page);
        expectSourceLedger(mocks, root === 'day-log' ? ['/api/v1/day-log'] : twinPaths.map((path) => `/api/v1${path}`));
        await assertMockApiComplete(page, mocks);
        expectPlannedSourceFailures(diagnostics,
          root === 'day-log' ? ['/api/v1/day-log'] : twinPaths.map((path) => `/api/v1${path}`));
      });
    }
  }
}
