import { expect, test, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import type { RGLLayouts, SavedDashboard } from '../src/features/dashboard/widgets/types';
import { getWidgetDef } from '../src/features/dashboard/widgets/registry';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { installCataloguePhotoSource, assertCatalogueAffectedAxes } from './dashboardCatalogueGeometry';
import { assertRemainingContent, installRemainingCatalogueSources, remainingBatches } from './dashboardCatalogueRemainingFixtures';
import { positionCataloguePanel } from './dashboardCatalogueCapture';
import { attachDiagnostics, expectNoRuntimeFailures, monitorPage } from './qualityAssertions';

test.skip(process.env.E2E_ONBOARDING_ATTRIBUTION !== '5235', 'Explicit isolated diagnostic authorization required');

async function measure(panel: Locator) {
  return panel.evaluate(element => {
    const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
    const selector = (node: Element) => {
      const parts = [];
      for (let current: Element | null = node; current; current = current.parentElement) {
        const index = current.parentElement ? [...current.parentElement.children].indexOf(current) + 1 : 1;
        parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      }
      return parts.join(' > ');
    };
    const cache = new Map<Element, ReturnType<typeof describe>>();
    function describe(node: Element) {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        selector: selector(node), tag: node.tagName, className: node.getAttribute('class'),
        widgetId: node.getAttribute('data-widget-id'), attributes: Object.fromEntries(
          [...node.attributes].filter(attribute => attribute.name.startsWith('data-'))
            .map(attribute => [attribute.name, attribute.value])),
        box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height },
        inline: { style: node.getAttribute('style') },
        computed: { height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight,
          overflow: style.overflow, overflowX: style.overflowX, overflowY: style.overflowY,
          display: style.display, flex: style.flex, visibility: style.visibility, opacity: style.opacity,
          transform: style.transform, transition: style.transition, animation: style.animation },
        scrollTop: node.scrollTop, scrollLeft: node.scrollLeft, scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        maximumScrollTop: Math.max(0, node.scrollHeight - node.clientHeight),
      };
    }
    const cached = (node: Element) => {
      let description = cache.get(node);
      if (!description) {
        description = describe(node);
        cache.set(node, description);
      }
      return description;
    };
    const ancestry = (node: Element | null) => {
      const result = [];
      for (let current = node; current; current = current.parentElement) result.push(cached(current));
      return result;
    };
    const rendered = (owner: Element) => {
      for (let current: Element | null = owner; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || Number(style.opacity) === 0 || style.clip === 'rect(0px, 0px, 0px, 0px)'
          || current === owner && ['hidden', 'collapse'].includes(style.visibility)) return false;
      }
      return true;
    };
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const readings = [];
    let index = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const nodeIndex = index++;
      const owner = node.parentElement;
      const text = node.textContent?.trim();
      if (!owner || !text || owner.closest('script, style') || !rendered(owner)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      let line = 0;
      for (const box of range.getClientRects()) {
        if (box.width <= 0 || box.height <= 0) continue;
        const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        readings.push({ id: `${nodeIndex}:${line++}`, text,
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height },
          point, hitInsidePanel: hit !== null && element.contains(hit),
          ancestors: ancestry(owner), hitAncestry: ancestry(hit) });
      }
    }
    const item = element.closest('.react-grid-item');
    const grid = element.closest('.react-grid-layout');
    const main = element.closest('main');
    const body = element.querySelector('[aria-busy] > .\\@container');
    if (!item || !grid || !main) throw new Error('Missing original catalogue RGL/main geometry');
    const reactGridEvidence = [];
    const fiberKey = Object.keys(grid).find(key => key.startsWith('__reactFiber$'));
    let fiber: unknown = fiberKey ? Reflect.get(grid, fiberKey) : null;
    for (let depth = 0; record(fiber) && depth < 35; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const state = record(fiber.stateNode) ? fiber.stateNode.state : undefined;
      const select = (value: unknown) => record(value) ? Object.fromEntries(
        ['breakpoint', 'cols', 'width', 'rowHeight', 'margin', 'gridConfig', 'breakpoints']
          .filter(key => key in value).map(key => [key, value[key]])) : null;
      const selectedProps = select(props);
      const selectedState = select(state);
      if (selectedProps && Object.keys(selectedProps).length || selectedState && Object.keys(selectedState).length) {
        reactGridEvidence.push({ depth, props: selectedProps, state: selectedState });
      }
    }
    return { wallTimeMs: Date.now(), performanceMs: performance.now(), panel: cached(element),
      item: cached(item), body: body ? cached(body) : null, grid: cached(grid), main: cached(main),
      windowScroll: { x: scrollX, y: scrollY }, viewport: { width: innerWidth, height: innerHeight },
      chrome: [...document.querySelectorAll('[data-role="appbar"], [data-role="status-bar"], [data-role="bottom-tab-bar"]')].map(cached),
      storage: { dashboards: localStorage.getItem('teslasync-dashboards'),
        active: localStorage.getItem('teslasync-active-dashboard'), stamp: localStorage.getItem('teslasync-row-height-version') },
      reactGridEvidence, readings };
  });
}

test('DIAGNOSTIC ONLY onboarding desktop original fixture sizing and internal scroll attribution', async ({ page }) => {
  test.setTimeout(90_000);
  expect(process.env.E2E_BASE_URL).toBe('http://127.0.0.1:5235');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedBrowserState(page, 'light', '/');
  const widgets = remainingBatches['catalogue-workspace'].map(widgetId =>
    ({ id: `review-${widgetId}`, widgetId, vehicleId: 7 }));
  const layouts: RGLLayouts = {};
  for (const [breakpoint, columns] of Object.entries({ lg: 4, md: 3, sm: 2, xs: 1 })) {
    let row = 0;
    layouts[breakpoint] = widgets.map(widget => {
      const def = getWidgetDef(widget.widgetId);
      if (!def) throw new Error(`Unregistered review widget: ${widget.widgetId}`);
      const y = row;
      row += def.defaultSize.rows;
      return { i: widget.id, x: 0, y, w: Math.min(columns, def.defaultSize.cols), h: def.defaultSize.rows };
    });
  }
  const dashboard: SavedDashboard = { id: 'review-catalogue-workspace', name: 'Review catalogue-workspace',
    widgets, layouts, createdAt: '2026-08-26T16:00:00.000Z', updatedAt: '2026-08-26T16:00:00.000Z', isDefault: true };
  await page.addInitScript(saved => {
    localStorage.setItem('teslasync-dashboards', JSON.stringify([saved]));
    localStorage.setItem('teslasync-active-dashboard', saved.id);
  }, dashboard);
  const mocks = await installApiMocks(page, 'populated', 'light');
  if (!mocks) throw new Error('Original diagnostic requires API fixtures');
  await installDashboardWidgetSources(page, mocks, false);
  await installRemainingCatalogueSources(page, mocks);
  await installCataloguePhotoSource(page, false);
  await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
    json: { dashboards: [dashboard], active_id: dashboard.id } satisfies DashboardLayoutsPayload,
  }));
  const diagnostics = monitorPage(page);
  const samples: Array<{ stage: string; geometry: Awaited<ReturnType<typeof measure>> }> = [];
  const operations: Record<string, unknown>[] = [];
  const path = test.info().outputPath('onboarding-attribution.json');
  const sample = async (stage: string) => {
    const geometry = await measure(page.locator('[data-widget-id="review-onboarding-checklist"] > .widget-panel'));
    samples.push({ stage, geometry });
    return geometry;
  };
  try {
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    await assertMockApiComplete(page, mocks);
    await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText(dashboard.name);
    const panel = page.locator('[data-widget-id="review-onboarding-checklist"] > .widget-panel');
    await positionCataloguePanel(panel);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading').first()).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel).not.toContainText('failed to load');
    await assertRemainingContent(panel, 'onboarding-checklist', 1440, test.info());
    const deadline = Date.now() + 8_000;
    await sample('immediately-after-original-restart-dismiss-restart');
    await expect(panel).toContainText(/Connect your Tesla/i);
    const def = getWidgetDef('onboarding-checklist');
    if (!def) throw new Error('Missing original onboarding registry fixture');
    await assertCatalogueAffectedAxes(panel, 'onboarding-checklist', { cols: Math.min(4, def.defaultSize.cols),
      rows: def.defaultSize.rows }, test.info());
    await positionCataloguePanel(panel);
    const initial = await sample('original-pre-capture-point-no-screenshot-yet');
    const affectedIds = initial.readings.filter(reading => !reading.hitInsidePanel).map(reading => reading.id);
    let previous = '';
    let stable = 0;
    await expect.poll(async () => {
      const current = await sample('read-only-stability-within-original-budget');
      const signature = JSON.stringify({ panel: current.panel, item: current.item, body: current.body,
        grid: current.grid, main: current.main, storage: current.storage,
        readings: current.readings.map(({ id, text, box, hitInsidePanel }) => ({ id, text, box, hitInsidePanel })) });
      stable = signature === previous ? stable + 1 : 1;
      previous = signature;
      return stable;
    }, { timeout: Math.max(1, deadline - Date.now()), intervals: [150, 150, 150, 150, 150, 150, 150, 150],
      message: 'Diagnostic records organic sizing stability without extending the original8s envelope' }).toBeGreaterThanOrEqual(5);
    const settled = await sample('settled-before-any-native-internal-scroll');
    const affected = settled.readings.filter(reading => affectedIds.includes(reading.id));
    const first = affected.find(reading => !reading.hitInsidePanel) ?? affected[0] ?? settled.readings[0];
    if (!first) throw new Error('Original diagnostic must retain nonempty reading inventory');
    const owner = first.ancestors.find(ancestor =>
      ancestor.selector.startsWith(settled.panel.selector)
      && ['auto', 'scroll'].includes(ancestor.computed.overflowY) && ancestor.maximumScrollTop > ancestor.scrollTop
      && affected.every(reading => reading.ancestors.some(candidate => candidate.selector === ancestor.selector)));
    await sample('before-unmasked-settled-viewport');
    await page.screenshot({ path: test.info().outputPath('settled-before-internal-scroll.png'), fullPage: false });
    await sample('after-unmasked-settled-viewport');
    if (owner) {
      const target = page.locator(owner.selector);
      const box = owner.box;
      const point = { x: Math.max(box.left, settled.panel.box.left) + 8,
        y: (Math.max(box.top, settled.panel.box.top, settled.main.box.top)
          + Math.min(box.bottom, settled.panel.box.bottom, 872)) / 2 };
      await page.mouse.move(point.x, point.y);
      const hit = await target.evaluate((element, pointer) => {
        const nativeHit = document.elementFromPoint(pointer.x, pointer.y);
        return { insideOwner: nativeHit !== null && element.contains(nativeHit),
          tag: nativeHit?.tagName, className: nativeHit?.getAttribute('class') };
      }, point);
      expect(hit.insideOwner, 'Wheel pointer must target actual native internal scroll owner').toBe(true);
      operations.push({ kind: 'ONE_NATIVE_WHEEL_TO_LEGAL_MAX', owner, point, hit,
        deltaY: owner.maximumScrollTop - owner.scrollTop });
      await page.mouse.wheel(0, owner.maximumScrollTop - owner.scrollTop);
      await expect.poll(async () => {
        const current = await sample('after-one-native-internal-wheel');
        return await target.evaluate(element => element.scrollTop === element.scrollHeight - element.clientHeight)
          && current.panel.box.height > 0;
      }, { timeout: Math.max(1, deadline - Date.now()),
        message: 'Observe one native wheel reaching real legal maximum within original budget' }).toBe(true);
      await sample('before-unmasked-native-max-viewport');
      await page.screenshot({ path: test.info().outputPath('after-one-internal-scroll.png'), fullPage: false });
      await sample('after-unmasked-native-max-viewport');
    } else {
      operations.push({ kind: 'NO_COMMON_INTERNAL_OWNER_WITH_POSITIVE_REMAINING_CAPACITY' });
    }
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mocks);
  } finally {
    await writeFile(path, JSON.stringify({ diagnosticOnly: true, candidate: 'http://127.0.0.1:5235',
      notAcceptanceOrOriginalRetry: true, originalFixture: dashboard, stabilityBudgetMs: 8_000,
      samples, operations, diagnostics }, null, 2));
    await test.info().attach('onboarding-attribution.json', { path, contentType: 'application/json' });
    await attachDiagnostics(test.info(), diagnostics);
  }
});
