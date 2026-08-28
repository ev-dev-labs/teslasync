import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { QUALITY_ROUTES } from './routeRegistry';

test.describe.configure({ mode: 'serial' });

const INTERACTIVE_BUDGET_MS = 2_500;
const SETTLED_BUDGET_MS = 4_500;
const FCP_BUDGET_MS = 1_500;
const LCP_BUDGET_MS = 2_500;

for (const route of QUALITY_ROUTES) {
  test(`${route.name} stays within principal-route performance budgets`, async ({ page }, testInfo) => {
    await seedBrowserState(page, 'dark', route.path);
    const mockApi = await installApiMocks(page, 'populated');
    await page.addInitScript(() => {
      const target = window as Window & {
        __e2ePerformance?: {
          layoutShift: number;
          longTaskMs: number;
          largestContentfulPaintMs: number;
        };
      };
      target.__e2ePerformance = {
        layoutShift: 0,
        longTaskMs: 0,
        largestContentfulPaintMs: 0,
      };

      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { value: number; hadRecentInput: boolean }
          >) {
            if (!entry.hadRecentInput) target.__e2ePerformance!.layoutShift += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        // Older browser engines do not expose layout-shift entries.
      }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            target.__e2ePerformance!.longTaskMs += entry.duration;
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        // Long-task timing is optional; Chromium exposes it in the CI project.
      }
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const latest = entries.at(-1);
          if (latest) target.__e2ePerformance!.largestContentfulPaintMs = latest.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        // Largest-contentful-paint may be unavailable in non-Chromium engines.
      }
    });

    const startedAt = Date.now();
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible();
    const interactiveMs = Date.now() - startedAt;
    await waitForHarnessReady(page, mockApi);
    const settledMs = Date.now() - startedAt;

    const browserMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const firstContentfulPaint = performance
        .getEntriesByName('first-contentful-paint')[0] as PerformancePaintTiming | undefined;
      const observed = (window as Window & {
        __e2ePerformance?: {
          layoutShift: number;
          longTaskMs: number;
          largestContentfulPaintMs: number;
        };
      }).__e2ePerformance;
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
        firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
        largestContentfulPaintMs: observed?.largestContentfulPaintMs ?? null,
        layoutShift: observed?.layoutShift ?? 0,
        longTaskMs: observed?.longTaskMs ?? 0,
        failedResourceDurations: resources.filter((entry) => entry.duration < 0).length,
        resourceCount: resources.length,
        transferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
      };
    });
    const metrics = { route: route.path, interactiveMs, settledMs, ...browserMetrics };

    await testInfo.attach(`performance-${route.name}.json`, {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json',
    });

    expect(metrics.interactiveMs).toBeLessThan(INTERACTIVE_BUDGET_MS);
    expect(metrics.settledMs).toBeLessThan(SETTLED_BUDGET_MS);
    expect(metrics.firstContentfulPaintMs).not.toBeNull();
    expect(metrics.firstContentfulPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(FCP_BUDGET_MS);
    expect(metrics.largestContentfulPaintMs).not.toBeNull();
    expect(metrics.largestContentfulPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(LCP_BUDGET_MS);
    expect(metrics.layoutShift).toBeLessThan(0.1);
    expect(metrics.longTaskMs).toBeLessThan(1_000);
    expect(metrics.failedResourceDurations).toBe(0);
    expect(metrics.resourceCount).toBeGreaterThan(0);
    await assertMockApiComplete(page, mockApi);
  });
}
