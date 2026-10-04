import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  assertCatalogueReadingInventory, catalogueObservationSource,
  type CatalogueObservationAgeLayout, type CatalogueObservationSource,
} from './dashboardCatalogueObservationAge';

function remainingCaptureBudget(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Original8s pre-capture readiness/settlement budget exhausted');
  return remaining;
}

export async function captureGeometry(panel: Locator, timeout?: number) {
  return panel.evaluate(element => {
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        width: box.width, height: box.height };
    };
    const main = element.closest('main');
    if (!main) throw new Error('Catalogue panel has no main scroll owner');
    const overlays = [...document.querySelectorAll(
      '[data-role="appbar"], [data-role="status-bar"], [data-role="bottom-tab-bar"]',
    )].filter(node => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && box.width > 0 && box.height > 0;
    }).map(node => ({ role: node.getAttribute('data-role'), box: rect(node) }));
    const mainBox = rect(main);
    const panelBox = rect(element);
    let top = Math.max(0, mainBox.top);
    let bottom = Math.min(innerHeight, mainBox.bottom);
    for (const overlay of overlays) {
      if (overlay.box.right <= panelBox.left || overlay.box.left >= panelBox.right) continue;
      if (overlay.role === 'appbar') top = Math.max(top, overlay.box.bottom);
      else bottom = Math.min(bottom, overlay.box.top);
    }
    const widgetId = element.closest('[data-widget-id]')?.getAttribute('data-widget-id');
    const brief = widgetId && ['review-fleet-posture', 'state-fleet-posture'].includes(widgetId)
      ? element.querySelector('[data-testid="fleet-operations-brief"]') : null;
    const scopeAge = brief?.querySelector(':scope > .pt-4 > div > .min-w-0 > span.mt-2.block');
    const oldestLabel = brief ? [...brief.querySelectorAll('dl > div > dt')]
      .find(node => node.textContent === 'Oldest reading') : null;
    const oldestAge = oldestLabel?.parentElement?.querySelector('dd');
    const scopeLink = brief?.querySelector(':scope > .pt-4 > div > a[href^="/vehicles/"]');
    const scopeMatch = /^\/vehicles\/(\d+)$/.exec(scopeLink?.getAttribute('href') ?? '');
    const readings = [];
    const isRendered = (owner: Element) => {
      for (let ancestor: Element | null = owner; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        // Descendants can override inherited visibility, but not ancestor opacity/display.
        if ((ancestor === owner && ['hidden', 'collapse'].includes(style.visibility))
          || style.display === 'none' || Number(style.opacity) === 0
          || style.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      }
      return true;
    };
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNodeIndex = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const nodeIndex = textNodeIndex++;
      const text = node.textContent?.trim();
      const owner = node.parentElement;
      if (!text || !owner || owner.closest('script, style') || !isRendered(owner)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const observationAgeRole = owner === scopeAge ? 'scope' as const
        : owner === oldestAge ? 'oldest' as const : null;
      const observationAgeLayout: CatalogueObservationAgeLayout[] | null = observationAgeRole ? [] : null;
      if (observationAgeLayout) {
        for (let container: Element | null = owner; container; container = container.parentElement) {
          const box = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          const left = box.left + container.clientLeft - panelBox.left;
          const top = box.top + container.clientTop - panelBox.top;
          observationAgeLayout.push({
            tag: container.tagName, className: container.getAttribute('class'),
            bounds: { top: box.top - panelBox.top, bottom: box.bottom - panelBox.top,
              left: box.left - panelBox.left, right: box.right - panelBox.left },
            clipBounds: { top, bottom: top + container.clientHeight,
              left, right: left + container.clientWidth },
            clipsX: ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) || container === element,
            clipsY: ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) || container === element,
            scrollTop: container.scrollTop, scrollLeft: container.scrollLeft,
            scrollHeight: container.scrollHeight, scrollWidth: container.scrollWidth,
            clientHeight: container.clientHeight, clientWidth: container.clientWidth,
          });
          if (container === element) break;
        }
      }
      let lineIndex = 0;
      for (const box of range.getClientRects()) {
        if (box.width <= 0 || box.height <= 0) continue;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        readings.push({
          id: `${nodeIndex}:${lineIndex++}`,
          observationAgeRole, observationAgeLayout,
          text, top: box.top, bottom: box.bottom, left: box.left, right: box.right,
          relativeTop: box.top - panelBox.top, relativeBottom: box.bottom - panelBox.top,
          relativeLeft: box.left - panelBox.left, relativeRight: box.right - panelBox.left,
          hitInsidePanel: hit !== null && element.contains(hit),
          hit: hit ? { tag: hit.tagName, className: hit.getAttribute('class'),
            role: hit.closest('[data-role]')?.getAttribute('data-role') } : null,
        });
      }
    }
    const header = element.querySelector('.widget-header')
      ?? element.querySelector('[role="heading"], h1, h2, h3, h4, h5, h6');
    const panelStyle = getComputedStyle(element);
    const item = element.closest('.react-grid-item');
    const body = element.querySelector('[aria-busy] > .\\@container');
    const bodyStyle = body ? getComputedStyle(body) : null;
    return {
      wallTimeMs: Date.now(), performanceMs: performance.now(),
      fleetObservation: brief ? { scopeVehicleId: scopeMatch ? Number(scopeMatch[1]) : null } : null,
      viewport: { width: innerWidth, height: innerHeight }, usable: { top, bottom },
      panel: panelBox, header: header ? rect(header) : null,
      panelComputed: {
        height: panelStyle.height, minHeight: panelStyle.minHeight, maxHeight: panelStyle.maxHeight,
        overflow: panelStyle.overflow, display: panelStyle.display, flex: panelStyle.flex,
        transform: panelStyle.transform, transitionProperty: panelStyle.transitionProperty,
        transitionDuration: panelStyle.transitionDuration, animationName: panelStyle.animationName,
        animationDuration: panelStyle.animationDuration,
      },
      rgl: item ? { box: rect(item),
        inlineHeight: item instanceof HTMLElement ? item.style.height : '',
        computedHeight: getComputedStyle(item).height, transform: getComputedStyle(item).transform,
        transition: getComputedStyle(item).transition } : null,
      body: body && bodyStyle ? { box: rect(body), scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        height: bodyStyle.height, overflow: bodyStyle.overflow, flex: bodyStyle.flex } : null,
      main: { box: mainBox, scrollTop: main.scrollTop, scrollLeft: main.scrollLeft,
        scrollHeight: main.scrollHeight, clientHeight: main.clientHeight },
      windowScroll: { x: scrollX, y: scrollY }, overlays, readings,
      storage: {
        dashboards: localStorage.getItem('teslasync-dashboards'),
        active: localStorage.getItem('teslasync-active-dashboard'),
        stamp: localStorage.getItem('teslasync-row-height-version'),
      },
    };
  }, undefined, { timeout });
}

type CatalogueGeometry = Awaited<ReturnType<typeof captureGeometry>> & {
  observationSource?: CatalogueObservationSource | null;
};

function assertReading(reading: CatalogueGeometry['readings'][number], geometry: CatalogueGeometry) {
  expect(reading.top, `${reading.text}: reading above visible main bounds`).toBeGreaterThanOrEqual(geometry.usable.top);
  expect(reading.bottom, `${reading.text}: reading behind fixed footer`).toBeLessThanOrEqual(geometry.usable.bottom);
  expect(reading.hitInsidePanel, `${reading.text}: reading occluded at native center hit`).toBe(true);
}

function assertUnoccluded(geometry: CatalogueGeometry) {
  expect(geometry.panel.top, 'Whole panel must sit below the app bar').toBeGreaterThanOrEqual(geometry.usable.top);
  expect(geometry.panel.bottom, 'Whole panel must sit above fixed status/tab bars; oversized captures cannot be cleared by scrolling').toBeLessThanOrEqual(geometry.usable.bottom);
  expect(geometry.readings.length, 'Capture must retain visible reading/identity text').toBeGreaterThan(0);
  for (const reading of geometry.readings) assertReading(reading, geometry);
}

function assertUnchanged(before: CatalogueGeometry, after: CatalogueGeometry) {
  expect(after.panel, 'Screenshot capture must not reposition/resize the widget').toEqual(before.panel);
  expect(after.header).toEqual(before.header);
  expect(after.main).toEqual(before.main);
  expect(after.windowScroll).toEqual(before.windowScroll);
  expect(after.storage, 'Screenshot capture must not rewrite saved layout/height/stamp').toEqual(before.storage);
  expect(after.rgl, 'Screenshot capture must not change settled RGL geometry').toEqual(before.rgl);
  expect(after.body, 'Screenshot capture must not reposition/scroll/resize the widget body').toEqual(before.body);
}

export function assertCatalogueShortCapture(before: CatalogueGeometry, after: CatalogueGeometry) {
  assertUnoccluded(before);
  assertUnoccluded(after);
  expect(after.readings.length, 'Short capture must retain every rendered reading region').toBe(before.readings.length);
  if (before.fleetObservation) assertCatalogueReadingInventory(before, after);
  assertUnchanged(before, after);
}

export async function positionCataloguePanel(panel: Locator, deadline?: number) {
  const geometry = await captureGeometry(panel, deadline === undefined ? undefined : remainingCaptureBudget(deadline));
  const availableHeight = geometry.usable.bottom - geometry.usable.top;
  const inset = geometry.panel.height <= availableHeight ? Math.min(16, availableHeight - geometry.panel.height) : 16;
  await panel.evaluate((element, { top, inset }) => {
    const main = element.closest('main');
    if (!main) throw new Error('Catalogue panel has no main scroll owner');
    main.scrollTo({
      top: Math.max(0, main.scrollTop + element.getBoundingClientRect().top - top - inset),
      behavior: 'instant',
    });
  }, { top: geometry.usable.top, inset }, {
    timeout: deadline === undefined ? undefined : remainingCaptureBudget(deadline),
  });
}

export async function captureCataloguePanel(page: Page, panel: Locator, info: TestInfo, filename: string) {
  const deadline = Date.now() + 8_000;
  const settlement: Array<{ geometry: Awaited<ReturnType<typeof captureGeometry>> }> = [];
  const snapshots: Array<{ stage: string; geometry: Awaited<ReturnType<typeof captureGeometry>> & {
    observationSource: CatalogueObservationSource | null;
  } }> = [];
  const path = info.outputPath(`${filename}.geometry.json`);
  let captureMode = 'locator followed by viewport';
  let coverage: {
    complete: boolean; panelCoveredThrough: number; expectedReadingIds: string[]; coveredReadingIds: string[];
    panelIntervals: Array<{ from: number; to: number; frame: string; sampledReadingIds: string[]; boundaryCutReadingIds: string[] }>;
    frameArtifacts: string[];
  } | undefined;
  const persist = () => writeFile(path, JSON.stringify({
    captureMode, fullPage: false, preCaptureBudgetMs: 8_000, settlement, snapshots, coverage,
  }, null, 2));
  const record = async (stage: string, captureDeadline?: number) => {
    const measured = await captureGeometry(panel, captureDeadline === undefined ? undefined : remainingCaptureBudget(captureDeadline));
    const geometry = { ...measured, observationSource: measured.readings.some(reading => reading.observationAgeRole)
      ? await catalogueObservationSource(page, measured.fleetObservation?.scopeVehicleId ?? NaN) : null };
    snapshots.push({ stage, geometry });
    await persist();
    return geometry;
  };
  try {
    await panel.waitFor({ state: 'visible', timeout: remainingCaptureBudget(deadline) });
    let previous = '';
    let stable = 0;
    const signatureOf = (geometry: Awaited<ReturnType<typeof captureGeometry>>) => JSON.stringify({
      panel: geometry.panel, header: geometry.header, panelComputed: geometry.panelComputed,
      rgl: geometry.rgl, body: geometry.body, main: geometry.main,
      windowScroll: geometry.windowScroll, storage: geometry.storage,
    });
    await expect.poll(async () => {
      await positionCataloguePanel(panel, deadline);
      const geometry = await captureGeometry(panel, remainingCaptureBudget(deadline));
      settlement.push({ geometry });
      await persist();
      const signature = signatureOf(geometry);
      stable = signature === previous ? stable + 1 : 1;
      previous = signature;
      // Text/hit failures are not readiness: stable clipped/occluded content must still fail.
      return stable >= 3 && geometry.panel.width > 0 && geometry.panel.height > 0
        && (!geometry.rgl || geometry.rgl.inlineHeight === geometry.rgl.computedHeight);
    }, { timeout: remainingCaptureBudget(deadline), intervals: [150, 150, 150, 150, 150, 150, 150, 150],
      message: 'Post-interaction panel/body/RGL must settle at the native inline height within the original8s budget' }).toBe(true);
    const positioned = settlement[settlement.length - 1]?.geometry;
    if (!positioned) throw new Error('Missing settled pre-capture panel geometry');
    const tall = positioned.panel.height > positioned.usable.bottom - positioned.usable.top;
    if (tall) captureMode = 'overlapping native-main-scroll viewport frames; no whole-locator clearance';
    const before = await record(tall ? 'before-viewport-frame-001' : 'before-locator', deadline);
    if (tall || before.fleetObservation) assertCatalogueReadingInventory(before, before);
    expect(signatureOf(before), 'Capture classification must retain final settled native geometry').toBe(previous);
    remainingCaptureBudget(deadline);
    if (tall) {
      const availableHeight = before.usable.bottom - before.usable.top;
      expect(availableHeight, 'Tall capture needs usable viewport space').toBeGreaterThan(0);
      expect(before.readings.length, 'Capture must retain visible reading/identity text').toBeGreaterThan(0);
      for (const reading of before.readings) {
        expect(reading.bottom - reading.top, `${reading.text}: entire reading must fit one usable viewport`)
          .toBeLessThanOrEqual(availableHeight);
      }
      const tallCoverage = {
        complete: false, panelCoveredThrough: 0, expectedReadingIds: before.readings.map(reading => reading.id),
        coveredReadingIds: [] as string[],
        panelIntervals: [] as Array<{ from: number; to: number; frame: string; sampledReadingIds: string[]; boundaryCutReadingIds: string[] }>,
        frameArtifacts: [] as string[],
      };
      coverage = tallCoverage;
      await persist();
      let previousInventory = before;
      const assertScrollOnly = (geometry: typeof before) => {
        expect(geometry.panel.height, 'Native scrolling must not resize panel').toBe(before.panel.height);
        expect(geometry.panel.width).toBe(before.panel.width);
        expect(geometry.panel.left).toBe(before.panel.left);
        expect(geometry.panel.right).toBe(before.panel.right);
        expect(geometry.panelComputed).toEqual(before.panelComputed);
        expect(geometry.main.box).toEqual(before.main.box);
        expect(geometry.main.scrollHeight).toBe(before.main.scrollHeight);
        expect(geometry.main.clientHeight).toBe(before.main.clientHeight);
        expect(geometry.main.scrollLeft).toBe(before.main.scrollLeft);
        expect(geometry.windowScroll).toEqual(before.windowScroll);
        expect(geometry.viewport).toEqual(before.viewport);
        expect(geometry.overlays).toEqual(before.overlays);
        expect(geometry.storage, 'Native scrolling must not rewrite saved layout/height/stamp').toEqual(before.storage);
        expect(geometry.usable).toEqual(before.usable);
        assertCatalogueReadingInventory(previousInventory, geometry);
        previousInventory = geometry;
      };
      const sample = (geometry: typeof before) => {
        assertScrollOnly(geometry);
        expect(geometry.panel.left, 'Entire sampled panel width must fit viewport').toBeGreaterThanOrEqual(0);
        expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewport.width);
        const readings = geometry.readings.filter(reading =>
          reading.top >= geometry.usable.top && reading.bottom <= geometry.usable.bottom);
        for (const reading of readings) {
          assertReading(reading, geometry);
          expect(reading.left, `${reading.text}: entire reading must fit panel width`).toBeGreaterThanOrEqual(geometry.panel.left);
          expect(reading.right).toBeLessThanOrEqual(geometry.panel.right);
        }
        return readings;
      };
      let frameIndex = 0;
      const captureFrame = async (geometry: typeof before) => {
        const name = `${filename}.viewport-${String(++frameIndex).padStart(3, '0')}.png`;
        const readings = sample(geometry);
        const framePath = info.outputPath(name);
        await page.screenshot({ path: framePath, fullPage: false });
        const after = await record(`after-viewport-frame-${String(frameIndex).padStart(3, '0')}`);
        assertUnchanged(geometry, after);
        expect(sample(after).map(reading => reading.id)).toEqual(readings.map(reading => reading.id));
        tallCoverage.frameArtifacts.push(framePath);
        tallCoverage.panelIntervals.push({
          from: Math.max(0, geometry.usable.top - geometry.panel.top),
          to: Math.min(geometry.panel.height, geometry.usable.bottom - geometry.panel.top), frame: framePath,
          sampledReadingIds: readings.map(reading => reading.id),
          boundaryCutReadingIds: geometry.readings.filter(reading =>
            reading.bottom > geometry.usable.top && reading.top < geometry.usable.bottom
            && (reading.top < geometry.usable.top || reading.bottom > geometry.usable.bottom)).map(reading => reading.id),
        });
        tallCoverage.coveredReadingIds = [...new Set([
          ...tallCoverage.coveredReadingIds, ...readings.map(reading => reading.id),
        ])];
        await persist();
        return after;
      };
      const scrollTo = async (top: number) => {
        await panel.evaluate((element, target) => {
          const main = element.closest('main');
          if (!main) throw new Error('Catalogue panel has no main scroll owner');
          main.scrollTo({ top: target, behavior: 'instant' });
        }, top);
        return record(`before-viewport-frame-${String(frameIndex + 1).padStart(3, '0')}`);
      };
      let current = await captureFrame(before);
      expect(tallCoverage.panelIntervals[0].from, 'First tall frame must cover panel top').toBe(0);
      const overlap = Math.min(availableHeight / 2,
        Math.max(32, ...before.readings.map(reading => reading.bottom - reading.top)));
      const frameLimit = Math.ceil(before.panel.height / (availableHeight / 2)) + 2;
      while (tallCoverage.panelIntervals[tallCoverage.panelIntervals.length - 1].to < before.panel.height) {
        expect(frameIndex, 'Tall panel capture must stay bounded').toBeLessThan(frameLimit);
        const prior = tallCoverage.panelIntervals[tallCoverage.panelIntervals.length - 1];
        const advance = Math.min(prior.to - prior.from - overlap, current.panel.bottom - current.usable.bottom + 16);
        expect(advance, 'Native main scroll must expose a new panel region').toBeGreaterThan(0);
        const next = await scrollTo(current.main.scrollTop + advance);
        expect(next.main.scrollTop, 'Native main scroll must expose a new panel region').toBeGreaterThan(current.main.scrollTop);
        assertScrollOnly(next);
        const nextStart = Math.max(0, next.usable.top - next.panel.top);
        expect(nextStart, 'Tall viewport frames must overlap, never leave a coverage gap').toBeLessThan(prior.to);
        expect(Math.min(next.panel.height, next.usable.bottom - next.panel.top),
          'Native main scroll must expose a new panel region').toBeGreaterThan(prior.to);
        current = await captureFrame(next);
      }
      // A line crossing a frame edge is not cleared until captured whole in another frame.
      for (const reading of before.readings) {
        if (tallCoverage.coveredReadingIds.includes(reading.id)) continue;
        const inset = (availableHeight - (reading.bottom - reading.top)) / 2;
        const target = before.main.scrollTop + reading.top - before.usable.top - inset;
        await captureFrame(await scrollTo(target));
        expect(tallCoverage.coveredReadingIds, `${reading.text}: visible reading region must be fully covered`)
          .toContain(reading.id);
      }
      expect([...tallCoverage.coveredReadingIds].sort()).toEqual([...tallCoverage.expectedReadingIds].sort());
      for (const interval of [...tallCoverage.panelIntervals].sort((a, b) => a.from - b.from)) {
        expect(interval.from, 'Every panel region must be covered without gaps').toBeLessThanOrEqual(tallCoverage.panelCoveredThrough);
        expect(interval.to).toBeGreaterThanOrEqual(interval.from);
        tallCoverage.panelCoveredThrough = Math.max(tallCoverage.panelCoveredThrough, interval.to);
      }
      expect(tallCoverage.panelCoveredThrough, 'Entire panel must be covered across actual viewport frames').toBe(before.panel.height);
      tallCoverage.complete = true;
      await persist();
      return;
    }
    assertUnoccluded(before);
    await panel.screenshot({ path: info.outputPath(filename) });
    const afterLocator = await record('after-locator');
    assertCatalogueShortCapture(before, afterLocator);
    await page.screenshot({ path: info.outputPath(`${filename}.viewport.png`), fullPage: false });
    const afterViewport = await record('after-viewport');
    assertCatalogueShortCapture(before, afterViewport);
  } finally {
    await persist();
    await info.attach(`${filename}.geometry.json`, { path, contentType: 'application/json' });
  }
}
