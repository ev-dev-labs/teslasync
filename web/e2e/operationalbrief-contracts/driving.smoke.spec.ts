import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import {
  DRIVING_WINDOW, drivingRecord, installDrivingBriefFixtures, plannedTrip,
  recordedGhost, recordedRecovery, recordedRows, seedDrivingLogbook, sweetSpotRows,
  simulatedDrive, type DrivingFixtureOptions,
} from './driving.fixtures';

test.describe('released driving N–Z OperationalBrief source contracts', () => {
  test.setTimeout(60_000);

  async function open(
    page: Page, theme: 'light' | 'dark', width: number, pathname: string,
    options: DrivingFixtureOptions = {},
  ) {
    await page.setViewportSize({ width, height: 1000 });
    await seedBrowserState(page, theme, pathname);
    await seedDrivingLogbook(page);
    const mocks = await installApiMocks(page, 'populated', theme);
    const fixtures = await installDrivingBriefFixtures(page, mocks, theme, options);
    const diagnostics = monitorPage(page);
    await page.goto(pathname);
    await waitForHarnessReady(page, mocks);
    return { mocks, fixtures, diagnostics };
  }

  function metric(brief: Locator, key: string) {
    return brief.locator(`[data-operational-metric="${key}"]`);
  }

  async function value(brief: Locator, key: string, expected: string | RegExp) {
    const item = metric(brief, key);
    await expect(item).toHaveAttribute('data-value-state', 'value');
    await expect(item.locator('[data-operational-value]')).toHaveText(expected);
  }

  async function unknown(brief: Locator, key: string) {
    const item = metric(brief, key);
    await expect(item).toHaveAttribute('data-value-state', 'missing');
    await expect(item.locator('[data-operational-value]')).toHaveText('—');
    await expect(item).toContainText('No measurement supplied');
  }

  async function review(
    page: Page, brief: Locator, title: string, source: string, details: readonly string[] = [],
  ) {
    await expect(brief).toHaveAttribute('data-operational-brief', 'true');
    const publication = await brief.locator('[data-operational-value]').allTextContents();
    const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
    await trigger.focus();
    await trigger.press('Enter');
    const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(source);
    for (const published of publication) await expect(drawer).toContainText(published);
    for (const detail of details) await expect(drawer).toContainText(detail);
    await expect(drawer.getByRole('button', { name: 'Close', exact: true }).first()).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await expect.poll(async () => {
      const box = await drawer.boundingBox();
      const viewport = page.viewportSize();
      return box != null && viewport != null
        && box.x >= -1 && box.y >= -1
        && box.x + box.width <= viewport.width + 1
        && box.y + box.height <= viewport.height + 1;
    }).toBe(true);
    await expectDialogsInsideViewport(page);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(publication);
  }

  async function finish(page: Page, context: Awaited<ReturnType<typeof open>>, intentionalFailure = false) {
    await expectNoHorizontalOverflow(page);
    if (intentionalFailure) expect(context.diagnostics.pageErrors).toEqual([]);
    else await expectNoRuntimeFailures(context.diagnostics);
    await assertMockApiComplete(page, context.mocks);
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 1440]) {
      test(`speed aggregate is SI and its independent drive sample stays qualified at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/speed-profile?${DRIVING_WINDOW}`);
        const brief = page.getByTestId('speed-profile-brief');
        await value(brief, 'average-speed', /^36(?:\.0{1,2})? km\/h$/);
        await value(brief, 'peak-speed', /^72(?:\.0{1,2})? km\/h$/);
        await value(brief, 'optimal-speed', /^54(?:\.0{1,2})? km\/h$/);
        await value(brief, 'samples', '20');
        // The released band has no power metric. Bucket avg_power_w remains
        // typed SI source evidence; it must not become a fabricated summary.
        await expect(brief.locator('[data-operational-metric*="power"]')).toHaveCount(0);
        await expect(metric(brief, 'samples')).toContainText('3 drives analysed');
        await expect(brief).toContainText('2026-08-01 — 2026-08-31');
        await review(page, brief, 'Speed summary metrics',
          'Speed-profile aggregate and returned vehicle drives; the server does not declare complete drive coverage.',
          ['3 drives analysed', 'drive evidence is a separately returned sample']);
        const profileCall = context.fixtures.calls.find(call => call.pathname === '/analytics/speed-profile');
        expect(profileCall?.params.get('vehicle_id')).toBe('7');
        expect(profileCall?.params.get('start')).toBe('2026-08-01');
        expect(profileCall?.params.get('end')).toBe('2026-08-31');
        await finish(page, context);
      });

      test(`logbook SI distance and category context are unchanged by the table filter at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/logbook?${DRIVING_WINDOW}`, { imperial: true });
        const brief = page.getByTestId('trip-logbook-brief');
        await value(brief, 'business-distance', /^10(?:\.0{1,2})? mi$/);
        await value(brief, 'commute-distance', /^20(?:\.0{1,2})? mi$/);
        await value(brief, 'business-count', '1');
        await value(brief, 'commute-count', '1');
        await value(brief, 'personal-count', '1');
        await value(brief, 'personal-amount', /^\$0(?:\.0{1,2})?$/);
        await value(brief, 'unclassified', '0/3');
        await expect(metric(brief, 'business-distance')).toContainText('1 drive');
        const before = await brief.locator('[data-operational-value]').allTextContents();
        await page.getByRole('combobox', { name: 'Filter by category', exact: true }).selectOption('business');
        expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(before);
        await review(page, brief, 'Logbook summary metrics',
          'Returned vehicle drives, local classifications, and saved reimbursement rates; complete server-range coverage is not supplied.',
          ['before the table category filter', 'of 3 drives']);
        // The July row is deliberately present in /drives but cannot inflate
        // this August publication; these are returned-row totals, not lifetime totals.
        await expect(brief).not.toContainText('90 km');
        await finish(page, context);
      });

      test(`recovery summary preserves separate aggregate/sample energy and valid zero at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/regen-efficiency?${DRIVING_WINDOW}`, {
          rows: recordedRows.slice(0, 3),
        });
        const summary = page.getByTestId('regen-selected-window-summary');
        const overview = page.getByTestId('regen-overview-brief');
        const coverage = page.getByTestId('regen-coverage-brief');
        await value(summary, 'regen-aggregate-recovered', /^2(?:\.0{1,2})? kWh$/);
        await value(summary, 'regen-aggregate-denominator', /^13(?:\.0{1,2})? kWh$/);
        await value(summary, 'regen-aggregate-share', /^15\.38%$/);
        await value(summary, 'regen-returned-rows', '3');
        await value(summary, 'regen-eligible-coverage', '2/3');
        await value(overview, 'regen-sample-recovered', /^2(?:\.0{1,2})? kWh$/);
        await value(overview, 'regen-sample-denominator', /^12(?:\.0{1,2})? kWh$/);
        await value(coverage, 'regen-method-returned', '3');
        await value(coverage, 'regen-method-eligible', '2');
        await value(coverage, 'regen-method-excluded', '1');
        await value(coverage, 'regen-method-unavailable', '1');
        const source = 'Complete recovery aggregate and independently returned capped drive detail.';
        await review(page, summary, 'Selected-window evidence', source,
          ['Measured regen and positive drive energy', 'Complete date-scoped aggregate']);
        await review(page, overview, 'Recovery overview', source,
          ['Model-based estimate', 'Measured canonical Drive rows returned by the capped detailed request.']);
        await review(page, coverage, 'Coverage & methodology', source);
        const detailCall = context.fixtures.calls.find(call => call.pathname === '/drives');
        const aggregateCall = context.fixtures.calls.find(call => call.pathname === '/analytics/regen');
        expect(detailCall?.params.get('vehicle_id')).toBe('7');
        expect(detailCall?.params.get('limit')).toBe('1000');
        expect(detailCall?.params.get('start')).toBe('2026-08-01T00:00:00.000Z');
        expect(detailCall?.params.get('end')).toBe('2026-09-01T00:00:00.000Z');
        expect(aggregateCall?.params.get('start')).toBe(detailCall?.params.get('start'));
        expect(aggregateCall?.params.get('end')).toBe(detailCall?.params.get('end'));
        await finish(page, context);
      });

      test(`returned route averages retain their unweighted basis at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/route-efficiency?${DRIVING_WINDOW}`);
        const brief = page.getByTestId('route-efficiency-brief');
        await value(brief, 'routes', '2');
        await value(brief, 'trips', '5');
        await value(brief, 'best', '180 Wh/km');
        await value(brief, 'average', '250 Wh/km');
        await value(brief, 'worst', '320 Wh/km');
        await value(brief, 'most-driven', '2');
        await review(page, brief, 'Route efficiency summary metrics',
          'Returned route-efficiency aggregate before pagination; completeness is not declared by the source.',
          ['unweighted mean of route averages', 'trips']);
        await finish(page, context);
      });

      test(`planned SI distance/time/energy and cost context survive a failed real recomputation at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, '/trip-planner', { imperial: true });
        const brief = page.getByTestId('trip-planner-brief');
        const cost = page.getByTestId('trip-cost-brief');
        await unknown(brief, 'distance');
        await unknown(brief, 'totalTime');
        await unknown(brief, 'energy');
        await unknown(cost, 'ev');
        await page.getByRole('combobox', { name: 'From', exact: true }).fill('Home');
        await page.getByRole('option', { name: 'Home', exact: true }).click();
        await page.getByRole('combobox', { name: 'To', exact: true }).fill('Office');
        await page.getByRole('option', { name: 'Office', exact: true }).click();
        const plan = page.getByRole('button', { name: 'Plan Trip', exact: true });
        await expect(plan).toBeEnabled();
        await plan.click();
        await waitForHarnessReady(page, context.mocks);
        await value(brief, 'distance', /^10(?:\.0{1,2})? mi$/);
        await value(brief, 'totalTime', '1h 15m');
        await value(brief, 'drivingTime', '1h 0m');
        await value(brief, 'chargingTime', '15m');
        await value(brief, 'energy', /^4(?:\.0{1,2})? kWh$/);
        await value(brief, 'cost', /^\$1\.20?$/);
        await value(cost, 'ev', /^\$1\.20?$/);
        await value(cost, 'gas', /^\$2(?:\.0{1,2})?$/);
        await value(cost, 'saved', /^\$0\.80?$/);
        await expect(brief).toContainText('Home → Office');
        await review(page, brief, 'Trip summary',
          'Deterministic trip-plan response using the submitted route, battery level, and preferences.',
          ['not recorded travel or a billing quote']);
        await review(page, cost, 'Trip Cost vs Gas',
          'Deterministic trip-plan response using the submitted route, battery level, and preferences.',
          ['gal avoided', 'cheaper', 'mpg']);
        const publication = await brief.locator('[data-operational-value]').allTextContents();
        const costPublication = await cost.locator('[data-operational-value]').allTextContents();
        context.fixtures.rejectNextPlan();
        await plan.click();
        await expect(brief).toContainText('Retained source');
        await expect(cost).toContainText('Retained source');
        expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(publication);
        expect(await cost.locator('[data-operational-value]').allTextContents()).toEqual(costPublication);
        expect(context.fixtures.planRequests).toBe(2);
        await review(page, brief, 'Trip summary',
          'Deterministic trip-plan response using the submitted route, battery level, and preferences.');
        await finish(page, context, true);
      });

      test(`arrival zero is observed while missing arrival is accounted separately at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/range-buffer?${DRIVING_WINDOW}`, {
          rows: [
            { ...drivingRecord, distanceM: 10000, endBatteryPct: 0 },
            { ...drivingRecord, id: 102, endBatteryPct: null },
          ],
        });
        const arrivals = page.getByTestId('range-buffer-kpis-brief');
        const driveContext = page.getByTestId('range-buffer-drive-context-brief');
        const support = page.getByTestId('range-buffer-evidence-support-brief');
        const accounting = page.getByTestId('range-buffer-accounting-brief');
        await value(arrivals, 'included', '1');
        await value(arrivals, 'median', /^0(?:\.0{1,2})?%$/);
        await value(arrivals, 'latest', /^0(?:\.0{1,2})?%$/);
        await value(driveContext, 'median-distance', /^10(?:\.0{1,2})? km$/);
        await value(support, 'samples', '1');
        await value(accounting, 'returned', '2');
        await value(accounting, 'included', '1');
        await value(accounting, 'invalid-arrival', '1');
        await value(accounting, 'incomplete', '0');
        const source = 'Returned vehicle drives in the selected window, capped at 1,000 rows; vehicle-local time and frozen analysis clock.';
        await review(page, arrivals, 'Observed arrival-buffer evidence', source, ['not a guarantee']);
        await review(page, driveContext, 'Drive-use context and field coverage', source, ['positive finite distance rows']);
        await review(page, support, 'Evidence support and coverage', source, ['50-row volume target']);
        await review(page, accounting, 'Row accounting and secondary coverage', source, ['1,000-row request cap']);
        await finish(page, context);
      });

      test(`empty what-if outcome stays unknown and its real recovery link navigates at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, '/what-if', { rows: [] });
        const brief = page.getByTestId('what-if-brief');
        await unknown(brief, 'scenario-energy');
        await unknown(brief, 'scenario-arrival');
        await unknown(brief, 'scenario-duration');
        await review(page, brief, 'Simulated drive outcome',
          'Selected drive and telemetry, recomputed locally with the current simulation knobs.',
          ['model outputs, not observed savings']);
        const browse = page.getByRole('link', { name: 'Browse drives', exact: true });
        await expect(browse).toHaveAttribute('href', '/drives');
        await browse.focus();
        await browse.press('Enter');
        await expect(page).toHaveURL(/\/drives$/);
        // No A–M page body is asserted: only the released N–Z recovery link.
        await assertMockApiComplete(page, context.mocks);
        expect(context.diagnostics.pageErrors).toEqual([]);
      });

      test(`what-if SI energy/time publication follows real knobs and reset at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, '/what-if', {
          rows: [simulatedDrive], detail: simulatedDrive,
        });
        const brief = page.getByTestId('what-if-brief');
        await value(brief, 'scenario-energy', /^4(?:\.0{1,2})? kWh$/);
        await value(brief, 'scenario-arrival', '72%');
        await value(brief, 'scenario-duration', '0.28 h');
        await expect(metric(brief, 'scenario-energy')).toContainText('was 4');
        await expect(metric(brief, 'scenario-duration')).toContainText('was 0.28 h');
        const publication = await brief.locator('[data-operational-value]').allTextContents();
        await review(page, brief, 'Simulated drive outcome',
          'Selected drive and telemetry, recomputed locally with the current simulation knobs.',
          ['was 4', 'was 0.28 h', 'model outputs, not observed savings']);
        const speed = page.getByRole('slider', { name: 'Average speed', exact: true });
        await speed.focus();
        await speed.press('Home');
        await value(brief, 'scenario-duration', '0.35 h');
        await value(brief, 'scenario-energy', '4.08 kWh');
        await expect(metric(brief, 'scenario-duration')).toContainText('was 0.28 h');
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await value(brief, 'scenario-duration', '0.28 h');
        expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(publication);
        await finish(page, context);
      });
      test(`seasonal loaded history publishes coverage without inventing a fit at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, '/seasonal-efficiency', {
          rows: [
            { ...drivingRecord, distanceM: 10000, energyUsedWh: 2000 },
            { ...drivingRecord, id: 102, energyUsedWh: null },
          ],
        });
        const summary = page.getByTestId('seasonal-evidence-brief');
        const calendar = page.getByTestId('seasonal-calendar-coverage-brief');
        const support = page.getByTestId('seasonal-evidence-support-brief');
        const accounting = page.getByTestId('seasonal-accounting-brief');
        await value(summary, 'seasonal-included', '1');
        await value(summary, 'seasonal-intensity', '0.20 kWh / km');
        await value(summary, 'seasonal-local-months', '1/12');
        await unknown(summary, 'seasonal-trend');
        await unknown(summary, 'seasonal-r-squared');
        await expect(summary).toContainText('Returned window below the 1,000-row cap');
        await value(calendar, 'calendar-months', '1/12');
        await value(calendar, 'observed-span', '0 d');
        await value(calendar, 'active-local-periods', '1 / 1');
        await value(calendar, 'timezone', 'UTC');
        await value(accounting, 'accounting-included', '1');
        await value(accounting, 'accounting-missingEnergy', '1');
        await value(accounting, 'accounting-future', '0');
        const source = 'Returned vehicle history; descriptive local-calendar fit, not a forecast.';
        await review(page, summary, 'Observed seasonal evidence', source, ['2 returned', '1 excluded']);
        await review(page, calendar, 'Vehicle-local calendar coverage', source, ['1 included rows']);
        await review(page, support, 'Evidence support and fit eligibility', source, ['samples per parameter']);
        await review(page, accounting, 'Returned-row accounting and recency', source);
        const historyCall = context.fixtures.calls.find(call => call.pathname === '/drives');
        expect(historyCall?.params.get('limit')).toBe('1000');
        expect(historyCall?.params.get('vehicle_id')).toBe('7');
        await finish(page, context);
      });

      test(`sweet spot SI band and distance-weighted evidence stay descriptive at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, `/speed-sweetspot?${DRIVING_WINDOW}`, { rows: sweetSpotRows });
        const summary = page.getByTestId('speed-sweet-spot-brief');
        const evidence = page.getByTestId('speed-sweet-spot-evidence-brief');
        const method = page.getByTestId('speed-sweet-spot-method-brief');
        await value(summary, 'best-qualified-band', /^30(?:\.0{1,2})?–40(?:\.0{1,2})? km\/h$/);
        await value(summary, 'band-consumption', /^200(?:\.0{1,2})? Wh\/km$/);
        await value(summary, 'overall-consumption', /^250(?:\.0{1,2})? Wh\/km$/);
        await value(summary, 'observed-gap', /^\+20(?:\.0{1,2})?%$/);
        await value(evidence, 'eligible', '6');
        await value(evidence, 'winning-drives', '3');
        await value(evidence, 'winning-distance', /^30(?:\.0{1,2})? km$/);
        await value(evidence, 'distance-share', /^50(?:\.0{1,2})?%$/);
        await value(evidence, 'qualified-bands', '2');
        await value(method, 'returned', '7');
        await value(method, 'eligible', '6');
        await value(method, 'excluded', '1');
        const source = 'Distance-weighted eligible returned drives; sample floor and row cap are unchanged.';
        await review(page, summary, 'Sweet spot summary metrics', source,
          ['6 eligible of 7 returned drives', 'not a savings forecast']);
        await review(page, evidence, 'Evidence & confidence', source);
        await review(page, method, 'Coverage & methodology', source,
          ['Returned, eligible, and excluded counts reconcile']);
        const call = context.fixtures.calls.find(item => item.pathname === '/drives');
        expect(call?.params.get('start')).toBe('2026-08-01');
        expect(call?.params.get('end')).toBe('2026-08-31');
        expect(call?.params.get('limit')).toBe('1000');
        await finish(page, context);
      });

      test(`ghost selection opens the real recorded duration/winner brief at ${width}px ${theme}`, async ({ page }) => {
        const context = await open(page, theme, width, '/segments');
        await page.getByRole('option', { name: 'Open leaderboard for Home → Office', exact: true }).click();
        await waitForHarnessReady(page, context.mocks);
        const brief = page.getByTestId('segment-ghost-brief');
        await value(brief, 'attempt-a', '10:00');
        await value(brief, 'attempt-b', '11:00');
        await expect(metric(brief, 'winner')).toHaveAttribute('data-value-state', 'value');
        await expect(metric(brief, 'winner')).toContainText('Attempt A');
        await expect(metric(brief, 'winner')).toContainText('Won by 1:00');
        await review(page, brief, 'Ghost Race',
          'Selected A/B ghost comparison response; charts retain independent telemetry samples and recorded margin.',
          ['Recorded attempt durations', 'Won by 1:00']);
        expect(context.fixtures.calls.some(call => call.pathname === '/segments/51/ghost'
          && call.params.get('a') === '101' && call.params.get('b') === '102')).toBe(true);
        await finish(page, context);
      });
    }
  }

  for (const state of ['zero', 'unknown'] as const) {
    test(`speed ${state} is not substituted for the other state`, async ({ page }) => {
      const context = await open(page, 'light', 320, `/speed-profile?${DRIVING_WINDOW}`, {
        rows: [],
        profile: state === 'zero'
          ? { avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0, distribution: [] }
          : { distribution: [] },
      });
      const brief = page.getByTestId('speed-profile-brief');
      for (const key of ['average-speed', 'peak-speed', 'optimal-speed']) {
        if (state === 'zero') await value(brief, key, /^0(?:\.0{1,2})? km\/h$/);
        else await unknown(brief, key);
      }
      await value(brief, 'samples', '0');
      await finish(page, context);
    });
  }

  test('failed speed source leaves its independently available drive coverage truthful', async ({ page }) => {
    const context = await open(page, 'dark', 1440, `/speed-profile?${DRIVING_WINDOW}`, { failProfile: true });
    const brief = page.getByTestId('speed-profile-brief');
    await expect(brief).toContainText('Source unavailable');
    await unknown(brief, 'average-speed');
    await unknown(brief, 'samples');
    await expect(metric(brief, 'samples')).toContainText('3 drives analysed');
    await finish(page, context, true);
  });

  test('failed drive source does not turn independently loaded speed readings into unknown speed', async ({ page }) => {
    const context = await open(page, 'light', 320, `/speed-profile?${DRIVING_WINDOW}`, { failDrives: true });
    const brief = page.getByTestId('speed-profile-brief');
    await value(brief, 'average-speed', /^36(?:\.0{1,2})? km\/h$/);
    await value(brief, 'samples', '20');
    await expect(metric(brief, 'samples')).toContainText('Drive sample coverage is unavailable independently of the speed profile.');
    await finish(page, context, true);
  });

  for (const source of ['empty', 'unavailable'] as const) {
    test(`logbook ${source} source distinguishes successful zero classifications from missing evidence`, async ({ page }) => {
      const context = await open(page, 'dark', 320, `/logbook?${DRIVING_WINDOW}`, {
        rows: [], failDrives: source === 'unavailable',
      });
      const brief = page.getByTestId('trip-logbook-brief');
      if (source === 'empty') {
        await value(brief, 'business-distance', /^0(?:\.0{1,2})? km$/);
        await value(brief, 'business-amount', /^\$0(?:\.0{1,2})?$/);
        await value(brief, 'business-count', '0');
        await value(brief, 'unclassified', '0/0');
      } else {
        await unknown(brief, 'business-distance');
        await unknown(brief, 'business-amount');
        await unknown(brief, 'business-count');
        await unknown(brief, 'unclassified');
      }
      await finish(page, context, source === 'unavailable');
    });
  }

  test('failed recovery aggregate cannot erase measured returned-row coverage', async ({ page }) => {
    const context = await open(page, 'dark', 320, `/regen-efficiency?${DRIVING_WINDOW}`, {
      rows: recordedRows.slice(0, 3), failRecovery: true,
    });
    const brief = page.getByTestId('regen-selected-window-summary');
    await expect(brief).toContainText('Independent sources partly available');
    await unknown(brief, 'regen-aggregate-recovered');
    await value(brief, 'regen-returned-rows', '3');
    await value(brief, 'regen-eligible-coverage', '2/3');
    await value(page.getByTestId('regen-overview-brief'), 'regen-sample-recovered', /^2(?:\.0{1,2})? kWh$/);
    await finish(page, context, true);
  });

  test('successful empty recovery has measured zero totals but no invented recovery denominator', async ({ page }) => {
    const context = await open(page, 'light', 320, `/regen-efficiency?${DRIVING_WINDOW}`, {
      rows: [],
      recovery: { ...recordedRecovery, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0, freeCharges: 0 },
    });
    const brief = page.getByTestId('regen-selected-window-summary');
    await value(brief, 'regen-aggregate-recovered', /^0(?:\.0{1,2})? kWh$/);
    await value(brief, 'regen-aggregate-denominator', /^0(?:\.0{1,2})? kWh$/);
    await unknown(brief, 'regen-aggregate-share');
    await value(brief, 'regen-returned-rows', '0');
    await value(brief, 'regen-eligible-coverage', '0/0');
    await finish(page, context);
  });

  test('contradictory aggregate zero is unavailable when the detailed source contains measured energy', async ({ page }) => {
    const context = await open(page, 'dark', 1440, `/regen-efficiency?${DRIVING_WINDOW}`, {
      rows: recordedRows.slice(0, 3),
      recovery: { ...recordedRecovery, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0, freeCharges: 0 },
    });
    const brief = page.getByTestId('regen-selected-window-summary');
    await unknown(brief, 'regen-aggregate-recovered');
    await unknown(brief, 'regen-aggregate-denominator');
    await unknown(brief, 'regen-aggregate-share');
    await value(brief, 'regen-returned-rows', '3');
    await value(page.getByTestId('regen-overview-brief'), 'regen-sample-denominator', /^12(?:\.0{1,2})? kWh$/);
    await expect(page.getByText('Aggregate totals unavailable', { exact: true })).toBeVisible();
    await finish(page, context);
  });

  test('an insufficient sweet-spot sample retains counts without inventing a best band', async ({ page }) => {
    const context = await open(page, 'light', 320, `/speed-sweetspot?${DRIVING_WINDOW}`, { rows: sweetSpotRows.slice(0, 2) });
    const summary = page.getByTestId('speed-sweet-spot-brief');
    await unknown(summary, 'best-qualified-band');
    await unknown(summary, 'band-consumption');
    await unknown(summary, 'observed-gap');
    await value(summary, 'overall-consumption', /^200(?:\.0{1,2})? Wh\/km$/);
    const method = page.getByTestId('speed-sweet-spot-method-brief');
    await value(method, 'returned', '2');
    await value(method, 'eligible', '2');
    await value(method, 'excluded', '0');
    await expect(page.getByTestId('speed-sweet-spot-evidence-brief')).toContainText('Insufficient evidence');
    await finish(page, context);
  });

  test('zero charging duration retains the original dash as a valid plan value, not missing source', async ({ page }) => {
    const context = await open(page, 'dark', 1440, '/trip-planner', {
      plan: {
        ...plannedTrip,
        route: { ...plannedTrip.route, total_duration_s: 3600, charging_duration_s: 0, estimated_cost: 0 },
        cost_comparison: {
          ev_cost: 0, gas_cost: 2, gas_gallons: 0.5, savings: 2,
          savings_pct: 100, gas_price_per_gallon: 4, gas_mpg: 20,
        },
      },
    });
    await page.getByRole('combobox', { name: 'From', exact: true }).fill('Home');
    await page.getByRole('option', { name: 'Home', exact: true }).click();
    await page.getByRole('combobox', { name: 'To', exact: true }).fill('Office');
    await page.getByRole('option', { name: 'Office', exact: true }).click();
    await page.getByRole('button', { name: 'Plan Trip', exact: true }).click();
    await waitForHarnessReady(page, context.mocks);
    const brief = page.getByTestId('trip-planner-brief');
    await value(brief, 'chargingTime', '—');
    await value(brief, 'cost', 'Free');
    await finish(page, context);
  });

  test('equal recorded ghost durations preserve the real tie instead of an inferred winner', async ({ page }) => {
    const context = await open(page, 'light', 320, '/segments', {
      ghost: {
        ...recordedGhost,
        b: { ...recordedGhost.b, duration_s: 600, series: recordedGhost.a.series },
        split_deltas: [{ fraction: 0, delta_s: 0 }, { fraction: 1, delta_s: 0 }],
        winner_drive_id: null, margin_s: 0,
      },
    });
    await page.getByRole('option', { name: 'Open leaderboard for Home → Office', exact: true }).click();
    await waitForHarnessReady(page, context.mocks);
    const brief = page.getByTestId('segment-ghost-brief');
    await value(brief, 'winner', 'Dead heat');
    await value(brief, 'attempt-a', '10:00');
    await value(brief, 'attempt-b', '10:00');
    await expect(metric(brief, 'winner')).toContainText('Identical recorded times.');
    await finish(page, context);
  });
});
