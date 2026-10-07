import { expect, type Locator, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { baseConfig } from '../playwright.config';

export async function observeCatalogueAxisRendering(panel: Locator, info: TestInfo) {
  const timeout = baseConfig.expect?.timeout;
  if (timeout === undefined) throw new Error('Missing standard expectation timeout');
  const started = Date.now();
  const observation = panel.evaluate(async (element, observationTimeout) => {
    const start = performance.now();
    const snapshot = () => {
      const measure = (node: Element) => {
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { tag: node.tagName, className: node.getAttribute('class'),
          x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
          display: style.display, flex: style.flex, minHeight: style.minHeight,
          cssHeight: style.height, overflow: style.overflow };
      };
      const container = element.querySelector('.recharts-responsive-container');
      const ancestors: ReturnType<typeof measure>[] = [];
      for (let node = container; node && element.contains(node); node = node.parentElement) {
        ancestors.push(measure(node));
        if (node === element) break;
      }
      const svgs = [...element.querySelectorAll('svg.recharts-surface')].map(measure);
      return { timestamp: new Date().toISOString(), elapsedMs: performance.now() - start,
        panel: measure(element), ancestors, svgs, text: element.textContent };
    };
    const initial = snapshot();
    const samples = [initial];
    let signature = JSON.stringify([initial.ancestors, initial.svgs]);
    let sample = initial;
    const hasVisibleSvg = () => sample.svgs.some(svg =>
      svg.width > 0 && svg.height > 0 && svg.display !== 'none');
    while (!hasVisibleSvg() && sample.elapsedMs < observationTimeout) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      sample = snapshot();
      const nextSignature = JSON.stringify([sample.ancestors, sample.svgs]);
      if (nextSignature !== signature) {
        samples.push(sample);
        signature = nextSignature;
      }
    }
    return { initial, final: sample, samples, visible: hasVisibleSvg(),
      firstPositiveSvgMs: hasVisibleSvg() ? sample.elapsedMs : null };
  }, timeout);
  const initialScreenshotStarted = Date.now();
  await panel.screenshot({ path: info.outputPath('charge-session-chart-initial-guard.png') });
  const initialScreenshotFinished = Date.now();
  const result = await observation;
  await writeFile(info.outputPath('charge-session-chart-render-observation.json'), JSON.stringify({
    mode: 'isolated-diagnostic-not-acceptance', started, standardExpectationTimeoutMs: timeout,
    initialScreenshotStarted, initialScreenshotFinished,
    ...result,
  }, null, 2));
  await panel.screenshot({ path: info.outputPath('charge-session-chart-after-observation.png') });
  expect(result.visible, 'No positive SVG within the existing expectation timeout').toBe(true);
  await expect(panel.locator('svg.recharts-surface').first()).toBeVisible();
}
