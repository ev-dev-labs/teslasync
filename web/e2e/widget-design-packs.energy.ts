import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertContained, assertOwnedTree, compositionGeometry } from './widget-design-packs.acceptance';
import { selectReviewPack } from './widget-design-packs.mock';
import {
  energyReviewFlow, energyReviewStats, unknownEnergyFlow, type EnergyReviewSources,
} from './widget-design-packs.energy.mock';

const sectionTitles = [
  'Energy summary metrics', 'Energy flow diagram', 'Live power', 'Daily energy usage',
  'Efficiency metrics', 'Daily distance', 'Daily efficiency', 'Daily energy history',
] as const;

/** Real source-owner semantic selectors; no alternative gallery/renderer. */
export async function inspectEnergyReview(
  page: Page, packId: PackId, testInfo: TestInfo, sources: EnergyReviewSources,
  includeSourceStates = false,
  distanceUnit: 'km' | 'mi' = 'km',
) {
  const main = page.locator('main');
  // A real modal may make the background inert. Only shell-retention queries
  // include that inaccessible background; interaction queries remain normal.
  const card = (title: typeof sectionTitles[number]) => main.locator('[data-card]').filter({
    has: page.getByRole('heading', { level: 3, name: title, exact: true, includeHidden: true }),
  });
  const diagram = card('Energy flow diagram');
  const power = card('Live power');
  const summary = card('Energy summary metrics');
  const history = card('Daily energy history');
  const charging = diagram.getByRole('group', { name: 'Charging', exact: true });
  const chip = charging.locator('[data-app-part~="badge"]');
  const meter = diagram.getByRole('meter', { name: 'Battery', exact: true });
  const evidence: Record<string, unknown> = {};
  const savedStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

  async function shells(background = false) {
    await expect(main.getByRole('heading', {
      level: 1, name: 'Energy flow', exact: true, includeHidden: background,
    })).toBeVisible();
    for (const title of sectionTitles) {
      await expect(card(title), `preserved ${title} shell`).toHaveCount(1);
      await expect(card(title).locator(':scope > [data-card-header]').getByRole('heading', {
        level: 3, name: title, exact: true, includeHidden: background,
      })).toBeVisible();
    }
    await assertContained(main, `${packId} real energy page`);
  }
  async function snapshot(state: string, surface: Locator) {
    await shells(await surface.getAttribute('aria-modal') === 'true');
    await assertOwnedTree(surface, packId);
    evidence[state] = {
      page: await compositionGeometry(page.locator('body')),
      surface: await compositionGeometry(surface),
    };
    await surface.screenshot({
      path: testInfo.outputPath(`${packId}-energy-${state}.png`), animations: 'disabled',
    });
  }
  async function refresh() {
    const start = sources.reads.length;
    const button = main.locator('[data-app-part~="page-header"]')
      .getByRole('button', { name: /^Refresh data ·/ });
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => new Set(sources.reads.slice(start).map(read => read.endpoint)).size).toBe(2);
    await expect(button).toBeEnabled();
  }
  async function facts(values: string[]) {
    await expect(power.getByRole('term')).toHaveText(['DC power', 'AC power', 'HVAC', 'Accessories']);
    await expect(power.getByRole('definition')).toHaveText(values);
  }
  async function plots(capture = false) {
    const geometry: Record<string, unknown> = {};
    for (const title of ['Daily energy usage', 'Daily distance', 'Daily efficiency'] as const) {
      const chart = card(title);
      await chart.scrollIntoViewIfNeeded();
      const paths = chart.locator('.recharts-area-curve, .recharts-bar-rectangle path');
      await expect.poll(() => paths.evaluateAll(nodes => nodes.filter(node => {
        const path = node as SVGPathElement;
        const box = path.getBBox();
        return box.width > 5 && box.height > 5 && path.getTotalLength() > 10;
      }).length)).toBeGreaterThan(0);
      await expect(chart.getByRole('table', { name: `${title} — data table`, exact: true })
        .getByRole('row')).toHaveCount(3);
      if (capture) geometry[title] = await paths.evaluateAll(nodes => nodes.map(node => {
        const path = node as SVGPathElement;
        const box = path.getBBox();
        return { width: box.width, height: box.height, length: path.getTotalLength() };
      }));
    }
    if (capture) evidence.plots = geometry;
  }
  async function success() {
    await facts(['11.00 kW', '0.00 kW', 'N/A', 'N/A']);
    await expect(meter).toHaveAttribute('aria-valuenow', '82');
    await expect(meter).toHaveAttribute('aria-valuemin', '0');
    await expect(meter).toHaveAttribute('aria-valuemax', '100');
    await expect.poll(() => meter.locator('[data-chart-gauge-fill]').evaluate(node => {
      const track = node.parentElement;
      if (!track) return false;
      const css = getComputedStyle(track);
      const width = track.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      return width > 1 && Math.abs(node.getBoundingClientRect().width / width - 0.82) < 0.01;
    }), { message: 'painted battery gauge retains the supplied 82/100 reading' }).toBe(true);
    const battery = diagram.getByRole('group', { name: 'Battery', exact: true });
    await expect(battery.getByText('62.50', { exact: true })).toBeVisible();
    await expect(battery).not.toContainText(/\b(?:kWh|Wh)\b/);
    await expect(chip).toHaveAttribute('data-app-variant', 'info');
  }
  async function neighbor(endpoint: 'history' | 'flow') {
    if (endpoint === 'flow') {
      await expect(main.getByRole('table', { name: 'Daily energy usage — data table', exact: true })
        .getByRole('row')).toHaveCount(3);
    } else await success();
  }

  await shells();
  await success();
  await plots(true);
  await assertOwnedTree(power, packId);
  await assertOwnedTree(charging, packId);
  await expect(summary.locator('[data-app-part~="metric-label"]')).toHaveText([
    'Total energy', 'Total charged', 'Distance', 'Efficiency', 'CO₂ saved', 'Period',
  ]);
  const flowGrid = diagram.locator('[data-flow-grid]');
  const allocatedWidth = await flowGrid.evaluate(node => node.getBoundingClientRect().width);
  await expect(flowGrid).toHaveAttribute('data-flow-axis', allocatedWidth >= 1048 ? 'row' : 'column');
  const flow = diagram.locator('[data-flow-grid] > *');
  await expect.poll(() => flow.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))))
    .toEqual(['Grid', 'Charging', 'Battery', 'Driving', 'Motor']);
  const flowGeometry = await flow.evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  for (let index = 1; index < flowGeometry.length; index += 1) {
    const before = flowGeometry[index - 1];
    const after = flowGeometry[index];
    expect(after.x >= before.x - 1 && after.y >= before.y - 1,
      'physical energy source order is never reversed by a design').toBe(true);
  }
  evidence.flowOrder = flowGeometry;
  evidence.connectorsAndFacts = {
    connector: await compositionGeometry(charging), facts: await compositionGeometry(power),
  };
  evidence.batteryGauge = await meter.locator('[data-chart-gauge-track], [data-chart-gauge-fill]')
    .evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
  await expect(diagram.getByRole('group', { name: 'Driving', exact: true })).toContainText('N/A');
  await expect(diagram.getByRole('group', { name: 'Motor', exact: true })).toContainText('No live data');

  // Real DataTable sort and mobile quick view, then a real open source drawer
  // surviving complete-profile changes. Neither save nor vehicle action runs.
  const sort = history.getByRole('button', { name: 'Energy', exact: true });
  const mobile = (page.viewportSize()?.width ?? 0) < 600;
  const firstValue = () => mobile
    ? history.locator('[data-card][data-row-key]').first().locator('[data-card-primary]')
    : history.getByRole('table', { name: 'Daily energy history', exact: true }).getByRole('row').nth(1);
  await history.getByRole('button', { name: 'Date', exact: true }).click();
  await sort.click();
  await expect(firstValue()).toContainText('20.00');
  await sort.click();
  await expect(firstValue()).toContainText('10.00');
  if (mobile) {
    await history.locator('[data-card][data-row-key]').first().click();
    const rowDetail = page.getByRole('dialog', { name: 'Daily energy history', exact: true });
    await expect(rowDetail).toContainText(distanceUnit === 'mi' ? '18.64 mi' : '30.00 km');
    await snapshot('row-detail', rowDetail);
    await page.keyboard.press('Escape');
    await expect(rowDetail).toBeHidden();
  }
  const review = summary.getByRole('button', { name: 'Review details', exact: true });
  await review.click();
  const drawer = page.getByRole('dialog', { name: 'Energy summary metrics details', exact: true });
  await expect(drawer).toContainText('Shared source total');
  await expect(drawer).toContainText('Estimated');
  const otherPack = packId === 'quiet' ? 'blueprint' : 'quiet';
  await selectReviewPack(page, otherPack);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${otherPack}(?:\\s|$)`));
  await selectReviewPack(page, packId);
  await snapshot('review-retained-sort', drawer);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(review).toBeFocused();
  await expect(firstValue()).toContainText('10.00');
  await history.getByRole('button', { name: 'Date', exact: true }).click();
  evidence.history = await compositionGeometry(history);
  if (!includeSourceStates) return evidence;

  for (const watts of [-11, -10, 0, 10, 11]) {
    sources.setFlow({ ...energyReviewFlow, dc_charging_power_w: watts });
    await refresh();
    await expect(chip).toHaveAttribute('data-app-variant', Math.abs(watts) > 10 ? 'info' : 'neutral');
    if (watts === 0) await facts(['0.00 kW', '0.00 kW', 'N/A', 'N/A']);
  }
  sources.setFlow(unknownEnergyFlow);
  await refresh();
  await facts(['—', '—', 'N/A', 'N/A']);
  await expect(chip).toContainText('—');
  await expect(meter).toHaveCount(0);
  await neighbor('flow');
  await snapshot('unknown-live', power);
  sources.setFlow({ ...unknownEnergyFlow, ac_charging_power_w: 0 });
  await refresh();
  await facts(['—', '0.00 kW', 'N/A', 'N/A']);
  await expect(chip).toContainText('—');
  await expect(meter).toHaveCount(0);
  await neighbor('flow');
  await snapshot('partial-live', power);
  sources.reset('flow');

  sources.setHistory({ ...energyReviewStats, daily_breakdown: [] });
  await refresh();
  for (const [title, message] of [
    ['Daily energy usage', 'No daily energy data available.'],
    ['Daily distance', 'No daily distance data available.'],
    ['Daily efficiency', 'No efficiency data available.'],
    ['Daily energy history', 'No energy history records available.'],
  ] as const) await expect(card(title)).toContainText(message);
  await expect(summary).toContainText('30.00');
  await success();
  await snapshot('empty-history', history);
  sources.setHistory({ ...energyReviewStats, daily_breakdown: energyReviewStats.daily_breakdown
    .map(row => ({ ...row, efficiency_wh_per_m: 0 })) });
  await refresh();
  await expect(card('Daily efficiency')).toContainText('No efficiency data available.');
  await expect(main.getByRole('table', { name: 'Daily distance — data table', exact: true })
    .getByRole('row')).toHaveCount(3);
  await snapshot('missing-positive-efficiency', card('Daily efficiency'));
  sources.reset('history');
  await refresh();

  for (const endpoint of ['flow', 'history'] as const) {
    const surface = endpoint === 'flow' ? power : summary;
    sources.fail(endpoint);
    await refresh();
    await expect(surface.getByTestId('stale-refresh-warning')).toBeVisible();
    await neighbor(endpoint);
    if (endpoint === 'flow') await facts(['11.00 kW', '0.00 kW', 'N/A', 'N/A']);
    else await expect(summary).toContainText('30.00');
    await snapshot(`${endpoint}-retained`, surface);
    sources.reset(endpoint);
    const readsBefore = sources.reads.filter(read => read.endpoint === endpoint).length;
    await surface.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => sources.reads.filter(read => read.endpoint === endpoint).length).toBeGreaterThan(readsBefore);
    await expect(surface.getByTestId('stale-refresh-warning')).toHaveCount(0);
    await success();
    await plots();
  }

  // Reloads are necessary only for genuinely initial query states; all other
  // cases above switch responses and use the real refresh controls in place.
  for (const endpoint of ['flow', 'history'] as const) {
    const surface = endpoint === 'flow' ? power : card('Daily energy usage');
    const release = sources.hold(endpoint);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(surface.locator('[data-app-part~="skeleton"]').first()).toBeVisible();
      await neighbor(endpoint);
      await snapshot(`${endpoint}-initial-loading`, surface);
    } finally { release(); }
    await success();
    await plots();
    sources.fail(endpoint);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const retry = surface.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await neighbor(endpoint);
    await snapshot(`${endpoint}-initial-error`, surface);
    sources.reset(endpoint);
    await retry.click();
    await expect(retry).toHaveCount(0);
    await success();
    await plots();
    await snapshot(`${endpoint}-recovered`, surface);
  }
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))),
    'local source-state review preserves all user preferences').toEqual(savedStorage);
  return evidence;
}
