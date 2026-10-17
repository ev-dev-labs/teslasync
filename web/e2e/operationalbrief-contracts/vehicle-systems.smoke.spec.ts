import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  accountingClimate, differentialHistory, guardConfig, guardEvents, guardState, latestClimate,
  maintenanceItems, mediaHistory, mediaLatest, noPressure, observedAt,
  pressureHistory, pressureLatest, rangeQuery, rootContracts, safetyPartial,
  serviceRecords, softwareUpdates, unknownClimate, unknownMedia,
  type RootContract,
} from './vehicle-systems.fixtures';

type FixtureMode = 'populated' | 'empty' | 'unknown';
type Endpoint = { path: string; json: unknown; query: readonly string[] };
const scoped = (path: string, json: unknown, extra: readonly string[] = []): Endpoint => ({
  path: `/api/v1${path}`, json, query: ['vehicle_id', ...extra],
});

function endpoints(contract: RootContract, mode: FixtureMode): Endpoint[] {
  const empty = mode === 'empty';
  const unknown = mode === 'unknown';
  switch (contract.fixture) {
    case 'climate':
    case 'preconditioning': {
      const result = [
        scoped('/climate', empty ? [] : accountingClimate),
      ];
      if (contract.route === '/climate-control') {
        result.push(
          scoped('/climate/latest', unknown ? unknownClimate : latestClimate),
          scoped('/charging-telemetry/latest', null),
        );
      }
      if (contract.fixture === 'preconditioning') {
        result.push(scoped('/drives', [], ['limit']));
      }
      return result;
    }
    case 'pressure':
      return [
        scoped('/tire-pressure/latest', unknown ? noPressure : pressureLatest),
        scoped('/tire-pressure', empty ? [] : pressureHistory, ['start', 'end']),
      ];
    case 'drift':
      return [scoped('/tire-pressure', empty ? [] : differentialHistory, ['start'])];
    case 'media':
      return [
        scoped('/media/latest', unknown ? unknownMedia : mediaLatest),
        scoped('/media', empty ? [] : unknown ? [unknownMedia] : mediaHistory, ['start', 'end']),
      ];
    case 'safety':
      return [
        scoped('/safety/latest', safetyPartial),
        scoped('/safety', [safetyPartial]),
        scoped('/security/latest', null),
      ];
    case 'maintenance':
      return [
        scoped('/maintenance', empty ? [] : maintenanceItems),
        scoped('/maintenance/records', serviceRecords),
      ];
    case 'software':
      return [scoped('/software-updates', empty ? [] : softwareUpdates, ['limit', 'offset', 'start', 'end'])];
    case 'guard':
      return [
        { path: '/api/v1/vehicles/7/guard/config', query: [], json: unknown ? null : guardConfig },
        { path: '/api/v1/vehicles/7/guard/events', query: [], json: guardEvents },
        {
          path: '/api/v1/vehicles/7/state', query: [],
          json: {
            state: unknown ? { vehicle_id: 7, state: 'online' } : guardState,
            live: true, freshness: 'fresh', observed_at: observedAt,
            verified_fields: unknown ? ['state'] : ['state', 'is_locked', 'sentry_mode'],
          },
        },
        { path: '/api/v1/geofences', query: [], json: [] },
      ];
  }
}

async function installDomainFixtures(
  page: Page, mocks: MockApiController | null, contract: RootContract, mode: FixtureMode,
) {
  const supplied = endpoints(contract, mode);
  for (const endpoint of supplied) {
    await page.route(url => url.pathname === endpoint.path, async route => {
      const url = new URL(route.request().url());
      expect(route.request().method(), endpoint.path).toBe('GET');
      expect([...url.searchParams.keys()].sort(), endpoint.path).toEqual([...endpoint.query].sort());
      if (endpoint.query.includes('vehicle_id')) {
        expect(url.searchParams.get('vehicle_id'), endpoint.path).toBe('7');
      }
      if (endpoint.path === '/api/v1/drives') expect(url.searchParams.get('limit')).toBe('1000');
      if (endpoint.path === '/api/v1/software-updates') {
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.get('offset')).toBe('0');
      }
      await fulfillApiFixture(route, mocks, { json: endpoint.json });
    });
  }
  return supplied;
}

function metric(brief: Locator, id: string) {
  return brief.locator(`[data-operational-metric="${id}"]`);
}

async function reading(brief: Locator, id: string, value: string | RegExp, state = 'value') {
  const item = metric(brief, id);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function openPage(
  page: Page, theme: 'light' | 'dark', width: number, contract: RootContract, mode: FixtureMode,
) {
  const route = `${contract.route}${rangeQuery}`;
  expect(ROUTE_REGISTRY.some(entry => entry.path === contract.route),
    `${contract.root} must use a generated application route`).toBe(true);
  await page.setViewportSize({ width, height: 1000 });
  await page.clock.setFixedTime(new Date(observedAt));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, theme, route);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('OperationalBrief source contracts require E2E_MOCKS enabled');
  const supplied = await installDomainFixtures(page, mocks, contract, mode);
  await page.goto(route);
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
  for (const endpoint of supplied) {
    expect(mocks.requests.some(request => request.path === endpoint.path && request.disposition === 'fulfilled'),
      `${contract.root} must actually request ${endpoint.path}`).toBe(true);
  }
  return mocks;
}

async function reviewDrawer(page: Page, brief: Locator, width: number) {
  await brief.scrollIntoViewIfNeeded();
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  const items = brief.locator('[data-operational-metric]');
  expect(await items.count()).toBeGreaterThan(0);
  const columns = await brief.getByRole('list').evaluate(node =>
    getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(width === 320 ? 1 : 3);
  const period = await brief.locator('xpath=..').getAttribute('data-source-period-kind');
  const retainedSource = await brief.locator('xpath=..').getAttribute('data-source-retained');
  const sourceDescription = (await brief.locator('p').first().textContent())?.trim() ?? '';
  expect(['unknown', 'snapshot'], 'summary must declare its actual source period').toContain(period);
  if (period === 'unknown') await expect(brief).toContainText('Not a live-state observation');
  const retained = await items.evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-operational-metric'),
    state: node.getAttribute('data-value-state'),
    label: node.firstElementChild?.firstElementChild?.textContent?.trim() ?? '',
    value: node.querySelector('[data-operational-value]')?.textContent?.trim() ?? '',
    detail: node.lastElementChild?.textContent?.trim() ?? '',
    links: Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map(link => ({ name: link.getAttribute('aria-label') ?? link.textContent?.trim() ?? '', href: link.getAttribute('href') ?? '' })),
  })));
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toHaveCount(1);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer).toHaveAccessibleName(/ details$/);
  expect(sourceDescription).not.toBe('');
  await expect(drawer).toHaveAccessibleDescription(sourceDescription);
  await expect(drawer.getByText('Operational metrics', { exact: true })).toBeVisible();
  for (const fact of retained) {
    expect(fact.label, `metric ${fact.id} must preserve its label`).not.toBe('');
    expect(fact.value, `metric ${fact.id} must have a displayed operand or missing marker`).not.toBe('');
    await expect(drawer.getByText(fact.label, { exact: true }).first()).toBeAttached();
    await expect(drawer.getByText(fact.value, { exact: true }).first()).toBeAttached();
    if (fact.detail) await expect(drawer.getByText(fact.detail, { exact: true }).first()).toBeAttached();
    for (const link of fact.links) {
      await expect(drawer.getByRole('link', { name: link.name, exact: true }).first())
        .toHaveAttribute('href', link.href);
    }
  }
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(brief.locator('xpath=..')).toHaveAttribute('data-source-period-kind', period!);
  expect(await brief.locator('xpath=..').getAttribute('data-source-retained')).toBe(retainedSource);
  expect(await items.evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-operational-metric'),
    state: node.getAttribute('data-value-state'),
    label: node.firstElementChild?.firstElementChild?.textContent?.trim() ?? '',
    value: node.querySelector('[data-operational-value]')?.textContent?.trim() ?? '',
    detail: node.lastElementChild?.textContent?.trim() ?? '',
    links: Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map(link => ({ name: link.getAttribute('aria-label') ?? link.textContent?.trim() ?? '', href: link.getAttribute('href') ?? '' })),
  })))).toEqual(retained);
}

async function assertOperands(page: Page, contract: RootContract) {
  switch (contract.root) {
    case 'CabinThermalPage':
      await reading(page.getByTestId('cabin-thermal-evidence'), 'cabin-thermal-returned', '12');
      await reading(page.getByTestId('cabin-thermal-evidence'), 'cabin-thermal-normalized', '8');
      await reading(page.getByTestId('cabin-thermal-evidence'), 'cabin-thermal-tau', '—', 'missing');
      break;
    case 'ComfortConsistencyPage': {
      await reading(page.getByTestId('comfort-consistency-evidence'), 'analyzed-samples', '5');
      await reading(page.getByTestId('comfort-consistency-evidence'), 'observed-active-duration', '0.13 h');
      await reading(page.getByTestId('comfort-consistency-evidence'), 'within-band-share', '87.50%');
      await reading(page.getByTestId('comfort-consistency-evidence'), 'weighted-deviation', '0.50 °C');
      const disposition = page.getByTestId('comfort-consistency-disposition-summary');
      for (const [index, value] of ['0', '1', '1', '1', '1', '1', '1', '1', '5'].entries()) {
        await reading(disposition, `outcome-${index}`, value);
      }
      const source = page.getByTestId('comfort-consistency-source-summary');
      await expect(source).toContainText('Counts are evaluated against 9 unique timestamp-valid rows.');
      break;
    }
    case 'HvacCyclingPage': {
      const brief = page.getByTestId('hvac-cycling-evidence');
      await reading(brief, 'returned-rows', '12');
      await reading(brief, 'known-state-samples', '8');
      await reading(brief, 'observed-intervals', '7');
      await reading(brief, 'observed-duration', '0.38 h');
      await reading(brief, 'on-duty', '78.26%');
      const source = page.getByTestId('hvac-cycling-source-summary');
      await expect(source).toContainText('Counts are evaluated against 9 unique timestamp-valid rows.');
      await reading(source, 'power', '8 · 88.89%');
      const duty = page.getByTestId('hvac-cycling-duty-summary');
      await reading(duty, 'on', '0.30 h');
      await reading(duty, 'off', '0.08 h');
      await reading(duty, 'on-samples', '7');
      await reading(duty, 'off-samples', '1');
      await reading(duty, 'duty', '78.26%');
      await expect(duty).toContainText('sample counts remain a separate evidence layer');
      break;
    }
    case 'PreconditioningEffectivenessPage':
      await reading(page.getByTestId('preconditioning-climate-source-summary'), 'returned', '12');
      await reading(page.getByTestId('preconditioning-drive-source-summary'), 'returned', '0');
      await reading(page.getByTestId('preconditioning-evidence'), 'readiness-difference', '—', 'missing');
      break;
    case 'TirePressurePage': {
      const brief = page.getByTestId('tire-pressure-summary');
      await reading(brief, 'tire-pressure-average', '2.90 bar');
      await reading(brief, 'tire-pressure-minimum', '2.80 bar');
      await reading(brief, 'tire-pressure-warning-count', '0');
      await expect(metric(brief, 'tire-pressure-warning-count')).toContainText('2 of 4 corners reported');
      await expect(metric(brief, 'tire-pressure-average')).toContainText('Missing corners are excluded.');
      await expect(metric(brief, 'tire-pressure-range-last-updated')).toContainText('not the observation time');
      break;
    }
    case 'TireDifferentialDriftPage':
      await reading(page.getByTestId('tire-differential-drift-summary'), 'usable-samples', '10');
      await reading(page.getByTestId('tire-differential-drift-summary'), 'imbalance', '0.00 bar');
      await reading(page.getByTestId('tire-differential-drift-summary'), 'threshold-days', '—', 'missing');
      break;
    case 'MediaPlayerPage': {
      const brief = page.getByTestId('media-listening-stats');
      await reading(brief, 'media-unique-tracks', '1');
      await reading(brief, 'media-top-source', 'Bluetooth');
      await reading(brief, 'media-average-volume', '4');
      await reading(brief, 'media-volume-step', '0.00');
      await expect(metric(brief, 'media-average-volume')).toContainText('Missing readings are excluded.');
      await expect(brief).toContainText('not complete listening time');
      break;
    }
    case 'SafetySettingsPage': {
      const brief = page.getByTestId('safety-configuration-summary');
      await reading(brief, 'total', '9');
      await reading(brief, 'enabled', '1');
      await reading(brief, 'disabled', '1');
      await reading(brief, 'unknown', '7');
      await reading(brief, 'enabled-feature-share', '—', 'missing');
      await reading(page.getByTestId('safety-driving-summary'), 'distance-since-reset', '0.00 km');
      await reading(page.getByTestId('safety-driving-summary'), 'self-driving-distance', '—', 'missing');
      break;
    }
    case 'SoftwareUpdatesPage': {
      const brief = page.getByTestId('software-update-summary');
      await reading(brief, 'software-current-version', '2026.26.3');
      await reading(brief, 'software-total-updates', '3');
      await reading(brief, 'software-installed', '2');
      await reading(brief, 'software-pending', '1');
      await reading(brief, 'software-average-cadence', '10d');
      await expect(brief).toContainText('not the complete fleet history');
      break;
    }
    case 'MaintenancePage':
      await reading(page.getByTestId('maintenance-summary'), 'maintenance-total', '2');
      await reading(page.getByTestId('maintenance-summary'), 'maintenance-overdue', '1');
      await reading(page.getByTestId('maintenance-summary'), 'maintenance-soon', '0');
      await expect(page.getByTestId('maintenance-cost-summary')).toHaveCount(0);
      await expect(page.getByText('No cost data available yet. Log service records to see cost estimates.', { exact: true }))
        .toBeVisible();
      break;
    case 'GuardModePage':
      await reading(page.getByTestId('guard-overview'), 'guard-sentry', 'Off');
      await reading(page.getByTestId('guard-overview'), 'guard-lock', 'Unlocked');
      await reading(page.getByTestId('guard-overview'), 'guard-state', 'Disarmed');
      await reading(page.getByTestId('guard-overview'), 'guard-total', '0');
      await expect(metric(page.getByTestId('guard-overview'), 'guard-state'))
        .toContainText('not confirmation of active monitoring');
      break;
    case 'ClimateControlPage':
      await reading(page.getByTestId('climate-systems-stats'), 'climate-systems-stats-0', 'Off');
      await reading(page.getByTestId('climate-systems-stats'), 'climate-systems-stats-3', '0');
      await expect(page.getByTestId('climate-efficiency-stats').locator('[data-operational-metric]'))
        .toHaveCount(3);
      break;
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    for (const contract of rootContracts) {
      test(`${contract.root}: real briefs, operands and Review drawer at ${width}px ${theme}`, async ({ page }) => {
        test.setTimeout(120_000);
        const diagnostics = monitorPage(page);
        const mocks = await openPage(page, theme, width, contract, 'populated');
        await assertOperands(page, contract);
        for (const band of contract.bands) {
          const briefs = page.getByTestId(band.id);
          await expect(briefs).toHaveCount(band.instances ?? 1);
          for (const brief of await briefs.all()) await reviewDrawer(page, brief, width);
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });
    }

    for (const [root, band, zero, missing] of [
      ['CabinThermalPage', 'cabin-thermal-evidence', 'cabin-thermal-returned', 'cabin-thermal-tau'],
      ['ComfortConsistencyPage', 'comfort-consistency-evidence', 'analyzed-samples', 'weighted-deviation'],
      ['HvacCyclingPage', 'hvac-cycling-evidence', 'returned-rows', 'on-duty'],
      ['PreconditioningEffectivenessPage', 'preconditioning-evidence', 'classified-departures', 'readiness-difference'],
      ['SoftwareUpdatesPage', 'software-update-summary', 'software-total-updates', 'software-current-version'],
      ['MediaPlayerPage', 'media-listening-stats', 'media-unique-tracks', 'media-top-source'],
      ['TireDifferentialDriftPage', 'tire-differential-drift-summary', 'usable-samples', 'threshold-days'],
    ] as const) {
      test(`${root}: successful zero is not unknown at ${width}px ${theme}`, async ({ page }) => {
        const diagnostics = monitorPage(page);
        const contract = rootContracts.find(item => item.root === root)!;
        const mocks = await openPage(page, theme, width, contract, 'empty');
        const brief = page.getByTestId(band);
        await reading(brief, zero, '0');
        await reading(brief, missing, '—', 'missing');
        await reviewDrawer(page, brief, width);
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });
    }

    for (const root of ['MediaPlayerPage', 'TirePressurePage', 'GuardModePage', 'ClimateControlPage']) {
      test(`${root}: unresolved scalar is not a zero observation at ${width}px ${theme}`, async ({ page }) => {
        const diagnostics = monitorPage(page);
        const contract = rootContracts.find(item => item.root === root)!;
        const mocks = await openPage(page, theme, width, contract, 'unknown');
        if (root === 'MediaPlayerPage') {
          await reading(page.getByTestId('media-listening-stats'), 'media-average-volume', '—', 'missing');
          await reading(page.getByTestId('media-listening-stats'), 'media-volume-step', '—', 'missing');
          await reading(page.getByTestId('media-listening-stats'), 'media-unique-tracks', '0');
        } else if (root === 'TirePressurePage') {
          await reading(page.getByTestId('tire-pressure-summary'), 'tire-pressure-average', '—', 'missing');
          await reading(page.getByTestId('tire-pressure-summary'), 'tire-pressure-warning-count', '—', 'missing');
          await expect(metric(page.getByTestId('tire-pressure-summary'), 'tire-pressure-range-last-updated'))
            .toHaveAttribute('data-value-state', 'value');
        } else if (root === 'GuardModePage') {
          for (const id of ['guard-state', 'guard-sentry', 'guard-lock']) {
            await reading(page.getByTestId('guard-overview'), id, '—', 'missing');
          }
          await reading(page.getByTestId('guard-overview'), 'guard-total', '0');
        } else {
          await reading(page.getByTestId('climate-systems-stats'), 'climate-systems-stats-0', '—', 'missing');
          await expect(page.getByTestId('climate-efficiency-stats')).toHaveAttribute('data-operational-brief', 'true');
        }
        await reviewDrawer(page, page.getByTestId(contract.bands.find(band => !band.instances)!.id), width);
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });
    }

    test(`preconditioning: independently pending climate keeps resolved drive zero at ${width}px ${theme}`, async ({ page }) => {
      const contract = rootContracts.find(item => item.root === 'PreconditioningEffectivenessPage')!;
      const route = `${contract.route}${rangeQuery}`;
      await page.setViewportSize({ width, height: 1000 });
      await page.clock.setFixedTime(new Date(observedAt));
      await seedBrowserState(page, theme, route);
      const mocks = await installApiMocks(page, 'populated', theme);
      if (!mocks) throw new Error('This contract requires synthetic fixtures');
      await installDomainFixtures(page, mocks, contract, 'empty');
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      let requested = false;
      await page.route(url => url.pathname === '/api/v1/climate', async apiRoute => {
        expect(apiRoute.request().method()).toBe('GET');
        expect(new URL(apiRoute.request().url()).searchParams.get('vehicle_id')).toBe('7');
        requested = true;
        await pending;
        await fulfillApiFixture(apiRoute, mocks, { json: [] });
      });
      try {
        await page.goto(route);
        await expect.poll(() => requested).toBe(true);
        const drives = page.getByTestId('preconditioning-drive-source-summary');
        await reading(drives, 'returned', '0');
        await reading(drives, 'overlap', '—', 'missing');
        await expect(page.getByTestId('preconditioning-climate-source-summary'))
          .toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTestId('preconditioning-evidence').locator('[data-value-state="missing"]'))
          .toHaveCount(6);
      } finally {
        release();
      }
      await waitForHarnessReady(page, mocks);
      await reading(page.getByTestId('preconditioning-drive-source-summary'), 'overlap', '0');
      await reading(page.getByTestId('preconditioning-evidence'), 'classified-departures', '0');
      await reviewDrawer(page, page.getByTestId('preconditioning-drive-source-summary'), width);
      await assertMockApiComplete(page, mocks);
    });

    test(`climate: failed real refresh retains independent published operands at ${width}px ${theme}`, async ({ page }) => {
      const contract = rootContracts.find(item => item.root === 'ClimateControlPage')!;
      const mocks = await openPage(page, theme, width, contract, 'populated');
      const brief = page.getByTestId('climate-systems-stats');
      const before = await brief.locator('[data-operational-metric]').evaluateAll(nodes =>
        nodes.map(node => ({ state: node.getAttribute('data-value-state'), value: node.querySelector('[data-operational-value]')?.textContent })));
      let failedReads = 0;
      await page.route(url => url.pathname === '/api/v1/climate/latest', async route => {
        expect(route.request().method()).toBe('GET');
        expect(new URL(route.request().url()).searchParams.get('vehicle_id')).toBe('7');
        failedReads += 1;
        await fulfillApiFixture(route, mocks, { status: 503, json: { error: 'Synthetic read refresh unavailable' } });
      });
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect.poll(() => failedReads).toBeGreaterThan(0);
      await expect(brief.locator('xpath=..')).toHaveAttribute('data-source-retained', 'true', { timeout: 30_000 });
      expect(await brief.locator('[data-operational-metric]').evaluateAll(nodes =>
        nodes.map(node => ({ state: node.getAttribute('data-value-state'), value: node.querySelector('[data-operational-value]')?.textContent })))).toEqual(before);
      await expect(page.getByTestId('climate-efficiency-stats').locator('xpath=..'))
        .not.toHaveAttribute('data-source-retained', 'true');
      await reviewDrawer(page, brief, width);
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }
}
