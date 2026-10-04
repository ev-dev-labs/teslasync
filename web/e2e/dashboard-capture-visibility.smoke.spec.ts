import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { assertCatalogueShortCapture, captureCataloguePanel, captureGeometry } from './dashboardCatalogueCapture';
import { assertCatalogueReadingInventory } from './dashboardCatalogueObservationAge';

async function controlledFixture(page: Page, content: string, overlay = '', rgl = false) {
  await page.route('**/capture-visibility-fixture', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="UTF-8"><style>
      body { margin: 0; font: 16px/24px sans-serif; }
      main { position: absolute; inset: 40px 0; overflow: auto; }
      .widget-panel { position: relative; box-sizing: border-box; width: 700px;
        min-height: 240px; padding: 16px; background: white; }
      h2, p { margin: 0; font: inherit; }
      [data-role=appbar] { position: fixed; inset: 0 0 auto; height: 32px; background: white; }
      [data-role=status-bar] { position: fixed; inset: auto 0 0; height: 32px; background: white; }
    </style></head><body><main>${rgl ? '<div class="react-grid-item" style="height:200px;transition:height 1s linear">' : ''}
      <section class="widget-panel">${content}</section>${rgl ? '</div>' : ''}</main>
      <div data-role="appbar"></div><div data-role="status-bar"></div>${overlay}</body></html>`,
  }));
  await page.goto('/capture-visibility-fixture');
  return page.locator('.widget-panel');
}

test('capture visibility excludes transparent ancestors but retains visible annotated and faint readings', async ({ page }) => {
  const panel = await controlledFixture(page, `
    <h2>Controlled helper fixture</h2>
    <span style="opacity:0;position:absolute;top:-80px"><span style="opacity:1">Opaque child of transparent ancestor</span></span>
    <span style="display:none"><span>Display hidden reading</span></span>
    <span style="visibility:hidden"><span>Visibility hidden reading</span></span>
    <span style="position:absolute;clip:rect(0,0,0,0)">Fully clipped reading</span>
    <p aria-hidden="true">Visible aria-hidden reading</p>
    <p inert>Visible inert reading</p>
    <p style="opacity:0.05">Visible faint reading</p>
    <p class="sr-only">Visible class without hiding CSS</p>
    <span style="visibility:hidden"><span style="visibility:visible">Visible visibility override</span></span>`);
  await captureCataloguePanel(page, panel, test.info(), 'controlled-visible.png');
  const artifact: { snapshots: Array<{ geometry: { readings: Array<{ text: string }> } }> } =
    JSON.parse(await readFile(test.info().outputPath('controlled-visible.png.geometry.json'), 'utf8'));
  expect(artifact.snapshots).toHaveLength(3);
  for (const { geometry } of artifact.snapshots) {
    expect(geometry.readings.map(reading => reading.text)).toEqual([
      'Controlled helper fixture', 'Visible aria-hidden reading', 'Visible inert reading',
      'Visible faint reading', 'Visible class without hiding CSS', 'Visible visibility override',
    ]);
  }
});

test('capture settlement waits for a real CSS RGL height transition within the single original budget', async ({ page }) => {
  const panel = await controlledFixture(page, `
    <style>.react-grid-item .widget-panel { height:100%;min-height:0;overflow:hidden; }</style>
    <h2>Real transition helper fixture</h2>
    <button onclick="this.closest('.react-grid-item').style.height='480px'">Expand controlled panel</button>
    ${Array.from({ length: 12 }, (_, index) => `<p>Transition reading ${index}</p>`).join('')}
  `, '', true);
  await panel.getByRole('button', { name: 'Expand controlled panel' }).click();
  const before = await panel.evaluate(element => {
    const item = element.closest('.react-grid-item');
    if (!(item instanceof HTMLElement)) throw new Error('Missing controlled real RGL item');
    return { height: item.getBoundingClientRect().height, target: item.style.height };
  });
  expect(before.target).toBe('480px');
  expect(before.height, 'Regression must actually begin during native CSS transition').toBeLessThan(480);
  const start = Date.now();
  await captureCataloguePanel(page, panel, test.info(), 'controlled-real-transition.png');
  expect(Date.now() - start, 'One existing pre-capture readiness/settlement budget, not repeated8s waits').toBeLessThan(8_000);
  const artifact: {
    preCaptureBudgetMs: number;
    settlement: Array<{ geometry: { rgl: { inlineHeight: string; computedHeight: string } } }>;
    snapshots: Array<{ geometry: { panel: { height: number }; readings: Array<{ hitInsidePanel: boolean }> } }>;
  } = JSON.parse(await readFile(test.info().outputPath('controlled-real-transition.png.geometry.json'), 'utf8'));
  expect(artifact.preCaptureBudgetMs).toBe(8_000);
  expect(artifact.settlement.some(sample => sample.geometry.rgl.computedHeight !== sample.geometry.rgl.inlineHeight)).toBe(true);
  expect(artifact.settlement[artifact.settlement.length - 1].geometry.rgl.computedHeight).toBe('480px');
  for (const snapshot of artifact.snapshots) {
    expect(snapshot.geometry.panel.height).toBe(480);
    expect(snapshot.geometry.readings.every(reading => reading.hitInsidePanel)).toBe(true);
  }
});

test('capture settlement still rejects stable persistent internal overflow instead of waiting it away', async ({ page }) => {
  const panel = await controlledFixture(page, `
    <h2>Persistent internal scroll fixture</h2>
    <section aria-busy="false"><div class="@container" style="height:96px;overflow:auto">
      ${Array.from({ length: 12 }, (_, index) => `<p>Persistent clipped reading ${index}</p>`).join('')}
    </div></section>`);
  const before = await panel.locator('.\\@container').evaluate(element => ({
    height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.height);
  const start = Date.now();
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-persistent-overflow.png'))
    .rejects.toThrow(/Persistent clipped reading \d+: reading occluded at native center hit/);
  expect(Date.now() - start).toBeLessThan(8_000);
  expect(await panel.locator('.\\@container').evaluate(element => ({
    height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
  }))).toEqual(before);
});

test('capture visibility still rejects visible reading above fixed appbar', async ({ page }) => {
  const panel = await controlledFixture(page, `
    <h2>Controlled helper fixture</h2>
    <span aria-hidden="true" style="position:absolute;top:-35px">Visible off-panel reading</span>`);
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-off-panel.png'))
    .rejects.toThrow(/Visible off-panel reading: reading above visible main bounds/);
});

test('capture visibility still rejects visible reading occluded by external content', async ({ page }) => {
  const panel = await controlledFixture(page, '<h2>Controlled helper fixture</h2><p>Visible occluded reading</p>',
    '<div style="position:fixed;left:0;top:80px;width:700px;height:24px;background:black;z-index:10"></div>');
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-occluded.png'))
    .rejects.toThrow(/Visible occluded reading: reading occluded at native center hit/);
});

test('capture visibility retains nonempty visible-reading guard', async ({ page }) => {
  const panel = await controlledFixture(page, '<span style="opacity:0"><span style="opacity:1">Invisible only</span></span>');
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-empty.png'))
    .rejects.toThrow(/Capture must retain visible reading\/identity text/);
});

const tallContent = '<h2>Controlled tall helper fixture</h2>'
  + Array.from({ length: 48 }, (_, index) => `<p>Tall reading ${index}</p>`).join('');

test('tall capture covers whole natural panel and every reading using overlapping native viewport frames', async ({ page }) => {
  const panel = await controlledFixture(page, tallContent);
  await captureCataloguePanel(page, panel, test.info(), 'controlled-tall.png');
  const artifact: {
    captureMode: string;
    coverage: {
      complete: boolean; panelCoveredThrough: number; expectedReadingIds: string[]; coveredReadingIds: string[];
      panelIntervals: Array<{ from: number; to: number }>; frameArtifacts: string[];
    };
    snapshots: Array<{ geometry: { panel: { height: number }; main: { scrollTop: number } } }>;
  } = JSON.parse(await readFile(test.info().outputPath('controlled-tall.png.geometry.json'), 'utf8'));
  expect(artifact.captureMode).toContain('overlapping native-main-scroll');
  expect(artifact.coverage.complete).toBe(true);
  expect(artifact.coverage.expectedReadingIds).toHaveLength(49);
  expect([...artifact.coverage.coveredReadingIds].sort()).toEqual([...artifact.coverage.expectedReadingIds].sort());
  expect(artifact.coverage.frameArtifacts.length).toBeGreaterThanOrEqual(2);
  expect(artifact.coverage.panelIntervals[0].from).toBe(0);
  expect(artifact.coverage.panelCoveredThrough).toBe(artifact.snapshots[0].geometry.panel.height);
  for (let index = 1; index < artifact.coverage.panelIntervals.length; index++) {
    expect(artifact.coverage.panelIntervals[index].from).toBeLessThan(artifact.coverage.panelIntervals[index - 1].to);
  }
  expect(new Set(artifact.snapshots.map(snapshot => snapshot.geometry.main.scrollTop)).size).toBeGreaterThan(1);
  for (const path of artifact.coverage.frameArtifacts) {
    expect((await readFile(path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

test('tall capture still rejects a visible reading occluded inside a sampled viewport', async ({ page }) => {
  const panel = await controlledFixture(page, tallContent,
    '<div style="position:fixed;left:0;top:176px;width:700px;height:32px;background:black;z-index:10"></div>');
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-tall-occluded.png'))
    .rejects.toThrow(/reading occluded at native center hit/);
});

test('tall capture rejects absence of legal native-scroll progress instead of claiming coverage', async ({ page }) => {
  const panel = await controlledFixture(page,
    '<style>.widget-panel { position:fixed;top:40px; }</style>' + tallContent);
  await expect(captureCataloguePanel(page, panel, test.info(), 'controlled-tall-no-progress.png'))
    .rejects.toThrow(/Native main scroll must expose a new panel region/);
});

async function controlledFreshness(page: Page, effect: 'fresh' | 'missing' | 'hit' | 'chrome' | 'geometry' | 'storage') {
  const panel = await controlledFixture(page, `
    <h2>Controlled query freshness</h2>
    <span id="freshness" style="position:absolute;right:16px;top:16px">Stale · just now</span>
    <p id="reading">Actual retained content</p>
    <button id="start">Resolve controlled query</button>
    <script>
      document.querySelector('#start').onclick=()=>{
        const status=document.querySelector('#freshness');
          status.textContent='just now';
          if(${JSON.stringify(effect)}==='missing')document.querySelector('#reading').remove();
          if(${JSON.stringify(effect)}==='hit'){
            const cover=document.createElement('div');
            cover.style.cssText='position:fixed;inset:40px 0 40px;background:black;z-index:100';
            document.body.append(cover);
          }
          if(${JSON.stringify(effect)}==='chrome')document.querySelector('#reading').style.cssText='position:absolute;top:-35px';
          if(${JSON.stringify(effect)}==='geometry')document.querySelector('.widget-panel').style.height='260px';
          if(${JSON.stringify(effect)}==='storage')localStorage.setItem('teslasync-row-height-version','unexpected');
      };
    </script>`);
  const before = await captureGeometry(panel);
  await page.screenshot({ path: test.info().outputPath(`controlled-freshness-${effect}-before-action.png`), fullPage: false });
  await panel.getByRole('button', { name: 'Resolve controlled query' }).click();
  const after = await captureGeometry(panel);
  await page.screenshot({ path: test.info().outputPath(`controlled-freshness-${effect}-after-action.png`), fullPage: false });
  const path = test.info().outputPath(`controlled-freshness-${effect}-native-geometry.json`);
  await writeFile(path, JSON.stringify({
    proof: 'Deterministic real native button action and exact shared short comparison; not mid-screenshot timing',
    effect, before, after,
  }, null, 2));
  await test.info().attach(`controlled-freshness-${effect}-native-geometry.json`, { path, contentType: 'application/json' });
  return { panel, before, after };
}

test('short non-FleetPosture capture permits real native freshness-caption evolution with original fixed geometry and visible readings', async ({ page }) => {
  const { panel, before, after } = await controlledFreshness(page, 'fresh');
  expect(before.readings.map(reading => reading.text)).toContain('Stale · just now');
  expect(after.readings.map(reading => reading.text)).toContain('just now');
  expect(() => assertCatalogueReadingInventory(before, after),
    'Counterfactual old exact inventory must reject real non-age caption/glyph evolution')
    .toThrow(/exact identity\/relative geometry|non-age reading text must remain exact/);
  assertCatalogueShortCapture(before, after);
  for (const geometry of [before, after]) {
    expect(geometry.readings.every(reading => reading.hitInsidePanel)).toBe(true);
    expect(geometry.readings.map(reading => reading.text)).toContain('Actual retained content');
  }
  await captureCataloguePanel(page, panel, test.info(), 'controlled-freshness.png');
});

for (const [effect, error] of [
  ['missing', /Short capture must retain every rendered reading region/],
  ['hit', /reading occluded at native center hit/],
  ['chrome', /reading above visible main bounds/],
  ['geometry', /Screenshot capture must not reposition\/resize the widget/],
  ['storage', /Screenshot capture must not rewrite saved layout\/height\/stamp/],
] as const) {
  test(`short native freshness capture still rejects ${effect}`, async ({ page }) => {
    const { before, after } = await controlledFreshness(page, effect);
    expect(() => assertCatalogueShortCapture(before, after)).toThrow(error);
  });
}
