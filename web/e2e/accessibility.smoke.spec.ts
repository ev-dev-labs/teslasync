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
import { QUALITY_ROUTES } from './routeRegistry';

for (const route of QUALITY_ROUTES) {
  test(`axe WCAG 2.2 AA runtime audit: ${route.path}`, async ({ page }, testInfo) => {
    await seedBrowserState(page, 'dark', route.path);
    const mockApi = await installApiMocks(page, 'populated');
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);
    await expect(page.getByText(/something went wrong|page failed to load/i)).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .options({
        rules: {
          'target-size': { enabled: true },
        },
      })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    await testInfo.attach('axe-results.json', {
      body: Buffer.from(JSON.stringify(results, null, 2)),
      contentType: 'application/json',
    });
    const evaluatedRules = [
      ...results.passes,
      ...results.violations,
      ...results.incomplete,
      ...results.inapplicable,
    ].map((item) => item.id);
    expect(evaluatedRules).toContain('target-size');
    const debt = AXE_DEBT_BY_ROUTE[route.path] ?? [];
    const expectedRules = new Set(debt.map((item) => item.rule));
    const unbaselinedRules = results.violations.filter((item) => !expectedRules.has(item.id));
    expect(unbaselinedRules, unbaselinedRules.map((item) => `${item.id}: ${item.help}`).join('\n'))
      .toEqual([]);
    for (const item of debt) {
      expect(
        axeTargets(results.violations, item.rule),
        `Known ${item.rule} debt changed for ${route.path}; reconcile only after review`,
      ).toEqual([...item.targets].sort());
    }
    await assertMockApiComplete(page, mockApi);
  });
}

test('forced-colors mode preserves a visible system focus indicator', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
  await page.keyboard.press('Tab');
  const focusIndicator = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return null;
    const style = getComputedStyle(active);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
    };
  });
  expect(focusIndicator).not.toBeNull();
  expect(focusIndicator?.outlineStyle).not.toBe('none');
  expect(focusIndicator?.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focusIndicator?.outlineOffset).toBeGreaterThanOrEqual(2);
  await assertMockApiComplete(page, mockApi);
});

test('reduced-motion mode neutralizes transitions and ambient animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, 'dark', '/');
  const mockApi = await installApiMocks(page, 'populated');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);

  const motion = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'animate-pulse transition-all';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const toMilliseconds = (duration: string) => {
      const value = Number.parseFloat(duration);
      return duration.trim().endsWith('ms') ? value : value * 1_000;
    };
    const result = {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDurationMs: toMilliseconds(style.animationDuration),
      animationIterations: Number.parseFloat(style.animationIterationCount),
      transitionDurationMs: toMilliseconds(style.transitionDuration),
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
    probe.remove();
    return result;
  });
  expect(motion.mediaMatches).toBe(true);
  expect(motion.animationDurationMs).toBeLessThanOrEqual(0.1);
  expect(motion.animationIterations).toBeLessThanOrEqual(1);
  expect(motion.transitionDurationMs).toBeLessThanOrEqual(0.1);
  expect(motion.scrollBehavior).toBe('auto');
  await assertMockApiComplete(page, mockApi);
});

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
