import { expect, test } from '@playwright/test';
import { sampleHeatmapPaint } from './widget-design-packs.specialized';

for (const moveDuringDecode of [false, true]) {
  test(`heatmap pixels retain one coordinate frame when decoding moves the plot (${moveDuringDecode})`, async ({ page }) => {
    const colors = ['#000000', '#444444', '#888888', '#ffffff'];
    const cells = Array.from({ length: 168 }, (_, index) =>
      `<rect x="${index % 24 * 10}" y="${Math.floor(index / 24) * 10}" width="10" height="10" fill="${colors[index - 36] ?? '#ffffff'}"/>`);
    await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="70">${cells.join('')}</svg>`);
    if (moveDuringDecode) {
      await page.evaluate(() => {
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          document.querySelector('svg')!.style.transform = 'translateY(300px)';
          return decode.call(this);
        };
      });
    }

    const { paint } = await sampleHeatmapPaint(page.locator('svg'));
    expect(paint.map(sample => sample.rgba)).toEqual([
      [0, 0, 0, 255], [68, 68, 68, 255], [136, 136, 136, 255], [255, 255, 255, 255],
    ]);
  });
}
