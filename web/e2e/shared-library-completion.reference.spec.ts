import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { completionCopy as c } from '../src/features/developer-reference/components/shared-library-completion/completionCopy';
import { completeChartRows, fixtureClipboardPayload, loadedFixtureIds } from '../src/features/developer-reference/components/shared-library-completion/fixtureData';
import { objectsToCSV } from '../src/lib/csvExport';
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { closeMockSseServer } from './mockSseServer';
import { attachDiagnostics, expectNoRuntimeFailures, monitorPage } from './qualityAssertions';

const contracts = [
  'weekday-select', 'composition-rail', 'code-block', 'copy-button', 'kv-list',
  'pill-filter-bar', 'widget-gauge-hero', 'widget-ranked-list', 'timeline-item-event-feed',
  'bulk-actions-toolbar', 'source-content', 'chart-card', 'ordered-step-list',
  'accordion', 'timeline-summary', 'small-multiples-chart', 'metric-bar',
  'playback-controls', 'timeline-scrubber', 'bipolar-bar',
] as const;

const requestedContracts = process.env.SHARED_LIBRARY_CONTRACTS?.split(',');
if (requestedContracts?.some(id => !contracts.some(contract => contract === id))) {
  throw new Error('Unknown shared-library contract in affected-only recheck');
}
const selectedContracts = contracts.filter(id => !requestedContracts || requestedContracts.includes(id));

const modes = [
  { name: 'desktop-dark', width: 1440, theme: 'dark', rtl: false, zoom: false, forced: false },
  { name: 'mobile-dark', width: 390, theme: 'dark', rtl: false, zoom: false, forced: false },
  { name: 'desktop-light', width: 1440, theme: 'light', rtl: false, zoom: false, forced: false },
  { name: 'mobile-light', width: 390, theme: 'light', rtl: false, zoom: false, forced: false },
  { name: 'mobile-rtl-text200', width: 390, theme: 'light', rtl: true, zoom: true, forced: false },
  { name: 'desktop-forced-colors', width: 1440, theme: 'dark', rtl: false, zoom: false, forced: true },
] as const;

test.afterAll(async () => { await closeMockSseServer(); });

for (const mode of modes) {
  test(`complete shared-library sweep: ${mode.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: mode.width, height: 1000 });
    await page.emulateMedia({
      colorScheme: mode.theme,
      reducedMotion: 'reduce',
      forcedColors: mode.forced ? 'active' : 'none',
    });
    const diagnostics = monitorPage(page);
    await seedBrowserState(page, mode.theme, '/dev/shared-library');
    const mocks = await installApiMocks(page, 'populated', mode.theme);
    await page.goto('/dev/shared-library');
    await waitForHarnessReady(page, mocks);
    const gallery = page.locator('[data-shared-library-gallery]');
    await expect(gallery).toBeVisible();
    if (mode.rtl || mode.zoom) {
      await gallery.evaluate((root, values) => {
        if (values.rtl) root.setAttribute('dir', 'rtl');
        if (values.zoom) document.documentElement.style.fontSize = '200%';
      }, { rtl: mode.rtl, zoom: mode.zoom });
    }

    await expect(page.locator('[data-shared-contract]')).toHaveCount(20);
    const geometry = [];
    for (const contract of selectedContracts) {
      const fixture = page.locator(`[data-shared-contract="${contract}"]`);
      await expect.soft(fixture, `${contract}: unique fixture`).toHaveCount(1);
      await expect.soft(fixture, `${contract}: visible complete fixture`).toBeVisible();
      await fixture.scrollIntoViewIfNeeded();
      const dimensions = await fixture.evaluate(root => ({
        contract: root.getAttribute('data-shared-contract'),
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bounds: { width: root.getBoundingClientRect().width, height: root.getBoundingClientRect().height },
      }));
      geometry.push(dimensions);
      expect.soft(dimensions.scrollWidth, `${contract}: allocated width overflow`)
        .toBeLessThanOrEqual(dimensions.clientWidth + 1);
      const screenshot = info.outputPath(`${contract}-${mode.name}.png`);
      await fixture.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`${contract}-${mode.name}`, { path: screenshot, contentType: 'image/png' });
    }
    const narrowGrid = page.locator('[data-narrow-multiples]');
    await narrowGrid.scrollIntoViewIfNeeded();
    const narrowGeometry = await narrowGrid.evaluate(root => ({
      width: root.clientWidth, scrollWidth: root.scrollWidth,
    }));
    expect.soft(narrowGeometry.scrollWidth, 'automatic multiples must fit below preferred minimum')
      .toBeLessThanOrEqual(narrowGeometry.width + 1);
    const overview = page.locator('[data-shared-contract="timeline-scrubber"]');
    await expect.soft(overview.getByRole('slider')).toHaveCount(0);
    await expect.soft(overview.getByRole('button')).toHaveCount(0);
    await expect.soft(overview.getByRole('listitem')).toHaveCount(5);
    const missingSigned = page.locator('[data-shared-contract="bipolar-bar"]')
      .getByRole('group', { name: 'Unresolved reading, not an invented zero', exact: true });
    await expect.soft(missingSigned).toBeVisible();
    await expect.soft(missingSigned).not.toHaveAttribute('aria-valuenow');
    const source = page.locator('[data-shared-contract="source-content"]');
    for (const state of ['Loading', 'Empty', 'Error', 'Retained after refresh error', 'Ready']) {
      await source.getByRole('button', { name: state, exact: true }).click();
      await expect.soft(source).toBeVisible();
      await expect.soft(source.getByText(c.neighborBody, { exact: true })).toBeVisible();
      if (selectedContracts.includes('source-content')) {
        const stateScreenshot = info.outputPath(`source-${state.replaceAll(' ', '-')}-${mode.name}.png`);
        await source.screenshot({ path: stateScreenshot, animations: 'disabled' });
      }
    }
    const disclosure = page.locator('[data-shared-contract="accordion"]');
    const trigger = disclosure.getByRole('button').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect.soft(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect.soft(trigger).toHaveAttribute('aria-expanded', 'false');
    await info.attach('contract-geometry.json', {
      body: Buffer.from(JSON.stringify({ mode, geometry, narrowGeometry }, null, 2)),
      contentType: 'application/json',
    });
    await attachDiagnostics(info, diagnostics);
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(mocks);
  });
}

test('allocated marker positions and focused tooltip containment', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, 'dark', '/dev/shared-library');
  const mocks = await installApiMocks(page, 'populated', 'dark');
  await page.goto('/dev/shared-library');
  await waitForHarnessReady(page, mocks);
  const results = [];
  for (const zoom of [false, true]) {
    await page.locator('[data-shared-library-gallery]').evaluate((root, enlarged) => {
      root.setAttribute('dir', enlarged ? 'rtl' : 'ltr');
      document.documentElement.style.fontSize = enlarged ? '200%' : '100%';
    }, zoom);
    for (const contract of ['pill-filter-bar', 'playback-controls', 'timeline-summary', 'chart-card']) {
      const fixture = page.locator(`[data-shared-contract="${contract}"]`);
      await fixture.scrollIntoViewIfNeeded();
      const details = await fixture.evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>('*')].map(node => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            tag: node.tagName, className: node.getAttribute('class'),
            text: node.textContent?.slice(0, 100), width: box.width,
            left: box.left - bounds.left, right: box.right - bounds.right,
            position: style.position, overflowX: style.overflowX,
            minWidth: style.minWidth, whiteSpace: style.whiteSpace,
          };
        }).filter(node => node.width > 0 && (node.left < -1 || node.right > 1));
      });
      results.push({ contract, zoom, details });
      const dimensions = await fixture.evaluate(root => ({
        clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
      }));
      expect.soft(dimensions.scrollWidth, `${contract}: text200=${zoom}`)
        .toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }
    const chartCard = page.locator('[data-shared-contract="chart-card"] [data-card]');
    await chartCard.getByRole('button', { name: `Read full description for ${c.chartName}` }).focus();
    const description = chartCard.getByRole('tooltip');
    await expect(description).toHaveCSS('opacity', '1');
    const cardBox = await chartCard.boundingBox();
    const descriptionBox = await description.boundingBox();
    if (!cardBox || !descriptionBox) throw new Error('Chart description has no allocated geometry');
    expect.soft(descriptionBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
    expect.soft(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    await description.screenshot({ path: info.outputPath(`chart-description-text200-${zoom}.png`) });
    const playback = page.locator('[data-shared-contract="playback-controls"]');
    const track = playback.getByRole('slider').first();
    const trackBox = await track.boundingBox();
    if (!trackBox) throw new Error('Playback track has no allocated geometry');
    const markers = playback.locator('[data-timeline-marker]');
    await expect(markers).toHaveCount(2);
    for (const [index, fraction] of [0.2, 0.8].entries()) {
      const marker = markers.nth(index);
      const box = await marker.boundingBox();
      if (!box) throw new Error('Prepared marker has no allocated geometry');
      expect.soft(Math.abs(box.x + box.width / 2 - (trackBox.x + trackBox.width * fraction)),
        `marker ${index} must use track width`).toBeLessThanOrEqual(1);
      await marker.focus();
      const tooltip = marker.locator('..').getByRole('tooltip');
      await expect(tooltip).toHaveCSS('opacity', '1');
      const tip = await tooltip.boundingBox();
      if (!tip) throw new Error('Focused marker description has no geometry');
      expect.soft(tip.x).toBeGreaterThanOrEqual(trackBox.x - 1);
      expect.soft(tip.x + tip.width).toBeLessThanOrEqual(trackBox.x + trackBox.width + 1);
      await tooltip.screenshot({ path: info.outputPath(`marker-${index}-text200-${zoom}.png`) });
    }
  }
  writeFileSync(info.outputPath('overflow-descendants.json'), JSON.stringify(results, null, 2));
  await assertMockApiComplete(mocks);
});

test('200 percent RTL preserves readable action labels', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const diagnostics = monitorPage(page);
  await seedBrowserState(page, 'light', '/dev/shared-library');
  const mocks = await installApiMocks(page, 'populated', 'light');
  await page.goto('/dev/shared-library');
  await waitForHarnessReady(page, mocks);
  await page.locator('[data-shared-library-gallery]').evaluate(root => {
    root.setAttribute('dir', 'rtl');
    document.documentElement.style.fontSize = '200%';
  });
  const results = [];
  for (const contract of contracts) {
    const fixture = page.locator(`[data-shared-contract="${contract}"]`);
    await fixture.scrollIntoViewIfNeeded();
    const overflow = await fixture.evaluate(root => {
      const issues = [];
      for (const button of root.querySelectorAll('button:not([data-timeline-marker])')) {
        const bounds = button.getBoundingClientRect();
        if (!bounds.width || !bounds.height) continue;
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.closest('[data-card-desc], .sr-only, svg')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width && (
              rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
              rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1
            )) issues.push({ label: node.textContent, button: button.textContent });
          }
        }
      }
      return issues;
    });
    results.push({ contract, overflow });
    expect.soft(overflow, `${contract}: visible labels must fit their controls`).toEqual([]);
  }
  writeFileSync(info.outputPath('action-label-containment.json'), JSON.stringify(results, null, 2));
  const bulkFooter = page.locator('[data-shared-contract="bulk-actions-toolbar"]')
    .getByRole('status').filter({ hasText: c.bulkIdle });
  await bulkFooter.scrollIntoViewIfNeeded();
  const footerVisibility = await bulkFooter.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { readable: hit != null && node.contains(hit), hit: hit?.tagName, hitText: hit?.textContent };
  });
  writeFileSync(info.outputPath('bulk-footer-visibility.json'), JSON.stringify(footerVisibility, null, 2));
  await page.screenshot({ path: info.outputPath('bulk-footer-real-viewport.png') });
  expect(footerVisibility.readable, 'bulk actions must not obscure their result status').toBe(true);
  await page.locator('[data-shared-contract="bulk-actions-toolbar"]').screenshot({
    path: info.outputPath('bulk-toolbar-text200-final.png'), animations: 'disabled',
  });
  await attachDiagnostics(info, diagnostics);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(mocks);
});

test('forced colors preserve visible measurement fills and temporal tracks', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce', colorScheme: 'dark' });
  const diagnostics = monitorPage(page);
  await seedBrowserState(page, 'dark', '/dev/shared-library');
  const mocks = await installApiMocks(page, 'populated', 'dark');
  await page.goto('/dev/shared-library');
  await waitForHarnessReady(page, mocks);
  const measurements = [];
  for (const [contract, trackSelector, fillSelector] of [
    ['metric-bar', '[data-metric-track]', '[data-metric-fill]'],
    ['bipolar-bar', '[data-bipolar-track]', '[data-bipolar-fill]'],
    ['playback-controls', '[data-timeline-track]', '[data-timeline-fill]'],
    ['timeline-scrubber', '[data-timeline-track]', '[data-timeline-marker]:not([data-position-unavailable])'],
  ]) {
    const fixture = page.locator(`[data-shared-contract="${contract}"]`);
    const track = fixture.locator(trackSelector).first();
    await expect(track).toHaveCSS('outline-style', 'solid');
    const canvas = await track.evaluate(node => getComputedStyle(node).backgroundColor);
    let visibleFills = 0;
    for (const fill of await fixture.locator(fillSelector).all()) {
      const paint = await fill.evaluate(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { width: box.width, height: box.height, background: style.backgroundColor };
      });
      if (paint.width > 0) {
        visibleFills += 1;
        expect(paint.height).toBeGreaterThan(0);
        expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(paint.background).not.toBe(canvas);
      }
      measurements.push({ contract, ...paint });
    }
    expect(visibleFills, `${contract}: prepared nonzero geometry`).toBeGreaterThan(0);
    await fixture.screenshot({
      path: info.outputPath(`${contract}-forced-colors-final.png`), animations: 'disabled',
    });
  }
  writeFileSync(info.outputPath('forced-colors-paints.json'), JSON.stringify(measurements, null, 2));
  await attachDiagnostics(info, diagnostics);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(mocks);
});

for (const mode of [
  { name: 'desktop-dark', width: 1440, theme: 'dark' as const, touch: false },
  { name: 'mobile-light', width: 390, theme: 'light' as const, touch: true },
]) {
  test.describe(`${mode.name} contract state interactions`, () => {
    test.use({ viewport: { width: mode.width, height: 1000 }, hasTouch: mode.touch });
    test('preserves prepared selection, readings, recovery and complete export data', async ({ page, context, browser }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const diagnostics = monitorPage(page);
      await seedBrowserState(page, mode.theme, '/dev/shared-library');
      const mocks = await installApiMocks(page, 'populated', mode.theme);
      await page.goto('/dev/shared-library');
      await waitForHarnessReady(page, mocks);
      const capture = async (contract: string, state: string) => {
        await page.locator(`[data-shared-contract="${contract}"]`).screenshot({
          path: info.outputPath(`${contract}-${state}.png`), animations: 'disabled',
        });
      };

      const days = page.locator('[data-shared-contract="weekday-select"]');
      await days.getByRole('button', { name: c.clearDays }).click();
      await expect(days.getByRole('status')).toHaveText(c.none);
      const sunday = days.getByRole('group', { name: c.days }).getByRole('button', { name: c.sunday });
      if (mode.touch) await sunday.tap(); else await sunday.click();
      await expect(sunday).toHaveAttribute('aria-pressed', 'true');
      await expect(days.getByRole('status')).toContainText('0');
      await capture('weekday-select', 'explicit-empty-and-touch-selection');

      const pills = page.locator('[data-shared-contract="pill-filter-bar"]');
      const filters = pills.getByRole('group', { name: c.filters });
      const unresolved = filters.getByRole('button', { name: /Unresolved observations/ });
      await unresolved.focus();
      await page.keyboard.press('Space');
      await expect(unresolved).toHaveAttribute('aria-pressed', 'true');
      const tabs = pills.getByRole('tablist');
      await tabs.getByRole('tab', { selected: true }).focus();
      await page.keyboard.press('Home');
      await expect(tabs.getByRole('tab', { selected: true })).toContainText(c.all);
      await page.keyboard.press('End');
      await expect(tabs.getByRole('tab', { selected: true })).toContainText(c.unresolved);
      await expect(tabs.getByRole('tab', { name: c.unavailable })).toBeDisabled();
      await capture('pill-filter-bar', 'keyboard-filter-and-tabs');

      const gauge = page.locator('[data-shared-contract="widget-gauge-hero"]');
      await expect(gauge.getByRole('group', { name: c.gaugeUnknown })).not.toHaveAttribute('aria-valuenow');
      await expect(gauge.getByRole('meter', { name: c.gaugeZero })).toHaveAttribute('aria-valuenow', '0');
      await expect(gauge.getByRole('group', { name: c.gaugeInvalid })).toContainText('40');
      await capture('widget-gauge-hero', 'unknown-zero-invalid-scale');
      const ranked = page.locator('[data-shared-contract="widget-ranked-list"]');
      await ranked.getByRole('button', { name: c.magnitudeOrder }).click();
      const positive = await ranked.getByText(c.rankPositive, { exact: true }).first().boundingBox();
      const unknown = await ranked.getByText(c.rankUnknown, { exact: true }).first().boundingBox();
      if (!positive || !unknown) throw new Error('Prepared rank labels are missing');
      expect(positive.y).toBeLessThan(unknown.y);
      await capture('widget-ranked-list', 'descending-values');
      await ranked.getByRole('button', { name: c.sourceOrder }).click();

      const bulk = page.locator('[data-shared-contract="bulk-actions-toolbar"]');
      await bulk.getByRole('button', { name: c.filteredScope }).click();
      await expect(bulk).toContainText('known 27-record filtered result');
      await expect(bulk.getByRole('button', { name: c.bulkDisabled })).toBeDisabled();
      await bulk.getByRole('button', { name: c.bulkExport }).click();
      await expect(bulk.getByRole('button', { name: c.bulkExport })).toBeDisabled();
      await expect(bulk).toContainText(loadedFixtureIds.join(', '));
      await capture('bulk-actions-toolbar', 'pending-exact-selected-ids');
      await bulk.getByRole('button', { name: c.bulkComplete }).click();
      await expect(bulk.getByRole('button', { name: c.bulkExport })).toBeEnabled();
      await bulk.getByRole('button', { name: c.bulkFail }).click();
      await expect(bulk).toContainText(c.bulkFailure);
      await expect(bulk.getByRole('button', { name: c.bulkExport })).toBeEnabled();
      await capture('bulk-actions-toolbar', 'failure-retains-selection');
      await bulk.getByRole('button', { name: c.bulkDelete }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').screenshot({ path: info.outputPath('bulk-confirmation.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(bulk.getByRole('button', { name: c.bulkExport })).toBeEnabled();

      const playback = page.locator('[data-shared-contract="playback-controls"]');
      await playback.getByRole('button', { name: 'Play', exact: true }).last().click();
      await expect(playback.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(2);
      await playback.getByRole('button', { name: 'Playback speed: 1x', exact: true }).click();
      await expect(playback.getByRole('button', { name: 'Playback speed: 10x', exact: true })).toHaveCount(1);
      await playback.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect(playback.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '0');
      await playback.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(playback.getByRole('button', { name: 'Play', exact: true })).toHaveCount(2);
      await capture('playback-controls', 'optional-capabilities');

      const chart = page.locator('[data-shared-contract="chart-card"]');
      await expect(chart.locator('[data-chart-toolbar]')).toHaveCount(1);
      await expect(chart.locator('tbody tr')).toHaveCount(12);
      await chart.getByRole('button', { name: 'Export chart', exact: true }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Download data as CSV', exact: true }).click();
      const path = await (await download).path();
      if (!path) throw new Error('Complete chart CSV download is missing');
      expect(readFileSync(path, 'utf8')).toBe(`\ufeff${objectsToCSV(completeChartRows)}`);
      for (const state of ['Loading', 'Empty', 'Error', 'Retained after refresh error', 'Ready']) {
        await chart.getByRole('button', { name: state, exact: true }).click();
        await capture('chart-card', state.replaceAll(' ', '-'));
      }

      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const copy = page.locator('[data-shared-contract="copy-button"]');
      await copy.getByRole('button', { name: c.copyPayload, exact: true }).click();
      await expect(copy).toContainText(c.copySuccess);
      const nativePayload = process.platform === 'win32'
        ? fixtureClipboardPayload.replaceAll('\n', '\r\n') : fixtureClipboardPayload;
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(nativePayload);
      await capture('copy-button', 'native-success');
      await expect(page.getByText('Copied to clipboard', { exact: true })).toBeHidden();
      const session = await browser.newBrowserCDPSession();
      const { browserContextIds } = await session.send('Target.getBrowserContexts');
      const browserContextId = browserContextIds[0];
      if (browserContextIds.length !== 1 || !browserContextId) throw new Error('Clipboard test requires one isolated browser context');
      await context.clearPermissions();
      for (const allowWithoutSanitization of [false, true]) {
        await session.send('Browser.setPermission', {
          permission: { name: 'clipboard-write', allowWithoutSanitization }, setting: 'denied',
          origin: 'http://127.0.0.1:5240', browserContextId,
        });
      }
      await copy.getByRole('button', { name: c.copyPayload, exact: true }).click();
      await expect(copy).toContainText(c.copyFailure);
      await expect(page.getByRole('group', { name: c.manual, exact: true })).toContainText(fixtureClipboardPayload);
      await capture('code-block', 'native-failure-manual-recovery');
      await capture('copy-button', 'native-failure-feedback');
      await session.detach();
      await attachDiagnostics(info, diagnostics);
      const expectedClipboardErrors = diagnostics.consoleErrors.filter(error => error.startsWith('CopyButton: clipboard write failed'));
      expect(expectedClipboardErrors).toHaveLength(1);
      await expectNoRuntimeFailures({
        ...diagnostics,
        consoleErrors: diagnostics.consoleErrors.filter(error => !error.startsWith('CopyButton: clipboard write failed')),
      });
      await assertMockApiComplete(mocks);
    });
  });
}
