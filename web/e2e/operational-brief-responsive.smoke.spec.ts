import { expect } from '@playwright/test';
import { routeBuiltApplication, test } from './app-design-test';
import { findSplitOperationalMetricWords } from './design-packs-capture';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { createReviewPreference, installPackReview } from './widget-design-packs.mock';

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const theme of ['dark', 'light'] as const) {
  test(`Blueprint Quick Stats keeps metric words readable on phones in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') throw new Error('A local test origin is required');
    const origin = new URL(baseURL).origin;
    const saved = createReviewPreference();
    saved.pack_id = 'blueprint';
    saved.app_wide = true;
    await page.setViewportSize({ width: 430, height: 932 });
    const mocks = await installPackReview(page, theme, 390, false, [], true, saved, origin, { font_scale: 1 });
    await routeBuiltApplication(page, origin, ['/quick-stats'], process.env.DESIGN_PACK_DIST_DIR);
    await page.goto('/quick-stats', { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mocks);
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'blueprint');
    await expect(page.locator('html')).toHaveAttribute('data-app-design-owner', /^pack-blueprint(?:\s|$)/);
    const labels = page.locator('[data-operational-metric-list] [data-app-part~="metric-label"]');
    await expect(labels.filter({ hasText: /^Charging sessions$/ })).toBeVisible();
    await expect(labels.filter({ hasText: /^Avg efficiency$/ })).toBeVisible();

    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 932 });
        for (const scale of [0.85, 1, 1.35]) {
          await page.locator('html').evaluate((element, value) =>
            element.style.setProperty('--font-scale', String(value)), scale);
          const context = `${theme}, ${forcedColors}, ${width}px, scale ${scale}`;
          expect(await findSplitOperationalMetricWords(page), context).toEqual([]);
          const sizes = await labels.evaluateAll(elements =>
            elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
          expect(Math.min(...sizes), context).toBeGreaterThanOrEqual(Math.max(16, 16 * scale) - 0.1);
          await expectNoHorizontalOverflow(page);
        }
      }
    }
    await page.emulateMedia({ forcedColors: 'none' });
    await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '1'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('[data-operational-metric-bank]').first()).toHaveCSS('display', 'flex');
    await assertMockApiComplete(page, mocks);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`Precision Ledger destination metrics keep words readable on phones in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== 'string') throw new Error('A local test origin is required');
    const origin = new URL(baseURL).origin;
    const saved = createReviewPreference();
    saved.pack_id = 'v3';
    saved.app_wide = true;
    await page.setViewportSize({ width: 360, height: 800 });
    const mocks = await installPackReview(page, theme, 390, false, [], true, saved, origin, { font_scale: 1 });
    await routeBuiltApplication(page, origin, ['/destination-transitions'], process.env.DESIGN_PACK_DIST_DIR);
    await page.goto('/destination-transitions', { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mocks);
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v3');
    await expect(page.locator('html')).toHaveAttribute('data-app-design-owner', /^pack-v3(?:\s|$)/);
    const label = page.locator('[data-operational-metric-list] [data-app-part~="metric-label"]')
      .filter({ hasText: /^Chronologically placed rows$/ });
    await expect(label).toBeVisible();
    const value = label.locator('..').locator('[data-app-part~="metric-value"]');
    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 932 });
        for (const scale of [0.85, 1, 1.35]) {
          await page.locator('html').evaluate((element, value) =>
            element.style.setProperty('--font-scale', String(value)), scale);
          const context = `${theme}, ${forcedColors}, ${width}px, scale ${scale}`;
          expect(await findSplitOperationalMetricWords(page), context).toEqual([]);
          expect(await label.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), context)
            .toBeGreaterThanOrEqual(Math.max(16, 16 * scale) - 0.1);
          const [labelBox, valueBox] = await Promise.all([label.boundingBox(), value.boundingBox()]);
          if (!labelBox || !valueBox) throw new Error(`Missing phone metric geometry: ${context}`);
          expect(valueBox.y, context).toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1);
          await expectNoHorizontalOverflow(page);
        }
      }
    }
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const [labelBox, valueBox] = await Promise.all([label.boundingBox(), value.boundingBox()]);
    if (!labelBox || !valueBox) throw new Error('Missing desktop metric geometry');
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(valueBox.x + 1);
    expect(labelBox.y).toBeLessThan(valueBox.y + valueBox.height);
    expect(valueBox.y).toBeLessThan(labelBox.y + labelBox.height);
    await assertMockApiComplete(page, mocks);
  });
}

for (const theme of ['dark', 'light'] as const) {
  for (const [path, requiredLabels] of [
    ['/charging', ['Potential interruptions', 'Sessions/week']],
    ['/settings', ['Temperature', 'Typography']],
  ] as const) {
    test(`Editorial ${path} keeps metric words readable on phones in ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const baseURL = testInfo.project.use.baseURL;
      if (typeof baseURL !== 'string') throw new Error('A local test origin is required');
      const origin = new URL(baseURL).origin;
      const saved = createReviewPreference();
      saved.pack_id = 'editorial';
      saved.app_wide = true;
      await page.setViewportSize({ width: 430, height: 932 });
      const mocks = await installPackReview(page, theme, 390, false, [], true, saved, origin, { font_scale: 1 });
      await routeBuiltApplication(page, origin, [path], process.env.DESIGN_PACK_DIST_DIR);
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await waitForHarnessReady(page, mocks);
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'editorial');
      await expect(page.locator('html')).toHaveAttribute('data-app-design-owner', /^pack-editorial(?:\s|$)/);
      const labels = page.locator('[data-operational-metric-list] [data-app-part~="metric-label"]');
      for (const label of requiredLabels) await expect(labels.filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
      for (const forcedColors of ['none', 'active'] as const) {
        await page.emulateMedia({ forcedColors });
        for (const width of [360, 390, 430]) {
          await page.setViewportSize({ width, height: 932 });
          for (const scale of [0.85, 1, 1.35]) {
            await page.locator('html').evaluate((element, value) =>
              element.style.setProperty('--font-scale', String(value)), scale);
            const context = `${theme}, ${forcedColors}, ${width}px, scale ${scale}`;
            expect(await findSplitOperationalMetricWords(page), context).toEqual([]);
            if (path === '/charging' && width === 360 && scale === 1.35) {
              const label = labels.filter({ hasText: /^Sessions\/week$/ });
              const value = label.locator('..').locator('[data-app-part~="metric-value"]');
              const [labelBox, valueBox] = await Promise.all([label.boundingBox(), value.boundingBox()]);
              if (!labelBox || !valueBox) throw new Error(`Missing metric geometry: ${context}`);
              expect(valueBox.y, context).toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1);
            }
            await expectNoHorizontalOverflow(page);
          }
        }
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}
