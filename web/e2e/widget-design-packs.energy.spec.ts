import { expect, test } from '@playwright/test';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { inspectEnergyReview } from './widget-design-packs.energy';
import { energyReviewPath, installEnergyReviewSources } from './widget-design-packs.energy.mock';

// Separate the substantive source-state work from the existing four all-route
// cases, without another project/workflow or reloading on ordinary pack changes.
test.setTimeout(1_800_000);
test.afterAll(async () => { await closeMockApiFixtures(); });
for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`Energy flow real source states at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const saved = createReviewPreference();
      saved.app_wide = true;
      const mocks = await installPackReview(page, theme, width, false, [], false, saved,
        testInfo.project.use.baseURL);
      const sources = await installEnergyReviewSources(page, mocks);
      sources.setActive(true);
      await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
      await page.goto(energyReviewPath);
      await waitForHarnessReady(page, mocks);
      const evidence: Record<string, unknown> = {};
      const signatures = new Map<string, Set<string>>();
      for (const packId of Object.keys(packNames) as PackId[]) {
        await test.step(`${packId} independent energy sources and actual open controls`, async () => {
          await selectReviewPack(page, packId);
          await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
          const geometry = await inspectEnergyReview(page, packId, testInfo, sources, true);
          evidence[packId] = geometry;
          for (const [state, measured] of Object.entries(geometry)) {
            const values = signatures.get(state) ?? new Set<string>();
            values.add(JSON.stringify(measured));
            signatures.set(state, values);
          }
        });
      }
      await testInfo.attach('energy-flow-source-state-geometry.json', {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      // Require every authored real state, not just whichever entries happen
      // to survive. Signatures contain measured page + focused-surface geometry.
      const requiredStates = [
        'review-retained-sort', 'unknown-live', 'partial-live', 'empty-history',
        'missing-positive-efficiency', 'flow-retained', 'history-retained',
        'flow-initial-loading', 'flow-initial-error', 'flow-recovered',
        'history-initial-loading', 'history-initial-error', 'history-recovered',
        ...(width === 390 ? ['row-detail'] : []),
      ];
      for (const state of requiredStates) {
        expect.soft(signatures.get(state)?.size ?? 0,
          `EXACTLY 27 rendered ${state} compositions at ${width}px/${theme}`).toBe(27);
      }
      expect(sources.reads.some(read => read.kind === 'held')).toBe(true);
      expect(sources.reads.some(read => read.kind === 'error')).toBe(true);
      expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
      expect(failures).toEqual([]);
      // Live queries keep polling through this check; their fixtures belong to the page lifetime.
      await assertMockApiComplete(page, mocks);
    });
  }
}

test('Energy mobile header tooltips stay contained across all designs', async ({ browser }, testInfo) => {
  const { assertContained, assertOwnedTree, profileAttributes } = await import('./widget-design-packs.acceptance');
  for (const theme of ['dark', 'light'] as const) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 390, height: 1000 },
      colorScheme: theme,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    const saved = createReviewPreference();
    saved.app_wide = true;
    const mocks = await installPackReview(page, theme, 390, false, [], false, saved,
      testInfo.project.use.baseURL);
    const sources = await installEnergyReviewSources(page, mocks);
    sources.setActive(true);
    const evidence: Record<string, unknown> = {};
    try {
      await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
      await page.goto(energyReviewPath);
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const header = main.locator('[data-app-part~="page-header"]');
      const heading = header.getByRole('heading', { level: 1, name: 'Energy flow', exact: true });
      for (const packId of Object.keys(packNames) as PackId[]) {
        await test.step(`${theme}/${packId} closed, hovered and keyboard-focused header help`, async () => {
          await selectReviewPack(page, packId);
          await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
          await assertOwnedTree(header, packId);
          await heading.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await heading.focus();
          const buttons = [
            header.getByRole('button', { name: 'More info: Energy flow', exact: true }),
            header.getByRole('button', { name: /^Refresh data ·/ }),
          ];
          await expect(header.locator('button[aria-describedby]')).toHaveCount(buttons.length);
          const measurements: Record<string, unknown> = {};
          for (const [index, button] of buttons.entries()) {
            const id = await button.getAttribute('aria-describedby');
            expect(id).toBeTruthy();
            const tooltip = page.locator(`[id="${id}"]`);
            await expect(tooltip).toHaveAttribute('role', 'tooltip');
            const text = await tooltip.textContent();
            expect(text?.trim().length).toBeGreaterThan(0);
            if (index === 0) expect(text).toBe('Power distribution and energy analysis');
            const states: Record<string, unknown> = {};
            const contained = async (state: string) => {
              await expect(tooltip).toHaveText(text!);
              await assertContained(main, `${theme}/${packId}/${state} energy main`);
              await assertContained(header, `${theme}/${packId}/${state} energy header`);
              await assertContained(header.locator('[data-app-part~="page-actions"]'),
                `${theme}/${packId}/${state} trailing commands`);
              await assertContained(tooltip, `${theme}/${packId}/${state} complete tooltip`);
              await assertOwnedTree(tooltip, packId);
              const geometry = await tooltip.evaluate(node => {
                const box = node.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
              });
              expect(geometry.top).toBeGreaterThanOrEqual(0);
              expect(geometry.bottom).toBeLessThanOrEqual(1000);
              const scope = (node: Element, attributes: readonly string[]) => {
                const owner = node.closest('[data-app-design-preview]') ?? document.documentElement;
                return Object.fromEntries(attributes.map(name => [name, owner.getAttribute(name)]));
              };
              expect(await tooltip.evaluate(scope, profileAttributes))
                .toEqual(await button.evaluate(scope, profileAttributes));
              states[state] = geometry;
            };
            await expect(tooltip).toHaveCSS('opacity', '0');
            await contained('closed');
            await button.hover();
            await expect(tooltip).toHaveCSS('opacity', '1');
            await contained('hover');
            await page.mouse.move(0, 0);
            await expect(tooltip).toHaveCSS('opacity', '0');
            await page.keyboard.press('Tab');
            await expect(button).toBeFocused();
            await expect(tooltip).toHaveCSS('opacity', '1');
            await contained('focus');
            await page.keyboard.press('Escape');
            await expect(button).toBeFocused();
            await expect(tooltip).toHaveCSS('opacity', '0');
            await contained('dismissed');
            measurements[index] = { text, states };
          }
          await heading.focus();
          evidence[packId] = measurements;
        });
      }
      expect(Object.keys(evidence)).toHaveLength(27);
    } finally {
      await testInfo.attach(`energy-mobile-header-${theme}.json`, {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      await testInfo.attach(`energy-mobile-header-${theme}.png`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
      try {
        expect(mocks.requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
          && !['/api/v1/settings/widget-design-pack', '/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))).toEqual([]);
        expect(failures).toEqual([]);
        await assertMockApiComplete(page, mocks);
      } finally {
        await context.close();
      }
    }
  }
});
