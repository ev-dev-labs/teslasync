import { expect, test } from '@playwright/test';
import { captureGeometry } from './dashboardCatalogueCapture';
import { assertCatalogueReadingInventory } from './dashboardCatalogueObservationAge';

test.beforeEach(async ({ page }) => {
  await page.goto('/offline.html');
  await page.setContent(`
    <main style="height:360px;overflow:auto">
      <article id="panel" style="height:1400px;padding:16px">
        <h3>Native reading geometry</h3>
        <svg width="350" height="420" viewBox="0 0 350 420">
          <g transform="translate(35.5,162.65503)">
            <text><tspan x="12.25" y="13.125">65.00</tspan></text>
          </g>
        </svg>
      </article>
    </main>
  `);
});

test('native SVG reading geometry is exactly invariant under scrolling', async ({ page }) => {
  const panel = page.locator('#panel');
  const before = await captureGeometry(panel);
  for (const offset of [137, 513, 0]) {
    await page.locator('main').evaluate((main, top) => { main.scrollTop = top; }, offset);
    assertCatalogueReadingInventory(before, await captureGeometry(panel));
  }
});

test('native SVG reading geometry still rejects a 0.0001px source displacement', async ({ page }) => {
  const panel = page.locator('#panel');
  const before = await captureGeometry(panel);
  await page.locator('g').evaluate(group => group.setAttribute('transform', 'translate(35.5,162.65513)'));
  const after = await captureGeometry(panel);
  expect(() => assertCatalogueReadingInventory(before, after))
    .toThrow('Every rendered reading region must retain its exact identity/relative geometry');
});
