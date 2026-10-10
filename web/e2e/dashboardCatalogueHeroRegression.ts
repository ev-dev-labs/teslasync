import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export async function assertCatalogueHeroMigration(
  page: Page, panel: Locator, info: TestInfo, screenshotName: string,
) {
  const startedAt = Date.now();
  const history: unknown[] = [];
  let previous = '';
  let stableSamples = 0;
  try {
    await expect.poll(async () => {
      const current = await panel.evaluate(element => {
        const record = (value: unknown): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null;
        const dashboards: unknown = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? 'null');
        if (!Array.isArray(dashboards)) throw new Error('Missing saved catalogue dashboards');
        const activeId = localStorage.getItem('teslasync-active-dashboard');
        const dashboard: unknown = dashboards.find((value: unknown) => record(value) && value.id === activeId);
        if (!record(dashboard) || !record(dashboard.layouts) || !Array.isArray(dashboard.layouts.md)) {
          throw new Error('Missing active desktop catalogue layout');
        }
        const item: unknown = dashboard.layouts.md.find((value: unknown) =>
          record(value) && value.i === 'review-vehicle-hero');
        if (!record(item)) throw new Error('Missing persisted desktop VehicleHero item');
        const bounds = element.getBoundingClientRect();
        return {
          activeId, stamp: localStorage.getItem('teslasync-row-height-version'),
          item, height: bounds.height, width: bounds.width,
          top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
          mainScrollTop: element.closest('main')?.scrollTop, windowScrollY: window.scrollY,
          computedHeight: getComputedStyle(element).height,
        };
      });
      history.push({ elapsedMs: Date.now() - startedAt, ...current });
      const signature = JSON.stringify(current);
      const ready = current.activeId === 'review-vehicle' && current.stamp === '2'
        && current.item.h === 6 && current.height === 560 && current.computedHeight === '560px';
      stableSamples = ready ? signature === previous ? stableSamples + 1 : 1 : 0;
      previous = signature;
      return stableSamples;
    }, { message: 'Unstamped VehicleHero must migrate and stabilize at six rows / 560px' })
      .toBeGreaterThanOrEqual(4);
  } finally {
    await writeFile(info.outputPath('vehicle-hero-migration-history.json'), JSON.stringify({
      test: info.title, seed: 'Existing unversioned catalogue seed; no stamp or layout rewrite',
      expectedRows: 6, expectedHeight: 560, history,
    }, null, 2));
  }

  await panel.evaluate(element => {
    const main = element.closest('main');
    if (!main) throw new Error('VehicleHero has no main scroll viewport');
    const bounds = element.getBoundingClientRect();
    main.scrollTo({
      top: Math.max(0, main.scrollTop + bounds.top - main.getBoundingClientRect().top - 16),
      behavior: 'instant',
    });
  });
  const identity = panel.getByRole('heading', { name: 'Aurora', exact: true });
  await expect(identity).toBeVisible();
  await expect(identity).toBeInViewport({ ratio: 1 });
  for (const path of ['/vehicles/7', '/commands', '/live', '/digital-twin']) {
    await expect(panel.locator(`a[href="${path}"]`)).toBeVisible();
    await expect(panel.locator(`a[href="${path}"]`)).toBeInViewport({ ratio: 1 });
  }
  const geometry = () => panel.evaluate(element => {
    const bounds = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, height: rect.height };
    };
    const main = element.closest('main');
    const identity = [...element.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .find(node => node.textContent?.trim() === 'Aurora');
    if (!main || !identity) throw new Error('Missing VehicleHero viewport or identity geometry');
    return {
      panel: bounds(element), main: bounds(main), identity: bounds(identity),
      actions: [...element.querySelectorAll('a')].map(node => ({
        href: node.getAttribute('href'), ...bounds(node),
      })),
      mainScrollTop: main.scrollTop, windowScrollX: window.scrollX, windowScrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      computedHeight: getComputedStyle(element).height,
    };
  });
  const before = await geometry();
  expect(before.panel.height).toBe(560);
  expect(before.panel.width, 'Both motion modes retain the same two-column desktop allocation').toBe(752);
  expect(before.panel.top).toBeGreaterThanOrEqual(before.main.top);
  expect(before.panel.bottom).toBeLessThanOrEqual(before.main.bottom);
  for (const node of [before.identity, ...before.actions]) {
    expect(node.top).toBeGreaterThanOrEqual(before.panel.top);
    expect(node.bottom).toBeLessThanOrEqual(before.panel.bottom);
    expect(node.left).toBeGreaterThanOrEqual(before.panel.left);
    expect(node.right).toBeLessThanOrEqual(before.panel.right);
  }
  await page.screenshot({ path: info.outputPath('vehicle-hero-viewport.png'), fullPage: false });
  const afterViewport = await geometry();
  await panel.screenshot({ path: info.outputPath(screenshotName) });
  const afterLocator = await geometry();
  await writeFile(info.outputPath('vehicle-hero-screenshot-geometry.json'), JSON.stringify({
    test: info.title, captureModes: ['viewport (fullPage=false)', 'locator'],
    before, afterViewport, afterLocator,
  }, null, 2));
  expect(afterViewport, 'Viewport screenshot must not change hero or scroll geometry').toEqual(before);
  expect(afterLocator, 'Locator screenshot must not change hero or scroll geometry').toEqual(before);
}
