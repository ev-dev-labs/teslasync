import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const profileAttributes = [
  'data-app-design-pack', 'data-app-navigation', 'data-app-header', 'data-app-content',
  'data-app-controls', 'data-app-data', 'data-app-chart', 'data-app-map', 'data-app-feedback',
] as const;

export async function assertOwnedTree(host: Locator, packId: string | null) {
  expect(packId).not.toBeNull();
  await expect(host).toHaveAttribute('data-app-design-owner', new RegExp(`^pack-${packId}(?:\\s|$)`));
  await expect.poll(() => host.evaluate(element => {
    const owner = element.getAttribute('data-app-design-owner');
    return [...element.querySelectorAll('*')]
      .filter(node => node.getAttribute('data-app-design-owner') !== owner)
      .slice(0, 8).map(node => node.tagName);
  }), { message: 'every final target, including vendor SVG/map descendants, retains its nearest preview owner' }).toEqual([]);
}

/** Measures rendered structure and state shapes, never IDs, descriptors, colors or shadows. */
export async function compositionGeometry(host: Locator) {
  return host.evaluate(element => {
    const origin = element.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 4) / 4;
    const parts = ['navigation', 'workspace-header', 'page-header', 'page-actions', 'panel', 'card',
      'skeleton', 'feedback', 'loading', 'empty', 'error', 'feedback-content', 'feedback-icon',
      'feedback-message', 'feedback-actions', 'feedback-retry', 'metric-grid',
      'metric', 'field', 'field-control', 'table', 'table-row', 'pagination', 'chart-plot',
      'chart-legend', 'map', 'map-controls', 'map-legend', 'dialog', 'dialog-header', 'tabs', 'tab',
      'badge', 'list', 'list-row', 'metric-label', 'metric-value', 'grid',
      'map-stage', 'map-split', 'map-details', 'map-provenance', 'map-sources', 'map-toolbar',
      'conversation-workspace', 'conversation-layout', 'conversation-sessions', 'conversation-session',
      'conversation-transcript', 'conversation-composer', 'conversation-message', 'conversation-welcome'];
    return { frame: { width: round(origin.width), height: round(origin.height) }, parts: Object.fromEntries(parts.map(part => [part,
      [...(element.matches(`[data-app-part~="${part}"]`) ? [element as HTMLElement] : []),
        ...element.querySelectorAll<HTMLElement>(`[data-app-part~="${part}"]`)]
        .filter(node => node.getClientRects().length > 0).slice(0, 12).map(node => {
          const box = node.getBoundingClientRect();
          const css = getComputedStyle(node);
          return {
            x: round(box.left - origin.left), y: round(box.top - origin.top),
            width: round(box.width), height: round(box.height),
            display: css.display, columns: css.gridTemplateColumns, rows: css.gridTemplateRows,
            direction: css.flexDirection, wrap: css.flexWrap, gap: css.gap,
            align: css.alignItems, justify: css.justifyContent,
            padding: css.padding, fontSize: css.fontSize, lineHeight: css.lineHeight,
            borderRadius: css.borderRadius, borderWidth: css.borderWidth,
            borderStyle: css.borderStyle, clipPath: css.clipPath,
          };
        }),
    ])) };
  });
}

export async function assertContained(host: Locator, description: string) {
  const { result, diagnostics } = await host.evaluate(element => {
    const box = element.getBoundingClientRect();
    const captionOverlap = matchMedia('(forced-colors: active)').matches
      && [...element.querySelectorAll('[data-chart-caption]')].some(caption => {
        const alternative = caption.parentElement?.querySelector('[data-chart-alternative]');
        if (!alternative || caption.getClientRects().length === 0) return false;
        const captionBox = caption.getBoundingClientRect();
        const alternativeBox = alternative.getBoundingClientRect();
        return captionBox.height > 0 && alternativeBox.height > 0 && alternativeBox.top < captionBox.bottom - 1;
      });
    const result = {
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      hostOverflow: element.scrollWidth > element.clientWidth + 2,
      outsideViewport: box.left < -2 || box.right > innerWidth + 2,
      chartCaptionOverlap: captionOverlap,
    };
    const overflowing: Record<string, unknown>[] = [];
    if (Object.values(result).some(Boolean)) {
      for (const node of element.querySelectorAll('*')) {
        if (node.getClientRects().length === 0) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left >= -2 && rect.right <= innerWidth + 2 && node.scrollWidth <= node.clientWidth + 2) continue;
        let clipped = false;
        for (let parent = node.parentElement; parent && parent !== element && parent.tagName !== 'BODY'; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== 'visible') {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        const css = getComputedStyle(node);
        overflowing.push({
          tag: node.tagName, id: node.id, class: node.getAttribute('class'),
          part: node.getAttribute('data-app-part'),
          left: rect.left, right: rect.right, width: rect.width,
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
          display: css.display, columns: css.gridTemplateColumns,
          minWidth: css.minWidth, maxWidth: css.maxWidth,
          overflowX: css.overflowX, position: css.position,
        });
        if (overflowing.length === 20) break;
      }
    }
    return {
      result,
      diagnostics: overflowing.length > 0
        ? { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overflowing }
        : null,
    };
  });
  expect(result, diagnostics ? `${description}\n${JSON.stringify(diagnostics, null, 2)}` : description)
    .toEqual({ documentOverflow: false, hostOverflow: false, outsideViewport: false, chartCaptionOverlap: false });
}

async function assertReadableTextInset(frame: Locator, text: Locator, description: string) {
  const outer = await frame.boundingBox();
  expect(outer).not.toBeNull();
  const inner = await text.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  expect(Math.min(inner.left - outer!.x, outer!.x + outer!.width - inner.right,
    inner.top - outer!.y, outer!.y + outer!.height - inner.bottom),
  `${description} keeps readable text clear of its frame`).toBeGreaterThanOrEqual(4);
}

export async function assertTableNoMatchContained(section: Locator) {
  const viewport = await section.locator('[data-grid-viewport]').boundingBox();
  expect(viewport).not.toBeNull();
  const table = section.getByRole('table', { name: 'Sample journey ledger' });
  const message = table.getByRole('status');
  await expect(message).toHaveText('No sample journeys match.');
  const text = await message.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].map(box => ({ left: box.left, right: box.right }));
  });
  expect(text.length).toBeGreaterThan(0);
  const reset = await table.getByRole('button', { name: 'Clear filters', exact: true }).boundingBox();
  expect(reset).not.toBeNull();
  for (const box of [...text, { left: reset!.x, right: reset!.x + reset!.width }]) {
    expect(box.left, 'no-match copy and recovery action remain inside the visible table viewport').toBeGreaterThanOrEqual(viewport!.x - 1);
    expect(box.right, 'no-match copy and recovery action need no horizontal scrolling').toBeLessThanOrEqual(viewport!.x + viewport!.width + 1);
  }
}

export async function assertPlotAndMap(preview: Locator) {
  await assertOwnedTree(preview, await preview.getAttribute('data-app-design-pack'));
  const chart = preview.locator('[data-preview-section="chart"]');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(2);
  const plots = await chart.locator('.recharts-line-curve').evaluateAll(nodes => nodes.map(node => {
    const path = node as SVGPathElement;
    const box = path.getBBox();
    return { width: box.width, height: box.height, length: path.getTotalLength(), d: path.getAttribute('d') ?? '' };
  }));
  for (const plot of plots) {
    expect(plot.width).toBeGreaterThan(30);
    expect(plot.height).toBeGreaterThan(5);
    expect(plot.length).toBeGreaterThan(30);
  }
  expect(plots[0].d.match(/M/g)?.length, 'battery line preserves the observation gap').toBe(2);
  await expect(chart.locator('[data-app-part~="chart-legend"]')).toBeVisible();
  const map = preview.locator('[data-preview-section="map"]');
  await map.scrollIntoViewIfNeeded();
  const provenance = map.locator('[data-app-part~="map-provenance"]');
  await expect(provenance).toBeVisible();
  if (await provenance.evaluate(element => getComputedStyle(element).outlineStyle !== 'none')) {
    expect(await provenance.evaluate(element => element.getClientRects().length),
      'framed map provenance uses one wrapped text box, not separate inline outlines').toBe(1);
    await assertReadableTextInset(provenance, provenance, 'map provenance');
  }
  await expect(map.locator('[data-preview-map-marker]')).toHaveCount(4);
  const vectors = await map.locator('.leaflet-overlay-pane path').evaluateAll(nodes =>
    nodes.map(node => {
      const box = (node as SVGPathElement).getBBox();
      return { width: box.width, height: box.height };
    }));
  expect(vectors.filter(box => box.width > 40 && box.height > 10).length).toBeGreaterThanOrEqual(2);
  const size = await map.locator('.leaflet-container').evaluate(element => ({
    width: element.clientWidth, height: element.clientHeight,
  }));
  expect(size.width).toBeGreaterThan(80);
  expect(size.height).toBeGreaterThan(100);
  await expect(map.locator('.leaflet-tile')).toHaveCount(0);
}

async function clickChoiceLabel(choice: Locator) {
  const id = await choice.getAttribute('id');
  expect(id, 'native choice has an associated visible label').toBeTruthy();
  await choice.page().locator(`label[for=${JSON.stringify(id)}]`).click();
}

export async function inspectPreviewInteractions(page: Page, preview: Locator, testInfo: TestInfo, evidence: string) {
  for (const state of ['loading', 'empty', 'error', 'stale', 'partial']) {
    await expect(preview.locator(`[data-preview-state="${state}"]`)).toHaveCount(1);
  }
  await expect(preview.getByRole('button', { name: 'Server save disabled' })).toBeDisabled();
  await expect(preview.getByRole('button', { name: 'Loading example' })).toBeDisabled();
  await expect(preview.getByRole('textbox', { name: 'Disabled source identifier' })).toBeDisabled();
  const form = preview.locator('[data-preview-section="form"]');
  await form.getByRole('button', { name: 'Apply locally' }).click();
  const name = form.getByRole('textbox', { name: /Sample view name/ });
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.focus();
  await expect(name).toBeFocused();
  expect(await name.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await form.screenshot({ path: testInfo.outputPath(`${evidence}-invalid-focus.png`), animations: 'disabled' });
  await name.fill('Local review');
  await form.getByRole('combobox', { name: 'Sample layout' }).selectOption('detail');
  await clickChoiceLabel(form.getByRole('radio', { name: 'Include partial examples' }));
  const sourceQuality = form.getByRole('checkbox', { name: 'Show source quality', exact: true });
  await expect(sourceQuality).toBeChecked();
  await clickChoiceLabel(sourceQuality);
  await expect(sourceQuality).not.toBeChecked();
  await form.getByRole('switch', { name: 'Show comparison context' }).click();
  await expect(form.getByRole('radio', { name: 'Include partial examples' })).toBeChecked();
  await form.getByRole('button', { name: 'Apply locally' }).click();
  await expect(form.getByText('Applied in this sandbox only')).toBeVisible();
  await form.screenshot({ path: testInfo.outputPath(`${evidence}-selected.png`), animations: 'disabled' });
  const feedback = preview.locator('[data-preview-section="feedback"]');
  await feedback.screenshot({ path: testInfo.outputPath(`${evidence}-data-states.png`), animations: 'disabled' });
  await feedback.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(feedback.getByText('Sample source recovered')).toBeVisible();
  await feedback.getByRole('button', { name: 'Show error again' }).click();
  const tableSection = preview.locator('[data-preview-section="table"]');
  const table = tableSection.getByRole('table', { name: 'Sample journey ledger' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await table.getByRole('button', { name: 'Distance', exact: true }).click();
  await expect(table.getByRole('row').nth(1)).toContainText('Park pause');
  await tableSection.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(table.getByText('Park pause', { exact: true })).toHaveCount(0);
  const search = tableSection.getByRole('searchbox', { name: 'Search loaded rows' });
  await search.fill('Studio');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByText('—', { exact: true })).toHaveCount(1);
  await search.fill('');
  await tableSection.getByRole('button', { name: 'Source quality filter' }).click();
  const filter = page.getByRole('dialog', { name: 'Source quality filter' });
  await expect(filter).toBeVisible();
  const complete = filter.getByRole('checkbox', { name: 'Complete', exact: true });
  await expect(complete).toBeChecked();
  await clickChoiceLabel(complete);
  await expect(complete).not.toBeChecked();
  await filter.screenshot({ path: testInfo.outputPath(`${evidence}-filter-open.png`), animations: 'disabled' });
  await filter.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await tableSection.getByRole('button', { name: 'Source quality filter' }).click();
  await page.getByRole('dialog', { name: 'Source quality filter' }).getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog', { name: 'Source quality filter' }).getByRole('button', { name: 'Done', exact: true }).click();
  await table.getByRole('button', { name: 'Distance', exact: true }).click();
  const chart = preview.locator('[data-preview-section="chart"]');
  const legend = chart.getByRole('button', { name: 'Sample reference (%)', exact: true });
  await legend.click();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
  await legend.click();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(2);
  // Frozen wall time otherwise stalls Recharts' Date.now-based mouse throttle.
  await page.clock.setFixedTime(new Date(await page.evaluate(() => Date.now()) + 50));
  await chart.locator('.recharts-line-dots circle').first().hover();
  const tooltip = chart.locator('[data-app-part~="chart-tooltip"]');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('[data-chart-tooltip-label]')).toHaveText('0');
  await expect(tooltip).toContainText('78.00');
  await expect(tooltip).toContainText('80.00');
  const map = preview.locator('[data-preview-section="map"]');
  await map.getByRole('button', { name: 'Zoom sample map in' }).click();
  await map.getByRole('button', { name: 'Reset map', exact: true }).click();
  await map.getByRole('button', { name: 'Fictional stop 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(map.getByText('Fictional stop 1', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  // Responsive remeasurement can restart Leaflet's Date-based native pan.
  await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now())));
  try {
    await expect.poll(() => map.evaluate(element => {
      const frame = element.querySelector('.leaflet-container')!.getBoundingClientRect();
      const popup = element.querySelector('.leaflet-popup')!.getBoundingClientRect();
      const tip = element.querySelector('.leaflet-popup-tip-container')!.getBoundingClientRect();
      const marker = element.querySelector('[data-preview-map-marker="0"]')!.getBoundingClientRect();
      return {
        left: popup.left >= frame.left - 1,
        right: popup.right <= frame.right + 1,
        top: popup.top >= frame.top - 1,
        bottom: popup.bottom <= frame.bottom + 1,
        idle: !element.querySelector('.leaflet-pan-anim, .leaflet-zoom-anim'),
        anchored: Math.abs((tip.left + tip.right - marker.left - marker.right) / 2) <= 1,
      };
    })).toEqual({ left: true, right: true, top: true, bottom: true, idle: true, anchored: true });
    await map.screenshot({ path: testInfo.outputPath(`${evidence}-map-popup.png`), animations: 'disabled' });
  } finally {
    await page.clock.setFixedTime(new Date(await page.evaluate(() => Date.now())));
  }
  await map.getByRole('button', { name: 'Show sample route' }).click();
  await expect(map.getByRole('button', { name: 'Show sample route' })).toHaveAttribute('aria-pressed', 'false');
  await map.getByRole('button', { name: 'Show sample route' }).click();
  await preview.getByRole('button', { name: 'Preview help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Preview help', exact: true });
  await expect(help).toBeVisible();
  await assertContained(help, 'open local popover');
  await assertReadableTextInset(help, help.getByText(
    'Explore open, selected and focus states without changing the saved design.', { exact: true }), 'preview help');
  await help.screenshot({ path: testInfo.outputPath(`${evidence}-popover.png`), animations: 'disabled' });
  await help.getByRole('button', { name: 'Dismiss help' }).click();
}

export async function inspectNestedDialog(page: Page, preview: Locator, capture?: { testInfo: TestInfo; file: string }) {
  const opener = preview.getByRole('button', { name: 'Inspect sample journey', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic journey details', exact: true });
  await expect(dialog).toBeVisible();
  const expectedProfile = await preview.evaluate((element, attributes) =>
    Object.fromEntries(attributes.map(attribute => [attribute, element.getAttribute(attribute)])), profileAttributes);
  expect(await dialog.evaluate((element, attributes) => {
    const boundary = element.closest('[data-app-design-preview]');
    return Object.fromEntries(attributes.map(attribute => [attribute, boundary?.getAttribute(attribute) ?? null]));
  }, profileAttributes)).toEqual(expectedProfile);
  await assertOwnedTree(dialog, expectedProfile['data-app-design-pack']);
  await assertContained(dialog, 'nested sample dialog');
  const summary = dialog.getByRole('tab', { name: 'Summary', exact: true });
  await summary.focus();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('tab', { name: 'Quality', exact: true })).toBeFocused();
  await expect(dialog.getByRole('tab', { name: 'Quality', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: 'Live unavailable' })).toBeDisabled();
  const geometry = await compositionGeometry(dialog);
  if (capture) await dialog.screenshot({ path: capture.testInfo.outputPath(capture.file), animations: 'disabled' });
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(preview).toBeVisible();
  await expect(opener).toBeFocused();
  return geometry;
}

/** A same-content, same-viewport comparison, including real portaled surfaces.
 * CSS metadata alone is never used as evidence of isolation. */
export async function isolationAppearance(host: Locator) {
  const geometry = await compositionGeometry(host);
  const styles = await host.evaluate(element => {
    const nodes = [element, ...element.querySelectorAll('[data-app-part]')];
    return nodes.filter(node => node.getClientRects().length > 0).map(node => {
      const css = getComputedStyle(node);
      return Object.fromEntries(['display', 'grid-template-columns', 'flex-direction',
        'padding', 'gap', 'font-family', 'font-size', 'font-weight', 'line-height',
        'color', 'background-color', 'background-image', 'border-width', 'border-style',
        'border-radius', 'box-shadow', 'outline-style'].map(key => [key, css.getPropertyValue(key)]));
    });
  });
  return { geometry, styles };
}

/** Prove real owner-guarded rules are active, not merely that two unstyled
 * specimens look alike. The removal/read/restore is one synchronous task, so
 * the scope observer cannot repair the specimen between the measurements. */
export async function assertOwnerGuardActivation(preview: Locator) {
  const activation = await preview.evaluate(element => {
    const nodes = [element, ...element.querySelectorAll('[data-app-part], .leaflet-pane, svg, svg path')];
    const properties = ['display', 'grid-template-columns', 'flex-direction', 'padding', 'gap',
      'font-size', 'font-weight', 'line-height', 'border-width', 'border-style',
      'background-color', 'background-image', 'border-radius', 'box-shadow'];
    const capture = () => nodes.filter(node => node.getClientRects().length > 0).map(node => {
      const css = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height,
        styles: properties.map(property => css.getPropertyValue(property)) };
    });
    const owners = [element, ...element.querySelectorAll('[data-app-design-owner]')]
      .map(node => ({ node, owner: node.getAttribute('data-app-design-owner') }));
    const applied = capture();
    let unowned: ReturnType<typeof capture>;
    try {
      for (const { node } of owners) node.removeAttribute('data-app-design-owner');
      unowned = capture();
    } finally {
      for (const { node, owner } of owners) {
        if (owner !== null) node.setAttribute('data-app-design-owner', owner);
      }
    }
    return { applied, unowned, restored: capture() };
  });
  expect(activation.applied, 'real final-target owner guards change computed preview composition/treatment')
    .not.toEqual(activation.unowned);
  expect(activation.restored, 'activation probe restores the actual sandbox exactly').toEqual(activation.applied);
}

export async function inspectPortaledIsolation(page: Page, preview: Locator) {
  await preview.getByRole('button', { name: 'Preview help', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Preview help', exact: true });
  await expect(popover).toBeVisible();
  expect(await popover.evaluate(element =>
    element.closest('[data-app-design-preview]')?.getAttribute('data-app-design-pack'))).toBe('quiet');
  await assertOwnedTree(popover, 'quiet');
  const help = await isolationAppearance(popover);
  await popover.getByRole('button', { name: 'Dismiss help' }).click();
  await preview.getByRole('button', { name: 'Safety information', exact: true }).hover();
  const tooltip = page.getByRole('tooltip').filter({
    hasText: 'Every action here is local to this synthetic preview.',
  });
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate(element =>
    element.closest('[data-app-design-preview]')?.getAttribute('data-app-design-pack'))).toBe('quiet');
  await assertOwnedTree(tooltip, 'quiet');
  const safety = await isolationAppearance(tooltip);
  await preview.getByRole('heading', { name: 'Application preview', exact: true }).hover();
  await expect(tooltip).toBeHidden();
  await preview.getByRole('button', { name: 'Inspect sample journey', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic journey details', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element =>
    element.closest('[data-app-design-preview]')?.getAttribute('data-app-design-pack'))).toBe('quiet');
  await assertOwnedTree(dialog, 'quiet');
  const details = await isolationAppearance(dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The actual shared DataTable filter is a different portal consumer, not a
  // custom preview stand-in for an open listbox/filter family.
  await preview.getByRole('button', { name: 'Source quality filter', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Source quality filter', exact: true });
  await expect(filter).toBeVisible();
  expect(await filter.evaluate(element =>
    element.closest('[data-app-design-preview]')?.getAttribute('data-app-design-pack'))).toBe('quiet');
  await assertOwnedTree(filter, 'quiet');
  const valueFilter = await isolationAppearance(filter);
  await filter.getByRole('button', { name: 'Done', exact: true }).click();
  return { help, safety, details, valueFilter };
}
