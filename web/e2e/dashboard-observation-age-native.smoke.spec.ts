import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { assertCatalogueShortCapture, captureCataloguePanel, captureGeometry } from './dashboardCatalogueCapture';
import { catalogueObservationSource, recordCatalogueObservationSources } from './dashboardCatalogueObservationAge';

async function nativeFixture(page: Page, mode: 'advance' | 'metric' | 'missing' | 'source' | 'occlusion') {
  recordCatalogueObservationSources(page);
  const observedAt = new Date(Date.now() - 1100).toISOString();
  let batchRequests = 0;
  await page.setViewportSize({ width: 900, height: 900 });
  await page.route('**/api/v1/vehicles', route => route.fulfill({ json: [{ id: 7, display_name: 'Controlled Aurora' }] }));
  await page.route('**/api/v1/vehicles/states', route => {
    batchRequests++;
    return route.fulfill({ json: {
      vehicles: [{ vehicle_id: 7, outcome: 'resolved', live: true, data_source: 'signal_store',
        observed_at: mode === 'source' && batchRequests > 1
          ? new Date(Date.parse(observedAt) + 1000).toISOString() : observedAt,
        state: { vehicle_id: 7, battery_level: 72 } }],
    } });
  });
  await page.route('**/observation-age-native-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>
      body{margin:0;font:16px/24px monospace}main{position:absolute;inset:40px 0;overflow:auto}
      .react-grid-item{height:${mode === 'advance' ? 240 : 1400}px;transition:height 5s linear}
      .widget-panel{height:100%;box-sizing:border-box;width:700px;padding:16px;background:white}
      h2,p,dl,dd{margin:0}span.block{display:block}
      [data-role=appbar]{position:fixed;inset:0 0 auto;height:32px;background:white}
      [data-role=status-bar]{position:fixed;inset:auto 0 0;height:32px;background:white}
    </style></head><body><main><div class="react-grid-item" data-widget-id="review-fleet-posture">
      <section class="widget-panel"><h2>Controlled native observation fixture</h2>
      <button disabled id="expand">Begin controlled capture</button>
      <div data-testid="fleet-operations-brief"><div class="pt-4"><div>
        <div class="min-w-0"><span class="mt-2 block" id="scope"></span></div>
        <a href="/vehicles/7">Open vehicle</a></div>
        <dl><div><dt>Oldest reading</dt><dd id="oldest"></dd></div></dl></div></div>
      <p id="metric">Verified 1/1</p>
      ${Array.from({ length: 45 }, (_, index) => `<p id="reading-${index}">Native reading ${index}</p>`).join('')}
      </section></div></main><div data-role="appbar"></div><div data-role="status-bar"></div>
      <script>
        let observed, changed=false;
        const main=document.querySelector('main'), button=document.querySelector('#expand');
        function renderAge(){
          const seconds=Math.max(0,Math.round((Date.now()-Date.parse(observed))/1000));
          document.querySelector('#scope').textContent='Last real observation '+seconds+'s ago';
          document.querySelector('#oldest').textContent=seconds+'s ago';
        }
        Promise.all([fetch('/api/v1/vehicles').then(r=>r.json()),
          fetch('/api/v1/vehicles/states').then(r=>r.json())]).then(([,batch])=>{
            observed=batch.vehicles[0].observed_at;renderAge();button.disabled=false;
          });
        button.onclick=()=>document.querySelector('.react-grid-item').style.height='1400px';
        main.addEventListener('scroll',async()=>{
          if(main.scrollTop<=100||changed)return;changed=true;
          if(${JSON.stringify(mode)}==='metric')document.querySelector('#metric').textContent='Verified 0/1';
          if(${JSON.stringify(mode)}==='missing')document.querySelector('#reading-30').remove();
          if(${JSON.stringify(mode)}==='source')await fetch('/api/v1/vehicles/states').then(r=>r.json());
          if(${JSON.stringify(mode)}==='occlusion'){
            const overlay=document.createElement('div');
            overlay.style.cssText='position:fixed;inset:40px 0 40px;background:black;z-index:100';
            document.body.append(overlay);
          }
          renderAge();
        });
      </script></body></html>`,
  }));
  await page.goto('/observation-age-native-fixture');
  await page.getByRole('button', { name: 'Begin controlled capture' }).click();
  return page.locator('.widget-panel');
}

async function actualAdvance(page: Page) {
  const panel = await nativeFixture(page, 'advance');
  await captureCataloguePanel(page, panel, test.info(), 'controlled-native-age.png');
  const artifact: { preCaptureBudgetMs: number; coverage: { complete: boolean };
    snapshots: Array<{ geometry: { wallTimeMs: number; readings: Array<{ observationAgeRole: string | null; text: string }> } }> } =
    JSON.parse(await readFile(test.info().outputPath('controlled-native-age.png.geometry.json'), 'utf8'));
  expect(artifact.preCaptureBudgetMs).toBe(8000);
  expect(artifact.coverage.complete).toBe(true);
  const inventories = artifact.snapshots.map(snapshot => snapshot.geometry.readings
    .filter(reading => reading.observationAgeRole).map(reading => reading.text));
  expect(new Set(inventories.map(inventory => JSON.stringify(inventory))).size,
    'Real CSS settlement/native main scroll must actually advance cached source-bound ages').toBeGreaterThan(1);
  return inventories;
}

test('controlled native baseline RED proves old exact-age inventory rejects a justified real-clock advance', async ({ page }) => {
  test.skip(process.env.E2E_OBSERVATION_AGE_RED !== '1', 'Explicit controlled baseline RED only');
  const inventories = await actualAdvance(page);
  for (const inventory of inventories) expect(inventory, 'Legacy exact-age inventory baseline').toEqual(inventories[0]);
});

test('controlled native GREEN covers source-bound real-clock age advance without discarding readings', async ({ page }) => {
  await actualAdvance(page);
});

for (const [mode, error] of [
  ['metric', /non-age reading text must remain exact/],
  ['missing', /exact identity\/relative geometry/],
  ['source', /snapshot must not change|Underlying observation instant/],
  ['occlusion', /reading occluded at native center hit/],
] as const) {
  test(`controlled native age contract rejects ${mode}`, async ({ page }) => {
    const panel = await nativeFixture(page, mode);
    await expect(captureCataloguePanel(page, panel, test.info(), `controlled-native-${mode}.png`))
      .rejects.toThrow(error);
  });
}

async function nativeDigitAdvance(page: Page, effect: string) {
  const deadline = Date.now() + 8000;
  const remaining = () => {
    const budget = deadline - Date.now();
    if (budget <= 0) throw new Error('Original8s native digit-advance budget exhausted');
    return budget;
  };
  recordCatalogueObservationSources(page);
  let observedAt = '';
  let requests = 0;
  await page.setViewportSize({ width: 900, height: 900 });
  await page.route('**/api/v1/vehicles', route => route.fulfill({ json: [{ id: 7, display_name: 'Controlled Aurora' }] }));
  await page.route('**/api/v1/vehicles/states', route => {
    requests++;
    if (!observedAt) observedAt = new Date(Date.now() - 6000).toISOString();
    return route.fulfill({ json: { vehicles: [{
      vehicle_id: 7, outcome: 'resolved', live: true, data_source: 'signal_store',
      observed_at: effect === 'source' && requests > 1
        ? new Date(Date.parse(observedAt) + 1000).toISOString() : observedAt,
      state: { vehicle_id: 7, battery_level: 72 },
    }] } });
  });
  await page.route('**/observation-age-digit-fixture', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="UTF-8"><style>
      body{margin:0;font:16px/24px Arial,sans-serif}
      main{position:absolute;inset:40px 0;overflow:auto}
      .react-grid-item{height:360px}.widget-panel{height:100%;box-sizing:border-box;width:700px;padding:16px;background:white}
      h2,p,dl,dd{margin:0}span.block{display:block}
      #oldest{height:32px;white-space:nowrap;font:24px/32px Georgia,serif}
      [data-role=appbar]{position:fixed;inset:0 0 auto;height:32px;background:white}
      [data-role=status-bar]{position:fixed;inset:auto 0 0;height:32px;background:white}
    </style></head><body><main><div class="react-grid-item" data-widget-id="review-fleet-posture">
      <section class="widget-panel"><h2>Controlled native digit advance</h2>
      <div data-testid="fleet-operations-brief"><div class="pt-4"><div>
        <div class="min-w-0"><span class="mt-2 block" id="scope"></span></div>
        <a href="/vehicles/7">Open vehicle</a></div>
        <dl><div><dt>Oldest reading</dt><dd id="oldest"></dd></div></dl></div></div>
      <p id="metric">Verified 1/1</p><button id="advance" disabled>Render observed age</button>
      </section></div></main><div data-role="appbar"></div><div data-role="status-bar"></div>
      <script>
        let observed;
        function renderAge(){
          const seconds=Math.max(0,Math.round((Date.now()-Date.parse(observed))/1000));
          document.querySelector('#scope').textContent='Last real observation '+seconds+'s ago';
          document.querySelector('#oldest').textContent=seconds+'s ago';
        }
        Promise.all([fetch('/api/v1/vehicles').then(r=>r.json()),fetch('/api/v1/vehicles/states').then(r=>r.json())])
          .then(([,batch])=>{observed=batch.vehicles[0].observed_at;renderAge();document.querySelector('#advance').disabled=false;});
        document.querySelector('#advance').onclick=async()=>{
          renderAge();
          const effect=${JSON.stringify(effect)},oldest=document.querySelector('#oldest');
          if(effect==='age-anchor')oldest.style.paddingLeft='4px';
          if(effect==='nonage-anchor')document.querySelector('#metric').style.paddingLeft='4px';
          if(effect==='container')oldest.style.width='350px';
          if(effect==='overflow')oldest.style.letterSpacing='180px';
          if(effect==='wrap'){oldest.style.whiteSpace='normal';oldest.style.width='15px';oldest.style.height='auto';}
          if(effect==='role')document.querySelector('#scope').classList.remove('block');
          if(effect==='source')await fetch('/api/v1/vehicles/states').then(r=>r.json());
          document.querySelector('#advance').dataset.completed='true';
        };
      </script></body></html>`,
  }));
  await page.goto('/observation-age-digit-fixture', { timeout: remaining() });
  const panel = page.locator('.widget-panel');
  await expect(page.locator('#oldest')).toHaveText('6s ago', { timeout: remaining() });
  const measure = async () => ({
    ...await captureGeometry(panel, remaining()),
    observationSource: await catalogueObservationSource(page, 7),
  });
  const before = await measure();
  await expect.poll(() => page.evaluate(instant => Math.round((Date.now() - Date.parse(instant)) / 1000), observedAt),
    { timeout: remaining(), intervals: [100], message: 'Native real clock must reach the next observed digit within original8s' }).toBe(7);
  await page.getByRole('button', { name: 'Render observed age' }).click({ timeout: remaining() });
  await expect(page.locator('#advance')).toHaveAttribute('data-completed', 'true', { timeout: remaining() });
  const after = await measure();
  const path = test.info().outputPath(`controlled-digit-${effect}-native-geometry.json`);
  await writeFile(path, JSON.stringify({
    proof: 'Real Date.now observation6->7 native action; exact shared application short comparison, not mid-screenshot timing',
    preCaptureBudgetMs: 8000, before, after,
  }, null, 2));
  await test.info().attach('controlled-digit-native-geometry.json', { path, contentType: 'application/json' });
  return { before, after };
}

test('native source-bound6-to7 digit advance preserves measured layout while intrinsic glyph width changes', async ({ page }) => {
  const { before, after } = await nativeDigitAdvance(page, 'advance');
  const first = before.readings.find(reading => reading.observationAgeRole === 'oldest');
  const next = after.readings.find(reading => reading.observationAgeRole === 'oldest');
  expect(first?.text).toBe('6s ago');
  expect(next?.text).toBe('7s ago');
  expect(next?.relativeRight, 'Native proportional digits must actually exercise intrinsic right-extent evolution')
    .not.toBe(first?.relativeRight);
  assertCatalogueShortCapture(before, after);
});

for (const [effect, error] of [
  ['age-anchor', /exact identity\/relative geometry/],
  ['nonage-anchor', /exact identity\/relative geometry/],
  ['container', /containing layout must remain exact/],
  ['overflow', /reading occluded|Full source-bound age glyph|containing layout/],
  ['wrap', /Short capture must retain every rendered reading region/],
  ['role', /exact identity\/relative geometry/],
  ['source', /Observation\/vehicle\/source snapshot|Underlying observation instant/],
] as const) {
  test(`native source-bound digit advance rejects ${effect}`, async ({ page }) => {
    const { before, after } = await nativeDigitAdvance(page, effect);
    if (effect === 'wrap') {
      expect(before.readings).toHaveLength(7);
      expect(after.readings).toHaveLength(8);
    }
    expect(() => assertCatalogueShortCapture(before, after)).toThrow(error);
  });
}
