import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks, seedBrowserState,
  waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import {
  installResaleFixtures, replacementCertificate, resaleEndpoints,
  type ResaleFixtureState,
} from './specialized-resale.supported.fixtures';

type Theme = 'dark' | 'light';

async function setup(page: Page, theme: Theme, width: number) {
  test.skip(process.env.E2E_MOCKS === '0', 'Synthetic source contracts require strict API mocks');
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await seedBrowserState(page, theme, '/resale-vault');
  const diagnostics = monitorPage(page);
  const mocks = await installApiMocks(page, 'populated', theme);
  expect(mocks).not.toBeNull();
  const state = await installResaleFixtures(page, mocks);
  return { mocks, state, diagnostics };
}

async function ready(page: Page, mocks: MockApiController | null, theme: Theme) {
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
  await expect(page.locator('main [data-operational-brief]')).toHaveCount(7);
}

async function metric(brief: Locator, key: string, value: string | RegExp, state = 'value') {
  const item = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function review(page: Page, brief: Locator, title: string, details: readonly string[]) {
  const values = await brief.locator('[data-operational-value]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  for (const detail of details) await expect(drawer).toContainText(detail);
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(values);
}

async function globalRefresh(page: Page) {
  // The page has no local sync action. The real global palette command invalidates active queries.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill('Refresh data');
  await palette.getByRole('option', { name: 'Refresh data', exact: true }).click();
  await expect(palette).toHaveCount(0);
}

async function sourceLedger(mocks: MockApiController | null, state: ResaleFixtureState) {
  for (const endpoint of resaleEndpoints) {
    expect(state.reads[endpoint.path], endpoint.path).toBeGreaterThan(0);
    expect(mocks?.requests.some(request =>
      request.path === `/api/v1${endpoint.path}` && request.method === 'GET'
      && request.disposition === 'fulfilled')).toBe(true);
  }
  expect(state.verifyBodies.length).toBeGreaterThan(0);
  expect(mocks?.requests.some(request => request.path === '/api/v1/public/battery-certificate/verify'
    && request.method === 'POST' && request.disposition === 'fulfilled')).toBe(true);
}

async function positiveMetrics(page: Page) {
  const battery = page.getByTestId('vault-battery-brief');
  await metric(battery, 'soh', /98.*%/);
  await metric(battery, 'capacity', /73\.50\s+kWh/);
  await metric(battery, 'original-capacity', /75\.00\s+kWh/);
  await metric(battery, 'cycles', /123\.5/);
  await metric(battery, 'fast-charge-ratio', /25.*%/);
  await metric(battery, 'charge-limit', /80.*%/);
  const certificate = page.getByTestId('vault-certificate-brief');
  await metric(certificate, 'certificate-soh', /96.*%/);
  await metric(certificate, 'certificate-capacity', /72\.00\s+kWh/);
  await metric(certificate, 'certificate-cycles', '125');
  await metric(certificate, 'certificate-habits', /88.*\/ 100/);
  await metric(page.getByTestId('vault-software-brief'), 'updates', '2');
  const driving = page.getByTestId('vault-driving-brief');
  await metric(driving, 'drives', '12');
  await metric(driving, 'distance', /150\.00\s+km/);
  await metric(driving, 'duration', /2\.00\s+h/);
  await metric(driving, 'efficiency', /0\.15\s+kWh\/km/);
  await metric(driving, 'regen', /20.*%/);
  await metric(driving, 'co2', /24.*kg/);
  const charging = page.getByTestId('vault-charging-brief');
  await metric(charging, 'sessions', '2');
  await metric(charging, 'energy-added', /70\.00\s+kWh/);
  await metric(charging, 'fast-charge-sessions', '1');
  await metric(charging, 'peak-power', /50\.00\s+kW/);
  await metric(charging, 'cost', /12\.50/);
  await expect(charging.locator('[data-operational-metric="cost"] [data-operational-value]'))
    .not.toContainText(/USD|\$/);
  await expect(charging).toContainText('the source does not supply a currency denomination');
  await metric(page.getByTestId('vault-incidents-brief'), 'events', '2');
  await metric(page.getByTestId('vault-incidents-brief'), 'acknowledged', '1');
  const maintenance = page.getByTestId('vault-maintenance-brief');
  await metric(maintenance, 'scheduled-items', '—', 'missing');
  await metric(maintenance, 'service-records', '—', 'missing');
  await expect(maintenance).toContainText('No evidence supplied');
}

test('supported resale positive typed evidence retains source windows and disclosure changes only the report at 320px dark', async ({ page }) => {
  test.setTimeout(120_000);
  const { mocks, state, diagnostics } = await setup(page, 'dark', 320);
  await page.goto('/resale-vault');
  await ready(page, mocks, 'dark');
  await expect(page.getByText('Signature verified', { exact: true })).toBeVisible();
  await positiveMetrics(page);
  await expect(page.getByText('Driving score: 92 (A)', { exact: true })).toBeVisible();
  await expect(page.getByText('2026.24.2', { exact: true }).first()).toBeVisible();
  const inventory = page.getByRole('table', { name: 'Evidence inventory', exact: true });
  await expect(inventory.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Warranty', exact: true }),
  })).toContainText('No data');
  await expect(page.locator('main')).not.toContainText(/PRIVATE_DETAILS_SENTINEL|PRIVATE_ACTOR_SENTINEL/);
  await review(page, page.getByTestId('vault-battery-brief'), 'Battery measurements', [
    '73.50 kWh', '75.00 kWh', '2026-01-12', '2026-08-26', 'Battery health loaded:',
    'Battery Passport measurements; missing readings are not inferred.',
  ]);
  await review(page, page.getByTestId('vault-certificate-brief'), 'Certificate measurements', [
    '72.00 kWh', '2026-08-26T14:00:00Z', '2026-09-25T14:00:00Z',
    'Battery certificate loaded:', 'signature verification is shown separately',
  ]);
  await review(page, page.getByTestId('vault-driving-brief'), 'Driving', [
    '150.00 km', '2.00 h', '2026-08-21', '2026-08-23',
    'Drives observed loaded:', 'Driving loaded:', 'Driving score loaded:',
    'aggregates and returned record counts may cover different windows.',
  ]);
  await review(page, page.getByTestId('vault-charging-brief'), 'Charging', [
    '70.00 kWh', '50.00 kW', '2026-08-10', '2026-08-14', 'Charging loaded:',
    'No currency conversion is applied.',
  ]);
  await review(page, page.getByTestId('vault-software-brief'), 'Observed software history', [
    'Complete source coverage and observation bounds are not established', 'Software updates loaded:',
  ]);
  await review(page, page.getByTestId('vault-incidents-brief'), 'Observed security history', [
    '2026-06-05', '2026-07-07', 'Security incidents loaded:', 'no incident severity or legal conclusion is inferred.',
  ]);
  await review(page, page.getByTestId('vault-maintenance-brief'), 'Maintenance record counts', [
    'No measurement supplied', 'Scheduled items loaded:', 'Service records loaded:',
  ]);
  const before = await page.locator('main [data-operational-value]').allTextContents();
  await page.getByRole('tab', { name: 'Disclosure profile', exact: true }).click();
  await page.getByRole('radio', { name: /^Custom(?:\s|$)/ }).check();
  await page.getByRole('checkbox', { name: 'Charging history', exact: true }).uncheck();
  await page.getByRole('tab', { name: 'Preview & sign', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Excluded by profile (1)', exact: true })).toBeVisible();
  await expect(page.getByText('charging_history', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('day precision');
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await expect(page.locator('main [data-operational-brief]')).toHaveCount(7);
  expect(await page.locator('main [data-operational-value]').allTextContents()).toEqual(before);
  const chargingRow = page.getByRole('table', { name: 'Evidence inventory', exact: true })
    .getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Charging history', exact: true }) });
  await expect(chargingRow).toContainText('Data found');
  await expect(chargingRow).toContainText('Excluded by profile');
  await sourceLedger(mocks, state);
  await expectNoHorizontalOverflow(page);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(page, mocks);
});

test('supported resale independent stats failure stays missing then real global refresh retains published SI aggregates at 1440px light', async ({ page }) => {
  test.setTimeout(120_000);
  const { mocks, state, diagnostics } = await setup(page, 'light', 1440);
  state.failStats = true;
  await page.goto('/resale-vault');
  await ready(page, mocks, 'light');
  const driving = page.getByTestId('vault-driving-brief');
  await metric(driving, 'drives', '2');
  for (const key of ['distance', 'duration', 'efficiency', 'regen', 'co2']) {
    await metric(driving, key, '—', 'missing');
  }
  await expect(driving).toContainText('Some sources unavailable');
  await metric(page.getByTestId('vault-battery-brief'), 'capacity', /73\.50\s+kWh/);
  await metric(page.getByTestId('vault-charging-brief'), 'sessions', '2');
  await expect(page.getByText('Driving score: 92 (A)', { exact: true })).toBeVisible();
  await expect(page.getByText('Signature verified', { exact: true })).toBeVisible();
  state.failStats = false;
  const reads = state.reads['/drives/stats'] ?? 0;
  await globalRefresh(page);
  await expect.poll(() => state.reads['/drives/stats'] ?? 0).toBeGreaterThan(reads);
  await positiveMetrics(page);
  await expect(driving).toContainText('Evidence available');
  const published = await driving.locator('[data-operational-value]').allTextContents();
  state.failStats = true;
  const failure = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/v1/drives/stats' && response.status() === 422);
  await globalRefresh(page);
  await failure;
  await expect(driving).toContainText('Retained evidence');
  expect(await driving.locator('[data-operational-value]').allTextContents()).toEqual(published);
  await review(page, driving, 'Driving', [
    '150.00 km', '2.00 h', '2026-08-21', '2026-08-23', 'Driving loaded:', 'Driving score loaded:',
  ]);
  await metric(page.getByTestId('vault-charging-brief'), 'cost', /12\.50/);
  await expect(page.getByTestId('vault-charging-brief')).toContainText('Evidence available');
  state.failStats = false;
  await globalRefresh(page);
  await expect(driving).toContainText('Evidence available');
  expect(await driving.locator('[data-operational-value]').allTextContents()).toEqual(published);
  expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
  expect(diagnostics.failedDataRequests.every(request =>
    request.startsWith('422 ') && request.includes('/api/v1/drives/stats?vehicle_id=7'))).toBe(true);
  expect(diagnostics.consoleErrors.every(message =>
    /^Failed to load resource: the server responded with a status of 422\b/.test(message))).toBe(true);
  await expectNoRuntimeFailures({ ...diagnostics, consoleErrors: [], failedDataRequests: [] });
  await sourceLedger(mocks, state);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});

test('supported resale issued certificate fixture agreement never carries a valid badge onto a replaced invalid payload at 1440px dark', async ({ page }) => {
  test.setTimeout(120_000);
  const { mocks, state, diagnostics } = await setup(page, 'dark', 1440);
  await page.goto('/resale-vault');
  await ready(page, mocks, 'dark');
  await expect(page.getByText('Signature verified', { exact: true })).toBeVisible();
  await metric(page.getByTestId('vault-certificate-brief'), 'certificate-capacity', /72\.00\s+kWh/);
  const attempts = state.verifyBodies.length;
  state.issue = structuredClone(replacementCertificate);
  state.verifyValid = false;
  state.holdVerification = true;
  try {
    await globalRefresh(page);
    await expect.poll(() => state.verifyBodies.length).toBeGreaterThan(attempts);
    await expect.poll(() => state.releaseVerification !== null).toBe(true);
    await metric(page.getByTestId('vault-certificate-brief'), 'certificate-soh', /94.*%/);
    await metric(page.getByTestId('vault-certificate-brief'), 'certificate-capacity', /70\.50\s+kWh/);
    await expect(page.getByText('Signature verified', { exact: true })).toHaveCount(0);
    state.releaseVerification?.();
    state.holdVerification = false;
    await expect(page.getByText('Self-verification failed — the signature may be stale.', { exact: true })).toBeVisible();
    await expect(page.getByText('Signature verified', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('vault-certificate-brief')).toContainText('Evidence available');
    await metric(page.getByTestId('vault-certificate-brief'), 'certificate-cycles', '126');
    await metric(page.getByTestId('vault-battery-brief'), 'soh', /98.*%/);
    await review(page, page.getByTestId('vault-certificate-brief'), 'Certificate measurements', [
      '70.50 kWh', '2026-08-27T14:00:00Z', '2026-09-26T14:00:00Z',
      'signature verification is shown separately and applies only to this exact payload.',
    ]);
    state.verifyValid = true;
    const beforeRetry = state.verifyBodies.length;
    await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
    await expect.poll(() => state.verifyBodies.length).toBeGreaterThan(beforeRetry);
    await expect(page.getByText('Signature verified', { exact: true })).toBeVisible();
    await expect(page.getByText('Self-verification failed — the signature may be stale.', { exact: true })).toHaveCount(0);
    await sourceLedger(mocks, state);
    await expectNoRuntimeFailures(diagnostics);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  } finally {
    state.holdVerification = false;
    state.releaseVerification?.();
  }
});
