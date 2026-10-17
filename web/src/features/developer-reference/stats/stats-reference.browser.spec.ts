import { expect, test } from '@playwright/test';

/**
 * NOT RUN. Parent supplies gated /dev/stats route and authenticated storage.
 * Explicit config below restricts this to the isolated reference, not production E2E.
 */
for (const width of [375, 639, 640, 768, 1023, 1024, 1280, 1920]) {
  test(`synthetic reference container geometry and accessibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/dev/stats');
    for (const count of [2, 3, 4, 5, 6]) {
      const strip = page.locator(`[data-stat-strip="dev-stats-${count}"]`);
      const geometry = await strip.evaluate(root => {
        const boxes = [...root.querySelectorAll('[data-stat]')].map(tile => {
          const box = tile.getBoundingClientRect();
          const label = tile.querySelector('[data-stat-label]')!.getBoundingClientRect();
          const value = tile.querySelector('[data-stat-value]')!.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, labelY: label.bottom, valueY: value.top };
        });
        return { width: root.clientWidth, overflow: root.scrollWidth > root.clientWidth + 1, boxes };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.boxes).toHaveLength(count);
      const firstY = geometry.boxes[0]!.y;
      const firstRow = geometry.boxes.filter(box => Math.abs(box.y - firstY) < 1);
      expect(firstRow).toHaveLength(Math.min(count, geometry.width < 640 ? 2 : geometry.width < 1024 ? 3 : 6));
      for (const box of geometry.boxes) {
        expect(box.valueY).toBeGreaterThanOrEqual(box.labelY - 1);
        expect(box.height).toBeGreaterThanOrEqual(56);
      }
      const heights = geometry.boxes.map(box => box.height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
      if (geometry.width < 640 && count % 2 === 1)
        expect(geometry.boxes[count - 1]!.width).toBeGreaterThanOrEqual(geometry.width - 2);
      await expect(strip.locator('svg')).toHaveCount(0);
    }
    const link = page.locator('[data-stat-strip="dev-stats-states"] a[data-stat]');
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAccessibleName(/Count:/);
    await expect(page.locator('[data-stat-strip="dev-stats-states"] [data-missing-reason]')).toBeVisible();
    const overflow = await page.locator('[data-stat-strip]').evaluateAll(roots =>
      roots.filter(root => root.scrollWidth > root.clientWidth + 1).length);
    expect(overflow).toBe(0);
  });
}
