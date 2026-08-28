import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import { QUALITY_ROUTES, type QualityRoute } from './routeRegistry';

test.describe.configure({ mode: 'serial' });

// Per-route performance budgets. Every route in QUALITY_ROUTES is
// exercised (so coverage never regresses below what routeRegistry
// declares), but the five principal operator routes — dashboard,
// fleet roster, battery health, drives, and charging — get budgets
// tuned to their actual composition without weakening the previous
// global ceilings:
//   - fleet/drives/charging are list/table pages and get tighter
//     interaction, paint, transfer, and settle budgets.
//   - chart-heavy battery and widget-heavy dashboard retain the
//     production baseline; route specialization must not excuse a
//     Core Web Vitals regression.
// Routes not listed here (notifications, settings, data-repair, …)
// fall back to DEFAULT_BUDGET so newly-registered routes still get a
// real gate without needing an entry here on day one.
interface PerfBudget {
  interactiveMs: number;
  settledMs: number;
  fcpMs: number;
  lcpMs: number;
  maxLayoutShift: number;
  maxLongTaskMs: number;
  maxTransferBytes: number;
}

const DEFAULT_BUDGET: PerfBudget = {
  interactiveMs: 2_500,
  settledMs: 4_500,
  fcpMs: 1_500,
  lcpMs: 2_500,
  maxLayoutShift: 0.1,
  maxLongTaskMs: 1_000,
  maxTransferBytes: 5_000_000,
};

const ROUTE_BUDGETS: Record<string, Partial<PerfBudget>> = {
  fleet: { interactiveMs: 2_200, settledMs: 4_000, fcpMs: 1_400, lcpMs: 2_200, maxTransferBytes: 4_500_000 },
  drives: { interactiveMs: 2_200, settledMs: 4_000, fcpMs: 1_400, lcpMs: 2_200, maxTransferBytes: 4_500_000 },
  charging: { interactiveMs: 2_200, settledMs: 4_000, fcpMs: 1_400, lcpMs: 2_200, maxTransferBytes: 4_500_000 },
};

function budgetFor(route: QualityRoute): PerfBudget {
  return { ...DEFAULT_BUDGET, ...ROUTE_BUDGETS[route.name] };
}

for (const route of QUALITY_ROUTES) {
  const budget = budgetFor(route);

  test(`${route.name} stays within its route performance budget`, async ({ page }, testInfo) => {
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
      body: Buffer.from(JSON.stringify({ ...metrics, budget }, null, 2)),
      contentType: 'application/json',
    });

    expect(metrics.interactiveMs).toBeLessThan(budget.interactiveMs);
    expect(metrics.settledMs).toBeLessThan(budget.settledMs);
    expect(metrics.firstContentfulPaintMs).not.toBeNull();
    expect(metrics.firstContentfulPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(budget.fcpMs);
    expect(metrics.largestContentfulPaintMs).not.toBeNull();
    expect(metrics.largestContentfulPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(budget.lcpMs);
    expect(metrics.layoutShift).toBeLessThan(budget.maxLayoutShift);
    expect(metrics.longTaskMs).toBeLessThan(budget.maxLongTaskMs);
    expect(metrics.failedResourceDurations).toBe(0);
    expect(metrics.resourceCount).toBeGreaterThan(0);
    expect(metrics.transferBytes).toBeLessThan(budget.maxTransferBytes);
    await assertMockApiComplete(page, mockApi);
  });
}
