import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AXE_DEBT_BY_ROUTE, axeTargets } from './axeBaseline';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi';

for (const path of ['/', '/vehicles', '/data-repair']) {
  test(`axe WCAG runtime audit: ${path}`, async ({ page }, testInfo) => {
    await seedBrowserState(page, 'dark', path);
    const mockApi = await installApiMocks(page, 'populated');
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);
    await expect(page.getByText(/something went wrong|page failed to load/i)).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    await testInfo.attach('axe-results.json', {
      body: Buffer.from(JSON.stringify(results, null, 2)),
      contentType: 'application/json',
    });
    const debt = AXE_DEBT_BY_ROUTE[path] ?? [];
    const expectedRules = new Set(debt.map((item) => item.rule));
    const unbaselinedRules = results.violations.filter((item) => !expectedRules.has(item.id));
    expect(unbaselinedRules, unbaselinedRules.map((item) => `${item.id}: ${item.help}`).join('\n'))
      .toEqual([]);
    for (const item of debt) {
      expect(
        axeTargets(results.violations, item.rule),
        `Known ${item.rule} debt changed for ${path}; reconcile only after review`,
      ).toEqual([...item.targets].sort());
    }
    await assertMockApiComplete(page, mockApi);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`mobile ${theme} bottom navigation meets WCAG contrast`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedBrowserState(page, theme, '/charging');
    const mockApi = await installApiMocks(page, 'populated', theme);

    await page.goto('/charging', { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);
    await expectThemeApplied(page, theme);

    const nav = page.locator('[data-role="bottom-tab-bar"]');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS(
      'background-color',
      theme === 'light' ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.6)',
    );
    const geometry = await nav.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

    const results = await new AxeBuilder({ page })
      .include('[data-role="bottom-tab-bar"]')
      .withRules(['color-contrast'])
      .analyze();
    const screenshotName = `mobile-${theme}-bottom-navigation.png`;
    const screenshotPath = testInfo.outputPath(screenshotName);
    await nav.screenshot({ path: screenshotPath });
    await testInfo.attach(screenshotName, {
      path: screenshotPath,
      contentType: 'image/png',
    });
    expect(
      results.violations,
      results.violations.map((item) => `${item.id}: ${item.help}`).join('\n'),
    ).toEqual([]);
    await assertMockApiComplete(page, mockApi);
  });
}
