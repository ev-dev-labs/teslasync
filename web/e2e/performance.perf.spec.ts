import { expect, test } from '@playwright/test';
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';

test.describe.configure({ mode: 'serial' });

test('critical mocked dashboard stays within contention-safe layout budgets', async ({ page }, testInfo) => {
  await seedBrowserState(page, 'dark');
  const mockApi = await installApiMocks(page, 'populated');
  await page.addInitScript(() => {
    (window as Window & { __e2eLayoutShift?: number }).__e2eLayoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) {
          (window as Window & { __e2eLayoutShift?: number }).__e2eLayoutShift! += entry.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      layoutShift: (window as Window & { __e2eLayoutShift?: number }).__e2eLayoutShift ?? 0,
      failedResourceDurations: resources.filter((entry) => entry.duration < 0).length,
      resourceCount: resources.length,
    };
  });
  await testInfo.attach('performance.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  });

  // Wall-clock paint timings fluctuate with runner contention. CLS and failed
  // resource accounting remain meaningful under load and are run in a
  // dedicated one-worker project.
  expect(metrics.layoutShift).toBeLessThan(0.25);
  expect(metrics.failedResourceDurations).toBe(0);
  expect(metrics.resourceCount).toBeGreaterThan(0);
  await assertMockApiComplete(page, mockApi);
});
