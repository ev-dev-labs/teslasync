import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PACK_APPEARANCES, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertContained, assertOwnedTree, compositionGeometry } from './widget-design-packs.acceptance';
import { nativeAchievements, nativeSignalNames, type NativeLiveMode } from './widget-design-packs.native.fixtures';
import type { NativeReviewSources } from './widget-design-packs.native.mock';

/** Original native track owns BOTH its role and track marker. In particular,
 * measured zero keeps its actual zero-width child; unknown keeps no child. */
export async function inspectNativeTrack(
  track: Locator, fraction: number | null, now: number | null, max = 100, height?: number,
) {
  await expect(track).toHaveCount(1);
  await expect(track).toHaveAttribute('data-app-part', 'metric');
  await expect(track).toHaveAttribute('data-app-metric', 'bar');
  await expect(track).toHaveAttribute('role', 'progressbar');
  await expect(track).toHaveAttribute('aria-valuemax', String(max));
  if (now == null) await expect(track).not.toHaveAttribute('aria-valuenow', /.*/);
  else await expect(track).toHaveAttribute('aria-valuenow', String(now));
  await expect(track.locator(':scope > [data-metric-fill]')).toHaveCount(fraction == null ? 0 : 1);
  const measured = await track.evaluate(element => {
    const box = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const fill = element.querySelector<HTMLElement>(':scope > [data-metric-fill]');
    const fillBox = fill?.getBoundingClientRect();
    const contentWidth = box.width - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
      - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    return {
      width: box.width, height: box.height, contentWidth,
      fillWidth: fillBox?.width ?? null, fillHeight: fillBox?.height ?? null,
      fraction: fillBox && contentWidth > 0 ? fillBox.width / contentWidth : null,
      fillInside: !fillBox || fillBox.left >= box.left - 1 && fillBox.right <= box.right + 1
        && fillBox.top >= box.top - 1 && fillBox.bottom <= box.bottom + 1,
      trackDisplay: css.display,
    };
  });
  expect(measured.width).toBeGreaterThan(30);
  expect(measured.fillInside).toBe(true);
  if (height != null) expect(measured.height, 'preserved original native track height').toBeCloseTo(height, 0);
  if (fraction != null) {
    expect(measured.fraction).not.toBeNull();
    expect(measured.fraction ?? NaN).toBeCloseTo(fraction, 2);
    expect(measured.fillHeight ?? 0).toBeGreaterThan(0);
  }
  return measured;
}

export async function inspectCompactSignalCoverage(host: Locator, packId: PackId, percentage: number | null) {
  await expect(host.getByText('Signals reporting', { exact: true })).toBeVisible();
  await expect(host.getByText(percentage == null ? '—' : `${percentage}%`, { exact: true }).first()).toBeVisible();
  const visuals = host.locator('[data-app-metric="bar"], [data-app-metric="segments"], svg[data-chart-family="radial-gauge"]');
  if (packId === 'classic') {
    await expect(visuals).toHaveCount(0);
    return { kind: 'compact-text', percentage };
  }
  await expect(host.locator(`[data-instrument-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeVisible();
  const measured = await visuals.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    const kind = element.getAttribute('data-app-metric') ?? 'gauge';
    const common = { kind, width: box.width, height: box.height,
      role: element.getAttribute('role'), label: element.getAttribute('aria-label'),
      now: element.getAttribute('aria-valuenow'), min: element.getAttribute('aria-valuemin'),
      max: element.getAttribute('aria-valuemax') };
    if (kind === 'gauge') {
      const marker = element.querySelector('[data-chart-gauge-marker]');
      const fill = element.querySelector('[data-chart-gauge-fill]');
      const angle = marker ? Math.atan2(
        Number(marker.getAttribute('y2')) - Number(marker.getAttribute('y1')),
        Number(marker.getAttribute('x2')) - Number(marker.getAttribute('x1')),
      ) * 180 / Math.PI : null;
      const fraction = angle != null ? ((angle + 225 + 360) % 360) / 270
        : fill ? parseFloat(fill.getAttribute('stroke-dasharray') ?? '') / Number(fill.getAttribute('pathLength')) : null;
      const glyph = (marker ?? fill)?.getBoundingClientRect();
      return { ...common, pieces: element.querySelectorAll('[data-chart-gauge-track]').length,
        fillCount: marker || fill ? 1 : 0, fraction, visible: box.width > 0 && box.height > 0,
        inside: !glyph || glyph.left >= box.left - 1 && glyph.right <= box.right + 1
          && glyph.top >= box.top - 1 && glyph.bottom <= box.bottom + 1 };
    }
    const track = element.querySelector('[data-metric-track]');
    const pieces = track ? [track] : [...element.children];
    const fractions = pieces.map(piece => {
      const rect = piece.getBoundingClientRect();
      const css = getComputedStyle(piece);
      const width = rect.width - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
        - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const fill = piece.firstElementChild?.getBoundingClientRect();
      return { fraction: fill && width > 0 ? fill.width / width : 0, filled: fill != null,
        visible: width > 0 && rect.height > 0 && (!fill || fill.height > 0),
        inside: !fill || fill.left >= rect.left - 1 && fill.right <= rect.right + 1 };
    });
    return { ...common, pieces: pieces.length, fillCount: fractions.filter(item => item.filled).length,
      fraction: fractions.reduce((sum, item) => sum + item.fraction, 0) / pieces.length,
      visible: fractions.every(item => item.visible), inside: fractions.every(item => item.inside) };
  }));
  expect(measured.length, 'nonclassic compact coverage retains a quantitative instrument').toBeGreaterThan(0);
  expect(measured.length).toBeLessThanOrEqual(2);
  expect(new Set(measured.map(item => item.kind)).size).toBe(measured.length);
  for (const visual of measured) {
    expect(visual.width).toBeGreaterThan(15);
    expect(visual.height).toBeGreaterThan(0);
    expect(visual.visible).toBe(true);
    expect(visual.inside).toBe(true);
    expect(visual.pieces).toBe(visual.kind === 'segments' ? 20 : 1);
    if (visual.kind !== 'gauge') {
      expect(visual.role).toBe(visual.kind === 'bar' ? 'progressbar' : percentage == null ? 'group' : 'meter');
      expect(visual.label).toMatch(/^Reporting coverage(?::|$)/);
      expect(visual.now).toBe(percentage == null ? null : String(percentage));
      if (percentage != null || visual.kind === 'bar') {
        expect(visual.min).toBe('0');
        expect(visual.max).toBe('100');
      } else {
        expect(visual.min).toBeNull();
        expect(visual.max).toBeNull();
      }
    }
    if (percentage == null) expect(visual.fillCount).toBe(0);
    else {
      expect(visual.fillCount).toBe(visual.kind === 'segments' ? 20 : 1);
      expect(visual.fraction).toBeCloseTo(percentage / 100, 2);
    }
  }
  return measured;
}

async function inspectRing(host: Locator, expectedFraction?: number) {
  await expect(host.locator('svg circle')).toHaveCount(2);
  const shape = await host.locator('svg').evaluate(svg => {
    const circles = [...svg.querySelectorAll('circle')];
    const fill = circles[1];
    const box = svg.getBoundingClientRect();
    const circumference = Number(fill.getAttribute('stroke-dasharray'));
    const offset = Number(fill.getAttribute('stroke-dashoffset'));
    return { width: box.width, height: box.height,
      radius: Number(fill.getAttribute('r')), fraction: 1 - offset / circumference };
  });
  expect(shape.width).toBeGreaterThan(15);
  expect(shape.height).toBeGreaterThan(15);
  expect(shape.radius).toBeGreaterThan(0);
  expect(Number.isFinite(shape.fraction)).toBe(true);
  if (expectedFraction != null) expect(shape.fraction).toBeCloseTo(expectedFraction, 4);
  return shape;
}

const widget = (page: Page, id: string) => page.locator(`[data-widget-id="pack-review-${id}"]`);
const menuTrigger = (page: Page) => page.getByRole('button', { name: 'Switch dashboard layout', exact: true });

async function inspectLayoutMenu(page: Page, packId: PackId, info: TestInfo) {
  const trigger = menuTrigger(page);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.getByRole('menu', { name: 'Saved layouts' });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
  await expect(menu.getByRole('menuitemradio', { name: /Implementation review/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: 'Synthetic selected-vehicle pin' })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Synthetic other-vehicle pin' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete layout', exact: true })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Reset to default', exact: true }).scrollIntoViewIfNeeded();
  await expect(menu.getByRole('menuitem', { name: 'Reset to default', exact: true })).toBeInViewport();
  await assertContained(menu, 'real inline layout popup stays inside viewport');
  await assertOwnedTree(menu, packId);
  const geometry = await compositionGeometry(menu);
  await menu.screenshot({ path: info.outputPath(`${packId}-native-layout-open.png`), animations: 'disabled' });
  await trigger.press('Escape');
  await expect(menu).toBeHidden();
  await trigger.press('Enter');
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await trigger.click();
  await menu.getByRole('menuitemradio', { name: 'Synthetic alternate layout' }).click();
  await trigger.click();
  await expect(menu.getByRole('menuitemradio', { name: 'Synthetic alternate layout' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitem', { name: 'Delete layout', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await assertOwnedTree(confirm, packId);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeHidden();
  await trigger.click();
  await menu.getByRole('menuitemradio', { name: /Implementation review/ }).click();
  await trigger.click();
  await page.getByRole('heading', { name: 'Fleet operations', exact: true }).click();
  await expect(menu).toBeHidden();
  return geometry;
}

export async function inspectNativeDashboard(page: Page, packId: PackId, info: TestInfo, width: number) {
  const geometry: Record<string, unknown> = {};
  const mileage = widget(page, 'mileage-stats');
  const health = widget(page, 'signal-health');
  const checklist = widget(page, 'onboarding-checklist');
  await expect(mileage.getByText('Mileage stats', { exact: true })).toBeVisible();
  await expect(health.getByText('Signal source coverage', { exact: true })).toBeVisible();
  const rows = checklist.locator('[data-testid^="checklist-task-"]');
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  const completed = await checklist.locator('[data-testid^="checklist-task-"][data-complete="true"]').count();
  expect(total).toBeGreaterThanOrEqual(6);
  if (packId === 'classic') {
    geometry.checklist = await inspectNativeTrack(checklist.locator('[data-metric-track][role="progressbar"]'),
      Math.round(completed / total * 100) / 100, completed, total, 8);
  } else {
    await expect(checklist.locator(`[data-instrument-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeVisible();
    const meter = checklist.locator('[data-app-metric="bar"][role="progressbar"], [data-app-metric="segments"][role="meter"]');
    await expect(meter).toHaveCount(1);
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute('aria-valuemin', '0');
    await expect(meter).toHaveAttribute('aria-valuemax', String(total));
    await expect(meter).toHaveAttribute('aria-valuenow', String(completed));
    const measured = await meter.evaluate(element => {
      const track = element.querySelector('[data-metric-track]');
      const pieces = track ? [track] : [...element.children];
      const fractions = pieces.map(piece => {
        const box = piece.getBoundingClientRect();
        const css = getComputedStyle(piece);
        const width = box.width - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
          - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
        const fill = piece.firstElementChild?.getBoundingClientRect();
        return { fraction: fill && width > 0 ? fill.width / width : NaN,
          visible: box.height > 0 && width > 0 && fill != null && fill.height > 0,
          inside: fill != null && fill.left >= box.left - 1 && fill.right <= box.right + 1 };
      });
      return { kind: element.getAttribute('data-app-metric'), pieces: pieces.length,
        fraction: fractions.reduce((sum, item) => sum + item.fraction, 0) / pieces.length,
        visible: fractions.every(item => item.visible), inside: fractions.every(item => item.inside) };
    });
    expect(measured.pieces).toBe(measured.kind === 'bar' ? 1 : 20);
    expect(measured.visible).toBe(true);
    expect(measured.inside).toBe(true);
    expect(measured.fraction).toBeCloseTo(completed / total, 2);
    geometry.checklist = measured;
    await expect(checklist.getByText(`${completed} of ${total} done`, { exact: true }).first()).toBeVisible();
  }
  if (width === 390) {
    await expect(mileage.getByTestId('mileage-milestone')).toHaveCount(0);
    geometry.health = await inspectCompactSignalCoverage(health, packId, 14);
  } else {
    geometry.mileage = await inspectNativeTrack(mileage.getByRole('progressbar', { name: 'Next milestone' }),
      0.2345, 23, 100, 8);
    // One active + SIX stale observations; catalogue length three is NOT the denominator.
    geometry.health = await inspectNativeTrack(health.getByRole('progressbar', { name: 'Reporting coverage' }),
      0.14, 14, 100, 6);
  }
  geometry.layout = await inspectLayoutMenu(page, packId, info);
  await checklist.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(checklist.getByTestId('onboarding-checklist')).toHaveCount(0);
  await checklist.getByRole('button', { name: 'Restart checklist', exact: true }).click();
  await expect(checklist.getByTestId('onboarding-checklist')).toBeVisible();
  return geometry;
}

export async function inspectNativeGap(page: Page, mode: NativeLiveMode = 'stale') {
  const panel = page.locator('[data-app-part~="panel"]').filter({
    has: page.getByRole('heading', { name: 'Freshness', exact: true }),
  });
  await expect(panel).toHaveCount(1);
  if (mode === 'stale') {
    const rows = panel.locator('ul[data-app-list="ranked"] > li');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('SyntheticLongStaleSignalForRankedRecordAcceptance6');
    await expect(rows.last()).toContainText('SyntheticLongStaleSignalForRankedRecordAcceptance1');
    await expect(rows.first().locator('[data-app-part="metric-value"]')).toContainText('6h');
    await inspectRing(panel.locator('[data-app-metric="ring"]'), 0.14);
  } else if (mode === 'fresh') {
    await expect(panel.getByText('All signals are arriving on time.', { exact: true })).toBeVisible();
    await expect(panel.locator('ul[data-app-list="ranked"]')).toHaveCount(0);
    await inspectRing(panel.locator('[data-app-metric="ring"]'), 1);
  } else if (mode === 'empty') {
    await expect(panel.getByText('No signal data available', { exact: true })).toBeVisible();
    await expect(panel.locator('[data-app-metric="ring"]')).toHaveCount(0);
  } else if (mode === 'missing-timestamp') {
    await expect(panel.getByText('1 signals have never reported.', { exact: true })).toBeVisible();
    await expect(panel.getByText('All signals are arriving on time.', { exact: true })).toHaveCount(0);
    await inspectRing(panel.locator('[data-app-metric="ring"]'), 0.5);
  }
  await assertContained(panel, 'freshness records and callouts do not overflow');
  return compositionGeometry(panel);
}

export async function inspectNativeSignals(page: Page, sources: NativeReviewSources) {
  const prior = sources.reads.filter(read => read.path.endsWith('/history')).length;
  await page.getByRole('button', { name: /Add signals/ }).click();
  const catalog = page.locator('[data-app-part="field"][aria-label="Signal catalog"]');
  await expect(catalog).toBeVisible();
  // Merely opening the catalogue must not fetch collapsed-category trends.
  expect(sources.reads.filter(read => read.path.endsWith('/history')).length).toBe(prior);
  const search = catalog.getByRole('textbox', { name: 'Filter tree' });
  await search.fill(nativeSignalNames.numeric);
  const numeric = catalog.getByRole('img', { name: `${nativeSignalNames.numeric} trend, 4 samples in the last hour` });
  await expect(numeric).toBeVisible();
  const plot = await numeric.locator('svg polyline[fill="none"]').evaluateAll(nodes => nodes.map(node => {
    const path = node as SVGPolylineElement;
    const box = path.getBBox();
    return { width: box.width, height: box.height, length: path.getTotalLength() };
  }));
  expect(plot.some(path => path.width > 20 && path.height > 1 && path.length > 20)).toBe(true);
  await search.fill(nativeSignalNames.boolean);
  await expect(catalog.getByRole('img', { name: `${nativeSignalNames.boolean} trend, 4 samples in the last hour` })).toBeVisible();
  await search.fill(nativeSignalNames.text);
  await expect(catalog.getByText('string', { exact: true })).toBeVisible();
  expect(sources.reads.filter(read => read.path.includes(`/${nativeSignalNames.text}/history`))).toEqual([]);
  await search.fill(nativeSignalNames.numeric);
  return compositionGeometry(catalog);
}

export async function inspectNativeReadiness(page: Page) {
  const panel = page.locator('[data-card]').filter({
    has: page.getByRole('heading', { name: 'Per-vehicle readiness', exact: true }),
  });
  await expect(panel).toHaveCount(1);
  const ready = panel.locator('[data-app-part~="card"][data-surface-variant="embedded"]').filter({
    has: page.getByRole('img', { name: 'Synthetic ready vehicle projected state of charge' }),
  });
  const shortfall = panel.locator('[data-app-part~="card"][data-surface-variant="embedded"]').filter({
    has: page.getByRole('img', { name: 'Synthetic deadline vehicle projected state of charge' }),
  });
  await expect(ready).toHaveCount(1);
  await expect(shortfall).toHaveCount(1);
  await expect(ready.getByText('Ready', { exact: true })).toBeVisible();
  await expect(ready.getByText('Opportunistic (no deadline)', { exact: true })).toBeVisible();
  await expect(ready.getByText(/Delivered 0.* of 0.* needed/)).toBeVisible();
  await expect(shortfall.getByText('Not ready', { exact: true })).toBeVisible();
  await expect(shortfall.getByText('Departure slot #0', { exact: true })).toBeVisible();
  await expect(shortfall.getByText(/^Unmet:/)).toBeVisible();
  await inspectRing(ready.locator('[data-app-metric="ring"]'), 0.9);
  await inspectRing(shortfall.locator('[data-app-metric="ring"]'), 0.255);
  await assertContained(panel, 'actual optimized readiness cards retain both source-derived outcomes');
  return compositionGeometry(panel);
}

export async function inspectNativeMilestones(page: Page, packId: PackId, info: TestInfo) {
  const panel = page.getByTestId('milestone-progress');
  await expect(panel.getByRole('heading', { name: 'Progress to the next round number' })).toBeVisible();
  const definitions = panel.locator('dl[data-app-list="definitions"]');
  await expect(definitions.locator(':scope > div')).toHaveCount(4);
  await expect(definitions.locator('dt')).toHaveText([
    'Previous milestone', 'Current odometer', 'Next milestone', 'Remaining',
  ]);
  await expect(definitions.locator('dd').nth(1)).toContainText('9,125');
  await expect(panel.getByText(/Forecast evidence uses 5 drives/)).toBeVisible();
  const ring = panel.locator('[data-app-metric="ring"]');
  await inspectRing(ring);
  const reading = ring.getByText('91.25%', { exact: true });
  await expect(reading).toBeVisible();
  const fitted = await reading.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = [...range.getClientRects()];
    const bounds = element.closest('[role="img"]')!.getBoundingClientRect();
    return { lines: lines.length, inside: lines.every(line =>
      line.left >= bounds.left - 1 && line.right <= bounds.right + 1
      && line.top >= bounds.top - 1 && line.bottom <= bounds.bottom + 1) };
  });
  expect(fitted.lines).toBe(1);
  expect(fitted.inside).toBe(true);
  const help = panel.getByRole('button', { name: 'More info about milestone math' });
  await help.focus();
  const description = await help.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  const tooltip = page.locator(`[role="tooltip"][id="${description}"]`);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCSS('opacity', '0');
  await ring.screenshot({
    path: info.outputPath(`${packId}-native-milestone-ring.png`), animations: 'disabled',
  });
  return compositionGeometry(panel);
}

export async function inspectNativeAchievements(page: Page) {
  const results: unknown[] = [];
  for (const achievement of nativeAchievements) {
    const iconLabel = achievement.id === 'first-drive' ? 'First Drive'
      : achievement.name || achievement.description;
    const badge = page.locator('[data-app-part="card"][data-surface-variant="standalone"]').filter({
      has: page.getByRole('img', { name: iconLabel, exact: true }),
    });
    await expect(badge).toHaveCount(1);
    if (achievement.unlocked) {
      await expect(badge.getByText('✓ Unlocked', { exact: true })).toBeVisible();
      await expect(badge.locator('[data-app-metric="ring"]')).toHaveCount(0);
    } else {
      const percent = Math.max(0, Math.min(100, Math.round((achievement.progress ?? 0) * 100)));
      await expect(badge.getByText(`${percent}%`, { exact: true })).toBeVisible();
      results.push(await inspectRing(badge.locator('[data-app-metric="ring"]'), percent / 100));
    }
    if (!achievement.name) await expect(badge.getByText('—', { exact: true })).toBeVisible();
    await assertContained(badge, 'native achievement badge wraps safely');
  }
  return results;
}

export async function inspectNativeFleet(page: Page) {
  const section = (id: string) => page.locator(`section[aria-labelledby="fleet-compare-${id}-title"]`);
  for (const id of ['select', 'highlights-section', 'status', 'trends', 'lifetime']) {
    await expect(section(id)).toBeVisible();
  }
  const status = section('status');
  const tracks = status.locator('[data-metric-track][role="progressbar"]');
  await expect(tracks).toHaveCount(2);
  await inspectNativeTrack(tracks.nth(0), 0.9, 90);
  await inspectNativeTrack(tracks.nth(1), 0.255, 26);
  const paths = section('trends').locator('.recharts-line-curve');
  await expect(paths).toHaveCount(2);
  const shapes = await paths.evaluateAll(nodes => nodes.map(node => {
    const path = node as SVGPathElement;
    return { width: path.getBBox().width, height: path.getBBox().height, length: path.getTotalLength() };
  }));
  expect(shapes.every(path => path.width > 30 && path.height > 1 && path.length > 30)).toBe(true);
  const bars = section('trends').locator('.recharts-bar-rectangle path');
  await expect(bars).toHaveCount(6);
  const barSizes = await bars.evaluateAll(nodes => nodes.map(node => {
    const box = (node as SVGPathElement).getBBox();
    return { width: box.width, height: box.height };
  }));
  expect(barSizes.every(box => box.width > 1 && box.height > 1)).toBe(true);
  for (let month = 0; month < 3; month += 1) {
    expect(barSizes[month].height / barSizes[month + 3].height,
      'actual drive-count bars retain the source-owned 4:3 vehicle ratio').toBeCloseTo(4 / 3, 2);
  }
  await page.getByRole('button', { name: 'Swap vehicles', exact: true }).click();
  await inspectNativeTrack(tracks.nth(0), 0.255, 26);
  await inspectNativeTrack(tracks.nth(1), 0.9, 90);
  await page.getByRole('button', { name: 'Swap vehicles', exact: true }).click();
  return compositionGeometry(status);
}

export async function inspectNativeMaintenance(page: Page) {
  const rows = page.locator('[data-maintenance-item]');
  await expect(rows).toHaveCount(6);
  for (const [id, fraction] of [[803, 0], [804, 0.5], [805, 1]] as const) {
    await inspectNativeTrack(page.locator(`[data-maintenance-item="${id}"]`).getByRole('progressbar'),
      fraction, fraction * 100);
  }
  for (const id of [801, 806]) {
    await expect(page.locator(`[data-maintenance-item="${id}"]`).getByRole('progressbar')).toHaveCount(0);
  }
  const metadata = page.locator('[data-maintenance-item="804"]');
  await metadata.getByRole('button', { name: 'Service interval and metadata' }).click();
  await expect(metadata.locator('dt')).toHaveCount(11);
  await expect(metadata.locator('dd').filter({ hasText: '1,000' }).first()).toBeVisible();
  await assertContained(metadata, 'native maintenance SI metadata and original track stay contained');
  return compositionGeometry(metadata);
}
