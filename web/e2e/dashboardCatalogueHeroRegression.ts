import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { GRID_COLS, GRID_MARGIN } from '../src/features/dashboard/hooks/useDashboardLayout';

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
        && current.item.h === 6 && current.item.w === 2 && current.height === 560 && current.computedHeight === '560px';
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
  const identityName = 'Aurora · Model Y Long Range';
  const identity = panel.getByRole('heading', { name: identityName, exact: true });
  await expect(identity).toHaveCount(1);
  await expect(identity).toBeVisible();
  await expect(identity).toBeInViewport({ ratio: 1 });
  const details = panel.getByRole('link', { name: /^Details/ });
  await expect(panel.getByRole('link')).toHaveCount(1);
  await expect(details).toHaveAttribute('href', '/vehicles/7');
  await expect(details).toBeVisible();
  await expect(details).toBeInViewport({ ratio: 1 });
  const target = await details.boundingBox();
  if (!target) throw new Error('Missing native vehicle Details target');
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await details.focus();
  await expect(details).toBeFocused();
  const battery = panel.getByRole('meter', { name: 'Battery', exact: true });
  await expect(battery).toHaveAttribute('aria-valuenow', '72');
  await expect(battery).toHaveAttribute('aria-valuemin', '0');
  await expect(battery).toHaveAttribute('aria-valuemax', '100');
  for (const [label, reading] of [
    ['Range', /^Range\s*410\s*km$/],
    ['Inside', /^Inside\s*21\s*°C$/],
    ['Outside', /^Outside\s*18\s*°C$/],
  ] as const) {
    await expect(panel.getByRole('group', { name: label, exact: true })).toHaveText(reading);
  }
  await expect(panel.getByText('Locked', { exact: true })).toBeVisible();
  await expect(panel).toContainText(/Sentry\s*On/);
  await expect(panel).toContainText('20 verified fields');
  const geometry = () => panel.evaluate((element, identityName) => {
    const bounds = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, height: rect.height };
    };
    const main = element.closest('main');
    const grid = element.closest('.react-grid-layout');
    const identity = [...element.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .find(node => node.textContent?.trim() === identityName);
    if (!main || !identity || !grid) throw new Error('Missing VehicleHero viewport, native grid or identity geometry');
    return {
      panel: bounds(element), main: bounds(main), grid: bounds(grid), identity: bounds(identity),
      actions: [...element.querySelectorAll('a')].map(node => ({
        href: node.getAttribute('href'), ...bounds(node),
      })),
      mainScrollTop: main.scrollTop, windowScrollX: window.scrollX, windowScrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      computedHeight: getComputedStyle(element).height,
    };
  }, identityName);
  const before = await geometry();
  expect(before.panel.height).toBe(560);
  const columnWidth = (before.grid.width - (GRID_COLS.md - 1) * GRID_MARGIN[0]) / GRID_COLS.md;
  expect(before.panel.width, 'Both motion modes retain the seeded two-column native desktop allocation')
    .toBe(Math.round(2 * columnWidth + GRID_MARGIN[0]));
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
