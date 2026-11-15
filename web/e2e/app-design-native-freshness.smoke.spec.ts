import { expect } from '@playwright/test';
import { test } from './app-design-test';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview } from './widget-design-packs.mock';
import { nativeWidgets } from './widget-design-packs.native.fixtures';
import { installNativeReviewSources } from './widget-design-packs.native.mock';

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const [theme, layout, widths] of [
  ['dark', 'desktop', [1440]], ['dark', 'phone', [360, 390, 430]],
  ['light', 'desktop', [1440]], ['light', 'phone', [360, 390, 430]],
] as const) {
  test(`Horizon Loft keeps long freshness labels contained on ${layout} in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = info.project.use.baseURL;
    if (typeof origin !== 'string') throw new Error('A running application origin is required');
    await page.setViewportSize({ width: widths[0], height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    const preference = createReviewPreference();
    preference.pack_id = 'v2';
    preference.app_wide = true;
    const mocks = await installPackReview(page, theme, widths[0], false, nativeWidgets, false, preference, origin);
    const sources = await installNativeReviewSources(page, mocks, widths[0]);
    try {
      await page.goto('/signal-gaps');
      await waitForHarnessReady(page, mocks);
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v2');
      const panel = page.locator('[data-app-part~="panel"]').filter({
        has: page.getByRole('heading', { name: 'Freshness', exact: true }),
      });
      const rows = panel.locator('[data-app-list="ranked"] > [data-app-part~="list-row"]');
      await expect(rows).toHaveCount(6);
      await expect(rows.first()).toContainText('SyntheticLongStaleSignalForRankedRecordAcceptance6');
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        const issues = await panel.evaluate(element => {
          const problems: unknown[] = [];
          if (document.documentElement.scrollWidth > innerWidth) {
            problems.push({ documentWidth: document.documentElement.scrollWidth, viewport: innerWidth });
          }
          for (const row of element.querySelectorAll('[data-app-list="ranked"] > [data-app-part~="list-row"]')) {
            const label = row.querySelector('[data-app-part~="metric-label"]');
            if (!label) {
              problems.push({ issue: 'missing label' });
              continue;
            }
            const box = row.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(label);
            const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
            if (row.scrollWidth > row.clientWidth || fragments.some(rect => rect.left < box.left || rect.right > box.right)) {
              problems.push({
                label: label.textContent, rowWidth: row.clientWidth, scrollWidth: row.scrollWidth,
                box: box.toJSON(), fragments: fragments.map(rect => rect.toJSON()),
                children: [...row.querySelectorAll('*')].map(node => {
                  const css = getComputedStyle(node);
                  return { tag: node.tagName, class: node.getAttribute('class'), width: node.clientWidth,
                    scrollWidth: node.scrollWidth, minWidth: css.minWidth, maxWidth: css.maxWidth,
                    overflowWrap: css.overflowWrap, whiteSpace: css.whiteSpace };
                }),
              });
            }
          }
          return problems;
        });
        expect(issues, `${width}px ranked labels remain fully readable without horizontal scrolling`).toEqual([]);
      }
      await assertMockApiComplete(page, mocks);
    } finally {
      sources.release();
    }
  });
}
