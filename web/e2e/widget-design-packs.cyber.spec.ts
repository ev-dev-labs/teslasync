import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { routeBuiltApplication, test } from './app-design-test';
import { assertMockApiComplete, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview } from './widget-design-packs.mock';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('Cyber grid tokens do not leak into neutral or other pack previews', async ({ page }) => {
  await page.setContent(`
    <style>:root { --bg-app: white; --border-subtle: rgba(0, 0, 0, .06); }</style>
    <div id="outer" data-app-part="shell-main" data-app-design-owner="pack-cyber"></div>
    <div id="neutral" data-app-design-preview>
      <div data-app-part="shell-main"></div>
    </div>
    <div id="other" data-app-design-preview data-app-design-pack="classic" data-app-design-owner="pack-classic">
      <div data-app-part="shell-main" data-app-design-owner="pack-classic"></div>
    </div>
    <div id="same" data-app-design-preview data-app-design-pack="cyber" data-app-design-owner="pack-cyber">
      <div data-app-part="shell-main" data-app-design-owner="pack-cyber"></div>
    </div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'cyber');
    element.setAttribute('data-app-design-owner', 'pack-cyber');
  });
  for (const file of [['base.css'], ['packs', 'cyber.css']]) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', ...file), 'utf8') });
  }
  const tokens = (selector: string) => page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return ['--app-cyber-canvas-grid-size', '--app-cyber-canvas-grid-line']
      .map(property => style.getPropertyValue(property).trim());
  });
  expect(await tokens('#outer')).toEqual(['6rem', '1px']);
  expect(await tokens('#neutral')).toEqual(['', '']);
  expect(await tokens('#other')).toEqual(['', '']);
  expect(await tokens('#same')).toEqual(['6rem', '1px']);
  await expect(page.locator('#same [data-app-part~="shell-main"]')).toHaveCSS('background-size', '96px 96px');
  await expect(page.locator('#other [data-app-part~="shell-main"]')).toHaveCSS('background-image', 'none');
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [360, 430]) {
    test(`Cyber grid keeps breadcrumb contrast at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const baseURL = testInfo.project.use.baseURL;
      if (typeof baseURL !== 'string') throw new Error('Review origin is required');
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const saved = createReviewPreference();
      saved.pack_id = 'cyber';
      saved.app_wide = true;
      const mocks = await installPackReview(page, theme, width, false, [], true, saved, baseURL);
      await routeBuiltApplication(page, new URL(baseURL).origin, ['/vehicles'], process.env.DESIGN_PACK_DIST_DIR);
      await page.goto('/vehicles');
      await waitForHarnessReady(page, mocks);

      const measurement = await page.locator(
        '[data-app-part~="shell-main"] [aria-label="Breadcrumb"] [title="Vehicles"]',
      ).first().evaluate(element => {
        const shell = element.closest('[data-app-part~="shell-main"]');
        if (!shell) throw new Error('Shell background is missing');
        const style = getComputedStyle(shell);
        const components = (color: string) => color.match(/[\d.]+/g)!.map(Number);
        const text = components(getComputedStyle(element).color);
        const background = components(style.backgroundColor).slice(0, 3);
        const colors = (style.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map(components);
        const strokes = colors.filter(color => (color[3] ?? 1) > 0);
        const layers = style.backgroundImage.match(/(?:linear|conic)-gradient/g) ?? [];
        const samples = [background, ...strokes.map(stroke =>
          background.map((channel, index) => channel * (1 - (stroke[3] ?? 1))
            + stroke[index] * (stroke[3] ?? 1)))];
        const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, channel, index) => {
          const value = channel / 255;
          return sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045
            ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        }, 0);
        const ratios = samples.map(sample => {
          const values = [luminance(text), luminance(sample)].sort((a, b) => a - b);
          return (values[1] + 0.05) / (values[0] + 0.05);
        });
        return {
          ratio: Math.min(...ratios),
          image: style.backgroundImage,
          size: style.backgroundSize,
          layers: layers.length,
          hasStroke: strokes.length > 0,
          hasClearSpace: colors.some(color => color[3] === 0),
        };
      });

      // One translucent layer avoids darkening where the circuit traces cross.
      expect(measurement.layers).toBe(1);
      expect(measurement.image).toContain('conic-gradient');
      expect(measurement.size).toBe('96px 96px');
      expect(measurement.hasStroke && measurement.hasClearSpace).toBe(true);
      expect(measurement.ratio, `breadcrumb grid contrast: ${JSON.stringify(measurement)}`).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth
        <= document.documentElement.clientWidth)).toBe(true);
      await assertMockApiComplete(page, mocks);
    });
  }
}
