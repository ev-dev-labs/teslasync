import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import sharp from 'sharp';
import { AXE_DEBT_BY_ROUTE } from './axeBaseline';
import { isSensitiveRun, resolveStorageState } from './configEnv';
import { isSsePath, resolveApiFixture, waitForNoVisibleActivity } from './mockApi';
import {
  QUALITY_ROUTES,
} from './routeRegistry';
import { CAPTURE_VIEWPORTS, captureRoutes, clearCaptureImages, findClippedBottomNavigationLabels, findClippedWorkspaceRangeLabels, findHorizontalScrollRegions, findOverlappingWorkspaceInputActions, findSmallBodyText, findSmallTouchTargets, findSplitBottomNavigationWords, findSplitOperationalMetricWords, selectCaptureRoutes, writeCaptureImages } from './design-packs-capture';

test('design pack captures cover registered application routes with unique filenames', () => {
  const routes = captureRoutes();
  expect(routes.length).toBeGreaterThan(200);
  expect(new Set(routes.map(route => route.file)).size).toBe(routes.length);
  expect(routes).toEqual(expect.arrayContaining([
    expect.objectContaining({ template: '/', file: 'dashboard' }),
    expect.objectContaining({ template: '/drives/:id', path: '/drives/412' }),
    expect.objectContaining({ template: '/vehicles/:id', path: '/vehicles/7' }),
  ]));
  expect(routes.some(route => route.template === '/watch')).toBe(false);
  expect(selectCaptureRoutes('dashboard,/drives').map(route => route.file)).toEqual(['dashboard', 'drives']);
  expect(() => selectCaptureRoutes('not-a-page')).toThrow('Unknown design pack capture page');
  expect(CAPTURE_VIEWPORTS.map(({ width, height }) => [width, height])).toEqual([
    [360, 800], [390, 844], [430, 932], [768, 1024], [1440, 900],
  ]);
});

test('capture image failures do not leave partial evidence', async () => {
  const directory = test.info().outputPath('capture-artifacts');
  await mkdir(directory, { recursive: true });
  const viewportPath = resolve(directory, 'page.png');
  const fullPath = resolve(directory, 'page--full.png');
  const frame = await sharp({
    create: { width: 4, height: 3, channels: 4, background: '#112233' },
  }).png().toBuffer();

  await writeCaptureImages(viewportPath, fullPath, [frame, frame]);
  expect(await readFile(viewportPath)).toEqual(frame);
  expect(await sharp(fullPath).metadata()).toMatchObject({ width: 4, height: 6 });

  await writeCaptureImages(viewportPath, fullPath, [frame]);
  await expect(access(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

  await expect(writeCaptureImages(viewportPath, resolve(directory, 'missing', 'full.png'), [frame, frame]))
    .rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(viewportPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('ordinary captures preserve separate interactive-state evidence', async () => {
  const directory = test.info().outputPath('capture-state-preservation');
  await mkdir(directory, { recursive: true });
  const viewportPath = resolve(directory, 'page.png');
  const fullPath = resolve(directory, 'page--full.png');
  const tablePath = resolve(directory, 'page--table.png');
  const supportPath = resolve(directory, 'page--support.png');
  const image = Buffer.from('existing evidence');
  await Promise.all([viewportPath, fullPath, tablePath, supportPath].map(path => writeFile(path, image)));

  await clearCaptureImages(viewportPath, fullPath, tablePath, false, [supportPath]);
  await expect(access(viewportPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(tablePath)).toEqual(image);
  expect(await readFile(supportPath)).toEqual(image);

  await clearCaptureImages(viewportPath, fullPath, tablePath, true, [supportPath]);
  await expect(access(tablePath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(supportPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('mobile captures detect visible nested scrolling without flagging clipped content or text inputs', async ({ page }) => {
  await page.setContent(`
    <div id="scrolling" style="width: 100px; overflow-x: auto"><div style="width: 200px">Reading</div></div>
    <div id="clipped" style="width: 100px; overflow-x: hidden"><div style="width: 200px">Reading</div></div>
    <div style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0)">
      <div id="screen-reader-scroll" style="width: 100px; overflow-x: auto"><div style="width: 200px">Alternative</div></div>
    </div>
    <div id="static-clip" style="position: static; clip: rect(0, 0, 0, 0); width: 100px; overflow-x: auto"><div style="width: 200px">Visible</div></div>
    <input style="width: 100px" value="A deliberately long editable field value">
  `);
  expect(await findHorizontalScrollRegions(page)).toEqual([
    expect.objectContaining({ id: 'scrolling', clientWidth: 100, scrollWidth: 200 }),
    expect.objectContaining({ id: 'static-clip', clientWidth: 100, scrollWidth: 200 }),
  ]);
});

test('capture readiness ignores clipped activity but waits for visible loading', async ({ page }) => {
  await page.setContent(`
    <main style="height:100px;overflow:auto">
      <div style="height:160px"></div>
      <div id="loading" data-testid="chart-block-skeleton" style="height:30px">Loading chart</div>
    </main>
  `);
  await waitForNoVisibleActivity(page);
  await page.locator('main').evaluate(element => { element.scrollTop = 70; });
  await page.evaluate(() => { setTimeout(() => document.getElementById('loading')?.remove(), 500); });
  await waitForNoVisibleActivity(page);
  expect(await page.locator('#loading').count()).toBe(0);
});

test('mobile touch audit reports visible small targets and respects labelled inputs', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`
    <button id="large" style="width:44px;height:44px">OK</button>
    <button id="small" style="width:30px;height:30px">No</button>
    <label id="label" style="display:inline-flex;width:44px;height:44px">
      <input type="checkbox" style="width:12px;height:12px"> Mark
    </label>
    <button id="hidden" style="display:none;width:20px;height:20px">Hidden</button>
    <button id="outside" style="position:absolute;left:500px;width:20px;height:20px">Outside</button>
    <details><summary id="small-summary" style="display:block;width:30px;height:30px">More</summary></details>
  `);
  expect(await findSmallTouchTargets(page)).toEqual([
    expect.objectContaining({ id: 'small', width: 30, height: 30 }),
    expect.objectContaining({ id: 'small-summary', width: 30, height: 30 }),
  ]);
});

test('mobile navigation audit checks rendered text rather than only control boxes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`
    <nav data-role="bottom-tab-bar" style="position:fixed;inset:auto 0 0;height:64px;overflow:hidden">
      <button style="position:absolute;left:0;bottom:0;width:120px;height:64px">
        <span class="sidenav-tab-label">Visible</span>
      </button>
      <button style="position:absolute;left:120px;bottom:0;width:120px;height:64px">
        <span class="sidenav-tab-label" style="position:absolute;top:58px;left:0;font:16px/20px sans-serif">Clipped</span>
      </button>
      <button style="position:absolute;left:240px;bottom:0;width:44px;height:64px">
        <span class="sidenav-tab-label" style="display:block;overflow-wrap:anywhere;font:16px/20px sans-serif">Charging</span>
      </button>
      <button style="display:none"><span class="sidenav-tab-label">Hidden</span></button>
    </nav>
  `);
  expect(await findClippedBottomNavigationLabels(page)).toEqual([
    expect.objectContaining({ label: 'Clipped' }),
  ]);
  expect(await findSplitBottomNavigationWords(page)).toEqual([
    expect.objectContaining({ label: 'Charging', lines: expect.any(Number) }),
  ]);
});

test('phone text diagnostics detect clipped workspace ranges and words split inside metric labels', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`
    <div data-role="mobile-workspace-controls">
      <button data-active-range="Last 7 days" style="width:60px">
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Last 7 days</span>
      </button>
      <button data-active-range="Today" style="width:100px"><span>Today</span></button>
    </div>
    <div data-operational-metric-list>
      <span data-app-part="metric-label" style="display:block;width:45px;overflow-wrap:anywhere">consumption</span>
      <span data-app-part="metric-label" style="display:block;width:110px;overflow-wrap:anywhere">Drive consumption</span>
      <span data-app-part="metric-label" style="display:none;width:1px">Hidden</span>
    </div>
  `);
  expect(await findClippedWorkspaceRangeLabels(page)).toEqual([
    expect.objectContaining({ label: 'Last 7 days' }),
  ]);
  expect(await findSplitOperationalMetricWords(page)).toEqual([
    expect.objectContaining({ label: 'consumption', word: 'consumption' }),
  ]);
});

test('phone workspace diagnostics detect controls over the vehicle text area', async ({ page }) => {
  await page.setContent(`
    <div data-role="mobile-workspace-controls">
      <div style="position:relative;width:160px">
        <input data-app-part="field-control" value="Aurora" style="box-sizing:border-box;width:160px;height:44px;padding-right:36px">
        <div style="position:absolute;right:8px;top:0"><button style="width:44px;height:44px"></button></div>
      </div>
    </div>
  `);
  expect(await findOverlappingWorkspaceInputActions(page)).toEqual([
    expect.objectContaining({ value: 'Aurora', overlap: 16 }),
  ]);
});

test('Classic phone metrics and workspace range remain readable as text scales', async ({ page }) => {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 8px; --density-pad-y: 8px; }
      body { margin: 0; font: 16px Arial, sans-serif; }
      [data-role="mobile-workspace-controls"] { display: flex; width: calc(100vw - 32px); gap: 8px; }
      [data-active-range] { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
        width: 160px; max-width: 160px; height: 44px; padding: 0 8px; border: 0; font: inherit; }
      [data-active-range] svg { flex: none; width: 16px; height: 16px; }
      [data-active-range] span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      [data-vehicle] { flex: 1; min-width: 0; height: 44px; }
      [data-vehicle] input { box-sizing: border-box; width: 100%; height: 44px; padding-inline: 40px 36px; font: inherit; }
      [data-vehicle] [data-actions] { position: absolute; inset-inline-end: 8px; top: 0; display: flex; gap: 4px; }
      [data-vehicle] [data-actions] button { width: 44px; height: 44px; }
      [data-operational-metric-list] { width: calc(100vw - 64px); }
      [data-app-part~="metric-label"] { display: block; }
    </style>
    <div data-role="mobile-workspace-controls" data-app-design-owner="pack-classic">
      <button data-active-range="Last 7 days" data-app-part="button" data-app-design-owner="pack-classic">
        <svg></svg><span data-app-design-owner="pack-classic">Last 7 days</span><svg></svg>
      </button>
      <div data-vehicle data-role="vehicle-picker-control">
        <div style="position:relative;width:100%">
          <input data-app-part="field-control" data-app-design-owner="pack-classic" value="Aurora">
          <div data-actions><button></button></div>
        </div>
      </div>
    </div>
    <div data-operational-metric-list data-columns="2" data-app-design-owner="pack-classic">
      <div data-operational-metric-bank data-app-part="metric-grid" data-app-design-owner="pack-classic">
        <div data-app-part="metric" data-app-design-owner="pack-classic">
          <span data-app-part="metric-label" data-app-design-owner="pack-classic">Drive consumption</span>
        </div>
        <div data-app-part="metric" data-app-design-owner="pack-classic">
          <span data-app-part="metric-label" data-app-design-owner="pack-classic">Efficiency</span>
        </div>
      </div>
    </div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const direction of ['ltr', 'rtl'] as const) {
      await page.locator('html').evaluate((element, value) => { element.dir = value; }, direction);
      for (const width of [360, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const scale of [0.85, 1.35]) {
          await page.locator('html').evaluate((element, value) => element.style.setProperty('--font-scale', String(value)), scale);
          for (const label of ['Last 7 days', 'Full year 2025 · Compare', 'AnExceptionallyLongRangeName']) {
            await page.locator('[data-active-range] span').evaluate((element, text) => { element.textContent = text; }, label);
            const context = `${forcedColors}, ${direction}, ${width}, ${scale}, ${label}`;
            expect(await findClippedWorkspaceRangeLabels(page), context).toEqual([]);
            expect(await findOverlappingWorkspaceInputActions(page), context).toEqual([]);
            expect(await findSplitOperationalMetricWords(page), context).toEqual([]);
            const geometry = await page.evaluate(() => {
              const row = document.querySelector<HTMLElement>('[data-role="mobile-workspace-controls"]')!;
              const trigger = document.querySelector<HTMLElement>('[data-active-range]')!.getBoundingClientRect();
              const vehicle = document.querySelector<HTMLElement>('[data-vehicle]')!.getBoundingClientRect();
              const input = document.querySelector<HTMLInputElement>('[data-vehicle] input')!;
              const inputStyle = getComputedStyle(input);
              const canvas = document.createElement('canvas').getContext('2d')!;
              canvas.font = inputStyle.font;
              const grid = document.querySelector<HTMLElement>('[data-operational-metric-list]')!;
              return {
                trigger: { width: trigger.width, height: trigger.height, left: trigger.left, right: trigger.right },
                vehicle: { width: vehicle.width, left: vehicle.left, right: vehicle.right },
                inputAvailable: input.getBoundingClientRect().width - parseFloat(inputStyle.borderLeftWidth)
                  - parseFloat(inputStyle.borderRightWidth) - parseFloat(inputStyle.paddingLeft) - parseFloat(inputStyle.paddingRight),
                inputText: canvas.measureText(input.value).width,
                rowOverflow: row.scrollWidth - row.clientWidth,
                gridOverflow: grid.scrollWidth - grid.clientWidth,
                columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
              };
            });
            expect(geometry.trigger.width, context).toBeGreaterThanOrEqual(44);
            expect(geometry.trigger.height, context).toBeGreaterThanOrEqual(44);
            expect(geometry.vehicle.width, context).toBeGreaterThanOrEqual(44);
            expect(direction === 'ltr' ? geometry.trigger.right <= geometry.vehicle.left : geometry.vehicle.right <= geometry.trigger.left, context).toBe(true);
            expect(geometry.inputAvailable - 1, `${context}: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(geometry.inputText);
            expect(geometry.rowOverflow, context).toBeLessThanOrEqual(1);
            expect(geometry.gridOverflow, context).toBeLessThanOrEqual(1);
            expect(geometry.columns, context).toBe(scale < 1 ? 2 : 1);
          }
        }
      }
      await page.locator('[data-actions]').evaluate((actions) => {
        const second = actions.firstElementChild!.cloneNode(true) as HTMLElement;
        actions.append(second);
      });
      expect(await findOverlappingWorkspaceInputActions(page), `${forcedColors}, ${direction}, two actions`).toEqual([]);
      await page.locator('[data-actions] button').last().evaluate((element) => element.remove());
    }
  }
});

test('Classic navigation keeps labels, touch targets and shell offsets visible at phone scales', async ({ page }) => {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 8px; --density-pad-y: 8px; --shell-tab-bar-height: 64px; }
      html[data-tab-bar="off"] { --shell-tab-bar-height: 0px; }
      body { margin: 0; font-family: Arial, sans-serif; letter-spacing: var(--tracking, 0em); }
      button { align-items: center; justify-content: center; border: 0; font: inherit; font-weight: 500; letter-spacing: inherit; }
      .safe-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }
      [data-role="status-bar"] { position: fixed; bottom: var(--shell-tab-bar-height); height: 44px; }
    </style>
    <footer data-role="status-bar"></footer>
    <nav data-role="bottom-tab-bar" data-app-part="navigation" data-app-design-owner="pack-classic" class="sidenav-phone-tabs safe-bottom">
      ${['Home', 'Vehicles', 'Driving', 'Charging', 'More'].map(label => `
        <button data-app-part="button nav-item" data-app-design-owner="pack-classic" class="sidenav-phone-tab">
          <span class="nav-phone-icon" data-app-design-owner="pack-classic" style="display:inline-flex;flex:none"><svg data-app-design-owner="pack-classic" width="22" height="22"></svg></span>
          <span class="sidenav-tab-label" data-app-design-owner="pack-classic">${label}</span>
        </button>
      `).join('')}
    </nav>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'layout', 'sidebar', 'sidenav.css'), 'utf8') });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const direction of ['ltr', 'rtl']) {
      await page.locator('html').evaluate((element, dir) => element.setAttribute('dir', dir), direction);
      for (const width of [360, 390, 400, 401, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const scale of [0.85, 1, 1.35]) {
          for (const tracking of ['-0.01em', '0em', '0.03em']) {
            for (const safe of [0, 24]) {
              const context = `${forcedColors}, ${direction}, ${width}, ${scale}, ${tracking}, inset ${safe}`;
              await page.locator('html').evaluate((element, values) => {
                element.style.setProperty('--font-scale', String(values.scale));
                element.style.setProperty('--tracking', values.tracking);
                element.style.setProperty('--app-phone-tab-safe', `${values.safe}px`);
              }, { scale, tracking, safe });
              expect(await findClippedBottomNavigationLabels(page), context).toEqual([]);
              expect(await findSmallTouchTargets(page), context).toEqual([]);
              const geometry = await page.evaluate(() => {
                const nav = document.querySelector<HTMLElement>('[data-role="bottom-tab-bar"]')!;
                const status = document.querySelector<HTMLElement>('[data-role="status-bar"]')!;
                const labels = Array.from(nav.querySelectorAll<HTMLElement>('.sidenav-tab-label'));
                const wrapped = labels.flatMap(label => {
                  const range = document.createRange();
                  range.selectNodeContents(label);
                  const lines = Array.from(range.getClientRects()).filter(rect => rect.width > 0);
                  return lines.length > 1
                    ? [{ label: label.textContent, button: label.parentElement?.getBoundingClientRect().width, lines: lines.map(rect => ({ width: rect.width, top: rect.top })) }] : [];
                });
                return {
                  nav: nav.getBoundingClientRect().toJSON(),
                  status: status.getBoundingClientRect().toJSON(),
                  padding: parseFloat(getComputedStyle(nav).paddingBottom),
                  tracking: getComputedStyle(labels[0]).letterSpacing === 'normal'
                    ? 0 : parseFloat(getComputedStyle(labels[0]).letterSpacing),
                  wrapped,
                };
              });
              expect(geometry.wrapped, context).toEqual([]);
              expect(geometry.tracking, context).toBeCloseTo(parseFloat(tracking) * 16, 2);
              expect(geometry.padding).toBe(safe);
              expect(geometry.nav.bottom).toBe(844);
              expect(geometry.status.bottom).toBeCloseTo(geometry.nav.top, 0);
            }
          }
        }
      }
    }
  }
  await page.locator('html').evaluate(element => element.setAttribute('data-tab-bar', 'off'));
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--shell-tab-bar-height').trim())).toBe('0px');
});

test('mobile text audit reports visible small prose without flagging hidden or off-screen text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(`
    <p id="small" style="font-size:14px">Small paragraph</p>
    <span id="small-role" data-typography-role="bodySm" style="font-size:15px">Small body role</span>
    <span id="small-role-class" class="text-sm text-[var(--text-secondary)]" style="font-size:15px">Small body role class</span>
    <p id="caption" data-typography-role="caption" style="font-size:12px">Short metadata</p>
    <p id="feedback" data-app-part="feedback-title" style="font-size:14px">Feedback title</p>
    <div data-app-part="list-row">
      <div data-app-part="history-route" id="route" style="font-size:12px">Route</div>
      <div data-history-primary><span id="primary" style="font-size:14px">Time</span></div>
      <div data-app-metric-grid="inline" id="metrics" style="font-size:12px">Distance</div>
    </div>
    <label id="field-label" data-app-part="field-label" style="font-size:14px">Search</label>
    <input id="field-input" data-app-part="field-control" placeholder="Search drives" style="font-size:14px" />
    <button id="field-button" data-app-part="button" style="font-size:14px">Apply</button>
    <div data-mobile-table><span id="card-value" class="mgr-meta-value" style="font-size:14px">42 kWh</span></div>
    <div data-app-part="dialog"><dl><div data-app-part="table-cell"><dt id="detail-label" style="font-size:12px">Energy</dt><dd id="detail-value" style="font-size:12px"><span id="detail-span" style="font-size:12px">42 kWh</span></dd></div></dl></div>
    <div data-operational-metric-list><span id="metric-label" data-app-part="metric-label" style="font-size:12px">Total distance</span></div>
    <a id="link" href="#details" style="font-size:12px">Details</a>
    <footer data-role="status-bar"><a href="#status" style="font-size:12px">API status</a></footer>
    <p id="large" style="font-size:16px">Readable paragraph</p>
    <p id="hidden" style="display:none;font-size:12px">Hidden paragraph</p>
    <p id="outside" style="position:absolute;left:500px;font-size:12px">Outside paragraph</p>
  `);
  expect(await findSmallBodyText(page)).toEqual([
    expect.objectContaining({ id: 'small', size: 14 }),
    expect.objectContaining({ id: 'small-role', size: 15 }),
    expect.objectContaining({ id: 'small-role-class', size: 15 }),
    expect.objectContaining({ id: 'feedback', size: 14 }),
    expect.objectContaining({ id: 'route', size: 12 }),
    expect.objectContaining({ id: 'primary', size: 14 }),
    expect.objectContaining({ id: 'metrics', size: 12 }),
    expect.objectContaining({ id: 'field-label', size: 14 }),
    expect.objectContaining({ id: 'field-input', size: 14 }),
    expect.objectContaining({ id: 'field-button', size: 14 }),
    expect.objectContaining({ id: 'card-value', size: 14 }),
    expect.objectContaining({ id: 'detail-label', size: 12 }),
    expect.objectContaining({ id: 'detail-value', size: 12 }),
    expect.objectContaining({ id: 'detail-span', size: 12 }),
    expect.objectContaining({ id: 'metric-label', size: 12 }),
    expect.objectContaining({ id: 'link', size: 12 }),
  ]);
});

test('Classic mobile grid keeps row and detail text readable without clipping', async ({ page }) => {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 8px; --density-pad-y: 8px; }
      body { margin: 0; font-family: Arial, sans-serif; }
      .mgr-title, .mgr-primary, .mgr-meta-label, .mgr-meta-value { display: block; overflow: hidden; white-space: nowrap; }
      dt, dd, dd span { font-size: 12px; }
    </style>
    <div class="mgr-host" style="width:100%">
      <div class="mgr-mobile" data-mobile-table data-app-design-owner="pack-classic">
        <div class="mgr-card" data-app-design-owner="pack-classic">
          <span class="mgr-title text-sm" data-app-design-owner="pack-classic">November charging session</span>
          <span class="mgr-primary text-sm" data-app-design-owner="pack-classic">42.00 kWh</span>
          <span class="mgr-meta-label text-sm" data-app-design-owner="pack-classic">SuperchargerSessionDetails</span>
          <span class="mgr-meta-value text-sm" data-app-design-owner="pack-classic">30% to 72%</span>
        </div>
      </div>
    </div>
    <div data-app-part="dialog"><dl><div data-app-part="table-cell"><dt data-app-design-owner="pack-classic">Energy</dt><dd data-app-design-owner="pack-classic"><span data-app-design-owner="pack-classic">42 kWh</span></dd></div></dl></div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'mobile-grid-reference', 'mobile-grid-reference.css'), 'utf8') });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  await page.addStyleTag({ content: '.text-sm { font-size: 14px; }' });
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const scale of [0.85, 1.35]) {
        await page.locator('html').evaluate((element, value) => element.style.setProperty('--font-scale', String(value)), scale);
        const measurements = await page.locator('.mgr-card span, dt, dd, dd span').evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          return {
            text: element.textContent,
            size: parseFloat(style.fontSize),
            overflow: element.scrollWidth - element.clientWidth,
          };
        }));
        for (const item of measurements) {
          expect(item.size, `${forcedColors}, ${width}, ${scale}: ${item.text}`).toBeGreaterThanOrEqual(15.9);
          expect(item.overflow, `${forcedColors}, ${width}, ${scale}: ${item.text}`).toBeLessThanOrEqual(1);
        }
      }
    }
  }
});

test('Classic phone prose respects its minimum without resizing protected widget content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <style>
      .text-sm { font-size: 14px; }
      .text-xs { font-size: 12px; }
      .widget-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 180px; }
      .brief-list, .brief-bank { display: flex; }
      .page-actions { border-inline-start: 3px solid CanvasText; }
    </style>
    <p id="page-body" class="text-sm text-[var(--text-secondary)]" data-app-design-owner="pack-classic">Page</p>
    <label id="page-field-label" class="text-sm" data-app-part="field-label" data-app-design-owner="pack-classic">Search</label>
    <input id="page-field" class="text-sm" data-app-part="field-control" data-app-design-owner="pack-classic" />
    <button id="page-button" class="text-sm" data-app-part="button" data-app-design-owner="pack-classic">Apply</button>
    <div id="page-actions" class="page-actions" data-app-part="page-actions" data-app-design-owner="pack-classic"></div>
    <div data-operational-brief-compact="true">
      <div id="page-brief" class="brief-list" data-operational-metric-list data-app-design-owner="pack-classic">
        <div id="page-bank" class="brief-bank" role="list" data-app-part="metric-grid" data-operational-metric-bank data-app-design-owner="pack-classic">
          <span role="listitem"><span id="page-brief-label" class="text-xs" data-app-part="metric-label" data-app-design-owner="pack-classic">Total</span><span id="page-brief-value" data-operational-value data-app-design-owner="pack-classic">One</span></span><span role="listitem">Two</span>
        </div>
      </div>
    </div>
    <div data-app-part="list-row" data-app-design-owner="pack-classic">
      <div data-history-primary data-app-design-owner="pack-classic">
        <span id="history-primary" class="text-sm" data-app-design-owner="pack-classic">Time</span>
      </div>
      <div id="history-route" class="text-xs" data-app-part="history-route" data-app-design-owner="pack-classic">Route</div>
      <div id="history-metrics" class="text-xs" data-app-metric-grid="inline" data-app-design-owner="pack-classic">
        <span id="history-metric" class="text-xs" data-app-metric="inline" data-app-design-owner="pack-classic">Distance</span>
      </div>
    </div>
    <div id="page-tooltip" data-app-part="chart-tooltip" data-app-design-owner="pack-classic">
      <p id="tooltip-label" class="text-xs" data-chart-tooltip-label data-app-design-owner="pack-classic">Date</p>
      <span id="tooltip-value" class="text-xs" data-chart-tooltip-value data-app-design-owner="pack-classic">
        Value <span id="tooltip-unit" class="text-xs" data-app-design-owner="pack-classic">kWh</span>
      </span>
      <p id="tooltip-copy" class="text-xs" data-chart-tooltip-copy data-app-design-owner="pack-classic">Recorded values</p>
    </div>
    <svg><path id="chart-cursor" class="recharts-rectangle recharts-tooltip-cursor" fill="#ccc" data-app-design-owner="pack-classic"></path></svg>
    <div data-widget-pack="classic">
      <p id="widget-body" class="text-sm text-[var(--text-secondary)]" data-app-design-owner="pack-classic">Widget</p>
      <input id="widget-field" class="text-sm" data-app-part="field-control" data-app-design-owner="pack-classic" />
      <div data-testid="widget-body"></div><div><a href="#details" id="widget-footer-link" data-app-design-owner="pack-classic">Details</a></div>
      <div id="widget-brief" class="brief-list" data-operational-metric-list data-app-design-owner="pack-classic">
        <div id="widget-bank" class="brief-bank" data-app-part="metric-grid" data-operational-metric-bank data-app-design-owner="pack-classic"><span id="widget-brief-label" class="text-xs" data-app-part="metric-label" data-app-design-owner="pack-classic">One</span><span>Two</span></div>
      </div>
      <div id="widget-grid" class="widget-grid" data-app-part="metric-grid" data-app-design-owner="pack-classic"><span>One</span><span>Two</span></div>
      <div data-app-part="chart-tooltip" data-app-design-owner="pack-classic">
        <p id="widget-tooltip" class="text-xs" data-chart-tooltip-label data-app-design-owner="pack-classic">Date</p>
      </div>
      <svg><path id="widget-cursor" class="recharts-rectangle recharts-tooltip-cursor" fill="#ccc" data-app-design-owner="pack-classic"></path></svg>
    </div>
    <div data-widget-pack="classic" data-app-design-preserve>
      <p id="protected-body" class="text-sm text-[var(--text-secondary)]">Protected widget</p>
    </div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
    element.style.setProperty('--font-scale', '0.85');
    element.style.setProperty('--surface-2', '#123456');
    element.style.setProperty('--elevation-2', '0px 2px 6px rgba(0, 0, 0, 0.4)');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  await expect(page.locator('#page-body')).toHaveCSS('font-size', '16px');
  for (const id of ['page-field-label', 'page-field', 'page-button']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('font-size', '16px');
  }
  await expect(page.locator('#page-actions')).toHaveCSS('border-left-width', '0px');
  await expect(page.locator('#page-brief')).toHaveCSS('display', 'grid');
  await expect(page.locator('#page-bank')).toHaveCSS('display', 'contents');
  await expect(page.locator('#page-brief-label')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#page-brief-value')).toHaveCSS('font-size', '17px');
  await expect(page.locator('#page-brief').getByRole('list')).toHaveCount(1);
  await expect(page.locator('#page-brief').getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('#history-primary')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#history-route')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#history-metrics')).toHaveCSS('font-size', '12px');
  await expect(page.locator('#history-metric')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#tooltip-label')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#tooltip-value')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#tooltip-unit')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#tooltip-copy')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#page-tooltip')).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await expect(page.locator('#page-tooltip')).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.4) 0px 2px 6px 0px');
  await expect(page.locator('#chart-cursor')).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect(page.locator('#widget-cursor')).toHaveCSS('fill', 'rgb(204, 204, 204)');
  await expect(page.locator('#widget-body')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#widget-field')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#widget-footer-link')).toHaveCSS('min-height', '44px');
  await expect(page.locator('#protected-body')).toHaveCSS('font-size', '14px');
  await expect(page.locator('#widget-brief')).toHaveCSS('display', 'flex');
  await expect(page.locator('#widget-bank')).toHaveCSS('display', 'flex');
  await expect(page.locator('#widget-brief-label')).toHaveCSS('font-size', '12px');
  await expect(page.locator('#widget-grid')).toHaveCSS('grid-template-columns', '90px 90px');
  await expect(page.locator('#widget-tooltip')).toHaveCSS('font-size', '12px');
  await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '1.35'));
  await expect(page.locator('#tooltip-label')).toHaveCSS('font-size', '21.6px');
  await expect(page.locator('#tooltip-copy')).toHaveCSS('font-size', '21.6px');
  await expect(page.locator('#page-field')).toHaveCSS('font-size', '21.6px');
  await expect(page.locator('#widget-tooltip')).toHaveCSS('font-size', '12px');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '0.85'));
  await expect(page.locator('#page-body')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#page-field')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#page-actions')).toHaveCSS('border-left-width', '3px');
  await expect(page.locator('#page-brief')).toHaveCSS('display', 'grid');
  await expect(page.locator('#page-bank')).toHaveCSS('display', 'contents');
  await expect(page.locator('#page-brief-value')).toHaveCSS('font-size', '17px');
  await expect(page.locator('#page-brief-label')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#page-brief').getByRole('list')).toHaveCount(1);
  await expect(page.locator('#page-brief').getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('#history-primary')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#tooltip-copy')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#widget-body')).toHaveCSS('font-size', '16px');
  await expect(page.locator('#protected-body')).toHaveCSS('font-size', '14px');
  await expect(page.locator('#widget-brief')).toHaveCSS('display', 'flex');
  await expect(page.locator('#widget-bank')).toHaveCSS('display', 'flex');
  await expect(page.locator('#widget-brief-label')).toHaveCSS('font-size', '12px');
  await expect(page.locator('#widget-grid')).toHaveCSS('grid-template-columns', '90px 90px');
});

test('Classic enlarges phone refresh targets without changing protected or read-only dots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <style>
      .original { box-sizing: border-box; padding: 0; border: 0; width: 28px !important; height: 28px !important; min-width: 0 !important; min-height: 0 !important; }
      [class~="!w-2.5"] { width: 10px !important; }
    </style>
    <button id="refresh" class="original !h-7" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic"></button>
    <button id="busy" class="original !h-7" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic" aria-disabled="true" aria-busy="true"></button>
    <button id="readonly" class="original !h-7" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic" disabled></button>
    <button id="edge" class="original !h-7 !w-2.5" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic"></button>
    <div data-widget-pack="classic"><div data-role="widget-shell-header"><button id="widget-refresh" class="original !h-7 !w-2.5" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic"></button></div></div>
    <div data-widget-pack="classic" data-app-design-preserve><div data-role="widget-shell-header"><button id="protected-refresh" class="original !h-7 !w-2.5" data-app-part="status" data-app-icon-only="true"></button></div></div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  for (const id of ['refresh', 'busy']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('width', '44px');
    await expect(page.locator(`#${id}`)).toHaveCSS('height', '44px');
  }
  await expect(page.locator('#readonly')).toHaveCSS('width', '28px');
  await expect(page.locator('#edge')).toHaveCSS('width', '10px');
  await expect(page.locator('#widget-refresh')).toHaveCSS('width', '44px');
  await expect(page.locator('#protected-refresh')).toHaveCSS('width', '10px');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#refresh')).toHaveCSS('width', '44px');
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('#refresh')).toHaveCSS('width', '28px');
});

test.describe('Classic touch tablet controls', () => {
  test.use({ hasTouch: true });

  test('keeps actionable controls reachable without resizing widget or read-only dots', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(`
      <style>
        .small { box-sizing: border-box; padding: 0; border: 0; width: 28px !important; height: 28px !important; }
        .dot { min-width: 0 !important; min-height: 0 !important; }
        input { width: 200px; height: 36px; }
      </style>
      <button id="action" class="small" data-app-part="button" data-app-design-owner="pack-classic"></button>
      <a id="link" class="small" href="#content" data-app-design-owner="pack-classic" style="display:inline-flex"></a>
      <div>
        <input id="field" data-app-part="field-control" data-app-design-owner="pack-classic" />
        <div>
          <button data-app-part="button" data-app-design-owner="pack-classic"></button>
          <button data-app-part="button" data-app-design-owner="pack-classic"></button>
        </div>
      </div>
      <button id="refresh" class="small dot !h-7" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic"></button>
      <button id="readonly" class="small dot !h-7" data-app-part="status" data-app-icon-only="true" data-app-design-owner="pack-classic" disabled></button>
      <div data-widget-pack="classic"><button id="widget-action" class="small" data-app-part="button" data-app-design-owner="pack-classic"></button></div>
    `);
    await page.locator('html').evaluate(element => {
      element.setAttribute('data-app-design-pack', 'classic');
      element.setAttribute('data-app-design-owner', 'pack-classic');
      element.style.setProperty('--density-gap', '6px');
    });
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
    for (const id of ['action', 'link', 'refresh']) {
      await expect(page.locator(`#${id}`)).toHaveCSS('width', '44px');
      await expect(page.locator(`#${id}`)).toHaveCSS('height', '44px');
    }
    await expect(page.locator('#field')).toHaveCSS('height', '44px');
    await expect(page.locator('#field')).toHaveCSS('padding-right', '100px');
    await expect(page.locator('#readonly')).toHaveCSS('width', '28px');
    await expect(page.locator('#widget-action')).toHaveCSS('width', '28px');
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator('#action')).toHaveCSS('width', '44px');
  });

  test('uses evenly divided heatmap rows at each available width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(`
      <div data-chart-key="charging-weekly-heatmap">
        <div id="viewport" data-chart-viewport data-app-design-owner="pack-classic" style="width:300px">
          <div id="grid" data-heatmap-grid data-app-design-owner="pack-classic" style="display:grid;gap:2px">
            ${Array.from({ length: 24 }, (_, hour) => `<button data-heatmap-slot="${hour}" data-app-design-owner="pack-classic">${hour}</button>`).join('')}
          </div>
        </div>
      </div>
    `);
    await page.locator('html').evaluate(element => {
      element.setAttribute('data-app-design-pack', 'classic');
      element.setAttribute('data-app-design-owner', 'pack-classic');
    });
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
    for (const [width, columns] of [[300, 6], [420, 8], [600, 12], [1200, 24]]) {
      await page.locator('#viewport').evaluate((element, value) => { element.style.width = `${value}px`; }, width);
      await expect.poll(async () => page.locator('#grid').evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
      const cells = await page.locator('#grid button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
      expect(Math.min(...cells)).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the forced-colors fallback caption and headers readable on touch tablets', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(`
      <style>.tiny { font-size: 12px; }</style>
      <figure data-chart-key="charging-weekly-heatmap">
        <div data-chart-alternative>
          <table data-app-part="table" data-app-design-owner="pack-classic">
            <caption class="tiny" data-app-design-owner="pack-classic">Weekly heatmap</caption>
            <thead data-app-design-owner="pack-classic"><tr>
              <th class="tiny" data-app-design-owner="pack-classic">Day</th>
            </tr></thead>
            <tbody data-app-design-owner="pack-classic"><tr data-app-design-owner="pack-classic">
              <td data-app-design-owner="pack-classic">Sunday</td>
            </tr></tbody>
          </table>
        </div>
      </figure>
    `);
    await page.locator('html').evaluate(element => {
      element.setAttribute('data-app-design-pack', 'classic');
      element.setAttribute('data-app-design-owner', 'pack-classic');
      element.style.setProperty('--font-scale', '0.85');
    });
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator('caption')).toHaveCSS('font-size', '16px');
    await expect(page.locator('th')).toHaveCSS('font-size', '16px');
    await page.locator('html').evaluate(element => element.style.setProperty('--font-scale', '1.35'));
    await expect(page.locator('caption')).toHaveCSS('font-size', '21.6px');
    await expect(page.locator('th')).toHaveCSS('font-size', '21.6px');
  });
});

test('Classic stacked chart fallback uses localized headers without changing cell names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <section data-app-design-owner="pack-classic" data-heatmap-label-day="Jour"
      data-heatmap-label-hour="Heure" data-heatmap-label-sessions="Seances"
      data-heatmap-label-energy="Energie" data-heatmap-label-status="Statut">
      <figure data-chart-key="charging-weekly-heatmap">
        <div data-chart-alternative>
          <table data-app-design-owner="pack-classic">
            <thead data-app-design-owner="pack-classic"><tr>
              <th>Jour</th><th>Heure</th><th>Seances</th><th>Energie</th><th>Statut</th>
            </tr></thead>
            <tbody data-app-design-owner="pack-classic"><tr data-app-design-owner="pack-classic">
              <td data-app-design-owner="pack-classic">lun</td><td data-app-design-owner="pack-classic">00:00</td>
              <td data-app-design-owner="pack-classic">1</td><td data-app-design-owner="pack-classic">2 kWh</td>
              <td data-app-design-owner="pack-classic">OK</td>
            </tr></tbody>
          </table>
        </div>
      </figure>
    </section>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  const cells = page.locator('tbody td');
  const labels = () => cells.evaluateAll(elements => elements.map(element => getComputedStyle(element, '::before').content));
  const expected = ['Jour', 'Heure', 'Seances', 'Energie', 'Statut'].map(label => `${JSON.stringify(label)} / ""`);
  expect(await labels()).toEqual(expected);
  await expect(page.getByRole('cell').first()).toHaveAccessibleName('lun');
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await labels()).toEqual(expected);
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await labels()).toEqual(Array(5).fill('none'));
});

test('hidden app-owned tooltips do not enlarge scroll regions', async ({ page }) => {
  await page.setContent(`
    <style>
      .group\\/tip { position: relative; display: inline-flex; }
      .absolute { position: absolute; }
    </style>
    <div id="scroller" style="width:160px;overflow:auto">
      <span class="group/tip">
        <button id="trigger">Details</button>
        <span id="bubble" class="absolute" data-app-part="tooltip" data-app-design-owner="pack-classic"
          style="left:300px;width:180px;opacity:0">Additional details</span>
      </span>
    </div>
  `);
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8') });
  await page.mouse.move(350, 750);
  const bubble = page.locator('#bubble');
  await expect(bubble).toHaveCSS('position', 'fixed');
  expect(await page.locator('#scroller').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  await page.locator('#trigger').focus();
  await expect(bubble).toHaveCSS('position', 'absolute');
  await bubble.evaluate(element => element.classList.add('!opacity-0'));
  await expect(bubble).toHaveCSS('position', 'fixed');
  expect(await page.locator('#scroller').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
});

test('Classic cost heatmap reflow does not resize the separate interactive heatmap or widgets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`
    <style>.cost { min-width: 600px } .pattern { min-width: 640px }</style>
    <div id="cost" class="cost" data-cost-heatmap-grid data-app-design-owner="pack-classic"></div>
    <div id="pattern" class="pattern" data-heatmap-grid data-app-design-owner="pack-classic"></div>
    <div data-widget-pack="classic">
      <div id="widget-cost" class="cost" data-cost-heatmap-grid data-app-design-owner="pack-classic"></div>
    </div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'classic');
    element.setAttribute('data-app-design-owner', 'pack-classic');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', 'classic.css'), 'utf8') });
  await expect(page.locator('#cost')).toHaveCSS('min-width', '0px');
  await expect(page.locator('#pattern')).toHaveCSS('min-width', '640px');
  await expect(page.locator('#widget-cost')).toHaveCSS('min-width', '600px');
});

test('declared route scenarios are unique', () => {
  const keys = QUALITY_ROUTES.flatMap((route) =>
    route.scenarios.map((scenario) => `${route.name}:${scenario}`));
  expect(new Set(keys).size).toBe(keys.length);
});

test('optional storage state is omitted cleanly and validates explicit paths', () => {
  expect(resolveStorageState({})).toBeUndefined();
  expect(resolveStorageState({ E2E_STORAGE_STATE: '   ' })).toBeUndefined();
  expect(resolveStorageState({ E2E_STORAGE_STATE: 'state.json' }, () => true)).toBe('state.json');
  expect(() => resolveStorageState({ E2E_STORAGE_STATE: 'missing.json' }, () => false))
    .toThrow('E2E_STORAGE_STATE does not exist: missing.json');
  expect(isSensitiveRun({ E2E_SENSITIVE: '1' })).toBe(true);
  expect(isSensitiveRun({})).toBe(false);
});

test('SSE paths are separate from JSON fixtures', () => {
  expect(isSsePath('/events')).toBe(true);
  expect(isSsePath('/signals/7/stream?fields=VehicleSpeed')).toBe(true);
  expect(resolveApiFixture('/events', 'GET', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/signals/7/stream?fields=VehicleSpeed', 'GET', 'populated').matched)
    .toBe(false);
});

test('theme fixture honors the requested project theme', () => {
  expect(resolveApiFixture('/settings', 'GET', 'populated', 'dark').body).toMatchObject({ mode: 'dark' });
  expect(resolveApiFixture('/settings', 'GET', 'populated', 'light').body).toMatchObject({ mode: 'light' });
});

test('shared shell fixture resolves the server-backed widget preference', () => {
  expect(resolveApiFixture('/settings/widget-design-pack', 'GET', 'populated')).toMatchObject({
    matched: true,
    body: { pack_id: 'classic', scope: expect.stringMatching(/^[a-f0-9]{64}$/) },
  });
  expect(resolveApiFixture('/settings/unknown-preference', 'GET', 'populated').matched).toBe(false);
});

test('browser globals are not monkeypatched by state seeding', () => {
  const source = readFileSync(resolve(process.cwd(), 'e2e', 'mockApi.ts'), 'utf8');
  expect(source).not.toContain("Object.defineProperty(window, 'Date'");
  expect(source).not.toContain("Object.defineProperty(window, 'EventSource'");
  expect(source).not.toContain('HarnessEventSource');
});

test('visual date labels use a fixed clock without changing shared browser seeding', () => {
  const visual = readFileSync(resolve(process.cwd(), 'e2e', 'visual.spec.ts'), 'utf8');
  const seed = readFileSync(resolve(process.cwd(), 'e2e', 'mockApi.ts'), 'utf8');
  const clock = "page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'))";
  expect(visual).toContain(clock);
  expect(visual.indexOf(clock)).toBeLessThan(visual.indexOf('page.goto'));
  expect(seed).not.toContain('clock.setFixedTime');
  expect(visual).not.toContain('clock.pauseAt');
});

test('Date semantics contract uses the standard hermetic API lifecycle', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'e2e', 'date.contract.smoke.spec.ts'),
    'utf8',
  );
  expect(source).toContain('installApiMocks');
  expect(source).toContain('waitForHarnessReady');
  expect(source).toContain('closeMockedPage');
  expect(source.indexOf('await installApiMocks')).toBeLessThan(source.indexOf('page.goto'));
  expect(source.indexOf('page.goto')).toBeLessThan(source.indexOf('await waitForHarnessReady'));
  const tryIndex = source.indexOf('try {', source.indexOf('await waitForHarnessReady'));
  const assertionCatchIndex = source.indexOf('} catch (error)', tryIndex);
  const assertionIndex = source.indexOf('page.evaluate', tryIndex);
  const completionIndex = source.indexOf('await closeMockedPage', assertionCatchIndex);
  expect(tryIndex).toBeGreaterThan(source.indexOf('await waitForHarnessReady'));
  expect(assertionIndex).toBeGreaterThan(tryIndex);
  expect(assertionIndex).toBeLessThan(assertionCatchIndex);
  expect(completionIndex).toBeGreaterThan(assertionCatchIndex);
  expect(source).not.toContain('} finally {');
  expect(source).toContain('new AggregateError(');
});

test('RUM transport remains enabled while E2E captures only reviewed beacon endpoints', () => {
  const vitalsReporter = readFileSync(
    resolve(process.cwd(), 'src', 'lib', 'webVitalsReporter.ts'),
    'utf8',
  );
  const errorReporter = readFileSync(
    resolve(process.cwd(), 'src', 'lib', 'errorReporter.ts'),
    'utf8',
  );
  const mockApi = readFileSync(resolve(process.cwd(), 'e2e', 'mockApi.ts'), 'utf8');
  expect(vitalsReporter).toContain("const ENDPOINT = '/api/v1/web-vitals'");
  expect(vitalsReporter).toContain('navigator.sendBeacon(ENDPOINT, blob)');
  expect(errorReporter).toContain("const ENDPOINT = '/api/v1/web-errors'");
  expect(errorReporter).toContain('fetch(ENDPOINT');
  expect(mockApi).toContain("Object.defineProperty(navigator, 'sendBeacon'");
  expect(mockApi).toContain("'/api/v1/web-vitals', '/api/v1/web-errors'");
  expect(mockApi).toContain("page.on('request'");
  expect(mockApi).not.toContain("performance.getEntriesByType('resource')");
  expect(mockApi).toContain("'API requests escaped or were blocked by Playwright routing'");
});

test('mocked browser runs cannot bypass API fixtures through the service worker', () => {
  const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
  const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  expect(config).toContain("const mocksEnabled = process.env.E2E_MOCKS !== '0'");
  expect(config).toContain("serviceWorkers: mocksEnabled ? 'block' : 'allow'");
  expect(viteConfig).toContain("process.env.npm_lifecycle_event === 'e2e:build'");
  expect(viteConfig).toContain("process.env.E2E_MOCKS !== '0'");
  expect(viteConfig).toContain('disable: mockedE2eBuild');
});

test('catch-all API fixture rejects unknown paths', () => {
  expect(resolveApiFixture('/definitely-unmatched', 'GET', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/definitely-unmatched', 'POST', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/vehicles', 'GET', 'populated').matched).toBe(true);
});

test('dashboard widget API fixtures have reviewed no-signal and map defaults', () => {
  for (const path of ['/climate/latest?vehicle_id=7', '/security/latest?vehicle_id=7']) {
    expect(resolveApiFixture(path, 'GET', 'populated')).toMatchObject({
      matched: true,
      body: null,
    });
  }
  expect(resolveApiFixture('/system/map-config', 'GET', 'populated')).toMatchObject({
    matched: true,
    body: { provider: 'free', api_key: '' },
  });
});

test('axe debt registry remains zero', () => {
  expect(Object.keys(AXE_DEBT_BY_ROUTE)).toEqual([]);
  for (const routeDebt of Object.values(AXE_DEBT_BY_ROUTE)) {
    for (const debt of routeDebt) {
      expect(debt.rule).toBeTruthy();
      expect(debt.owner).toBeTruthy();
      expect(debt.tracking).toBeTruthy();
      expect(debt.targets.length).toBeGreaterThan(0);
      expect(new Set(debt.targets).size).toBe(debt.targets.length);
    }
  }
});

test('authenticated smoke records only sanitized aggregate status', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'frontend-quality.yml'), 'utf8');
  const productionJob = workflow.split('  authenticated-production-smoke:')[1];
  expect(productionJob).toContain("E2E_SENSITIVE: '1'");
  expect(productionJob).toContain('authenticated-smoke-status.json');
  expect(productionJob).toContain('rm -rf test-results playwright-report blob-report');
  expect(productionJob).not.toContain('web/test-results/');
  expect(productionJob).not.toContain('web/playwright-report/');
});

test('CI shares one hermetic build and gives each browser shard one managed preview', () => {
  interface WorkflowStep {
    run?: string;
    if?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }
  const workflow = load(readFileSync(
    resolve(process.cwd(), '..', '.github', 'workflows', 'frontend-quality.yml'), 'utf8',
  )) as { jobs: Record<string, {
    needs?: string | string[];
    if?: string;
    steps: WorkflowStep[];
    strategy?: { matrix?: { shard?: number[]; browser?: string[]; include?: Array<{ suite: string; shard: string }> } };
  }> };
  const build = workflow.jobs['browser-build'];
  const visualShards = workflow.jobs['visual-tests'].strategy?.matrix?.shard ?? [];
  expect(visualShards).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
  const visualSteps = workflow.jobs['visual-tests'].steps;
  const comparison = visualSteps.find(step => step.run?.startsWith('npm run e2e:visual '));
  expect(comparison).toBeDefined();
  expect(comparison?.if).toBeUndefined();
  expect(visualSteps.some(step => step.run?.includes('e2e:update-visual'))).toBe(false);
  const chromiumRows = workflow.jobs['chromium-tests'].strategy?.matrix?.include ?? [];
  for (const [suite, count] of [['quality', 32], ['a11y', 13], ['performance', 1]] as const) {
    expect(chromiumRows.filter(row => row.suite === suite).map(row => row.shard))
      .toEqual(Array.from({ length: count }, (_, index) => `${index + 1}/${count}`));
  }
  expect(workflow.jobs['cross-browser-tests'].strategy?.matrix)
    .toEqual({ browser: ['firefox', 'webkit', 'edge'], shard: [1, 2, 3] });
  const engines = workflow.jobs['cross-browser'];
  expect(engines.if).toBe('always()');
  expect(engines.needs).toEqual(['contract', 'browser-build', 'cross-browser-tests', 'app-design-tests']);
  expect(engines.strategy?.matrix?.browser).toEqual(['firefox', 'webkit', 'edge']);
  expect(engines.steps.find(step => step.run?.includes('all(job["result"] == "success"'))).toBeDefined();
  const buildSteps = Object.values(workflow.jobs).flatMap(job =>
    job.steps.filter(step => step.run?.includes('npm run e2e:build')));
  expect(buildSteps).toHaveLength(1);
  expect(build.steps).toContain(buildSteps[0]);
  expect(buildSteps[0].env).toMatchObject({ E2E_MOCKS: '1' });
  expect(build.steps.find(step => step.uses?.startsWith('actions/upload-artifact'))?.with)
    .toMatchObject({ name: 'e2e-app', path: 'web/e2e/.app-dist/', 'if-no-files-found': 'error' });

  for (const [id, command] of [
    ['chromium-tests', "npm run e2e:${{ matrix.suite }} -- --shard=${{ matrix.shard }} ${{ matrix.suite == 'a11y' && '--fully-parallel' || '' }}"],
    ['cross-browser-tests', 'npm run e2e -- --project=${{ matrix.browser }}-smoke --shard=${{ matrix.shard }}/3'],
    ['visual-tests', `npm run e2e:visual -- --shard=\${{ matrix.shard }}/${visualShards.length} --workers=2`],
  ]) {
    const job = workflow.jobs[id];
    expect(job.needs).toBe('browser-build');
    expect(job.steps.find(step => step.uses?.startsWith('actions/download-artifact'))?.with)
      .toMatchObject({ name: 'e2e-app', path: 'web/e2e/.app-dist' });
    expect(job.steps.find(step => step.run === command)?.env)
      .toMatchObject({ E2E_REUSE_BUILD: '1', E2E_MOCKS: '1' });
  }

  const { scripts } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const suite of ['e2e', 'e2e:quality', 'e2e:performance', 'e2e:a11y', 'e2e:visual']) {
    expect(scripts[suite]).toBe(`node scripts/run-e2e-suite.mjs ${suite}:run`);
  }
});

test('local suite wrapper separates build time from preview readiness', () => {
  const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
  expect(config).not.toMatch(/webServer:[\s\S]*command:.*e2e:build/);
  expect(config).toContain("command: 'npm run preview");
  expect(config).toContain('timeout: 120_000');
  const wrapper = readFileSync(resolve(process.cwd(), 'scripts', 'run-e2e-suite.mjs'), 'utf8');
  expect(wrapper).toContain("runNpm(['run', 'e2e:build'])");
  expect(wrapper).toContain("E2E_SKIP_WEBSERVER: '1'");
  expect(wrapper).toContain("preview.kill('SIGTERM')");
  expect(wrapper).toContain('ECONNREFUSED|proxy error|http proxy error');
});

test('docs screenshots and visual baseline updates are separate commands', () => {
  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(rootPackage.scripts.screenshots).toBe('node scripts/screenshots.js');
  expect(rootPackage.scripts['e2e:update-baselines']).toContain('e2e:update-visual');
  const wrapper = readFileSync(resolve(process.cwd(), '..', 'scripts', 'screenshots.js'), 'utf8');
  expect(wrapper).toContain('screenshots:docs');
  expect(wrapper).not.toContain('e2e:update-visual');
});

test('docs screenshot destinations and deployment URLs are portable', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'scripts', 'capture-docs-screenshots.mjs'),
    'utf8',
  );

  expect(source).toContain('process.env.E2E_BASE_URL');
  expect(source).toContain('process.env.DOCS_SCREENSHOT_DIR');
  expect(source).toContain('process.env.E2E_STORAGE_STATE');
  expect(source).toContain("resolve(scriptDirectory, '..', '..')");
  expect(source).toContain('resolve(outputDirectory, `${route.name}.png`)');
  expect(source).not.toMatch(/['"][A-Za-z]:[\\/]/);
  expect(source).not.toMatch(/['"]\/(?:home|Users)\//);
});
