import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { COMPOSITOR_METRICS } from '../src/lib/teslaCompositor';
import type { WidgetSize } from '../src/features/dashboard/widgets/types';
import { observeCatalogueAxisRendering } from './dashboardCatalogueAxisDiagnostic';
import { assertCatalogueFullBounds } from './dashboardCatalogueBounds';

export async function installCataloguePhotoSource(page: Page, svgFallback: boolean) {
  const path = process.env.E2E_CATALOGUE_PHOTO
    ?? resolve(process.cwd(), 'e2e', 'fixtures', 'dashboard-catalogue-model-y-white.png');
  await page.route('https://static-assets.tesla.com/configurator/compositor*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('model') !== 'my' || !url.searchParams.get('options')?.includes('$PPSW')) {
      await route.abort();
      throw new Error(`Unmatched compositor source: ${url.search}`);
    }
    // A completed but undecodable source exercises the documented SVG fallback without outbound traffic.
    if (svgFallback) await route.fulfill({ status: 200, contentType: 'image/png', body: 'Unavailable compositor source' });
    else await route.fulfill({ status: 200, contentType: 'image/png', path });
  });
}

export async function assertCatalogueAllocation(panel: Locator, widgetId: string, info: TestInfo) {
  const allocation = await panel.evaluate(element => {
    const shell = element.querySelector('[aria-busy]');
    const heading = shell?.querySelector('h3');
    const body = shell && [...shell.children].find(child => child.classList.contains('@container'));
    if (!heading || !body) throw new Error('Missing widget heading/body allocation');
    const h = heading.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    const p = element.getBoundingClientRect();
    return { headingBottom: h.bottom, bodyTop: b.top, bodyBottom: b.bottom,
      panelBottom: p.bottom, bodyHeight: b.height, clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight };
  });
  expect(allocation.headingBottom, `${widgetId}: heading overlaps body`).toBeLessThanOrEqual(allocation.bodyTop + 1);
  expect(allocation.bodyBottom, `${widgetId}: body escapes allocated card`).toBeLessThanOrEqual(allocation.panelBottom + 1);
  expect(allocation.bodyHeight, `${widgetId}: header leaves no content allocation`).toBeGreaterThan(30);
  if (['battery-gauge', 'range-estimate', 'drive-score', 'sleep-efficiency', 'regen-efficiency'].includes(widgetId)) {
    expect(allocation.scrollHeight, `${widgetId}: compact readings require vertical overflow`)
      .toBeLessThanOrEqual(allocation.clientHeight + 1);
  }
  await writeFile(info.outputPath(`${widgetId}-allocation.json`), JSON.stringify(allocation, null, 2));
}

export async function assertCatalogueYAxisTickBounds(
  panel: Locator, widgetId: string, info: TestInfo, expectedAxes = 1,
) {
  if (process.env.E2E_CATALOGUE_AXIS_DIAGNOSTIC === '1' && widgetId === 'charge-session-chart') {
    await observeCatalogueAxisRendering(panel, info);
  }
  const { ticks, axisTicks, chartGeometry, widgetBounds } = await panel.evaluate(element => {
    const charts = [...element.querySelectorAll('svg.recharts-surface')];
    if (charts.length === 0) throw new Error('Missing populated widget chart');
    const widget = element.getBoundingClientRect();
    const measure = (node: Element | null) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { tag: node.tagName, className: node.getAttribute('class'),
        inlineStyle: node.getAttribute('style'), x: box.x, y: box.y,
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, height: box.height, display: style.display,
        flex: style.flex, minHeight: style.minHeight, maxHeight: style.maxHeight,
        contain: style.contain };
    };
    const chartGeometry = charts.map(svg => {
      const figure = svg.closest('figure');
      const responsiveContainer = svg.closest('.recharts-responsive-container');
      const sharedViewport = svg.closest('[data-chart-viewport]');
      return {
        svg: measure(svg),
        responsiveContainer: measure(responsiveContainer),
        viewport: measure(sharedViewport ?? responsiveContainer),
        viewportKind: sharedViewport ? 'shared-chart-viewport' : 'direct-responsive-container',
        figure: measure(figure),
      };
    });
    const axisTicks = charts.flatMap((svg, chartIndex) => {
      const bounds = svg.getBoundingClientRect();
      const indexes = { x: 0, y: 0 };
      return [...svg.querySelectorAll('.recharts-xAxis, .recharts-yAxis')].flatMap(axis => {
        const axisKind = axis.classList.contains('recharts-yAxis') ? 'y' : 'x';
        const axisIndex = indexes[axisKind]++;
        return [...axis.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(tick => {
          const box = tick.getBoundingClientRect();
          return { text: tick.textContent, left: box.left, right: box.right,
            top: box.top, bottom: box.bottom, height: box.height,
            chartLeft: bounds.left, chartRight: bounds.right,
            chartTop: bounds.top, chartBottom: bounds.bottom,
            widgetLeft: widget.left, widgetRight: widget.right, width: box.width,
            widgetTop: widget.top, widgetBottom: widget.bottom,
            chartIndex, axisIndex, axisKind };
        });
      });
    });
    return { ticks: axisTicks.filter(tick => tick.axisKind === 'y'), axisTicks,
      chartGeometry, widgetBounds: measure(element) };
  });
  await writeFile(info.outputPath(`${widgetId}-chart-geometry.json`), JSON.stringify(chartGeometry, null, 2));
  await writeFile(info.outputPath(`${widgetId}-all-axis-tick-bounds.json`), JSON.stringify({
    widgetBounds, axisTicks,
  }, null, 2));
  await writeFile(info.outputPath(`${widgetId}-tick-bounds.json`), JSON.stringify(ticks, null, 2));
  const axes = [...new Set(ticks.map(tick => `${tick.chartIndex}:${tick.axisIndex}`))];
  const contract = { expectedAxes, actualAxes: axes.length, tickCount: ticks.length,
    xTickCount: axisTicks.filter(tick => tick.axisKind === 'x').length };
  await writeFile(info.outputPath(`${widgetId}-axis-contract.json`), JSON.stringify({
    status: 'captured-not-asserted', ...contract,
  }, null, 2));
  if (!widgetBounds) throw new Error(`${widgetId}: missing widget bounds`);
  for (const [index, chart] of chartGeometry.entries()) {
    if (!chart.svg || !chart.viewport) throw new Error(`${widgetId}: missing chart ${index} SVG/viewport bounds`);
    assertCatalogueFullBounds(chart.svg, chart.viewport, `${widgetId}: SVG ${index} in viewport`);
    assertCatalogueFullBounds(chart.svg, widgetBounds, `${widgetId}: SVG ${index} in widget`);
  }
  expect(axes.length, `${widgetId}: missing or unexpected visible Y-axis`).toBe(expectedAxes);
  for (const axis of axes) {
    expect(ticks.filter(tick => `${tick.chartIndex}:${tick.axisIndex}` === axis).length,
      `${widgetId}: missing rendered ticks on axis ${axis}`).toBeGreaterThan(2);
  }
  for (const tick of axisTicks) {
    const chart = chartGeometry[tick.chartIndex];
    if (!chart?.svg || !chart.viewport) throw new Error(`${widgetId}: missing tick chart bounds`);
    const label = `${widgetId}: ${tick.axisKind.toUpperCase()} tick ${tick.text}`;
    assertCatalogueFullBounds(tick, chart.svg, `${label} in SVG`);
    assertCatalogueFullBounds(tick, chart.viewport, `${label} in viewport`);
    assertCatalogueFullBounds(tick, widgetBounds, `${label} in widget`);
  }
  await writeFile(info.outputPath(`${widgetId}-axis-contract.json`), JSON.stringify({
    status: 'bounds-passed', ...contract,
  }, null, 2));
  return ticks;
}

export async function assertSpeedProfileTickBounds(panel: Locator, info: TestInfo) {
  const ticks = await assertCatalogueYAxisTickBounds(panel, 'speed-profile', info, 2);
  expect(ticks.filter(tick => tick.text?.includes('%')).length).toBeGreaterThan(2);
  expect(ticks.filter(tick => !tick.text?.includes('%')).length).toBeGreaterThan(2);
}

const affectedAxisIDs = new Set([
  'battery-degradation-trend', 'drive-efficiency-chart', 'driving-dynamics',
  'charge-session-chart', 'climate-history', 'cost-breakdown', 'cost-forecast',
  'energy-stats', 'monthly-mileage', 'motor-history', 'power-flow-history',
  'solar-production', 'tire-pressure-history', 'wall-connector', 'drive-telemetry',
]);

export async function assertCatalogueAffectedAxes(
  panel: Locator, widgetId: string, size: WidgetSize, info: TestInfo,
) {
  if (!affectedAxisIDs.has(widgetId)) return;
  const squareCompact = ['battery-degradation-trend', 'drive-efficiency-chart', 'charge-session-chart']
    .includes(widgetId);
  const compact = size.cols <= 1 && (!squareCompact || size.rows <= 1);
  let reason: string | undefined;
  if (compact) reason = 'Source compact branch has readings but no visible Y-axis';
  else if (widgetId === 'driving-dynamics' && size.cols < 3) {
    reason = 'Distribution histogram is wide-only; standard branch has source-backed gauges';
  } else if (widgetId === 'cost-breakdown') {
    await expect(panel.locator('.recharts-pie-sector').first()).toBeVisible();
    reason = 'Positive finite monthly costs use the genuine donut branch; signed bar covered separately';
    await assertCatalogueYAxisTickBounds(panel, widgetId, info, 0);
    await writeFile(info.outputPath(`${widgetId}-axis-contract.json`), JSON.stringify({
      status: 'bounds-passed', axisStatus: 'not-applicable',
      expectedAxes: 0, actualAxes: 0, reason, size,
    }, null, 2));
    return;
  }
  if (reason) {
    await expect(panel.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value')).toHaveCount(0);
    await writeFile(info.outputPath(`${widgetId}-axis-contract.json`), JSON.stringify({
      status: 'not-applicable', reason, size,
    }, null, 2));
    return;
  }
  await assertCatalogueYAxisTickBounds(panel, widgetId, info,
    ['motor-history', 'drive-telemetry'].includes(widgetId) ? 2 : 1);
}

export async function assertTwinWheelAndPhotoGeometry(
  panel: Locator, widgetId: string, motion: 'reduce' | 'no-preference', driving: boolean, svgFallback: boolean, info: TestInfo,
) {
  const twin = panel.getByRole('img', { name: 'Vehicle digital twin showing current physical state', exact: true });
  await expect(twin.locator('[data-svg-wheel-rotor]')).toHaveCount(svgFallback ? 2 : 0);
  await expect(twin.locator('[data-wheel-rotor]')).toHaveCount(svgFallback ? 0 : 2);
  const rotorAttribute = svgFallback ? 'data-svg-wheel-rotor' : 'data-wheel-rotor';
  expect(await twin.locator(`[${rotorAttribute}]`).evaluateAll(
    (nodes, attribute) => nodes.map(node => node.getAttribute(attribute)).sort(), rotorAttribute,
  )).toEqual(['front', 'rear']);
  const photo = svgFallback ? null : await twin.evaluate((element, metrics) => {
    const image = element.querySelector<HTMLImageElement>(':scope > img');
    const svg = element.querySelector<SVGSVGElement>(':scope > svg');
    if (!image?.complete || image.naturalWidth === 0 || !svg) throw new Error('Missing loaded compositor photo/SVG');
    const imageBounds = image.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const scale = imageBounds.width / metrics.imgWidth;
    const wheels = [...element.querySelectorAll<HTMLElement>('[data-wheel-spinner]')].map(wheel => {
      const key = wheel.dataset.wheelSpinner as 'front' | 'rear';
      const box = wheel.getBoundingClientRect();
      return { key, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        centerX: box.left + box.width / 2, centerY: box.top + box.height / 2,
        expectedX: imageBounds.left + metrics.wheels[key].x * scale,
        expectedY: imageBounds.top + metrics.wheels[key].y * scale };
    });
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
      width: bounds.width, svgWidth: svg.getBoundingClientRect().width,
      photoLeft: imageBounds.left + metrics.carLeft * scale,
      photoRight: imageBounds.left + metrics.carRight * scale,
      photoGround: imageBounds.top + metrics.ground * scale, wheels };
  }, COMPOSITOR_METRICS);
  if (photo) {
  expect(Math.abs(photo.width - photo.svgWidth), 'SVG must use actual constrained twin width').toBeLessThanOrEqual(1);
  expect(photo.photoLeft, 'Front body clipped').toBeGreaterThanOrEqual(photo.left - 1);
  expect(photo.photoRight, 'Rear body clipped').toBeLessThanOrEqual(photo.right + 1);
  expect(photo.photoGround, 'Tires/ground clipped').toBeLessThanOrEqual(photo.bottom + 1);
  for (const wheel of photo.wheels) {
    expect(wheel.left, `${wheel.key} wheel clipped left`).toBeGreaterThanOrEqual(photo.left - 1);
    expect(wheel.right, `${wheel.key} wheel clipped right`).toBeLessThanOrEqual(photo.right + 1);
    expect(wheel.top, `${wheel.key} wheel clipped top`).toBeGreaterThanOrEqual(photo.top - 1);
    expect(wheel.bottom, `${wheel.key} wheel clipped bottom`).toBeLessThanOrEqual(photo.bottom + 1);
    expect(Math.abs(wheel.centerX - wheel.expectedX), `${wheel.key} crop horizontal calibration`).toBeLessThanOrEqual(1);
    expect(Math.abs(wheel.centerY - wheel.expectedY), `${wheel.key} crop vertical calibration`).toBeLessThanOrEqual(1);
  }
  }
  const wheels = await twin.evaluate(async element => {
    const nodes = [...element.querySelectorAll('[data-svg-wheel-rotor], [data-wheel-rotor]')];
    const frames: string[][] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      frames.push(nodes.map(node => getComputedStyle(node).transform));
    }
    return frames;
  });
  expect(wheels[0]).toHaveLength(2);
  for (let index = 0; index < 2; index++) {
    const distinct = new Set(wheels.map(frame => frame[index])).size;
    if (motion === 'reduce') expect(distinct, `Reduced wheel ${index} still rotates`).toBe(1);
    else if (driving) expect(distinct, `Normal driving wheel ${index} stopped`).toBeGreaterThan(1);
  }
  await writeFile(info.outputPath(`${widgetId}-photo-wheel-geometry.json`), JSON.stringify({ svgFallback, photo, wheels }, null, 2));
}
