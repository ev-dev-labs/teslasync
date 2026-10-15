import { expect, test } from '@playwright/test';
import type { APICallLog, APICallLogResponse, APICallLogStats, ErrorStats } from '../src/api/types';
import type { WebErrorsSummary } from '../src/types/admin';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectIntegratedGridFooter, expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic API diagnostic fixtures');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1024, 1440]) {
    test(`API evidence header filters and inspection work at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      const path = '/api-logs?page=3';
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      const diagnostics = monitorPage(page);
      const requests: URLSearchParams[] = [];
      const event: APICallLog = {
        id: 901, ts: '2026-08-26T15:15:00.000Z', vehicle_id: null,
        service: 'tesla-api', http_method: 'GET', endpoint: '/synthetic/diagnostic',
        status_code: 200, duration_ms: 12, error_message: null, rate_limited: false,
        request_headers: { 'Content-Type': 'application/json' }, response_headers: null,
        request_body: '{"synthetic":true}', response_body: '{"recorded":true}',
      };
      await page.route('**/api/v1/api-logs?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        requests.push(params);
        const noMatch = params.get('endpoint') === '/not-in-loaded-page';
        await fulfillApiFixture(route, mocks, {
          json: {
            data: noMatch ? [] : [{ ...event, http_method: params.get('method') || 'GET' }],
            total: noMatch ? 0 : params.get('method') ? 1 : 76,
            limit: Number(params.get('limit') ?? 25), offset: Number(params.get('offset') ?? 0),
          } satisfies APICallLogResponse,
        });
      });
      await page.route('**/api/v1/api-logs/stats*', route => fulfillApiFixture(route, mocks, {
        json: {
          total_calls: 76, by_method: { GET: 75, POST: 1 }, by_service: { 'tesla-api': 76 },
          error_rate: 0, error_count: 0, avg_duration_ms: 12, last_24h: 76,
        } satisfies APICallLogStats,
      }));
      await page.route('**/api/v1/system/errors/stats', route => fulfillApiFixture(route, mocks, {
        json: { total_errors: 0, uptime: '2h', by_code: {} } satisfies ErrorStats,
      }));
      await page.route('**/api/v1/admin/web-errors/summary', route => fulfillApiFixture(route, mocks, {
        json: {
          window_seconds: 3600, windowSeconds: 3600, total: 0, top: [],
          as_of: event.ts, asOf: event.ts,
        } satisfies WebErrorsSummary,
      }));
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const table = main.getByRole('table', { name: 'API call log', exact: true });
      await expect(table).toContainText('/synthetic/diagnostic');
      await expect.poll(() => requests.some(params => params.get('offset') === '75')).toBe(true);
      await expectIntegratedGridFooter(table);
      const frame = table.locator('xpath=ancestor::*[@data-grid-frame][1]');
      await expect(frame.getByRole('radio', { name: 'Compact', exact: true })).toBeVisible();
      await frame.getByRole('radio', { name: 'Comfortable', exact: true }).click();
      await expect(frame.getByRole('radio', { name: 'Comfortable', exact: true })).toBeChecked();
      await expect(frame.getByRole('button', { name: 'Export list', exact: true })).toBeVisible();
      await expect(frame.getByRole('button', { name: 'Reorder or hide columns' })).toBeVisible();
      const search = frame.getByPlaceholder('Filter by endpoint...', { exact: true });
      await search.fill('/synthetic');
      await expect.poll(() => requests.some(params =>
        params.get('endpoint') === '/synthetic' && Number(params.get('offset') ?? 0) === 0)).toBe(true);
      await search.fill('');
      await expect.poll(() => new URL(page.url()).searchParams.get('endpoint')).toBeNull();
      await table.getByRole('button', { name: 'Expand row', exact: true }).click();
      await expect(table).toContainText('"recorded": true');
      await expect(table.getByRole('button', { name: 'Copy Request body', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath(`api-inspection-${width}-${theme}.png`), fullPage: true });
      const methodTrigger = table.getByRole('button', { name: 'Method filter', exact: true });
      expect(await methodTrigger.evaluate(element => element.closest('th') != null)).toBe(true);
      await methodTrigger.click();
      const methodFilter = page.getByRole('dialog', { name: 'Method filter', exact: true });
      await methodFilter.getByRole('combobox', { name: 'Method', exact: true }).selectOption('POST');
      await methodFilter.getByRole('button', { name: 'Done', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      expect(new URL(page.url()).searchParams.get('page')).toBeNull();
      expect(new URL(page.url()).searchParams.get('method')).toBe('POST');
      await expect.poll(() => requests.some(params =>
        params.get('method') === 'POST' && Number(params.get('offset') ?? 0) === 0)).toBe(true);
      await expect(table).toContainText('POST');
      await page.reload();
      await waitForHarnessReady(page, mocks);
      await table.getByRole('button', { name: 'Method filter', exact: true }).click();
      const persisted = page.getByRole('dialog', { name: 'Method filter', exact: true });
      await expect(persisted.getByRole('combobox', { name: 'Method', exact: true })).toHaveValue('POST');
      await persisted.getByRole('button', { name: 'Clear', exact: true }).click();
      await persisted.getByRole('button', { name: 'Done', exact: true }).click();
      await table.getByRole('button', { name: 'Endpoint filter', exact: true }).click();
      const endpointFilter = page.getByRole('dialog', { name: 'Endpoint filter', exact: true });
      await endpointFilter.getByRole('textbox', { name: 'Endpoint', exact: true }).fill('/not-in-loaded-page');
      await endpointFilter.getByRole('button', { name: 'Done', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expect(table).not.toContainText('/synthetic/diagnostic');
      await expect(table.getByRole('button', { name: 'Endpoint filter', exact: true })).toBeVisible();
      await table.getByRole('button', { name: 'Endpoint filter', exact: true }).click();
      await page.getByRole('dialog', { name: 'Endpoint filter', exact: true })
        .getByRole('button', { name: 'Clear', exact: true }).click();
      await page.getByRole('dialog', { name: 'Endpoint filter', exact: true })
        .getByRole('button', { name: 'Done', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expect(table).toContainText('/synthetic/diagnostic');
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`api-header-evidence-${width}-${theme}.png`), fullPage: true });
      await assertMockApiComplete(page, mocks);
    });
  }
}
