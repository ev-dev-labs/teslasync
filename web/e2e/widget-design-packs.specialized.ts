import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertContained, compositionGeometry } from './widget-design-packs.acceptance';
import { DRIVE_DETAIL_ID } from './driveDetailFixtures';
import type { SpecializedReviewSources } from './widget-design-packs.specialized.mock';
import { alternateConversation, chargingReviewPath, syntheticConversation } from './widget-design-packs.specialized.fixtures';
import { energyReviewPath } from './widget-design-packs.energy.mock';

// These routes are registered in App.tsx. EfficiencyLandscape is deliberately
// not assigned an invented URL: its owner must supply a real route disposition.
export const specializedReviewRoutes = [
  '/battery-cells', chargingReviewPath, '/signal-mutual-information', energyReviewPath,
  `/drives/${DRIVE_DETAIL_ID}`, `/drives/${DRIVE_DETAIL_ID}/replay`, '/live', '/chatbot', '/statistics',
] as const;

async function withRunningObservationClock(page: Page, interact: () => Promise<void>) {
  const observationTime = await page.evaluate(() => Date.now());
  // Leaflet auto-pan and Recharts' mousemove throttle both measure elapsed Date time.
  await page.clock.setSystemTime(observationTime);
  try {
    await interact();
  } finally {
    await page.clock.setFixedTime(observationTime);
  }
}

export interface RouteVectorSegment {
  index: number; space: string; d: string; length: number;
  start: { x: number; y: number }; end: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
}

export function connectedRouteVectorGeometry(segments: readonly RouteVectorSegment[]) {
  const endpointKey = (segment: RouteVectorSegment, point: RouteVectorSegment['start']) =>
    JSON.stringify([segment.space, point.x, point.y]);
  const endpoints = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    if (!(segment.length > 0) || ![
      segment.length, segment.start.x, segment.start.y, segment.end.x, segment.end.y,
      segment.bounds.x, segment.bounds.y, segment.bounds.width, segment.bounds.height,
    ].every(Number.isFinite)) throw new Error('Route vectors require finite nondegenerate native geometry');
    for (const point of [segment.start, segment.end]) {
      const key = endpointKey(segment, point);
      endpoints.set(key, [...(endpoints.get(key) ?? []), index]);
    }
  });
  const visited = new Set<number>();
  return segments.flatMap((first, firstIndex) => {
    if (visited.has(firstIndex)) return [];
    visited.add(firstIndex);
    const members = [firstIndex];
    const connections: { from: number; to: number; point: RouteVectorSegment['start'] }[] = [];
    for (let cursor = 0; cursor < members.length; cursor++) {
      const segment = segments[members[cursor]];
      for (const point of [segment.start, segment.end]) {
        for (const neighbor of endpoints.get(endpointKey(segment, point)) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          members.push(neighbor);
          connections.push({ from: segment.index, to: segments[neighbor].index, point });
        }
      }
    }
    const group = members.map(index => segments[index]);
    const x = Math.min(...group.map(segment => segment.bounds.x));
    const y = Math.min(...group.map(segment => segment.bounds.y));
    return [{
      space: first.space,
      segmentIndices: group.map(segment => segment.index).sort((a, b) => a - b),
      connections,
      bounds: {
        x, y,
        width: Math.max(...group.map(segment => segment.bounds.x + segment.bounds.width)) - x,
        height: Math.max(...group.map(segment => segment.bounds.y + segment.bounds.height)) - y,
      },
      length: group.reduce((sum, segment) => sum + segment.length, 0),
    }];
  });
}

async function renderedRouteSegments(paths: Locator): Promise<RouteVectorSegment[]> {
  return paths.evaluateAll(nodes => {
    const svgs = [...new Set(nodes.map(node => node instanceof SVGPathElement ? node.ownerSVGElement : null))];
    return nodes.flatMap((node, index) => {
      if (!(node instanceof SVGPathElement) || !node.matches('.leaflet-interactive[fill="none"]')) return [];
      const d = node.getAttribute('d') ?? '';
      // Leaflet polylines have one M followed by L commands; arcs, closed markers and disjoint subpaths are not a route.
      if (!/^M[-+\d.eE,\s]+(?:L[-+\d.eE,\s]+)+$/.test(d) || node.getClientRects().length === 0) return [];
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility !== 'visible' || css.stroke === 'none'
        || Number(css.opacity) === 0 || Number(css.strokeOpacity) === 0) return [];
      const matrix = node.getScreenCTM();
      if (!matrix) return [];
      const length = node.getTotalLength();
      const start = node.getPointAtLength(0);
      // Clamp beyond the rounded native length to read the exact final endpoint.
      const end = node.getPointAtLength(length + 1);
      const bounds = node.getBBox();
      return [{
        index, d, length,
        // Identical coordinates only prove continuity within the same SVG and rendered transform.
        space: JSON.stringify([svgs.indexOf(node.ownerSVGElement), matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]),
        start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      }];
    });
  });
}

async function renderedGeometry(nodes: Locator, minimum = 1) {
  await expect(nodes.first()).toBeVisible();
  await expect.poll(() => nodes.evaluateAll(elements => {
    const owner = document.documentElement.getAttribute('data-app-design-owner');
    return owner !== null && elements.every(element => element.getAttribute('data-app-design-owner') === owner);
  }), { message: 'actual feature/vendor geometry receives the live complete profile' }).toBe(true);
  await expect.poll(() => nodes.evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  }).length)).toBeGreaterThanOrEqual(minimum);
  return nodes.evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).map(element => {
    const box = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const path = element instanceof SVGPathElement ? element : null;
    return {
      width: box.width, height: box.height,
      display: css.display, columns: css.gridTemplateColumns, gap: css.gap,
      padding: css.padding, fontSize: css.fontSize, lineHeight: css.lineHeight,
      pathLength: path?.getTotalLength() ?? null,
    };
  }));
}

async function inspectOpenDialog(
  page: Page, dialog: Locator, packId: PackId, testInfo: TestInfo, file: string,
) {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
  await assertContained(dialog, 'real specialized route open details');
  const geometry = await compositionGeometry(dialog);
  await dialog.screenshot({ path: testInfo.outputPath(file), animations: 'disabled' });
  if (await dialog.getAttribute('aria-modal') === 'true') {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return geometry;
}

async function inspectReviewDetails(page: Page, packId: PackId, testInfo: TestInfo, file: string) {
  const trigger = page.locator('main').getByRole('button', { name: 'Review details', exact: true }).first();
  // WebKit pointer activation focuses main; establish the keyboard return target before opening.
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const geometry = await inspectOpenDialog(page, page.getByRole('dialog'), packId, testInfo, file);
  await expect(trigger).toBeFocused();
  return geometry;
}

export async function sampleHeatmapPaint(plot: Locator) {
  const pixels = await plot.screenshot({ animations: 'disabled' });
  const paint = await plot.evaluate(async (element, imageData) => {
    const nodes = element.querySelectorAll('rect');
    const bounds = element.getBoundingClientRect();
    const samples = [36, 37, 38, 39].map(index => {
      const box = nodes[index].getBoundingClientRect();
      return {
        fill: getComputedStyle(nodes[index]).fill,
        x: (box.left + box.width / 2 - bounds.left) / bounds.width,
        y: (box.top + box.height / 2 - bounds.top) / bounds.height,
      };
    });
    const image = new Image();
    image.src = `data:image/png;base64,${imageData}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Heatmap paint verification requires a 2D context');
    context.drawImage(image, 0, 0);
    return samples.map(sample => {
      const x = Math.floor(sample.x * canvas.width);
      const y = Math.floor(sample.y * canvas.height);
      return { fill: sample.fill, sample: { x, y, width: canvas.width, height: canvas.height },
        rgba: [...context.getImageData(x, y, 1, 1).data] };
    });
  }, pixels.toString('base64'));
  return { pixels, paint };
}

/** Actual data-backed feature renderers and local open controls. Metadata is
 * checked separately; distinctness evidence contains only measured geometry. */
export async function inspectSpecializedRoute(
  page: Page, path: string, packId: PackId, testInfo: TestInfo, sources: SpecializedReviewSources,
  units: { temperature: 'C' | 'F'; distance: 'km' | 'mi' },
) {
  const main = page.locator('main');
  const evidence: Record<string, unknown> = {};
  const prefix = `${packId}-${path.replace(/\W+/g, '-')}`;
  if (path === '/') {
    const sampleSpeed = units.distance === 'mi' ? '44.74' : '72.00';
    const heatmap = main.locator('[data-widget-id="pack-review-speed-heatmap"]');
    const plot = heatmap.locator('svg[data-chart-family="speed-heatmap"]:visible');
    if ((page.viewportSize()?.width ?? 0) < 600) {
      // The real xs dashboard intentionally passes cols:1. Preserve that
      // source-owned compact reading rather than injecting a fake full plot.
      await expect(plot).toHaveCount(0);
      await expect(heatmap).toContainText(sampleSpeed);
      evidence.speedCompact = await renderedGeometry(heatmap);
    } else {
      await expect(plot).toHaveCount(1);
      await plot.scrollIntoViewIfNeeded();
      await expect(plot.locator('rect')).toHaveCount(168);
      const { pixels, paint } = await sampleHeatmapPaint(plot);
      await testInfo.attach(`${prefix}-speed-heatmap.png`, { body: pixels, contentType: 'image/png' });
      await testInfo.attach(`${prefix}-speed-heatmap-paint.json`, { body: JSON.stringify(paint), contentType: 'application/json' });
      const distances = paint.slice(0, 3).map(color => color.rgba.slice(0, 3)
        .reduce((sum, channel, index) => sum + (channel - paint[3].rgba[index]) ** 2, 0));
      expect(distances[0], 'maximum speed has stronger paint than the middle sample').toBeGreaterThan(distances[1]);
      expect(distances[1], 'middle speed has stronger paint than measured zero').toBeGreaterThan(distances[2]);
      expect(distances[2], 'measured zero stays visually distinct from no sample').toBeGreaterThan(0);
      evidence.speedPaint = paint.map(({ fill, rgba }) => ({ fill, rgba }));
      await expect(plot).toContainText(sampleSpeed);
      await expect(plot.locator('title')).toHaveCount(168);
      const fallback = heatmap.getByRole('table', { name: 'Speed heatmap — data table', includeHidden: true });
      await expect(fallback.getByRole('row', { includeHidden: true })).toHaveCount(169);
      await expect(heatmap.locator('[data-chart-scale]')).toBeVisible();
      evidence.speedCells = await renderedGeometry(plot.locator('rect'), 168);
      evidence.speedPlot = await renderedGeometry(plot);
    }
  }
  if (path === '/battery-cells') {
    const heatmap = main.locator('[data-chart-family="battery-cells"][role="img"]');
    await expect(heatmap).toHaveCount(4);
    await expect(heatmap.first()).toHaveAttribute('aria-label', /3\.900 V.*\+5.*mV/);
    await expect(heatmap.nth(2)).toHaveAttribute('aria-label', /3\.850 V.*-45.*mV/);
    await expect(main.locator('[data-chart-family="battery-cells"][data-heatmap-state="unavailable"]')).toHaveCount(1);
    await expect(heatmap.last()).toHaveAttribute('aria-label', /Unknown/);
    const paints = await heatmap.evaluateAll(nodes => nodes.map(node => {
      const css = getComputedStyle(node);
      return { background: css.backgroundColor, border: css.borderTopColor };
    }));
    expect(new Set(paints.slice(0, 3).map(paint => paint.background)).size, 'three meaningful voltage status fills survive').toBe(3);
    expect(new Set(paints.slice(0, 3).map(paint => paint.border)).size, 'three meaningful voltage status borders survive').toBe(3);
    // Review evidence only: colors are NOT inputs to composition distinctness.
    await testInfo.attach(`${prefix}-cell-status-paints.json`, { body: JSON.stringify(paints), contentType: 'application/json' });
    evidence.cells = await renderedGeometry(heatmap, 4);
    await main.getByRole('button', { name: 'Switch to bar view', exact: true }).click();
    const voltageChart = main.getByRole('figure', { name: 'Cell voltage heatmap', exact: true });
    const bars = voltageChart.locator('.recharts-bar-rectangle path');
    evidence.voltageBars = await renderedGeometry(bars, 3);
    // Reveal the whole responsive plot, not just the first bar's partly clipped bounds.
    await voltageChart.scrollIntoViewIfNeeded();
    await withRunningObservationClock(page, async () => {
      await bars.first().hover();
      const tooltip = page.locator('[data-app-part~="chart-tooltip"]:visible').first();
      await expect(tooltip).toContainText('Voltage');
      evidence.voltageTooltip = await renderedGeometry(tooltip);
      await tooltip.screenshot({ path: testInfo.outputPath(`${prefix}-voltage-tooltip.png`), animations: 'disabled' });
    });
    await main.getByRole('button', { name: 'Switch to grid view', exact: true }).click();
    evidence.review = await inspectReviewDetails(page, packId, testInfo, `${prefix}-review.png`);
    sources.setNoCellData(true);
    try {
      await page.getByRole('button', { name: /^Refresh data ·/ }).click();
      await expect(heatmap).toHaveCount(0);
      await expect(main).toContainText('No cell readings available.');
      await expect(main).toContainText('398.5');
      const temperatures = main.getByRole('region', { name: 'Temperature summary', exact: true });
      await expect(temperatures).toContainText(units.temperature === 'F' ? /71\.6(?:0)?/ : /22(?:\.0+)?/);
      await expect(temperatures).toContainText(units.temperature === 'F' ? /86(?:\.0+)?/ : /30(?:\.0+)?/);
      await expect(temperatures).toContainText(`°${units.temperature}`);
      await expect(temperatures).not.toContainText('No temperature data available');
      evidence.independentPackTemperature = await compositionGeometry(main);
    } finally {
      sources.setNoCellData(false);
    }
    await page.getByRole('button', { name: /^Refresh data ·/ }).click();
    await expect(heatmap).toHaveCount(4);
  }
  if (path === chargingReviewPath) {
    const boundary = main.locator('[data-chart-key="charging-weekly-heatmap"]');
    await expect(boundary.locator('[data-chart-viewport][role="group"]')).toBeVisible();
    await expect(boundary.locator('[role="img"] [data-heatmap-slot]')).toHaveCount(0);
    const grid = main.locator('[data-heatmap-grid]');
    await expect(grid.locator('[data-heatmap-slot]')).toHaveCount(168);
    await expect(grid.locator('[data-heatmap-slot][tabindex="0"]')).toHaveCount(1);
    evidence.chargingCells = await renderedGeometry(grid.locator('[data-heatmap-slot]'), 168);
    const recorded = grid.getByRole('button', { name: /— 2 sessions$/ });
    await page.mouse.move(1, 1);
    await recorded.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    await recorded.focus();
    await recorded.press('Enter');
    const detail = page.getByRole('dialog').filter({ has: page.locator('[data-chart-tooltip-label]') });
    await expect(detail).toContainText('2 sessions');
    await expect(detail).toContainText('0.00');
    await expect(detail).toContainText('Some returned sessions have no recorded value');
    await expect(detail).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
    expect(await detail.evaluate(element => Boolean(element.closest('[data-app-design-portal]')))).toBe(true);
    await assertContained(detail, 'real portaled charging partial-zero detail');
    evidence.partialZero = await compositionGeometry(detail);
    await detail.screenshot({ path: testInfo.outputPath(`${prefix}-partial-zero.png`), animations: 'disabled' });
    const before = await detail.boundingBox();
    const recordedSlot = Number(await recorded.getAttribute('data-heatmap-slot'));
    await recorded.press('ArrowRight');
    const signed = grid.locator(`[data-heatmap-slot="${recordedSlot + 1}"]`);
    await expect(signed).toBeFocused();
    await expect(detail).toContainText('1 sessions');
    await expect(detail).toContainText(/[−-]1\.25/);
    const anchor = await signed.boundingBox();
    expect(anchor).not.toBeNull();
    await expect.poll(async () => {
      const popup = await detail.boundingBox();
      return popup && anchor ? Math.abs(popup.x + popup.width / 2 - (anchor.x + anchor.width / 2)) : Infinity;
    }, { message: 'real shared portaled placement follows the keyboard-selected cell' }).toBeLessThan(3);
    expect((await detail.boundingBox())?.x).not.toBe(before?.x);
    evidence.slotDetail = await inspectOpenDialog(page, detail, packId, testInfo, `${prefix}-signed-slot.png`);
    await expect(signed).toBeFocused();
    await signed.press('End');
    await expect(grid.locator(`[data-heatmap-slot="${Math.floor(recordedSlot / 24) * 24 + 23}"]`)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(grid.locator(`[data-heatmap-slot="${Math.floor(recordedSlot / 24) * 24}"]`)).toBeFocused();
    await page.keyboard.press('Control+Home');
    await expect(grid.locator('[data-heatmap-slot="0"]')).toBeFocused();
    await page.keyboard.press('Control+End');
    await expect(grid.locator('[data-heatmap-slot="167"]')).toBeFocused();
    await recorded.focus();
    await recorded.press('Space');
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(detail).toBeHidden();
    await expect(recorded).toBeFocused();
    await recorded.press('Enter');
    await main.getByRole('heading', { level: 1 }).click();
    await expect(detail).toBeHidden();
    evidence.review = await inspectReviewDetails(page, packId, testInfo, `${prefix}-review.png`);
  }
  if (path === '/signal-mutual-information') {
    await main.getByRole('combobox', { name: 'Signal A', exact: true }).selectOption('NumericA');
    await main.getByRole('combobox', { name: 'Signal B', exact: true }).selectOption('NumericB');
    const cells = main.locator('[data-chart-family="heatmap"][aria-label^="Signal A bin"]');
    await expect.poll(() => cells.count()).toBeGreaterThanOrEqual(4);
    await expect(main.getByTestId('signal-mutual-information-summary')).toContainText('64');
    evidence.jointCells = await renderedGeometry(cells, 4);
    for (const title of ['Signals to compare', 'Mutual information metrics', 'Top joint-state contributions', 'Contribution heatmap']) {
      await expect(main.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    }
    const negative = cells.filter({ hasText: /[−-]\d/ });
    await expect.poll(() => negative.count()).toBeGreaterThan(0);
    for (const cell of await negative.all()) await expect(cell).toHaveCSS('border-top-style', 'dashed');
    const fallback = main.getByRole('table', { name: 'Contribution heatmap — data table', includeHidden: true });
    await expect(fallback.getByRole('row', { includeHidden: true })).toHaveCount(await cells.count() + 1);
    const bars = main.locator('.recharts-bar-rectangle path');
    await withRunningObservationClock(page, async () => {
      let nonzero = -1;
      await expect.poll(async () => {
        nonzero = await bars.evaluateAll(nodes => nodes.findIndex(node => (node as SVGPathElement).getBBox().height > 1));
        return nonzero;
      }, { message: 'real contribution paths finish growing before native hover' }).toBeGreaterThanOrEqual(0);
      evidence.contributionBars = await renderedGeometry(bars);
      await bars.nth(nonzero).hover();
      const tooltip = page.locator('[data-app-part~="chart-tooltip"]:visible').first();
      await expect(tooltip).toContainText('Contribution');
      evidence.contributionTooltip = await renderedGeometry(tooltip);
      await tooltip.screenshot({ path: testInfo.outputPath(`${prefix}-contribution-tooltip.png`), animations: 'disabled' });
    });
    evidence.review = await inspectReviewDetails(page, packId, testInfo, `${prefix}-review.png`);
  }
  if (path === `/drives/${DRIVE_DETAIL_ID}` || path === `/drives/${DRIVE_DETAIL_ID}/replay` || path === '/live') {
    const map = main.locator('.leaflet-container').first();
    await map.scrollIntoViewIfNeeded();
    evidence.map = await renderedGeometry(map);
    const paths = map.locator('.leaflet-overlay-pane path');
    if (path !== '/live') {
      let segments: RouteVectorSegment[] = [];
      let connected: ReturnType<typeof connectedRouteVectorGeometry> = [];
      await expect.poll(async () => {
        segments = await renderedRouteSegments(paths);
        connected = connectedRouteVectorGeometry(segments);
        return connected.filter(({ bounds: box }) => box.width > 30 && box.height > 10).length;
      }).toBeGreaterThan(0);
      evidence.routeVectors = await renderedGeometry(paths);
      evidence.routeVectorSegments = segments;
      evidence.connectedRouteVectors = connected;
      await testInfo.attach(`${prefix}-connected-route-vectors.json`, {
        body: JSON.stringify({ segments, connected, originalPathGeometry: evidence.routeVectors }),
        contentType: 'application/json',
      });
    } else {
      // The actual Live stage renders a marker, not a fictional route trace.
      // Its real multi-point vectors are checked after switching to Recent.
      evidence.observedMarker = await renderedGeometry(map.locator('.leaflet-marker-icon'));
    }
    evidence.mapControls = await renderedGeometry(main.getByRole('group', { name: 'Map style', exact: true }).first());
    evidence.mapStage = await renderedGeometry(main.locator('[data-app-part~="map-stage"]'));
    if (path === `/drives/${DRIVE_DETAIL_ID}`) {
      await expect(main.locator('[data-map-legend="speed"] li')).toHaveCount(4);
      evidence.speedLegend = await renderedGeometry(main.locator('[data-map-legend="speed"]'));
      const route = main.getByRole('region', { name: 'Route map', exact: true });
      await expect(route).toHaveAttribute('data-route-mode', 'path');
      await expect(route.locator('[data-app-part~="map-provenance"]')).toHaveCount(0);
      evidence.recordedRoute = await renderedGeometry(route);
      await withRunningObservationClock(page, async () => {
        await map.locator('.leaflet-interactive').last().click();
        const popup = map.locator('.leaflet-popup-content-wrapper');
        await expect(popup).toBeVisible();
        await expect(map.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-pan-anim/);
        await expect(popup).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
        evidence.endpointPopup = await renderedGeometry(popup);
        await popup.screenshot({ path: testInfo.outputPath(`${prefix}-endpoint.png`), animations: 'disabled' });
        await map.locator('.leaflet-popup-close-button').click();
        await expect(popup).toBeHidden();
      });
      const overview = main.locator('[data-chart-key="drive-detail-overview"]');
      const travellers = overview.getByRole('slider');
      await expect(travellers).toHaveCount(2);
      const traveller = travellers.first();
      await traveller.scrollIntoViewIfNeeded();
      await traveller.focus();
      const start = await traveller.getAttribute('aria-valuenow');
      expect(start).not.toBeNull();
      const trace = overview.locator('.recharts-area-curve').first();
      const beforePath = await trace.getAttribute('d');
      expect(beforePath).not.toBeNull();
      await traveller.press('ArrowRight');
      await expect(traveller).not.toHaveAttribute('aria-valuenow', start ?? '');
      await expect(trace).not.toHaveAttribute('d', beforePath ?? '');
      evidence.brushWindow = await renderedGeometry(overview.locator('.recharts-brush'));
      await traveller.press('ArrowLeft');
      await expect(traveller).toHaveAttribute('aria-valuenow', start ?? '');
      const toggle = overview.locator('button[data-series-key="power"]');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      const curves = await overview.locator('.recharts-line-curve').count();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(overview.locator('.recharts-line-curve')).toHaveCount(curves - 1);
      await expect(overview.locator('button[data-series-key="power"]')).toHaveCount(1);
      evidence.nativeLegend = await renderedGeometry(overview.locator('[data-app-part~="chart-legend"]'));
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(overview.locator('.recharts-line-curve')).toHaveCount(curves);
    } else if (path === '/live') {
      const details = main.getByRole('region', { name: 'Location details', exact: true });
      await expect(details.locator('dl[data-app-list="definitions"]')).toHaveCount(3);
      await expect(details.locator('dt')).toHaveCount(8);
      await expect(details.locator('dd')).toHaveCount(8);
      await expect(details).toContainText('47.612');
      await expect(details).toContainText('-122.314');
      await expect(details).toContainText('0.00');
      evidence.locationFacts = await renderedGeometry(details);
      evidence.liveSplit = await renderedGeometry(main.getByTestId('map-overview-hero'));
      await map.locator('.leaflet-marker-icon').click();
      const popup = map.locator('.leaflet-popup-content-wrapper');
      await expect(popup).toContainText('Aurora');
      evidence.vehiclePopup = await renderedGeometry(popup);
      await map.locator('.leaflet-popup-close-button').click();
      await main.getByRole('button', { name: 'Details', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Sources and method', exact: true })
        .locator('[data-app-part~="map-sources"]')).toBeVisible();
      evidence.sources = await inspectOpenDialog(page, page.getByRole('dialog', { name: 'Sources and method', exact: true }),
        packId, testInfo, `${prefix}-sources.png`);
      await main.getByRole('button', { name: 'Recent route', exact: true }).click();
      const recentMap = main.locator('[data-map-kind="overview"] .leaflet-container');
      evidence.recentMap = await renderedGeometry(recentMap);
      const recentPaths = recentMap.locator('.leaflet-overlay-pane path');
      await expect.poll(() => recentPaths.evaluateAll(nodes => nodes.filter(node => {
        const box = (node as SVGPathElement).getBBox();
        return box.width > 30 && box.height > 10;
      }).length)).toBeGreaterThan(0);
      evidence.recentVectors = await renderedGeometry(recentPaths);
      const slider = main.getByRole('slider', { name: 'Playback progress', exact: true });
      await slider.focus();
      await slider.press('End');
      await expect(slider).toHaveAttribute('aria-valuenow', '100');
      await main.getByRole('button', { name: 'Live', exact: true }).click();
    } else {
      const stats = main.getByTestId('replay-current-stats');
      await expect(stats.locator('[data-app-metric="tile"]')).toHaveCount(6);
      const slider = main.getByRole('slider', { name: 'Playback progress', exact: true });
      await slider.focus();
      await slider.press('Home');
      const before = await main.getByTestId('replay-current-stats').textContent();
      await slider.press('End');
      await expect(slider).toHaveAttribute('aria-valuenow', '100');
      await expect(main.getByTestId('replay-current-stats')).not.toHaveText(before ?? '');
      evidence.replayReadout = await renderedGeometry(main.getByTestId('replay-current-stats'));
      const timeline = main.getByRole('group', {
        name: 'Trip replay speed and power timeline area chart', exact: true,
      });
      await expect(timeline).toBeVisible();
      const timelineCurves = timeline.locator('.recharts-area-curve');
      await expect(timelineCurves).toHaveCount(2);
      evidence.replayCurves = await renderedGeometry(timelineCurves, 2);
      await expect(timeline.getByRole('button', { name: 'Speed', exact: true })).toHaveCount(1);
      const power = timeline.getByRole('button', { name: 'Power', exact: true });
      await expect(power).toHaveAttribute('aria-pressed', 'false');
      await power.click();
      await expect(power).toHaveAttribute('aria-pressed', 'true');
      await expect(timelineCurves).toHaveCount(1);
      await power.click();
      await expect(power).toHaveAttribute('aria-pressed', 'false');
      await expect(timelineCurves).toHaveCount(2);
      const elevation = main.getByRole('img', { name: /^Elevation profile$/i });
      await expect(elevation).toBeVisible();
      const elevationCurve = elevation.locator('.recharts-area-curve');
      await expect(elevationCurve).toHaveCount(1);
      evidence.replayElevation = await renderedGeometry(elevationCurve);
      await main.getByRole('button', { name: 'Sources', exact: true }).click();
      const sourcesDialog = page.getByRole('dialog', { name: 'Sources', exact: true });
      await expect(sourcesDialog.locator('[data-testid^="replay-source-"]')).toHaveCount(6);
      await expect(sourcesDialog.getByTestId('replay-source-speed')).toContainText('Position');
      await expect(sourcesDialog.getByTestId('replay-source-speed')).toContainText('Historical');
      evidence.sources = await inspectOpenDialog(page, page.getByRole('dialog', { name: 'Sources', exact: true }),
        packId, testInfo, `${prefix}-sources.png`);
      await slider.focus();
      await slider.press('Home');
    }
  }
  if (path === '/chatbot') {
    const historyPreference = await page.evaluate(() => localStorage.getItem('teslasync-chatbot-history-visible'));
    const history = main.getByRole('button', { name: 'History', exact: true });
    const initiallyOpen = await history.getAttribute('aria-pressed') === 'true';
    if (!initiallyOpen) await history.click();
    const sessions = page.getByRole('complementary', { name: 'History', exact: true });
    await sessions.getByRole('button', { name: 'New chat', exact: true }).click();
    const composer = main.getByRole('textbox', { name: 'Message', exact: true });
    const welcome = main.locator('[data-app-part~="conversation-welcome"]');
    await expect(welcome).toBeVisible();
    const suggestions = welcome.getByRole('list', { name: 'Suggested prompts', exact: true }).getByRole('button');
    await expect(suggestions).toHaveCount(4);
    for (const suggestion of await suggestions.all()) {
      const prompt = await suggestion.innerText();
      await suggestion.click();
      await expect(composer).toHaveValue(prompt);
      await expect(composer).toBeFocused();
    }
    evidence.welcome = await compositionGeometry(welcome);
    await composer.fill('');
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    await page.getByRole('button', { name: new RegExp(`^${alternateConversation}`) }).click();
    const transcript = main.getByRole('log', { name: 'Conversation', exact: true });
    await expect(transcript).toContainText('QA alternate question');
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    await page.getByRole('button', { name: new RegExp(`^${syntheticConversation}`) }).click();
    await expect(transcript).toContainText('QA recorded question');
    await expect(transcript).not.toContainText('QA alternate question');
    await expect(transcript).toContainText('QA recorded answer.');
    await expect(transcript.locator('[data-role="user"]')).toHaveCount(1);
    await expect(transcript.locator('[data-role="assistant"] li')).toHaveCount(2);
    await expect(transcript.locator('[data-role="assistant"] pre code')).toHaveText(/^QA example only\s*$/);
    evidence.transcript = await renderedGeometry(transcript);
    await composer.fill('Draft only: never submitted.');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('Draft only: never submitted.\n');
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await composer.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true });
    await expect(composer).toHaveValue('Draft only: never submitted.\n');
    await expect(main.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    evidence.composer = await renderedGeometry(main.locator('[data-app-part~="conversation-composer"]'));
    await composer.fill('');
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    const row = sessions.getByRole('listitem').filter({ has: page.getByRole('button', { name: new RegExp(`^${syntheticConversation}`) }) });
    await row.getByRole('button', { name: 'Rename conversation', exact: true }).click();
    const rename = page.getByRole('textbox', { name: 'Rename conversation', exact: true });
    await rename.fill('Local revision, cancelled');
    await rename.press('Escape');
    await expect(sessions).toBeVisible();
    const deleteTrigger = row.getByRole('button', { name: 'Delete conversation', exact: true });
    await deleteTrigger.focus();
    await deleteTrigger.press('Enter');
    const confirmation = page.getByRole('dialog', { name: 'Delete conversation?', exact: true });
    evidence.confirmation = await inspectOpenDialog(page, confirmation, packId, testInfo, `${prefix}-confirmation.png`);
    await expect(sessions).toBeVisible();
    await expect(deleteTrigger).toBeFocused();
    // Close only the history UI, never confirm delete, save rename or submit.
    const drawer = page.getByRole('dialog', { name: 'History', exact: true });
    if (await drawer.isVisible()) await page.keyboard.press('Escape');
    if ((await history.getAttribute('aria-pressed') === 'true') !== initiallyOpen) await history.click();
    await page.evaluate(value => {
      if (value === null) localStorage.removeItem('teslasync-chatbot-history-visible');
      else localStorage.setItem('teslasync-chatbot-history-visible', value);
    }, historyPreference);
  }
  if (path === '/statistics') {
    const states = main.getByRole('figure', { name: 'State distribution', exact: true });
    const sectors = states.locator('.recharts-pie-sector path');
    await expect(sectors).toHaveCount(2);
    evidence.stateSectors = await renderedGeometry(sectors, 2);
    const legend = states.locator('[data-app-part~="chart-legend"]');
    await expect(legend).toContainText('Driving');
    await expect(legend).toContainText('Parked');
    await expect(legend.getByRole('button')).toHaveCount(0);
    await expect(legend.locator('[data-chart-legend-label]')).toHaveCount(2);
    evidence.passiveLegend = await renderedGeometry(legend);
    await expect(main).toContainText('Add more vehicles to compare');
    const sector = sectors.first();
    await sector.scrollIntoViewIfNeeded();
    // An annular sector's bounding-box center can be in its unpainted hole.
    const paintedPoint = await sector.evaluate(element => {
      if (!(element instanceof SVGPathElement)) throw new Error('Expected a real pie sector path');
      const bounds = element.getBoundingClientRect();
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error('Pie sector has no screen transform');
      const inverse = matrix.inverse();
      for (const x of [0.25, 0.75, 0.5, 0.125, 0.875]) {
        for (const y of [0.25, 0.75, 0.5, 0.125, 0.875]) {
          const point = new DOMPoint(bounds.left + bounds.width * x, bounds.top + bounds.height * y);
          if (element.isPointInFill(point.matrixTransform(inverse))
            && document.elementFromPoint(point.x, point.y) === element) {
            return { x: bounds.width * x, y: bounds.height * y };
          }
        }
      }
      throw new Error('Pie sector has no visible, genuinely hit-testable painted point');
    });
    await sector.hover({ position: paintedPoint });
    const tooltip = page.locator('[data-app-part~="chart-tooltip"]:visible').first();
    await expect(tooltip).toBeVisible();
    evidence.stateTooltip = await renderedGeometry(tooltip);
    evidence.review = await inspectReviewDetails(page, packId, testInfo, `${prefix}-review.png`);
  }
  return evidence;
}
