import { test } from '@playwright/test';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';
import {
  attachDiagnostics,
  expectDialogsInsideViewport,
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  expectStableChartHeights,
  monitorPage,
  waitForRoute,
} from './qualityAssertions';
import { QUALITY_ROUTES } from './routeRegistry';

for (const route of QUALITY_ROUTES) {
  test(`${route.name} has stable responsive geometry`, async ({ page }, testInfo) => {
    const theme = testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
    await seedBrowserState(page, theme, route.path);
    const mockApi = await installApiMocks(page, 'populated', theme);
    const diagnostics = monitorPage(page);

    await waitForRoute(page, route.path);
    await waitForHarnessReady(page, mockApi);
    await expectThemeApplied(page, theme);
    await expectNoHorizontalOverflow(page);
    await expectStableChartHeights(page);
    if (route.name === 'data-repair') {
      await page.getByRole('button', { name: /review case 301/i }).click();
      await expectDialogsInsideViewport(page);
      await page.keyboard.press('Escape');
    }
    await attachDiagnostics(testInfo, diagnostics);
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mockApi);
  });
}
