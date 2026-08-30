import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import {
  attachDiagnostics,
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  monitorPage,
} from './qualityAssertions';

const JOURNEYS = [
  {
    // Critical operator chain: dashboard/fleet state -> vehicle inspect
    // (roster) -> battery health -> charging history. Mirrors the
    // backend's OperatorChainJourneySteps synthetic probe
    // (internal/synthetic/probe_journey.go) at the UI layer.
    name: 'critical operator chain',
    routes: ['/', '/vehicles', '/battery', '/charging'],
  },
  {
    name: 'operational evidence review',
    routes: ['/drives', '/data-repair'],
  },
] as const;

const ROUTE_READY_BUDGET_MS = 8_000;

test.describe.configure({ mode: 'serial' });

for (const journey of JOURNEYS) {
  test(`production synthetic: ${journey.name}`, async ({ page }, testInfo) => {
    testInfo.setTimeout(journey.routes.length * 20_000);
    await seedBrowserState(page, 'dark', journey.routes[0]);
    const mockApi = await installApiMocks(page, 'populated');
    const diagnostics = monitorPage(page);
    const timings: Array<{ route: string; readyMs: number }> = [];

    for (const [index, route] of journey.routes.entries()) {
      const startedAt = Date.now();
      if (index === 0) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
      } else {
        await page.evaluate((nextRoute) => {
          history.pushState({}, '', nextRoute);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, route);
      }

      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
      await waitForHarnessReady(page, mockApi);
      await expectNoHorizontalOverflow(page);

      const readyMs = Date.now() - startedAt;
      timings.push({ route, readyMs });
      expect(readyMs).toBeLessThan(ROUTE_READY_BUDGET_MS);
    }

    if (process.env.E2E_SENSITIVE !== '1') {
      await testInfo.attach(`synthetic-${journey.name.replaceAll(' ', '-')}.json`, {
        body: Buffer.from(JSON.stringify({ journey: journey.name, timings }, null, 2)),
        contentType: 'application/json',
      });
    }
    if (process.env.E2E_SENSITIVE !== '1') {
      await attachDiagnostics(testInfo, diagnostics);
    }
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mockApi);
  });
}
