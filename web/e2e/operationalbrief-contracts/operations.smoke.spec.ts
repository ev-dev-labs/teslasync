import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport,
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  monitorPage,
} from '../qualityAssertions';
import {
  catalogReport,
  claimReport,
  exportJobs,
  failedLaterCatalog,
  installExportFixtures,
  installServiceFixtures,
  operationsNow,
  operationsRoutes,
  serviceReport,
  unknownCatalogReport,
  unknownServiceReport,
  zeroCatalogReport,
  zeroServiceReport,
} from './operations.fixtures';

async function expectMetric(brief: Locator, key: string, value: string, state = 'value') {
  const metric = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(metric).toHaveCount(1);
  await expect(metric).toHaveAttribute('data-value-state', state);
  await expect(metric.locator('[data-operational-value]')).toHaveText(value);
}

async function readDownload(download: Download): Promise<string> {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error('List export did not provide a download stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function reviewDetails(page: Page, brief: Locator, title: string, details: readonly string[]) {
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  for (const detail of details) await expect(dialog).toContainText(detail);
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.press('Space');
  await expect(dialog).toBeVisible();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function expectServiceSections(page: Page) {
  for (const name of [
    'Official NHTSA TSB catalog', 'Vehicle match context', 'Warranty countdown',
    'Warranty claim draft', 'Recall inventory', 'Manufacturer communications & TSBs',
    'Ranked observed symptoms', 'Evidence & limitations', 'Source freshness',
  ]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
}

test.beforeAll(() => {
  for (const path of Object.values(operationsRoutes)) {
    expect(ROUTE_REGISTRY.some(route => route.path === path.split('?')[0])).toBe(true);
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440] as const) {
    test.describe(`operations briefs ${width}px ${theme}`, () => {
      test.setTimeout(60_000);
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.setFixedTime(new Date(operationsNow));
      });

      test('exports preserve raw counts, binary size, selection, list exports and artifact links', async ({ page }) => {
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.exports);
        const mocks = await installApiMocks(page, 'populated', theme);
        expect(mocks, 'this strict fixture suite requires E2E_MOCKS').not.toBeNull();
        const fixture = await installExportFixtures(page, mocks);
        await page.goto(operationsRoutes.exports);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByRole('region', { name: 'Export summary', exact: true });
        await expect(brief).toHaveAttribute('data-operational-brief', 'true');
        await expect(brief.getByRole('listitem')).toHaveCount(5);
        for (const [key, value] of [['total', '6'], ['ready', '2'], ['in-progress', '2'], ['failed', '1'], ['storage', '3.75 KB']]) {
          await expectMetric(brief, key, value);
        }
        await expect(brief).toContainText('Export-job list snapshot');
        await expect(brief).toContainText('Loaded jobs before table filters and pagination; no date window is applied.');
        await expect(brief).toContainText('Last successful load:');
        const readyLink = page.getByRole('link', { name: `Download export ${exportJobs[0].id}`, exact: true });
        await expect(readyLink).toHaveAttribute('href', `/api/v1/export/jobs/${exportJobs[0].id}/download`);
        await expect(readyLink).toHaveAttribute('download', '');
        await expect(page.getByRole('link', { name: /^Download export / })).toHaveCount(2);
        const selection = page.getByRole('checkbox', { name: /^Select drives export,/ });
        await selection.check();
        await expectMetric(brief, 'total', '6');
        await expectMetric(brief, 'storage', '3.75 KB');
        const grid = page.locator('[data-grid-frame]');
        await expect(page.getByRole('heading', { name: 'Export jobs', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Status breakdown', exact: true })).toBeVisible();
        await grid.getByRole('button', { name: 'Export list', exact: true }).click();
        const exportMenu = page.getByRole('menu', { name: 'Export list', exact: true });
        await expect(exportMenu.getByRole('radio', { name: 'Selected (1)', exact: true })).toBeChecked();
        const jsonDownload = page.waitForEvent('download');
        await exportMenu.getByRole('menuitem', { name: 'Download as JSON', exact: true }).click();
        const selectedRows: unknown = JSON.parse(await readDownload(await jsonDownload));
        expect(selectedRows).toEqual([expect.objectContaining({
          type: 'drives', format: 'csv', status: 'ready', file_size: 1024,
        })]);
        await grid.getByRole('button', { name: 'Export list', exact: true }).click();
        const csvDownload = page.waitForEvent('download');
        await exportMenu.getByRole('menuitem', { name: 'Download as CSV', exact: true }).click();
        const csv = await readDownload(await csvDownload);
        expect(csv).toContain('drives');
        expect(csv).not.toContain('charging');
        await grid.getByRole('button', { name: 'Export list', exact: true }).click();
        await exportMenu.getByRole('radio', { name: 'Visible (6)', exact: true }).click();
        await expect(exportMenu.getByRole('radio', { name: 'Visible (6)', exact: true })).toBeChecked();
        const allDownload = page.waitForEvent('download');
        await exportMenu.getByRole('menuitem', { name: 'Download as JSON', exact: true }).click();
        const allRows: unknown = JSON.parse(await readDownload(await allDownload));
        expect(allRows).toEqual(exportJobs.map(job => expect.objectContaining({
          type: job.type, format: job.format, status: job.status,
        })));
        if (width === 1440) {
          await grid.getByRole('button', { name: 'Type filter', exact: true }).click();
          const filter = page.getByRole('dialog', { name: 'Type filter', exact: true });
          await filter.getByRole('checkbox', { name: 'Select all shown values', exact: true }).uncheck();
          await filter.getByRole('checkbox', { name: 'drives', exact: true }).check();
          await filter.getByRole('button', { name: 'Done', exact: true }).click();
          await expect(grid.getByRole('checkbox', { name: /export,/ })).toHaveCount(1);
          await expectMetric(brief, 'total', '6');
          await expectMetric(brief, 'storage', '3.75 KB');
          await grid.getByRole('button', { name: 'Type filter', exact: true }).click();
          await filter.getByRole('button', { name: 'Clear', exact: true }).click();
          await filter.getByRole('button', { name: 'Done', exact: true }).click();
        }
        await reviewDetails(page, brief, 'Export summary', [
          'Every job in the returned list, including expired jobs and unrecognized statuses.',
          'Queued and processing jobs combined; this is not a completion estimate.',
          'Sum of known positive finite file sizes in bytes across all returned jobs; missing or invalid sizes contribute nothing.',
          'Binary byte units use saved precision and locale. A zero footprint displays as —, not as an unknown source.',
          'Derived from the export/jobs response snapshot; list coverage is not an all-time or date-range guarantee.',
        ]);
        await expect(page.getByRole('checkbox', { name: /^Deselect drives export,/ })).toBeChecked();
        await grid.getByRole('button', { name: 'Delete', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: 'Delete export jobs?', exact: true });
        await expect(confirmation).toContainText('Selected jobs and their downloadable artifacts will be permanently removed.');
        await page.keyboard.press('Escape');
        await expect(confirmation).toHaveCount(0);
        expect(fixture.deletions).toEqual([]);
        await expect(readyLink).toHaveAttribute('href', `/api/v1/export/jobs/${exportJobs[0].id}/download`);
        await grid.getByRole('button', { name: 'Delete', exact: true }).click();
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect.poll(() => fixture.deletions).toEqual([[exportJobs[0].id]]);
        await expectMetric(brief, 'total', '5');
        await expectMetric(brief, 'ready', '1');
        await expectMetric(brief, 'storage', '2.75 KB');
        await expect(readyLink).toHaveCount(0);
        await expect(grid.getByRole('checkbox', { checked: true })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });

      test('successful empty export snapshot is measured zero, including zero-size display', async ({ page }) => {
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.exports);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installExportFixtures(page, mocks, []);
        await page.goto(operationsRoutes.exports);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = page.getByRole('region', { name: 'Export summary', exact: true });
        for (const key of ['total', 'ready', 'in-progress', 'failed']) await expectMetric(brief, key, '0');
        await expectMetric(brief, 'storage', '—');
        await expect(brief).toContainText('Export-job list snapshot');
        await expect(page.getByText('No exports yet', { exact: true })).toBeVisible();
        await reviewDetails(page, brief, 'Export summary', [
          'A zero footprint displays as —, not as an unknown source.',
          'Loaded jobs before table filters and pagination; no date window is applied.',
        ]);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });

      test('failed initial export source stays unknown rather than becoming a successful empty list', async ({ page }) => {
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.exports);
        const mocks = await installApiMocks(page, 'populated', theme);
        const fixture = await installExportFixtures(page, mocks);
        fixture.fail();
        await page.goto(operationsRoutes.exports);
        const brief = page.getByRole('region', { name: 'Export summary', exact: true });
        await expect(brief).toContainText('Export-job source failed', { timeout: 30_000 });
        await expect(brief).toContainText('Successful load time is unknown.');
        for (const key of ['total', 'ready', 'in-progress', 'failed', 'storage']) {
          await expectMetric(brief, key, '—', 'missing');
        }
        await expect(page.getByText('No exports yet', { exact: true })).toHaveCount(0);
        await reviewDetails(page, brief, 'Export summary', ['Successful load time is unknown.']);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        expect(diagnostics.failedDataRequests.every(request => request.includes('/api/v1/export/jobs'))).toBe(true);
      });

      test('export refresh failure retains publication and recovery restores source status', async ({ page }) => {
        test.setTimeout(60_000);
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.exports);
        const mocks = await installApiMocks(page, 'populated', theme);
        const fixture = await installExportFixtures(page, mocks);
        await page.goto(operationsRoutes.exports);
        await waitForHarnessReady(page, mocks);
        const brief = page.getByRole('region', { name: 'Export summary', exact: true });
        const published = await brief.locator('[data-operational-metric]').allTextContents();
        const reads = fixture.reads;
        fixture.fail();
        const refresh = page.locator('[data-role="page-header"]').getByRole('button', { name: 'Refresh', exact: true });
        await refresh.click();
        await expect.poll(() => fixture.reads).toBeGreaterThan(reads);
        await expect(brief).toContainText('Retained export jobs', { timeout: 30_000 });
        expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(published);
        await expect(page.getByRole('link', { name: /^Download export / })).toHaveCount(2);
        await reviewDetails(page, brief, 'Export summary', [
          'Retained export jobs',
          'Every job in the returned list, including expired jobs and unrecognized statuses.',
        ]);
        fixture.recover();
        await refresh.click();
        await expect(brief).toContainText('Export-job list snapshot');
        await expectMetric(brief, 'total', '6');
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.every(request => request.includes('/api/v1/export/jobs'))).toBe(true);
      });

      test('service report preserves source-specific trust, entity context and all official period controls', async ({ page, context }) => {
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.service);
        const mocks = await installApiMocks(page, 'populated', theme);
        const fixture = await installServiceFixtures(page, mocks, serviceReport, failedLaterCatalog);
        await page.goto(operationsRoutes.service);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        await expectServiceSections(page);
        const summary = page.getByTestId('service-intelligence-summary');
        const catalog = page.getByTestId('service-intelligence-catalog-summary');
        await expect(summary).toHaveAttribute('data-operational-brief', 'true');
        await expect(catalog).toHaveAttribute('data-operational-brief', 'true');
        for (const [key, value] of [['recall-candidates', '1'], ['potentially-applicable', '1'], ['manufacturer-communications', '1'], ['symptom-matches', '2']]) {
          await expectMetric(summary, key, value);
        }
        await expect(summary).toContainText('Returned report');
        await expect(summary).toContainText('Selected vehicle · source windows may differ');
        await expect(summary).toContainText('Report generated');
        await expect(page.getByRole('table', { name: 'Vehicle match context', exact: true })).toContainText('Tesla Model 3');
        await expect(page.getByRole('table', { name: 'Vehicle match context', exact: true })).toContainText('2021');
        await expectMetric(catalog, 'normalized-tesla-records', '321');
        await expectMetric(catalog, 'official-period-artifacts', '5');
        await expect(catalog).toContainText('Fresh');
        await expect(catalog).toContainText('Global catalog · official periods');
        await expect(catalog.getByTitle('2026-08-05T07:00:00.000Z')).toBeVisible();
        await expect(page.getByText('Latest import failed', { exact: true })).toBeVisible();
        await expect(page.getByText(failedLaterCatalog.latest_attempt!.error_detail!, { exact: true })).toBeVisible();
        await expect(page.getByText('1000 source rows', { exact: true })).toBeVisible();
        await expect(page.getByText('188 Tesla rows', { exact: true })).toBeVisible();
        await expect(page.getByText('2 rejected', { exact: true })).toBeVisible();
        await expect(page.getByTitle(catalogReport.latest_successful!.artifact_sha256!)).toHaveText('SHA-256 aaaaaaaaaaaa…');
        const periods = ['2005–2009', '2010–2014', '2015–2019', '2020–2024', '2025–2026'];
        await expect(page.getByRole('button', { name: /^Import official NHTSA artifact for / })).toHaveCount(5);
        for (const period of periods) {
          const control = page.getByRole('button', { name: `Import official NHTSA artifact for ${period}`, exact: true });
          await expect(control).toBeEnabled();
          await expect(control).toHaveText(period === '2025–2026' ? 'Refresh' : 'Import');
        }
        for (const source of serviceReport.sources) {
          const sourceLink = page.locator(`a[href="${source.source_url}"]`);
          await expect(sourceLink).toHaveAccessibleName('Open source');
          await expect(sourceLink).toHaveAttribute('target', '_blank');
          await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
        }
        await expect(page.locator(`a[href="${serviceReport.recall_findings[0].source_document_url}"]`)).toBeVisible();
        await expect(page.locator(`a[href="${serviceReport.communications[0].source_document_url}"]`)).toBeVisible();
        await expect(page.getByRole('link', { name: 'Open evidence source', exact: true }))
          .toHaveAttribute('href', serviceReport.evidence.items[0].source_document_url!);
        await expect(page.getByText('Returned maintenance evidence', { exact: true })).toBeVisible();
        await expect(page.getByText('Campaign completion must be officially confirmed.', { exact: true })).toBeVisible();
        const ranked = page.getByText('first_server_rank', { exact: true }).locator('xpath=ancestor::li[1]');
        await expect(ranked.locator('xpath=following-sibling::li[1]')).toContainText('second_server_rank');
        await expect(page.getByText('Completion unknown', { exact: true })).toBeVisible();
        await reviewDetails(page, summary, 'Service match summary', [
          'Returned model-year recall candidates, not confirmed vehicle eligibility.',
          'Returned applicability hypotheses; campaign completion remains unknown.',
          'Official communications index',
          'Stale',
          'Normalized cache',
          'Maintenance retrieval is unavailable; absence is not completion evidence.',
          'Not scored',
          'No action is recommended from this evidence alone.',
        ]);
        await reviewDetails(page, catalog, 'Catalog coverage summary', [
          'Normalized catalog inventory across imported periods; not the selected vehicle match count.',
          'Allow-listed official periods available to import, not proof that every period has been imported.',
          'Official NHTSA bulk artifacts. Freshness follows the last successful import; a failed later attempt does not replace retained records.',
        ]);
        await page.getByRole('textbox', { name: 'Issue description', exact: true }).fill(claimReport.issue);
        await page.getByRole('button', { name: 'Draft ticket', exact: true }).click();
        await expect(page.getByText(claimReport.subject, { exact: true })).toBeVisible();
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.getByRole('button', { name: 'Copy ticket text', exact: true }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(claimReport.body);
        await expect(page.getByRole('button', { name: 'Open service evidence pack', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Import official NHTSA artifact for 2025–2026', exact: true }).click();
        await expect.poll(() => fixture.importedArtifacts).toEqual([catalogReport.latest_successful!.artifact_url]);
        await expect(page.getByText('Latest import failed', { exact: true })).toHaveCount(0);
        await expectMetric(catalog, 'normalized-tesla-records', '321');
        await expectMetric(summary, 'recall-candidates', '1');
        await expect(page.getByText('Already current', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import official NHTSA artifact for 2025–2026', exact: true })).toBeEnabled();
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });

      test('catalog age crosses the real eight-day boundary without erasing successful inventory', async ({ page }) => {
        const diagnostics = monitorPage(page);
        await page.clock.setFixedTime(new Date('2026-08-13T07:00:00Z'));
        await seedBrowserState(page, theme, operationsRoutes.service);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installServiceFixtures(page, mocks);
        await page.goto(operationsRoutes.service);
        await waitForHarnessReady(page, mocks);
        const catalog = page.getByTestId('service-intelligence-catalog-summary');
        await expect(catalog).toContainText('Stale');
        await expectMetric(catalog, 'normalized-tesla-records', '321');
        await expectMetric(catalog, 'official-period-artifacts', '5');
        await expect(catalog.getByTitle('2026-08-05T07:00:00.000Z')).toBeVisible();
        await expect(page.getByText('Catalog refresh recommended', { exact: true })).toBeVisible();
        await expect(page.getByText('TSB catalog is not populated', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Import official NHTSA artifact for 2025–2026', exact: true }))
          .toHaveText('Refresh');
        await reviewDetails(page, catalog, 'Catalog coverage summary', [
          'Stale',
          'Normalized catalog inventory across imported periods; not the selected vehicle match count.',
          'Official NHTSA bulk artifacts. Freshness follows the last successful import; a failed later attempt does not replace retained records.',
        ]);
        await expectServiceSections(page);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });

      test('service refresh failure retains source details and leaves catalog and warranty requests independent', async ({ page }) => {
        test.setTimeout(60_000);
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.service);
        const mocks = await installApiMocks(page, 'populated', theme);
        const fixture = await installServiceFixtures(page, mocks);
        await page.goto(operationsRoutes.service);
        await waitForHarnessReady(page, mocks);
        await expectServiceSections(page);
        const summary = page.getByTestId('service-intelligence-summary');
        const catalog = page.getByTestId('service-intelligence-catalog-summary');
        const published = await summary.locator('[data-operational-metric]').allTextContents();
        const reportReads = fixture.reportReads;
        const warrantyReads = fixture.warrantyReads;
        const catalogReads = fixture.catalogReads;
        fixture.fail();
        await page.locator('[data-role="page-container"]').getByRole('button', { name: /^Refresh data/ }).click();
        await expect.poll(() => fixture.reportReads).toBeGreaterThan(reportReads);
        await expect(summary).toContainText('Retained report', { timeout: 30_000 });
        expect(await summary.locator('[data-operational-metric]').allTextContents()).toEqual(published);
        expect(fixture.warrantyReads).toBe(warrantyReads);
        expect(fixture.catalogReads).toBe(catalogReads);
        await expectMetric(catalog, 'normalized-tesla-records', '321');
        await expect(catalog).toContainText('Fresh');
        await expect(page.getByText('Retained battery coverage', { exact: true })).toBeVisible();
        await expect(page.locator(`a[href="${serviceReport.recall_findings[0].source_document_url}"]`)).toBeVisible();
        await reviewDetails(page, summary, 'Service match summary', [
          'Retained report',
          'Official communications index',
          'Retained official import remains available.',
          'Maintenance retrieval is unavailable; absence is not completion evidence.',
        ]);
        fixture.recover();
        const notice = page.getByTestId('stale-refresh-warning').filter({
          hasText: 'Recall & service intelligence may be out of date',
        });
        await notice.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(summary).toContainText('Returned report');
        await waitForHarnessReady(page, mocks);
        expect(fixture.warrantyReads).toBe(warrantyReads);
        expect(fixture.catalogReads).toBe(catalogReads);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        expect(diagnostics.failedDataRequests.every(request => request.includes('/api/v1/service-intelligence/vehicles/7?refresh=false'))).toBe(true);
      });

      for (const state of ['zero', 'unknown'] as const) {
        test(`service and catalog ${state} measurements remain distinct from coverage and eligibility`, async ({ page }) => {
          const diagnostics = monitorPage(page);
          await seedBrowserState(page, theme, operationsRoutes.service);
          const mocks = await installApiMocks(page, 'populated', theme);
          await installServiceFixtures(page, mocks,
            state === 'zero' ? zeroServiceReport : unknownServiceReport,
            state === 'zero' ? zeroCatalogReport : unknownCatalogReport);
          await page.goto(operationsRoutes.service);
          await waitForHarnessReady(page, mocks);
          const summary = page.getByTestId('service-intelligence-summary');
          const catalog = page.getByTestId('service-intelligence-catalog-summary');
          for (const key of ['recall-candidates', 'potentially-applicable', 'manufacturer-communications', 'symptom-matches']) {
            await expectMetric(summary, key, state === 'zero' ? '0' : '—', state === 'zero' ? 'value' : 'missing');
          }
          await expectMetric(catalog, 'normalized-tesla-records', state === 'zero' ? '0' : '—', state === 'zero' ? 'value' : 'missing');
          await expectMetric(catalog, 'official-period-artifacts', '5');
          await expect(summary).toContainText(state === 'zero' ? 'Returned report' : 'Summary unavailable');
          await expect(catalog).toContainText(state === 'zero' ? 'Fresh' : 'Not imported');
          if (state === 'unknown') {
            await expect(summary).toContainText('Report generated —');
            await expect(catalog).toContainText('Never');
            await expect(page.getByText('TSB catalog is not populated', { exact: true })).toBeVisible();
          }
          await expect(page.getByRole('table', { name: 'Vehicle match context', exact: true })).toContainText('Tesla Model 3');
          await expect(page.getByRole('button', { name: /^Import official NHTSA artifact for / })).toHaveCount(5);
          await reviewDetails(page, summary, 'Service match summary', [
            'Returned applicability hypotheses; campaign completion remains unknown.',
            'Returned observed signal overlaps; match scores and evidence remain in the ranked records below.',
          ]);
          await reviewDetails(page, catalog, 'Catalog coverage summary', [
            'Allow-listed official periods available to import, not proof that every period has been imported.',
          ]);
          await expectThemeApplied(page, theme);
          await expectNoHorizontalOverflow(page);
          await assertMockApiComplete(page, mocks);
          await expectNoRuntimeFailures(diagnostics);
        });
      }

      test('standalone connect form remains a form, not an invented operational summary', async ({ page }) => {
        const diagnostics = monitorPage(page);
        await seedBrowserState(page, theme, operationsRoutes.connect);
        const mocks = await installApiMocks(page, 'populated', theme);
        await page.goto(operationsRoutes.connect);
        await expect(page.getByRole('heading', { name: 'Connect to your server', exact: true })).toBeVisible();
        const address = page.getByRole('textbox', { name: 'Server address', exact: true });
        await expect(address).toBeFocused();
        await expect(page.getByLabel('Access token (optional)', { exact: true })).toHaveAttribute('type', 'password');
        await expect(page.locator('[data-operational-brief]')).toHaveCount(0);
        const requestsBefore = mocks?.requests.filter(request => request.path === '/api/v1/system/auth-mode').length ?? 0;
        await address.fill('https://teslasync.example.com/unsupported-path');
        await address.press('Enter');
        await expect(page.getByRole('alert')).toHaveText('Enter just the server origin, without a /path.');
        await expect(page).toHaveURL(/\/connect$/);
        expect(mocks?.requests.filter(request => request.path === '/api/v1/system/auth-mode').length ?? 0).toBe(requestsBefore);
        await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled();
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });
    });
  }
}
