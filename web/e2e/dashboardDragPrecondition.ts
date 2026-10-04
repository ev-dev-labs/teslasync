import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export async function beginNativeDashboardDrag(page: Page, handle: Locator, info: TestInfo) {
  const samples: Array<Awaited<ReturnType<typeof measure>>> = [];
  async function measure(point?: { x: number; y: number }) {
    return handle.evaluate((element, pointer) => {
      const rect = (node: Element) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const box = rect(element);
      const target = pointer ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(target.x, target.y);
      const item = element.closest('[data-widget-id]');
      const grid = element.closest('.react-grid-layout');
      const main = element.closest('main');
      return {
        performanceMs: performance.now(), wallTimeMs: Date.now(), box, target,
        widgetId: item?.getAttribute('data-widget-id'),
        draggable: item?.classList.contains('react-draggable') ?? false,
        grid: grid ? rect(grid) : null,
        main: main ? { box: rect(main), scrollTop: main.scrollTop, scrollLeft: main.scrollLeft } : null,
        windowScroll: { x: scrollX, y: scrollY },
        hitMatchesHandle: hit?.closest('.widget-drag-handle') === element,
        hitAncestry: (() => {
          const result = [];
          for (let node = hit; node; node = node.parentElement) {
            result.push({ tag: node.tagName, className: node.getAttribute('class'),
              widgetId: node.getAttribute('data-widget-id') });
          }
          return result;
        })(),
        storage: {
          dashboards: localStorage.getItem('teslasync-dashboards'),
          active: localStorage.getItem('teslasync-active-dashboard'),
          stamp: localStorage.getItem('teslasync-row-height-version'),
        },
      };
    }, point);
  }
  const save = () => writeFile(info.outputPath('native-drag-precondition.json'),
    JSON.stringify({ stage: 'post-Customize, fresh pointer, before and after native mouse-down', samples }, null, 2));
  let previous = '';
  let stable = 0;
  try {
    await expect.poll(async () => {
      const sample = await measure();
      samples.push(sample);
      const signature = JSON.stringify({
        box: sample.box, grid: sample.grid, main: sample.main,
        windowScroll: sample.windowScroll, widgetId: sample.widgetId,
      });
      stable = signature === previous ? stable + 1 : 1;
      previous = signature;
      return stable >= 3 && sample.draggable && sample.hitMatchesHandle
        && sample.box.width > 0 && sample.box.height > 0;
    }, { message: 'Customize must expose a stable, hittable native drag handle within the existing readiness budget' }).toBe(true);

    // Hover can trigger layout changes: verify the fresh point again before pressing.
    const stableSample = samples[samples.length - 1];
    if (!stableSample) throw new Error('Missing stable drag-handle measurement');
    const fresh = await measure();
    samples.push(fresh);
    expect(fresh.box).toEqual(stableSample.box);
    expect(fresh.hitMatchesHandle).toBe(true);
    await page.mouse.move(fresh.target.x, fresh.target.y);
    const beforeDown = await measure(fresh.target);
    samples.push(beforeDown);
    expect(beforeDown.box, 'Drag handle must not move between fresh point selection and mouse-down').toEqual(fresh.box);
    expect(beforeDown.hitMatchesHandle, 'Native pointer must still hit the intended drag handle').toBe(true);
    expect(beforeDown.draggable).toBe(true);
    expect(beforeDown.widgetId).toBe(fresh.widgetId);
    // No artifact I/O between the validated hit and the native press.
    await page.mouse.down();
    samples.push(await measure(fresh.target));
    return fresh.target;
  } finally {
    await save();
  }
}
