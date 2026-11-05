import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  closeMockedPage, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { installRemainingCatalogueSources } from './dashboardCatalogueRemainingFixtures';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import type { SavedDashboard, WidgetSizeClass } from '../src/features/dashboard/widgets/types';

const screenshotWidths = [390, 768, 1024, 1280, 1440, 1920, 2560];
const widths = [...new Set([...Array.from({ length: 22 }, (_, index) => 390 + index * 100), ...screenshotWidths])]
  .sort((a, b) => a - b);

for (const theme of ['light', 'dark'] as const) {
 for (const layout of ['default', 'customized'] as const) {
  test(`${layout} dashboard packs content from 390 to 2560: ${theme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedBrowserState(page, theme, '/', { preserveDashboardState: true });
    const mocks = layout === 'customized'
      ? await prepareCatalogueState(page, [
          'charge-status', 'battery-gauge', 'recent-drives', 'vehicle-hero',
          'climate-status', 'battery-degradation-trend', 'quick-nav',
        ], 1440, theme)
      : await installApiMocks(page, 'populated', theme);
    if (!mocks) throw new Error('Dashboard layout acceptance requires local mocks');
    if (layout === 'default') {
      await installDashboardWidgetSources(page, mocks);
      await installRemainingCatalogueSources(page, mocks);
      await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
        json: { dashboards: [], active_id: '' },
      }));
    } else {
      const classes: WidgetSizeClass[] = ['large', 'small', 'medium', 'medium', 'small', 'full', 'medium'];
      const custom: SavedDashboard = {
        id: 'customized', name: 'Custom sizes and order', layoutVersion: 1,
        widgets: [
          'charge-status', 'battery-gauge', 'recent-drives', 'vehicle-hero',
          'climate-status', 'battery-degradation-trend', 'quick-nav',
        ].map((widgetId, index) => ({ id: `custom-${widgetId}`, widgetId, sizeClass: classes[index] })),
        layouts: {}, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
      };
      await page.addInitScript(saved => {
        localStorage.setItem('teslasync-dashboards', JSON.stringify([saved]));
        localStorage.setItem('teslasync-active-dashboard', saved.id);
      }, custom);
      await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
        json: { dashboards: [custom], active_id: custom.id },
      }));
    }
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    await expect(page.locator('[data-widget-id]')).toHaveCount(layout === 'default' ? 9 : 7);
    const directory = resolve('..', 'docs', 'dashboard-layout');
    await mkdir(directory, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      let previous = '';
      await expect.poll(async () => {
        const geometry = await page.locator('[data-widget-id]').evaluateAll(elements => JSON.stringify(
          elements.map(element => {
            const box = element.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height];
          }),
        ));
        const stable = geometry === previous;
        previous = geometry;
        return stable;
      }, { intervals: [300, 300, 300], timeout: 10_000 }).toBe(true);
      if (screenshotWidths.includes(width)) {
        await page.screenshot({ path: resolve(directory, `${layout}-${theme}-${width}.png`), fullPage: true });
      }
      const failures = await page.locator('.dashboard-canvas[data-grid-columns]').evaluate(canvas => {
        const failures: string[] = [];
        const boundary = canvas.getBoundingClientRect();
        const columns = Number((canvas as HTMLElement).dataset.gridColumns);
        const small = (boundary.width - (columns - 1) * 16) / columns;
        const cards = [...canvas.querySelectorAll<HTMLElement>('[data-widget-id]')].map(element => ({
          element, box: element.getBoundingClientRect(),
        }));
        for (const { element, box } of cards) {
          const panel = element.querySelector<HTMLElement>('.widget-panel')!;
          const panelBox = panel.getBoundingClientRect();
          let bottom = panelBox.top;
          const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
            }
          }
          for (const visual of panel.querySelectorAll('svg, img, canvas, .leaflet-container')) {
            const rect = visual.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
          }
          const emptyRatio = (panelBox.bottom - Math.min(bottom, panelBox.bottom)) / panelBox.height;
          if (emptyRatio > 0.4) failures.push(`${element.dataset.widgetId}: ${(emptyRatio * 100).toFixed(1)}% empty`);
          const body = panel.querySelector<HTMLElement>('[data-testid="widget-body"]');
          const ceiling = Number.parseFloat(getComputedStyle(panel).maxHeight);
          if (body && panelBox.height < ceiling - 4 && body.scrollHeight > body.clientHeight + 4) {
            failures.push(`${element.dataset.widgetId}: content clipped below its height ceiling`);
          }
          if (box.left < boundary.left - 2 || box.right > boundary.right + 2) {
            failures.push(`${element.dataset.widgetId}: outside canvas`);
          }
          for (const other of cards) {
            if (other.element !== element && box.left < other.box.right - 2
              && box.right > other.box.left + 2 && box.top < other.box.bottom - 2
              && box.bottom > other.box.top + 2) {
              failures.push(`${element.dataset.widgetId}: overlapping ${other.element.dataset.widgetId}`);
            }
          }
          const y = box.top + 2;
          // A normal vertical gutter is not a missing column.
          const occupied = cards.filter(card => card.box.top <= y && card.box.bottom + 16 > y)
            .sort((a, b) => a.box.left - b.box.left);
          let edge = boundary.left;
          for (const card of occupied) {
            if (card.box.left - edge > small + 34) failures.push(`row ${y}: horizontal hole ${card.box.left - edge}px`);
            edge = Math.max(edge, card.box.right);
          }
          if (boundary.right - edge > small + 18) failures.push(`row ${y}: trailing hole ${boundary.right - edge}px`);
        }
        return [...new Set(failures)];
      });
      expect.soft(failures, `${layout}/${theme}/${width}`).toEqual([]);
    }
    await closeMockedPage(page, mocks);
  });
 }
}
