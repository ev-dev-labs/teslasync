import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import sharp from 'sharp';
import { APPLICATION_DESIGNS, APP_DESIGN_PACK_FILES, getAppDesignAttributes } from '../src/components/ui/app-designs/designs';
import { PACK_IDS } from '../src/features/dashboard/widgets/designPacks/types';
import { AXE_DEBT_BY_ROUTE } from './axeBaseline';
import { isSensitiveRun, resolveStorageState } from './configEnv';
import { isSsePath, resolveApiFixture, waitForNoVisibleActivity } from './mockApi';
import {
  QUALITY_ROUTES,
} from './routeRegistry';
import { CAPTURE_VIEWPORTS, captureRoutes, clearCaptureImages, findClippedBottomNavigationLabels, findClippedWorkspaceRangeLabels, findHorizontalScrollRegions, findOverlappingWorkspaceInputActions, findSmallBodyText, findSmallTouchTargets, findSplitBottomNavigationWords, findSplitOperationalMetricWords, selectCaptureRoutes, skipExistingCapture, writeCaptureImages } from './design-packs-capture';

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

test('pack density tokens resolve to usable spacing without changing Kinetic action gaps', async ({ page }) => {
  await page.setContent(`
    <style>:root { --density-gap: 12px; }</style>
    <div data-app-part="page" class="space-y-6">
      <div></div><div id="section" data-app-design-owner="content-workbench"></div>
    </div>
    <div id="actions" data-app-part="page-actions" data-app-design-owner="pack-kinetic"></div>
  `);
  const styles = resolve('src', 'components', 'ui', 'app-designs');
  await page.addStyleTag({ content: await readFile(resolve(styles, 'shell.css'), 'utf8') });
  for (const file of Object.values(APP_DESIGN_PACK_FILES)) {
    await page.addStyleTag({ content: await readFile(resolve(styles, 'packs', file), 'utf8') });
  }
  for (const pack of PACK_IDS) {
    await page.locator('html').evaluate((element, value) => {
      element.setAttribute('data-app-design-pack', value);
      element.setAttribute('data-app-design-owner', `pack-${value}`);
    }, pack);
    const density = await page.locator('html').evaluate(element =>
      Number(getComputedStyle(element).getPropertyValue('--app-content-density').trim()));
    expect(density, pack).toBeGreaterThan(0);
    expect(Number.isFinite(density), pack).toBe(true);
    if (pack === 'kinetic') {
      await expect(page.locator('#section')).toHaveCSS('margin-block-start', '16px');
      await expect(page.locator('#actions')).toHaveCSS('gap', '12px');
    }
  }
});

test('shared pack phone rules retain readable controls, grid text and protected content', async ({ page }) => {
  await page.setContent(`
    <style>
      :root { --font-scale: .85; --density-gap: 12px; --density-pad-y: 12px; --density-pad-x: 16px; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      .text-sm, .mgr-title, .mgr-meta-value { font-size: 12px; }
      .sidenav-phone-tab { display: flex; flex-direction: column; align-items: center; border: 0; font-size: 11px; }
      [data-role="bottom-tab-bar"] { display: flex; align-items: stretch; }
    </style>
    <p id="prose" class="text-sm" data-app-design-owner="pack-v1">Readable body text</p>
    <label data-app-part="field-label" data-app-design-owner="pack-v1" for="field">Search</label>
    <input id="field" data-app-part="field-control" data-app-design-owner="pack-v1">
    <button id="action" data-app-part="button" data-app-design-owner="pack-v1">Apply</button>
    <div data-mobile-table data-app-design-owner="pack-v1">
      <div class="mgr-card" data-app-design-owner="pack-v1">
        <span class="mgr-title" data-app-design-owner="pack-v1">Session</span>
        <span class="mgr-meta-value" data-app-design-owner="pack-v1">LongUnbrokenSessionValueThatMustWrapOnPhones</span>
      </div>
    </div>
    <div data-app-design-preserve><p id="protected" class="text-sm" data-app-design-owner="pack-v1">Protected widget</p></div>
    <nav data-role="bottom-tab-bar" data-app-design-owner="pack-v1">
      ${['Home', 'Drives', 'Charge', 'Alerts', 'More'].map(label => `
        <button class="sidenav-phone-tab" data-app-part="button nav-item" data-app-design-owner="pack-v1">
          <span class="nav-phone-icon" data-app-design-owner="pack-v1"><svg width="22" height="22" data-app-design-owner="pack-v1"></svg></span>
          <span class="sidenav-tab-label" data-app-design-owner="pack-v1">${label}</span>
        </button>`).join('')}
    </nav>
    <div id="reserved" style="height:var(--shell-tab-bar-height)"></div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'v1');
    element.setAttribute('data-app-design-owner', 'pack-v1');
  });
  for (const sheet of ['base.css', 'mobile.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const scale of [0.85, 1.35]) {
        await page.locator('html').evaluate((element, value) => element.style.setProperty('--font-scale', String(value)), scale);
        const sizes = await page.evaluate(() => {
          const font = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
          const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          return {
            prose: font('#prose'), field: font('#field'), action: font('#action'),
            grid: font('.mgr-meta-value'), protected: font('#protected'),
            navButton: font('.sidenav-phone-tab'),
            inputHeight: bounds('#field').height, buttonHeight: bounds('#action').height,
            navHeight: bounds('[data-role="bottom-tab-bar"]').height, reserved: bounds('#reserved').height,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        const context = `${forcedColors}, ${width}px, scale ${scale}`;
        expect(sizes.prose, context).toBeGreaterThanOrEqual(16);
        expect(sizes.field, context).toBeGreaterThanOrEqual(16);
        expect(sizes.action, context).toBeGreaterThanOrEqual(16);
        expect(sizes.grid, context).toBeGreaterThanOrEqual(16);
        expect(sizes.navButton, context).toBeGreaterThanOrEqual(16);
        expect(sizes.protected, context).toBe(12);
        expect(sizes.inputHeight, context).toBeGreaterThanOrEqual(44);
        expect(sizes.buttonHeight, context).toBeGreaterThanOrEqual(44);
        expect(sizes.reserved, context).toBeGreaterThanOrEqual(sizes.navHeight);
        expect(sizes.scrollWidth, context).toBeLessThanOrEqual(width);
      }
    }
  }
});

test('pack presentation roles reset at nested previews without changing protected surfaces', async ({ page }) => {
  await page.setContent(`
    <style>
      :root { --panel-radius: 10px; --panel-shadow: none; --radius-lg: 10px; --radius-md: 8px; --elevation-1: none; --font-sans: sans-serif; --font-weight-bold: 700; --font-weight-semibold: 600; --tracking: 0; --surface-1: rgb(10, 20, 30); --border-subtle: gray; --motion-duration-fast: 150ms; --motion-easing-standard: ease; }
      .panel { border: 1px solid; background: var(--app-surface-panel, var(--surface-1)); }
      #protected { border-radius: 3px; }
    </style>
    <div id="outer" class="panel" data-app-part="panel" data-surface-variant="standalone" data-app-design-owner="pack-v1"></div>
    <div id="outer-chart" data-chart-viewport data-app-design-owner="pack-v1"></div>
    <button id="animated" data-app-part="button" data-app-design-owner="pack-v1">Action</button>
    <div data-app-design-preview data-app-design-pack="v2" data-app-design-owner="pack-v2">
      <div id="inner" class="panel" data-app-part="panel" data-surface-variant="standalone" data-app-design-owner="pack-v2"></div>
      <div id="inner-chart" data-chart-viewport data-app-design-owner="pack-v2"></div>
    </div>
    <div data-app-design-preserve><div id="protected" class="panel" data-app-part="panel" data-surface-variant="standalone"></div></div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'v1');
    element.setAttribute('data-app-design-owner', 'pack-v1');
    element.style.setProperty('--app-card-radius', '24px');
    element.style.setProperty('--app-chart-surface', 'rgb(35, 55, 75)');
    element.style.setProperty('--app-surface-panel', 'rgb(45, 65, 85)');
    element.style.setProperty('--app-input-action-clearance', '3rem');
    element.style.setProperty('--app-interaction-duration', '800ms');
  });
  for (const sheet of ['base.css', 'charts.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  const radius = (selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element).borderRadius);
  expect(await radius('#outer')).toBe('24px');
  expect(await radius('#inner')).toBe('10px');
  expect(await radius('#protected')).toBe('3px');
  const background = (selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element).backgroundColor);
  expect(await background('#outer')).toBe('rgb(45, 65, 85)');
  expect(await background('#inner')).toBe('rgb(10, 20, 30)');
  expect(await background('#outer-chart')).toBe('rgb(35, 55, 75)');
  expect(await background('#inner-chart')).toBe('rgb(10, 20, 30)');
  expect(await page.locator('#inner').evaluate(element =>
    getComputedStyle(element).getPropertyValue('--app-input-action-clearance').trim())).toBe('0.75rem');
  const duration = () => page.locator('#animated').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(await duration()).toBe('0.8s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toBe('0s');
});

test('pack presentation roles drive existing controls, grid, flow and conversation surfaces', async ({ page }) => {
  const instrument = getAppDesignAttributes('v1');
  const cards = getAppDesignAttributes('v2');
  const marker = (pack: 'v1' | 'v2') =>
    [`pack-${pack}`, ...Object.entries(APPLICATION_DESIGNS[pack]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
  await page.setContent(`
    <style>
      :root { --font-sans: sans-serif; --font-weight-bold: 700; --font-weight-semibold: 600; --tracking: 0; --density-gap: 12px; --density-pad-y: 12px; --density-pad-x: 16px; --surface-1: rgb(10, 20, 30); --surface-2: rgb(20, 30, 40); --surface-3: rgb(30, 40, 50); --border-strong: gray; --border-default: gray; --control-border: gray; --radius-md: 8px; --radius-lg: 10px; }
    </style>
    <input id="control" data-app-part="field-control" data-app-design-owner="${marker('v1')}">
    <table data-app-part="table"><thead id="grid" data-app-design-owner="${marker('v1')}"><tr><th>Label</th></tr></thead></table>
    <div data-app-part="page" class="space-y-3"><div></div><div id="flow" data-app-design-owner="${marker('v1')}">Content</div></div>
    <div id="preview" data-app-design-preview data-app-design-owner="${marker('v2')}">
      <div id="bubble" data-app-part="card conversation-bubble" data-app-design-owner="${marker('v2')}">Reply</div>
    </div>
  `);
  await page.evaluate(({ outer, inner }) => {
    for (const [name, value] of Object.entries(outer)) document.documentElement.setAttribute(name, value);
    document.documentElement.setAttribute('data-app-design-owner', 'pack-v1');
    const root = document.documentElement.style;
    root.setProperty('--app-control-radius', '13px');
    root.setProperty('--app-control-surface', 'rgb(41, 52, 63)');
    root.setProperty('--app-grid-header', 'rgb(31, 42, 53)');
    root.setProperty('--app-content-density', '1.5');
    const preview = document.querySelector<HTMLElement>('#preview')!;
    for (const [name, value] of Object.entries(inner)) preview.setAttribute(name, value);
    preview.style.setProperty('--app-conversation-surface', 'rgb(42, 53, 64)');
    preview.style.setProperty('--app-conversation-radius', '17px');
  }, { outer: instrument, inner: cards });
  for (const sheet of ['base.css', 'shell.css', 'controls.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  const style = (selector: string) => page.locator(selector).evaluate(element => {
    const computed = getComputedStyle(element);
    return { radius: computed.borderRadius, background: computed.backgroundColor, margin: computed.marginBlockStart };
  });
  expect(await style('#control')).toMatchObject({ radius: '13px', background: 'rgb(41, 52, 63)' });
  expect(await style('#grid')).toMatchObject({ background: 'rgb(31, 42, 53)' });
  expect(await style('#flow')).toMatchObject({ margin: '24px' });
  expect(await style('#bubble')).toMatchObject({ radius: '17px', background: 'rgb(42, 53, 64)' });
});

test('shared phone heatmap and opted-in table wrap without losing cells or labels', async ({ page }) => {
  await page.setContent(`
    <style>
      :root { --font-scale: 1; --density-gap: 12px; --density-pad-y: 12px; --density-pad-x: 16px; --border-default: gray; --text-secondary: gray; --font-weight-medium: 500; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      [data-cost-heatmap-grid] { min-width: 600px; }
    </style>
    <div data-cost-heatmap-grid data-app-design-owner="pack-v1">
      <div data-cost-heatmap-axis data-app-design-owner="pack-v1">${Array.from({ length: 12 }, (_, i) => `<span>${i}</span>`).join('')}</div>
      <div data-cost-heatmap-day data-app-design-owner="pack-v1">
        <span data-cost-heatmap-day-label data-app-design-owner="pack-v1">Mon</span>
        ${Array.from({ length: 24 }, (_, i) => `<span data-hour="${i}">${i}</span>`).join('')}
      </div>
    </div>
    <table data-mobile-stack-table data-app-design-owner="pack-v1">
      <caption data-app-design-owner="pack-v1">Hourly costs</caption>
      <thead data-app-design-owner="pack-v1"><tr><th>Day</th><th>Cost</th></tr></thead>
      <tbody data-app-design-owner="pack-v1">
        <tr data-app-design-owner="pack-v1">
          <th data-app-design-owner="pack-v1" scope="row">Mon</th>
          <td data-app-design-owner="pack-v1" data-mobile-label="Cost">$1.00</td>
        </tr>
      </tbody>
    </table>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'v1');
    element.setAttribute('data-app-design-owner', 'pack-v1');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'mobile.css'), 'utf8') });
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.locator('[data-hour]').count()).toBe(24);
      expect(await page.locator('[data-hour]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-hour'))))
        .toEqual(Array.from({ length: 24 }, (_, i) => String(i)));
      expect(await page.getByRole('table', { name: 'Hourly costs' }).count()).toBe(1);
      expect(await page.locator('td').evaluate(element => getComputedStyle(element, '::before').content)).toContain('Cost');
      expect(await page.locator('[data-cost-heatmap-day-label]').evaluate(element => getComputedStyle(element).gridRow)).toContain('span 2');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});

test('chart fallback tables retain readable labeled cells without phone overflow', async ({ page }) => {
  const columns = ['Type', 'Sessions', 'Energy', 'Cost', 'Energy with recorded cost', 'Sessions with recorded cost'];
  const values = ['Home', '4', '48 kWh', '$8', '48 kWh', '4'];
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --font-scale: 1; --density-gap: 12px; --density-pad-y: 8px; --density-pad-x: 12px; --border-default: gray; --text-secondary: gray; --font-weight-medium: 500; }
      body { margin: 0; }
      #chart-scroll { max-width: 100%; overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 4px 8px; }
    </style>
    <figure data-app-part="chart" data-chart-variant="panel">
      <figcaption data-chart-alternative>
        <div data-table-variant="embedded">
          <div id="chart-scroll">
            <table data-app-part="table" data-app-table-variant="embedded" data-mobile-stack-table>
              <caption>Charger type breakdown — data table</caption>
              <thead><tr>${columns.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
              <tbody><tr>${values.map((value, index) => `<td data-mobile-label="${columns[index]}">${value}</td>`).join('')}</tr></tbody>
            </table>
          </div>
        </div>
      </figcaption>
    </figure>
  `);
  for (const sheet of ['base.css', 'shell.css', 'controls.css', 'charts.css', 'maps.css', 'feedback.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  for (const id of PACK_IDS) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[id]), 'utf8') });
  }
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'mobile.css'), 'utf8') });
  for (const pack of PACK_IDS) {
    const owner = [`pack-${pack}`, ...Object.entries(APPLICATION_DESIGNS[pack]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
    await page.locator('html').evaluate((element, values) => {
      for (const [name, value] of Object.entries(values.attributes)) element.setAttribute(name, value);
      element.setAttribute('data-app-design-owner', values.owner);
      document.querySelectorAll('figure, figure *').forEach(node => node.setAttribute('data-app-design-owner', values.owner));
    }, { attributes: getAppDesignAttributes(pack), owner });
    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const scale of [0.85, 1, 1.35]) {
        await page.locator('html').evaluate((element, value) => element.style.setProperty('--font-scale', String(value)), scale);
        for (const width of [360, 390, 430]) {
          await page.setViewportSize({ width, height: 844 });
          const table = page.getByRole('table', { name: 'Charger type breakdown — data table' });
          expect(await table.getByRole('columnheader').allTextContents()).toEqual(columns);
          expect(await table.getByRole('cell').allTextContents()).toEqual(values);
          const geometry = await page.locator('#chart-scroll').evaluate(element => ({
            overflow: element.scrollWidth - element.clientWidth,
            cells: [...element.querySelectorAll('td')].map(cell => ({
              label: getComputedStyle(cell, '::before').content,
              labelSize: parseFloat(getComputedStyle(cell, '::before').fontSize),
              valueSize: parseFloat(getComputedStyle(cell).fontSize),
            })),
          }));
          const context = `${pack} ${forcedColors} ${width}px scale ${scale}`;
          expect(geometry.overflow, context).toBeLessThanOrEqual(1);
          for (const [index, cell] of geometry.cells.entries()) {
            expect(cell.label, context).toContain(columns[index]);
            expect(cell.labelSize, context).toBeGreaterThanOrEqual(16);
            expect(cell.valueSize, context).toBeGreaterThanOrEqual(16);
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByRole('table', { name: 'Charger type breakdown — data table' })).toHaveCSS('display', 'table');
    }
  }
});

test('operational metric banks keep their authored wide layout and phone reflow', async ({ page }) => {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 12px; --density-pad-y: 8px; --density-pad-x: 12px; --font-scale: 1; }
      body { margin: 0; }
      .brief { display: flex; flex-direction: column; }
      .bank { display: flex; flex-wrap: wrap; gap: 12px; }
      .reading { flex: 1 1 200px; min-width: 0; }
    </style>
    <div class="brief" data-operational-metric-list data-owned>
      <div id="bank" class="bank" role="list" data-operational-metric-bank data-app-part="metric-grid" data-owned>
        <div class="reading" role="listitem" data-app-part="metric" data-owned>Distance 42 km</div>
        <div class="reading" role="listitem" data-app-part="metric" data-owned>Time unavailable</div>
      </div>
    </div>
    <div id="ordinary" class="bank" data-app-part="metric-grid" data-owned><span>One</span><span>Two</span></div>
    <section data-app-design-preview data-app-design-pack="v2" data-app-data="cards" data-app-design-owner="pack-v2 data-cards">
      <div class="brief" data-operational-metric-list data-app-design-owner="pack-v2 data-cards">
        <div id="nested-bank" class="bank" data-operational-metric-bank data-app-part="metric-grid" data-app-design-owner="pack-v2 data-cards">
          <div class="reading" data-app-part="metric" data-app-design-owner="pack-v2 data-cards">Nested one</div>
          <div class="reading" data-app-part="metric" data-app-design-owner="pack-v2 data-cards">Nested two</div>
        </div>
      </div>
    </section>
  `);
  for (const sheet of ['feedback.css', 'mobile.css']) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  for (const pack of ['blueprint', 'v2'] as const) {
    const attributes = getAppDesignAttributes(pack);
    const owner = `pack-${pack} data-${APPLICATION_DESIGNS[pack].data}`;
    await page.locator('html').evaluate((element, values) => {
      for (const [name, value] of Object.entries(values.attributes)) element.setAttribute(name, value);
      element.setAttribute('data-app-design-owner', values.owner);
      document.querySelectorAll('[data-owned]').forEach(node => node.setAttribute('data-app-design-owner', values.owner));
    }, { attributes, owner });
    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const width of [360, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const compact = width < 1024;
        await expect(page.locator('#bank')).toHaveCSS('display', compact ? 'contents' : 'flex');
        await expect(page.locator('#nested-bank')).toHaveCSS('display', compact ? 'contents' : 'flex');
        await expect(page.locator('#ordinary')).toHaveCSS('display', forcedColors === 'none' ? 'grid' : 'flex');
        expect(await page.locator('#bank').getByRole('listitem').allTextContents()).toEqual(['Distance 42 km', 'Time unavailable']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});

test('data modes preserve semantic and embedded metric paint and layout', async ({ page }) => {
  await page.setContent(`
    <style>
      html {
        --density-row-h: 44px; --density-pad-y: 8px; --density-pad-x: 12px;
        --density-gap: 12px; --font-scale: 1; --panel-radius: 12px;
        --border-default: rgb(64, 64, 64); --border-strong: rgb(72, 72, 72);
        --surface-1: rgb(30, 30, 30); --app-grid-cell-bg: rgb(30, 30, 30);
        --semantic-warning-bg: rgb(120, 80, 10); --semantic-warning-border: rgb(220, 160, 20);
        --semantic-danger-bg: rgb(120, 20, 20); --semantic-danger-border: rgb(220, 40, 40);
      }
      .tile { display: block; padding: 12px; border: 1px solid rgb(80, 80, 80); background: rgb(24, 24, 24); }
      .warning { background: rgb(120, 80, 10); border-color: rgb(220, 160, 20); }
      .danger { background: rgb(120, 20, 20); border-color: rgb(220, 40, 40); }
      .embedded { padding: 0; border: 0; background: transparent; }
    </style>
    <div id="normal" class="tile" data-owned data-app-part="metric" data-app-metric="tile">Normal</div>
    <div id="warning" class="tile warning" data-owned data-app-part="metric" data-app-metric="tile" data-app-tone="warning">Warning</div>
    <div id="danger" class="tile danger" data-owned data-app-part="metric" data-app-metric="tile" data-app-tone="danger">Danger</div>
    <div id="embedded" class="tile embedded" data-owned data-app-part="metric" data-app-metric="card" data-surface-variant="embedded">
      <div id="nested" class="tile" data-owned data-app-part="metric" data-app-metric="tile">Embedded reading</div>
    </div>
  `);
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8') });
  for (const pack of ['classic', 'v3', 'v2', 'v1'] as const) {
    const attributes = getAppDesignAttributes(pack);
    const owner = `pack-${pack} data-${APPLICATION_DESIGNS[pack].data}`;
    await page.locator('html').evaluate((element, values) => {
      for (const [name, value] of Object.entries(values.attributes)) element.setAttribute(name, value);
      element.setAttribute('data-app-design-owner', values.owner);
      document.querySelectorAll('[data-owned]').forEach(node => node.setAttribute('data-app-design-owner', values.owner));
    }, { attributes, owner });
    for (const palette of [
      { warning: 'rgb(120, 80, 10)', warningBorder: 'rgb(220, 160, 20)', danger: 'rgb(120, 20, 20)', dangerBorder: 'rgb(220, 40, 40)' },
      { warning: 'rgb(255, 240, 200)', warningBorder: 'rgb(150, 100, 10)', danger: 'rgb(255, 220, 220)', dangerBorder: 'rgb(170, 30, 30)' },
    ]) {
      await page.locator('html').evaluate((element, colors) => {
        element.style.setProperty('--semantic-warning-bg', colors.warning);
        element.style.setProperty('--semantic-warning-border', colors.warningBorder);
        element.style.setProperty('--semantic-danger-bg', colors.danger);
        element.style.setProperty('--semantic-danger-border', colors.dangerBorder);
      }, palette);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.locator('#warning')).toHaveCSS('background-color', palette.warning);
        await expect(page.locator('#warning')).toHaveCSS('border-top-color', palette.warningBorder);
        await expect(page.locator('#danger')).toHaveCSS('background-color', palette.danger);
        await expect(page.locator('#danger')).toHaveCSS('border-top-color', palette.dangerBorder);
        await expect(page.locator('#embedded')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(page.locator('#embedded')).toHaveCSS('border-top-width', '0px');
        for (const id of ['warning', 'danger', 'embedded', 'nested']) {
          await expect(page.locator(`#${id}`)).toHaveCSS('display', 'block');
        }
        await expect(page.locator('#nested')).toHaveCSS('background-color', 'rgb(24, 24, 24)');
        await expect(page.locator('#normal')).not.toHaveCSS('background-color', 'rgb(24, 24, 24)');
      }
    }
  }
});

test('shared phone layout keeps operational metrics, support copy and actions usable', async ({ page }) => {
  await page.setContent(`
    <style>
      :root { --font-scale: 1.35; --density-gap: 12px; --density-pad-y: 12px; --density-pad-x: 16px; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      [data-operational-metric-list] { width: 100%; }
      [data-app-part~="metric-label"] { font-size: 12px; }
      [data-testid="masked-value"] { display: flex; }
      [data-testid="masked-value"] button { width: 20px; height: 20px; }
    </style>
    <div data-operational-metric-list data-app-design-owner="pack-v1">
      <div data-app-part="metric-grid" data-operational-metric-bank data-app-design-owner="pack-v1">
        <div data-app-part="metric-label" data-app-design-owner="pack-v1">Battery condition</div>
        <div data-app-part="metric-label" data-app-design-owner="pack-v1">Recorded charging sessions</div>
      </div>
    </div>
    <div data-testid="masked-value" data-app-design-owner="pack-v1">
      <span>Masked value</span><button data-app-design-owner="pack-v1">Show</button>
    </div>
    <div data-app-part="feedback-message"><a href="#help" data-app-design-owner="pack-v1">Help</a></div>
    <pre data-app-code-kind="support-bundle" data-app-design-owner="pack-v1">LongUnbrokenSupportInformationThatMustWrapOnPhones</pre>
    <div data-app-design-preserve><div data-testid="masked-value"><button id="protected-action">Show</button></div></div>
  `);
  await page.locator('html').evaluate(element => {
    element.setAttribute('data-app-design-pack', 'v1');
    element.setAttribute('data-app-design-owner', 'pack-v1');
  });
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'mobile.css'), 'utf8') });
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const measurements = await page.evaluate(() => {
        const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        return {
          metricSize: parseFloat(getComputedStyle(document.querySelector('[data-app-part~="metric-label"]')!).fontSize),
          action: bounds('[data-testid="masked-value"] > button').height,
          link: bounds('[data-app-part~="feedback-message"] a').height,
          protectedAction: bounds('#protected-action').height,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      const context = `${forcedColors}, ${width}px`;
      expect(measurements.metricSize, context).toBeGreaterThanOrEqual(16);
      expect(measurements.action, context).toBeGreaterThanOrEqual(44);
      expect(measurements.link, context).toBeGreaterThanOrEqual(44);
      expect(measurements.protectedAction, context).toBe(20);
      expect(measurements.scrollWidth, context).toBeLessThanOrEqual(width);
    }
  }
});

test('all pack styles retain the shared phone floor and bottom navigation geometry', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setContent(`
    <style>
      :root { --font-scale: .85; --density-row-h: 44px; --density-gap: 12px; --density-pad-y: 12px; --density-pad-x: 16px; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      .text-sm, .text-2xs, .mgr-title { font-size: 12px; }
      .sidenav-phone-tab { display: flex; flex-direction: column; align-items: center; border: 0; }
      [data-role="bottom-tab-bar"] { display: flex; align-items: stretch; }
    </style>
    <p id="prose" class="text-sm" data-owned>Read the current state</p>
    <p id="unclassified-prose" class="text-2xs" data-owned style="max-width:180px">date,distance_m,efficiency_wh_per_m</p>
    <div data-app-design-preserve><p id="protected-prose" class="text-2xs" data-owned>Protected copy</p></div>
    <div data-app-part="timeline-row"><div data-app-part="timeline-content">
      <a id="timeline-link" href="#record" data-owned>Open record</a>
    </div></div>
    <div class="leaflet-control-attribution"><a id="map-credit" href="#credit" data-owned>Map credit</a></div>
    <div class="leaflet-marker-icon" data-owned style="position:relative;width:28px;height:28px;margin-left:-14px;margin-top:-14px">
      <div id="map-marker-visual" data-map-marker="vehicle" style="width:28px;height:28px"></div>
    </div>
    <input id="field" data-app-part="field-control" data-owned>
    <div data-mobile-table data-owned><span class="mgr-title" data-owned>Session details</span></div>
    <nav data-role="bottom-tab-bar" data-owned>
      ${['Home', 'Drives', 'Charge', 'Alerts', 'More'].map(label => `
        <button class="sidenav-phone-tab" data-app-part="button nav-item" data-owned>
          <span class="nav-phone-icon" data-owned><svg width="22" height="22" data-owned></svg></span>
          <span class="sidenav-tab-label" data-owned>${label}</span>
        </button>`).join('')}
    </nav>
    <div id="reserved" style="height:var(--shell-tab-bar-height)"></div>
  `);
  const sheets = ['base.css', 'shell.css', 'controls.css', ...PACK_IDS.map(pack => join('packs', APP_DESIGN_PACK_FILES[pack])), 'mobile.css'];
  for (const sheet of sheets) {
    await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', sheet), 'utf8') });
  }
  for (const pack of PACK_IDS) {
    const attributes = getAppDesignAttributes(pack);
    const owner = [`pack-${pack}`, ...Object.entries(APPLICATION_DESIGNS[pack]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
    await page.evaluate(({ profile, marker }) => {
      for (const [name, value] of Object.entries(profile)) document.documentElement.setAttribute(name, value);
      document.documentElement.setAttribute('data-app-design-owner', marker);
      document.querySelectorAll('[data-owned]').forEach(element => element.setAttribute('data-app-design-owner', marker));
    }, { profile: attributes, marker: owner });
    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        const sizes = await page.evaluate(() => {
          const font = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          return {
            prose: font('#prose'), field: font('#field'), grid: font('.mgr-title'),
            unclassifiedProse: font('#unclassified-prose'), protectedProse: font('#protected-prose'),
            unclassifiedScroll: document.querySelector('#unclassified-prose')!.scrollWidth,
            unclassifiedWidth: document.querySelector('#unclassified-prose')!.clientWidth,
            timelineLink: rect('#timeline-link').height, mapCredit: rect('#map-credit').height,
            marker: rect('.leaflet-marker-icon').toJSON(), markerVisual: rect('#map-marker-visual').toJSON(),
            markerMargin: getComputedStyle(document.querySelector('.leaflet-marker-icon')!).marginLeft,
            inputHeight: rect('#field').height,
            navHeight: rect('[data-role="bottom-tab-bar"]').height,
            reserved: rect('#reserved').height,
            targets: [...document.querySelectorAll('.sidenav-phone-tab')].map(element => element.getBoundingClientRect().height),
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        const context = `${pack}, ${forcedColors}, ${width}px`;
        expect(sizes.prose, context).toBeGreaterThanOrEqual(16);
        expect(sizes.unclassifiedProse, context).toBeGreaterThanOrEqual(16);
        expect(sizes.unclassifiedScroll, context).toBeLessThanOrEqual(sizes.unclassifiedWidth);
        expect(sizes.protectedProse, context).toBe(12);
        expect(sizes.timelineLink, context).toBeGreaterThanOrEqual(44);
        expect(sizes.mapCredit, context).toBeGreaterThanOrEqual(44);
        expect(sizes.marker.width, context).toBe(44);
        expect(sizes.marker.height, context).toBe(44);
        expect(sizes.markerMargin, context).toBe('-22px');
        expect(sizes.markerVisual.width, context).toBe(28);
        expect(sizes.markerVisual.height, context).toBe(28);
        expect(sizes.markerVisual.x + sizes.markerVisual.width / 2, context)
          .toBeCloseTo(sizes.marker.x + sizes.marker.width / 2);
        expect(sizes.field, context).toBeGreaterThanOrEqual(16);
        expect(sizes.grid, context).toBeGreaterThanOrEqual(16);
        expect(sizes.inputHeight, context).toBeGreaterThanOrEqual(44);
        expect(Math.min(...sizes.targets), context).toBeGreaterThanOrEqual(44);
        expect(sizes.reserved, context).toBeGreaterThanOrEqual(sizes.navHeight);
        expect(sizes.scrollWidth, context).toBeLessThanOrEqual(width);
      }
    }
  }
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

test('capture resume preserves existing viewport evidence', async () => {
  const directory = test.info().outputPath('resume-artifacts');
  await mkdir(directory, { recursive: true });
  const viewportPath = resolve(directory, 'page.png');
  const image = Buffer.from('existing evidence');
  expect(await skipExistingCapture(viewportPath, true)).toBe(false);
  await writeFile(viewportPath, image);
  expect(await skipExistingCapture(viewportPath, true)).toBe(true);
  expect(await skipExistingCapture(viewportPath, false)).toBe(false);
  expect(await readFile(viewportPath)).toEqual(image);
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
      await page.locator('html').evaluate((element, value) => { element.setAttribute('dir', value); }, direction);
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

test('Classic compact phone headers share a row only when the action rail fits', async ({ page }) => {
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 12px; --density-pad-y: 12px; }
      body { margin: 0; font: 16px system-ui, sans-serif; }
      header { display: flex; width: calc(100vw - 32px); }
      header.flex-row { flex-direction: row; flex-wrap: wrap; }
      header.flex-col { flex-direction: column; }
      [data-app-part~="page-title"] { display: flex; min-width: 0; align-items: center; }
      h1 { margin: 0; min-width: 0; font-size: calc(24px * var(--font-scale)); overflow-wrap: break-word; }
      button { flex: none; width: 44px; height: 44px; }
      [data-app-part~="page-actions"] { display: flex; flex: none; }
    </style>
    <header class="flex-row" data-single data-app-part="page-header" data-app-design-owner="pack-classic">
      <div data-app-part="page-title" data-app-design-owner="pack-classic">
        <h1>Energy intelligence</h1><button aria-label="More information"></button>
      </div>
      <div data-app-part="page-actions" data-app-design-owner="pack-classic"><button aria-label="Save view"></button></div>
    </header>
    <header class="flex-row" data-many data-app-part="page-header" data-app-design-owner="pack-classic">
      <div data-app-part="page-title" data-app-design-owner="pack-classic"><h1>Action center</h1></div>
      <div data-many-actions data-app-part="page-actions" data-app-design-owner="pack-classic">
        <button aria-label="Refresh"></button><button aria-label="Copy"></button><button aria-label="Share"></button>
        <button aria-label="Save"></button><button aria-label="More"></button>
      </div>
    </header>
    <header class="flex-col" data-stacked data-app-part="page-header" data-app-design-owner="pack-classic">
      <div data-app-part="page-title" data-app-design-owner="pack-classic"><h1>Stacked header</h1></div>
    </header>
    <div data-widget-pack="classic">
      <header class="flex-row" data-protected data-app-part="page-header" data-app-design-owner="pack-classic">
        <div data-app-part="page-title" data-app-design-owner="pack-classic"><h1>Protected</h1></div>
      </header>
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
      await page.locator('html').evaluate((element, value) => { element.setAttribute('dir', value); }, direction);
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const scale of [0.85, 1.35]) {
          await page.locator('html').evaluate((element, value) => element.style.setProperty('--font-scale', String(value)), scale);
          const context = `${forcedColors}, ${direction}, ${width}, ${scale}`;
          const geometry = await page.evaluate(() => {
            const read = (selector: string) => {
              const header = document.querySelector<HTMLElement>(selector)!;
              const title = header.querySelector<HTMLElement>('[data-app-part~="page-title"]')!;
              const actions = header.querySelector<HTMLElement>('[data-app-part~="page-actions"]');
              const titleBox = title.getBoundingClientRect();
              const actionBox = actions?.getBoundingClientRect();
              return {
                title: { top: titleBox.top, bottom: titleBox.bottom, left: titleBox.left, right: titleBox.right },
                actions: actionBox && { top: actionBox.top, bottom: actionBox.bottom, left: actionBox.left, right: actionBox.right },
                overflow: header.scrollWidth - header.clientWidth,
                basis: getComputedStyle(title).flexBasis,
                columnGap: getComputedStyle(header).columnGap,
              };
            };
            return { single: read('[data-single]'), many: read('[data-many]'), stacked: read('[data-stacked]'), protected: read('[data-protected]') };
          });
          const actions = geometry.single.actions!;
          expect(Math.abs(actions.top - geometry.single.title.top), context).toBeLessThanOrEqual(1);
          expect(direction === 'ltr' ? actions.left >= geometry.single.title.right - 1 : actions.right <= geometry.single.title.left + 1, context).toBe(true);
          expect(geometry.single.overflow, context).toBeLessThanOrEqual(1);
          expect(geometry.many.overflow, context).toBeLessThanOrEqual(1);
          if (width === 360 && scale === 1.35) {
            expect(geometry.many.actions!.top, context).toBeGreaterThanOrEqual(geometry.many.title.bottom);
          }
          expect(geometry.stacked.basis, context).toBe('auto');
          expect(geometry.protected.basis, context).toBe('auto');
          expect(geometry.stacked.columnGap, context).toBe('4px');
          expect(geometry.protected.columnGap, context).toBe('4px');
        }
      }
    }
  }
});

test('workbench uses the full width when a section has no header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      [data-app-part="page-content"] { container-type: inline-size; width: 1000px; }
    </style>
    <main data-app-part="page-content">
      <section id="headed" data-app-part="section" data-app-design-owner="content-workbench">
        <header data-app-design-owner="content-workbench">Heading</header>
        <div data-app-design-owner="content-workbench">Content</div>
      </section>
      <section id="headerless" data-app-part="section" data-app-design-owner="content-workbench">
        <div data-app-design-owner="content-workbench">Standalone brief</div>
      </section>
      <section id="hidden-heading" data-app-part="section" data-app-design-owner="content-workbench">
        <header hidden data-app-design-owner="content-workbench">Hidden heading</header>
        <div data-app-design-owner="content-workbench">Standalone brief</div>
      </section>
    </main>
  `);
  await page.addStyleTag({ content: await readFile(resolve('src', 'components', 'ui', 'app-designs', 'shell.css'), 'utf8') });
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      headed: box('#headed'), header: box('#headed > header'), content: box('#headed > div'),
      headerless: box('#headerless'), brief: box('#headerless > div'),
      hiddenHeading: box('#hidden-heading'), hiddenBrief: box('#hidden-heading > div'),
    };
  });
  expect(geometry.content.left).toBeGreaterThan(geometry.header.right);
  expect(geometry.brief.left).toBeCloseTo(geometry.headerless.left, 0);
  expect(geometry.brief.right).toBeCloseTo(geometry.headerless.right, 0);
  expect(geometry.hiddenBrief.left).toBeCloseTo(geometry.hiddenHeading.left, 0);
  expect(geometry.hiddenBrief.right).toBeCloseTo(geometry.hiddenHeading.right, 0);
});

test('real phone navigation fits its reserved shell across packs and preferences', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      html { --density-gap: 8px; --density-pad-y: 8px; --density-pad-x: 12px; --shell-tab-bar-height: 64px; }
      html[data-tab-bar="off"] { --shell-tab-bar-height: 0px; }
      body { margin: 0; font-family: Arial, sans-serif; }
      button { align-items: center; justify-content: center; border: 0; font: inherit; font-weight: 500; }
      [data-role="status-bar"] { position: fixed; bottom: var(--shell-tab-bar-height); height: 44px; }
    </style>
    <div data-app-part="shell" data-presentation-mode="standard" data-owned>
      <footer data-role="status-bar"></footer>
      <nav data-role="bottom-tab-bar" data-app-part="navigation" data-owned class="sidenav-phone-tabs safe-bottom">
        ${['Home', 'Vehicles', 'Driving', 'Charging', 'More'].map(label => `
          <button aria-label="${label}" data-app-part="button nav-item" data-owned class="sidenav-phone-tab">
            <span class="nav-phone-icon" data-owned style="display:inline-flex;flex:none"><svg data-owned width="22" height="22"></svg></span>
            <span class="sidenav-tab-label" data-owned>${label}</span>
          </button>
        `).join('')}
      </nav>
    </div>
  `);
  const sheets = [
    ...['base.css', 'shell.css', 'controls.css', ...PACK_IDS.map(id => join('packs', APP_DESIGN_PACK_FILES[id])), 'mobile.css']
      .map(sheet => resolve('src', 'components', 'ui', 'app-designs', sheet)),
    resolve('src', 'components', 'layout', 'sidebar', 'sidenav.css'),
  ];
  for (const sheet of sheets) await page.addStyleTag({ content: await readFile(sheet, 'utf8') });

  for (const pack of PACK_IDS) {
    const owner = [`pack-${pack}`, ...Object.entries(APPLICATION_DESIGNS[pack]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
    await page.locator('html').evaluate((element, values) => {
      element.setAttribute('data-app-design-pack', values.pack);
      element.setAttribute('data-app-design-owner', values.owner);
      document.querySelectorAll('[data-owned]').forEach(node => node.setAttribute('data-app-design-owner', values.owner));
    }, { pack, owner });
    const exhaustive = pack === 'classic' || pack === 'v1';
    for (const forcedColors of ['none', 'active'] as const) {
      await page.emulateMedia({ forcedColors });
      for (const width of exhaustive ? [360, 390, 400, 401, 430] : [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const scale of exhaustive ? [0.85, 1, 1.35] : [1]) {
          for (const gap of exhaustive ? [8, 16] : [8]) {
            for (const safe of exhaustive ? [0, 24] : [24]) {
              const context = `${pack}, ${forcedColors}, ${width}px, scale ${scale}, gap ${gap}, inset ${safe}`;
              await page.locator('html').evaluate((element, values) => {
                element.style.setProperty('--font-scale', String(values.scale));
                element.style.setProperty('--density-gap', `${values.gap}px`);
                element.style.setProperty('--app-phone-tab-safe', `${values.safe}px`);
              }, { scale, gap, safe });
              expect(await findClippedBottomNavigationLabels(page), context).toEqual([]);
              expect(await findSplitBottomNavigationWords(page), context).toEqual([]);
              expect(await findSmallTouchTargets(page), context).toEqual([]);
              const geometry = await page.evaluate(() => {
                const nav = document.querySelector<HTMLElement>('[data-role="bottom-tab-bar"]')!;
                const bar = nav.getBoundingClientRect();
                const buttons = Array.from(nav.querySelectorAll('button'), button => button.getBoundingClientRect().toJSON());
                const status = document.querySelector<HTMLElement>('[data-role="status-bar"]')!.getBoundingClientRect();
                return {
                  bar: bar.toJSON(), buttons, status: status.toJSON(),
                  padding: parseFloat(getComputedStyle(nav).paddingBottom),
                  scrollWidth: document.documentElement.scrollWidth,
                };
              });
              expect(geometry.padding, context).toBe(safe);
              expect(geometry.bar.bottom, context).toBe(844);
              expect(geometry.status.bottom, context).toBeCloseTo(geometry.bar.top, 0);
              expect(geometry.scrollWidth, context).toBeLessThanOrEqual(width);
              for (const button of geometry.buttons) {
                expect(button.width, context).toBeGreaterThanOrEqual(44);
                expect(button.height, context).toBeGreaterThanOrEqual(44);
                expect(button.top, context).toBeGreaterThanOrEqual(geometry.bar.top);
                expect(button.bottom, context).toBeLessThanOrEqual(geometry.bar.bottom - safe + 0.5);
              }
              for (let i = 0; i < geometry.buttons.length; i++) {
                for (const other of geometry.buttons.slice(i + 1)) {
                  const button = geometry.buttons[i];
                  const overlap = Math.min(button.right, other.right) - Math.max(button.left, other.left) > 0.5
                    && Math.min(button.bottom, other.bottom) - Math.max(button.top, other.top) > 0.5;
                  expect(overlap, context).toBe(false);
                }
              }
            }
          }
        }
      }
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
