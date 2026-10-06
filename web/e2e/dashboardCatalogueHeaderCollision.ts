import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getWidgetDef } from '../src/features/dashboard/widgets/registry';
import { catalogueObservationSource } from './dashboardCatalogueObservationAge';
import { positionCataloguePanel } from './dashboardCatalogueCapture';

async function headerGeometry(expand: Locator) {
  return expand.evaluate(element => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('Expand target is not a native button');
    const container = element.closest('[data-widget-id]');
    if (container?.getAttribute('data-widget-id') !== 'review-fleet-posture') {
      throw new Error('Expand belongs to the wrong widget');
    }
    const panel = container.querySelector(':scope > .widget-panel');
    const title = panel?.querySelector('h3:not(.sr-only)');
    const header = title?.parentElement?.parentElement?.parentElement;
    if (!header || !panel?.contains(header)) throw new Error('Missing exact FleetPosture shell header');
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, height: box.height };
    };
    const visible = (node: Element) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (style.visibility !== 'visible' || box.width <= 0 || box.height <= 0) return false;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestorStyle.display === 'none' || Number(ancestorStyle.opacity) === 0
          || ancestorStyle.clip === 'rect(0px, 0px, 0px, 0px)') return false;
        if (ancestor === container) break;
      }
      return true;
    };
    const expandBox = rect(element);
    const controls = [...header.querySelectorAll('button')].filter(visible).map(button => {
      const box = rect(button);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { text: button.textContent?.trim(), label: button.getAttribute('aria-label'), box,
        verticalOverlap: Math.max(0, Math.min(box.bottom, expandBox.bottom) - Math.max(box.top, expandBox.top)),
        gap: expandBox.left - box.right, hitOwnButton: hit?.closest('button') === button };
    });
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    const readings = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement || node.parentElement.closest('.sr-only')
        || !visible(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.width <= 0 || box.height <= 0) continue;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        readings.push({ text: node.textContent.trim(), left: box.left, right: box.right,
          top: box.top, bottom: box.bottom,
          verticalOverlap: Math.max(0, Math.min(box.bottom, expandBox.bottom) - Math.max(box.top, expandBox.top)),
          gap: expandBox.left - box.right, hitInsideHeader: hit !== null && header.contains(hit) });
      }
    }
    const hit = document.elementFromPoint(expandBox.left + expandBox.width / 2,
      expandBox.top + expandBox.height / 2);
    const main = container.closest('main');
    return { expand: expandBox, opacity: Number(getComputedStyle(element).opacity),
      keyboardFocusVisible: element.matches(':focus-visible'), containerHovered: container.matches(':hover'),
      hitOwnExpand: hit?.closest('button') === element,
      hitWidgetId: hit?.closest('[data-widget-id]')?.getAttribute('data-widget-id'),
      controls, readings, header: rect(header), title: title?.textContent,
      scroll: { main: main?.scrollTop, window: scrollY }, captureMode: 'viewport/fullPage=false' };
  });
}

function assertGeometry(frame: Awaited<ReturnType<typeof headerGeometry>>, keyboard: boolean) {
  expect(frame.expand.width, 'Expand must be at least44px wide').toBeGreaterThanOrEqual(44);
  expect(frame.expand.height, 'Expand must be at least44px high').toBeGreaterThanOrEqual(44);
  expect(frame.opacity, 'Shown Expand must be fully visible').toBe(1);
  expect(frame.hitOwnExpand, 'Expand center must hit that exact native button').toBe(true);
  expect(frame.hitWidgetId).toBe('review-fleet-posture');
  expect(frame.title).toBe('Fleet posture');
  const refresh = frame.controls.filter(control => control.text === 'Refresh');
  expect(refresh, 'Visible Refresh must not be dropped to avoid the collision').toHaveLength(1);
  expect(refresh[0].box.right).toBeLessThanOrEqual(frame.expand.left);
  expect(refresh[0].gap, 'Actual Refresh/Expand gap must be at least8px').toBeGreaterThanOrEqual(8);
  for (const control of frame.controls) {
    expect(control.hitOwnButton, 'Each visible header control center must retain its own button').toBe(true);
    if (control.verticalOverlap > 0) expect(control.gap, 'Vertically overlapping controls require8px gap')
      .toBeGreaterThanOrEqual(8);
  }
  expect(frame.readings.some(reading => reading.text === 'Fleet posture')).toBe(true);
  expect(frame.readings.some(reading => reading.text === 'Refresh')).toBe(true);
  for (const reading of frame.readings) {
    expect(reading.hitInsideHeader, 'Visible header text must not be occluded').toBe(true);
    if (reading.verticalOverlap > 0) expect(reading.gap, 'Vertically overlapping text requires8px gap')
      .toBeGreaterThanOrEqual(8);
  }
  if (keyboard) {
    expect(frame.containerHovered, 'Keyboard visibility must not depend on hover').toBe(false);
    expect(frame.keyboardFocusVisible).toBe(true);
  }
}

async function assertPosture(panel: Locator) {
  await expect(panel.getByRole('heading', { name: 'Fleet posture', exact: true, level: 3 })).toBeVisible();
  await expect(panel.getByText('1 of 1 verified', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('fleet-posture-announcement'))
    .toContainText('All 1 vehicles verified from current telemetry.');
  await expect(panel.getByRole('link', { name: 'Open vehicle', exact: true })).toHaveAttribute('href', '/vehicles/7');
  await expect(panel).toContainText(/Last real observation\s+\S/);
  await expect(panel).toContainText('Active vehicle scope');
  await expect(panel.getByText('Aurora', { exact: true })).toHaveCount(1);
  await expect(panel.getByText('Aurora', { exact: true })).toBeVisible();
  await expect(panel.getByText('driving', { exact: true })).toHaveCount(1);
  await expect(panel.getByText('driving', { exact: true })).toBeVisible();
  await expect(panel).toContainText('Vehicle data is reporting normally.');
  await expect(panel).toContainText('current telemetry');
  await expect(panel).toContainText('observed, not fetched');
  const oldestLabel = panel.getByText('Oldest reading', { exact: true }).and(panel.locator('dt'));
  await expect(oldestLabel).toHaveCount(1);
  await expect(oldestLabel).toBeVisible();
  const oldestValue = oldestLabel.locator('..').locator('dd');
  await expect(oldestValue).toHaveCount(1);
  await expect(oldestValue).toBeVisible();
  await expect(oldestValue).toContainText(/^\d+[smhd] ago/);
  for (const text of ['Live · 1', 'Stale · 0', 'Guessed · 0', 'Missing · 0']) {
    await expect(panel.getByText(text, { exact: true })).toBeVisible();
  }
}

async function assertRefresh(page: Page, panel: Locator) {
  const before = await catalogueObservationSource(page, 7);
  const count = (responses: typeof before.responses, path: string) =>
    responses.filter(response => new URL(response.url).pathname === path).length;
  const refresh = panel.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toHaveCount(1);
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect.poll(async () => {
    const after = await catalogueObservationSource(page, 7);
    return ['/api/v1/vehicles', '/api/v1/vehicles/states'].every(path =>
      count(after.responses, path) > count(before.responses, path));
  }, { message: 'Refresh must actually refetch both the roster and fleet-state sources' }).toBe(true);
  const after = await catalogueObservationSource(page, 7);
  expect(after.responses.filter(response => new URL(response.url).pathname === '/api/v1/vehicles/states')
    .every(response => new URL(response.url).searchParams.get('vehicle_ids') === '7')).toBe(true);
  await expect(refresh).toBeEnabled();
  await assertPosture(panel);
  return { before, after };
}

async function fullscreenGeometry(overlay: Locator) {
  return overlay.evaluate(element => {
    const box = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Exit fullscreen');
    if (buttons.length !== 1) throw new Error('Dialog must own exactly one native Exit fullscreen button');
    const exit = buttons[0];
    const exitBox = exit.getBoundingClientRect();
    const hit = document.elementFromPoint(exitBox.left + exitBox.width / 2, exitBox.top + exitBox.height / 2);
    return {
      dialog: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      exit: { left: exitBox.left, right: exitBox.right, top: exitBox.top, bottom: exitBox.bottom,
        width: exitBox.width, height: exitBox.height },
      exitTopmostOwnButton: hit?.closest('button') === exit,
      activeInsideDialog: element.contains(document.activeElement), exitFocused: document.activeElement === exit,
      hit: hit ? { tag: hit.tagName, role: hit.getAttribute('role'), label: hit.getAttribute('aria-label') } : null,
    };
  });
}

function assertFullscreenGeometry(frame: Awaited<ReturnType<typeof fullscreenGeometry>>) {
  expect(frame.dialog.left).toBe(0);
  expect(frame.dialog.top).toBe(0);
  expect(frame.dialog.right).toBe(frame.viewport.width);
  expect(frame.dialog.bottom).toBe(frame.viewport.height);
  expect(frame.dialog.width).toBe(frame.viewport.width);
  expect(frame.dialog.height).toBe(frame.viewport.height);
  expect(frame.exit.width).toBeGreaterThanOrEqual(44);
  expect(frame.exit.height).toBeGreaterThanOrEqual(44);
  expect(frame.exit.left).toBeGreaterThanOrEqual(0);
  expect(frame.exit.top).toBeGreaterThanOrEqual(0);
  expect(frame.exit.right).toBeLessThanOrEqual(frame.viewport.width);
  expect(frame.exit.bottom).toBeLessThanOrEqual(frame.viewport.height);
  expect(frame.exitTopmostOwnButton, 'Exit center must hit its exact button above app chrome').toBe(true);
  expect(frame.activeInsideDialog, 'Modal focus must remain inside its semantic dialog').toBe(true);
}

export async function assertCatalogueHeaderCollision(page: Page, panel: Locator,
  width: number, theme: string, info: TestInfo) {
  const def = getWidgetDef('fleet-posture');
  if (!def) throw new Error('Missing original FleetPosture registry definition');
  const container = page.locator('[data-widget-id="review-fleet-posture"]');
  const expand = container.getByRole('button', { name: `Expand ${def.name}`, exact: true });
  await expect(expand).toHaveCount(1);
  await positionCataloguePanel(panel);
  await assertPosture(panel);
  const captures = [];
  for (const mode of ['hover', 'keyboard'] as const) {
    if (mode === 'hover') {
      await expand.hover();
    } else {
      await page.mouse.move(0, 0);
      await expand.focus();
      await expand.press('Shift+Tab');
      await expect(expand).not.toBeFocused();
      await page.keyboard.press('Tab');
      await expect(expand).toBeFocused();
      await positionCataloguePanel(panel);
    }
    await expect(expand).toHaveCSS('opacity', '1');
    const before = await headerGeometry(expand);
    await writeFile(info.outputPath(`fleet-header-${mode}-before.json`), JSON.stringify(before, null, 2));
    assertGeometry(before, mode === 'keyboard');
    const path = info.outputPath(`fleet-header-${mode}-${width}-${theme}.png`);
    await page.screenshot({ path, fullPage: false, timeout: 8_000 });
    const after = await headerGeometry(expand);
    await writeFile(info.outputPath(`fleet-header-${mode}-after.json`), JSON.stringify(after, null, 2));
    assertGeometry(after, mode === 'keyboard');
    captures.push({ mode, path, before, after });
  }
  const gridRefresh = await assertRefresh(page, panel);
  await page.mouse.move(0, 0);
  await expand.focus();
  await expand.press('Enter');
  const exit = page.getByRole('button', { name: 'Exit fullscreen', exact: true });
  await expect(exit).toHaveCount(1);
  await expect(exit).toBeVisible();
  const overlay = page.getByRole('dialog').filter({ has: exit });
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toHaveAttribute('aria-modal', 'true');
  await expect(overlay).toHaveAccessibleName(def.name);
  await expect(exit).toBeFocused();
  const fullscreenBefore = await fullscreenGeometry(overlay);
  await writeFile(info.outputPath('fleet-fullscreen-before.json'), JSON.stringify(fullscreenBefore, null, 2));
  assertFullscreenGeometry(fullscreenBefore);
  await exit.press('Shift+Tab');
  const reverseTrap = await fullscreenGeometry(overlay);
  await writeFile(info.outputPath('fleet-fullscreen-reverse-tab.json'), JSON.stringify(reverseTrap, null, 2));
  assertFullscreenGeometry(reverseTrap);
  expect(reverseTrap.exitFocused, 'Shift+Tab from first Exit must wrap to another dialog control').toBe(false);
  await page.keyboard.press('Tab');
  await expect(exit, 'Tab from last dialog control must wrap back to Exit').toBeFocused();
  await expect(overlay.getByRole('heading', { name: def.name, exact: true, level: 2 })).toBeVisible();
  await assertPosture(overlay);
  const fullscreenRefresh = await assertRefresh(page, overlay);
  await exit.click();
  await expect(exit).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  await expect(expand, 'Native Exit must restore the original Expand focus').toBeFocused();
  await expand.press('Enter');
  await expect(overlay).toHaveCount(1);
  await expect(exit).toBeFocused();
  const escapeBefore = await fullscreenGeometry(overlay);
  await writeFile(info.outputPath('fleet-fullscreen-escape-before.json'), JSON.stringify(escapeBefore, null, 2));
  assertFullscreenGeometry(escapeBefore);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(exit).toHaveCount(0);
  await expect(expand, 'Native Escape must restore the original Expand focus').toBeFocused();
  await positionCataloguePanel(panel);
  await assertPosture(panel);
  await writeFile(info.outputPath('fleet-header-native-contract.json'), JSON.stringify({
    width, theme, captures, gridRefresh, fullscreenRefresh, fullscreenBefore, reverseTrap, escapeBefore,
    fullscreenOpenedAndClosed: true, reverseAndForwardTabTrapped: true, escapeClosedAndFocusRestored: true,
    scope: 'Original FleetPosture only; hover/keyboard geometry, exact button hits and actual refresh source requests.',
  }, null, 2));
}
