import { expect, type Locator, type Page } from '@playwright/test';
import { waitForHarnessReady, type MockApiController } from './mockApi';
import { compositionGeometry } from './widget-design-packs.acceptance';
import { nativeSignalNames, type NativeLiveMode } from './widget-design-packs.native.fixtures';
import { inspectCompactSignalCoverage, inspectNativeGap, inspectNativeTrack } from './widget-design-packs.native';
import type { NativeReviewSources } from './widget-design-packs.native.mock';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';

/** Existing cross-tab invalidation protocol, not a private QueryClient handle
 * or fabricated query result. Needed for a tiny trend with no refresh button. */
async function invalidate(page: Page, keys: readonly (readonly (string | number)[])[]) {
  await page.evaluate(queryKeys => {
    const channel = new BroadcastChannel('teslasync');
    channel.postMessage({ _from: 'native-design-review', _ts: Date.now(),
      msg: { type: 'queryInvalidate', keys: queryKeys } });
    channel.close();
  }, keys);
}

async function invalidateRead(
  page: Page, sources: NativeReviewSources, mocks: MockApiController,
  key: readonly (string | number)[], path: string,
) {
  const before = sources.reads.filter(read => read.path === path).length;
  await invalidate(page, [key]);
  await expect.poll(() => sources.reads.filter(read => read.path === path).length,
    { message: `existing invalidation must cause the actual ${path} hook read` }).toBeGreaterThan(before);
  await waitForHarnessReady(page, mocks);
}

export async function inspectNativeRecordStates(
  page: Page, sources: NativeReviewSources, mocks: MockApiController, packId: PackId,
) {
  const states: Record<string, unknown> = {};
  const snapshot = async (name: string, focus: Locator) => {
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
    await expect(focus).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
    states[name] = { page: await compositionGeometry(page.locator('body')),
      surface: await compositionGeometry(focus) };
  };
  sources.setLive('stale');
  await page.goto('/signal-gaps');
  await waitForHarnessReady(page, mocks);
  const freshness = page.locator('[data-app-part~="panel"]').filter({
    has: page.getByRole('heading', { name: 'Freshness', exact: true }),
  });
  for (const mode of ['fresh', 'missing-timestamp', 'empty', 'stale'] as NativeLiveMode[]) {
    sources.setLive(mode);
    await page.getByRole('button', { name: 'Refresh signals', exact: true }).click();
    await waitForHarnessReady(page, mocks);
    await inspectNativeGap(page, mode);
    await snapshot(`gap-${mode}`, freshness);
  }
  sources.failLive();
  await page.getByRole('button', { name: 'Refresh signals', exact: true }).click();
  await expect(freshness.getByTestId('stale-refresh-warning')).toBeVisible();
  await expect(freshness.locator('ul[data-app-list="ranked"] > li')).toHaveCount(6);
  await snapshot('gap-retained-error', freshness);
  sources.setLive('stale');
  await freshness.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(freshness.getByTestId('stale-refresh-warning')).toHaveCount(0);
  await inspectNativeGap(page);

  const releaseLive = sources.holdLive();
  try {
    await page.reload();
    await expect(freshness.locator('[data-app-part="skeleton"]')).toBeVisible();
    await expect(freshness.locator('[data-app-metric="ring"]')).toHaveCount(0);
    await snapshot('gap-initial-loading', freshness);
  } finally { releaseLive(); }
  await waitForHarnessReady(page, mocks);
  await inspectNativeGap(page);
  sources.failLive();
  await page.reload();
  await expect(freshness.getByRole('alert')).toBeVisible();
  await expect(freshness.locator('[data-app-metric="ring"]')).toHaveCount(0);
  await snapshot('gap-initial-error', freshness);
  sources.setLive('stale');
  await freshness.getByRole('button', { name: 'Retry', exact: true }).click();
  await inspectNativeGap(page);
  await snapshot('gap-recovered', freshness);

  const signalPath = `/signals?catopen=true&catq=${nativeSignalNames.numeric}`;
  const catalog = page.locator('[data-app-part="field"][aria-label="Signal catalog"]');
  const trend = catalog.getByRole('img', {
    name: `${nativeSignalNames.numeric} trend, 4 samples in the last hour`, exact: true,
  });
  const historyKey = ['typed-signals', 'history', 7, nativeSignalNames.numeric, 1, '', '', 30] as const;
  const historyPath = `/signals/7/${nativeSignalNames.numeric}/history`;
  sources.setHistory(4);
  const releaseHistory = sources.holdHistory();
  try {
    await page.goto(signalPath);
    const skeleton = catalog.locator('[data-app-part="skeleton"]');
    await expect(skeleton).toHaveCount(1);
    const size = await skeleton.evaluate(element => ({
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
    }));
    expect(size.width).toBeCloseTo(80, 0);
    expect(size.height).toBeCloseTo(18, 0);
    await snapshot('trend-initial-loading', catalog);
  } finally { releaseHistory(); }
  await expect(trend).toBeVisible();
  sources.failHistory();
  await invalidateRead(page, sources, mocks, historyKey, historyPath);
  await expect(catalog.getByText('Trend may be out of date', { exact: true })).toBeVisible();
  await expect(trend).toBeVisible();
  await snapshot('trend-retained-error', catalog);
  sources.setHistory(4);
  await invalidateRead(page, sources, mocks, historyKey, historyPath);
  await expect(catalog.getByText('Trend may be out of date', { exact: true })).toHaveCount(0);

  for (const count of [0, 1]) {
    sources.setHistory(count);
    await invalidateRead(page, sources, mocks, historyKey, historyPath);
    await expect(catalog.locator('[title="No samples in last hour"]')).toBeVisible();
    await expect(trend).toHaveCount(0);
    await waitForHarnessReady(page, mocks);
    await snapshot(`trend-${count}-samples`, catalog);
  }
  sources.failHistory();
  await page.reload();
  await expect(catalog.getByRole('img', { name: 'Failed to load trend', exact: true })).toBeVisible();
  await snapshot('trend-initial-error', catalog);
  sources.setHistory(4);
  await invalidateRead(page, sources, mocks, historyKey, historyPath);
  await expect(trend).toBeVisible();
  await snapshot('trend-recovered', catalog);
  return states;
}

export async function inspectNativeProgressStates(
  page: Page, sources: NativeReviewSources, mocks: MockApiController, width: number, packId: PackId,
) {
  const states: Record<string, unknown> = {};
  const snapshot = async (name: string, focus: Locator) => {
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', packId);
    await expect(focus).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
    states[name] = { page: await compositionGeometry(page.locator('body')),
      surface: await compositionGeometry(focus) };
  };
  await page.goto('/vehicle-comparison?leftId=7&rightId=8');
  await waitForHarnessReady(page, mocks);
  const status = page.locator('section[aria-labelledby="fleet-compare-status-title"]');
  const tracks = status.locator('[data-metric-track][role="progressbar"]');
  const colors = new Set<string>();
  for (const value of [0, 20, 21, 50, 51, -5, 125, null]) {
    sources.setBattery(value);
    await invalidateRead(page, sources, mocks, ['vehicle-state', 8], '/vehicles/8/state');
    if (value == null) {
      await expect(tracks).toHaveCount(1);
    } else {
      await expect(tracks).toHaveCount(2);
      const clamped = Math.min(100, Math.max(0, value));
      await inspectNativeTrack(tracks.nth(1), clamped / 100, Math.round(clamped), 100, 8);
      await expect(status.getByText(`${value}%`, { exact: true })).toBeVisible();
      if ([20, 21, 51].includes(value)) colors.add(await tracks.nth(1)
        .locator(':scope > [data-metric-fill]').evaluate(element => getComputedStyle(element).backgroundColor));
    }
    await snapshot(`fleet-battery-${value == null ? 'unknown' : value}`, status);
  }
  expect(colors.size, 'native critical/warning/success fill semantics survive each design').toBe(3);
  sources.setBattery(25.5);
  await invalidateRead(page, sources, mocks, ['vehicle-state', 8], '/vehicles/8/state');
  sources.setMileage(10_000);
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  const mileage = page.locator('[data-widget-id="pack-review-mileage-stats"]');
  const health = page.locator('[data-widget-id="pack-review-signal-health"]');
  if (width === 390) {
    await expect(mileage.getByTestId('mileage-milestone')).toHaveCount(0);
  } else {
    // Exactly 10,000 advances to 20,000 with a genuine ZERO-width fill.
    await expect(mileage.getByTestId('mileage-milestone')).toContainText('20,000');
    await inspectNativeTrack(mileage.getByRole('progressbar', { name: 'Next milestone' }), 0, 0, 100, 8);
  }
  await snapshot('mileage-exact-milestone', mileage);
  sources.setMileage(12_345);
  for (const mode of ['empty', 'zero', 'fresh'] as const) {
    sources.setLive(mode);
    await invalidateRead(page, sources, mocks, ['signal-gaps', 7], '/signals/7/live');
    if (width === 390) {
      await inspectCompactSignalCoverage(health, packId, mode === 'empty' ? null : mode === 'zero' ? 0 : 100);
    } else {
      await inspectNativeTrack(health.getByRole('progressbar', { name: 'Reporting coverage' }),
        mode === 'empty' ? null : mode === 'zero' ? 0 : 1,
        mode === 'empty' ? null : mode === 'zero' ? 0 : 100, 100, 6);
    }
    await snapshot(`coverage-${mode}`, health);
  }
  sources.setLive('stale');
  return states;
}
