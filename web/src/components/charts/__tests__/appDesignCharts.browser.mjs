/**
 * Coordinator-only browser geometry gate. Uses an ALREADY RUNNING Vite dev
 * origin; this script never starts a server, installs tools or builds assets.
 *
 * PowerShell, from the repository root:
 * $env:CHART_DESIGN_BASE_URL='http://127.0.0.1:<coordinator-port>'
 * # Optional, only after the coordinator verifies this installed executable:
 * # $env:CHART_DESIGN_BROWSER_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
 * node web\src\components\charts\__tests__\appDesignCharts.browser.mjs
 *
 * A fresh, service-worker-blocked context permits only same-origin Vite/static
 * assets. GET /api/v1/settings is synthetic; other API/network requests fail
 * closed. Vite HMR WebSockets are stubbed, never connected to a server.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseURL = process.env.CHART_DESIGN_BASE_URL;
assert.ok(baseURL, 'CHART_DESIGN_BASE_URL must point to a coordinator-owned Vite dev server');
const fixtureOrigin = new URL(baseURL).origin;
const fixtureURL = new URL('/__chart_design_fixture__', fixtureOrigin).href;
const fixtureSettings = {
  locale: 'en-US', tz_display_default: 'utc', chart_palette: 'cb_safe', decimal_precision: 2,
};
const familyRepresentatives = {
  precision: 'classic', editorial: 'editorial', instrument: 'motorsport', soft: 'ambient', geometric: 'bauhaus',
};
const executablePath = process.env.CHART_DESIGN_BROWSER_EXECUTABLE?.trim();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({
  reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block',
});
const page = await context.newPage();
const errors = [];
const networkFailures = [];
const mockedApiRequests = [];
page.on('pageerror', error => errors.push(error.message));

async function settled() {
  assert.deepEqual(networkFailures, [], 'Unexpected network request was blocked');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.deepEqual(networkFailures, [], 'Unexpected network request was blocked');
}

async function measure() {
  return page.evaluate(() => {
    const root = document.querySelector('#chart-design-fixture');
    const first = root.querySelector('figure');
    const svg = first.querySelector('.recharts-wrapper > svg.recharts-surface');
    const plot = first.querySelector('[data-chart-viewport]');
    const plotted = [...root.querySelectorAll('[data-app-part~="chart-plot"]')].flatMap(owner =>
      [...owner.querySelectorAll('.recharts-wrapper > svg.recharts-surface')].map(surface => {
        const allocation = owner.getBoundingClientRect();
        const box = surface.getBoundingClientRect();
        const ancestors = [];
        for (let element = surface.parentElement; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          ancestors.push({
            tag: element.tagName, className: element.getAttribute('class'),
            part: element.getAttribute('data-app-part'),
            boxSizing: style.boxSizing, borderWidth: style.borderWidth,
            padding: style.padding, width: style.width, height: style.height,
          });
          if (element === owner) break;
        }
        return {
          chartKey: owner.closest('[data-chart-key]')?.getAttribute('data-chart-key') ?? null,
          width: box.width, height: box.height,
          allocation: { x: allocation.x, y: allocation.y, width: allocation.width, height: allocation.height },
          surface: { x: box.x, y: box.y, width: box.width, height: box.height },
          ancestors,
          fits: box.left >= allocation.left - 1 && box.right <= allocation.right + 1
            && box.top >= allocation.top - 1 && box.bottom <= allocation.bottom + 1,
        };
      }),
    );
    const legend = first.querySelector('.recharts-legend-wrapper').getBoundingClientRect();
    const bounds = plot.getBoundingClientRect();
    const header = first.querySelector('[data-app-part~="chart-header"]');
    const title = header.querySelector('[data-card-title-group]');
    const toolbar = header.querySelector('[data-chart-toolbar]');
    const legendContent = first.querySelector('[data-app-part~="chart-legend"]');
    const legendList = legendContent.querySelector('.recharts-default-legend');
    const legendItems = [...legendContent.querySelectorAll('.recharts-legend-item')];
    const tooltip = [...root.children].find(element => element.matches('[data-app-part~="chart-tooltip"]'));
    const tooltipRow = tooltip.querySelector('[data-chart-tooltip-row]');
    const tooltipName = tooltipRow.querySelector('[data-chart-tooltip-name]');
    const tooltipValue = tooltipRow.querySelector('[data-chart-tooltip-value]');
    const previewTooltip = root.querySelector('[data-app-design-preview] [data-app-part~="chart-tooltip"]');
    const previewStyle = getComputedStyle(previewTooltip);
    const previewRowStyle = getComputedStyle(previewTooltip.querySelector('[data-chart-tooltip-row]'));
    const relativeBox = (element, owner) => {
      const box = element.getBoundingClientRect();
      const parent = owner.getBoundingClientRect();
      return { x: box.left - parent.left, y: box.top - parent.top, width: box.width, height: box.height };
    };
    const fits = (element, owner) => {
      const box = relativeBox(element, owner);
      const parent = owner.getBoundingClientRect();
      return box.x >= -1 && box.y >= -1
        && box.x + box.width <= parent.width + 1 && box.y + box.height <= parent.height + 1;
    };
    const columns = element => {
      const style = getComputedStyle(element);
      return style.display.includes('grid') && style.gridTemplateColumns !== 'none'
        ? style.gridTemplateColumns.trim().split(/\s+/).length : 0;
    };
    const titleBox = relativeBox(title, header);
    const toolbarBox = relativeBox(toolbar, header);
    const toolbarBelowTitle = toolbarBox.y >= titleBox.y + titleBox.height - 1;
    const toolbarCenterOffset = toolbarBox.y + toolbarBox.height / 2 - titleBox.y - titleBox.height / 2;
    const nameBox = relativeBox(tooltipName, tooltipRow);
    const valueBox = relativeBox(tooltipValue, tooltipRow);
    const power = first.querySelector('.recharts-line-curve');
    const gauge = root.querySelector('[data-chart-family="linear-gauge"]');
    const signed = root.querySelector('[data-chart-family="bipolar"]');
    return {
      mode: document.documentElement.dataset.appChart,
      owner: first.getAttribute('data-app-design-owner'),
      partOwners: [header, title, toolbar, legendContent, legendList, tooltip, tooltipRow, power]
        .map(element => element.getAttribute('data-app-design-owner')),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      plotted,
      powerColor: getComputedStyle(power).stroke,
      gapSegments: power.getAttribute('d').match(/M/g)?.length,
      areaColor: getComputedStyle(first.querySelector('.recharts-area-area')).fill,
      bars: first.querySelectorAll('.recharts-bar-rectangle').length,
      annotationColor: getComputedStyle(first.querySelector('.recharts-reference-line-line')).stroke,
      travellers: first.querySelectorAll('.recharts-brush-traveller').length,
      legendFits: legend.left >= bounds.left - 1 && legend.right <= bounds.right + 1
        && legend.top >= bounds.top - 1 && legend.bottom <= bounds.bottom + 1,
      axisLabels: [...svg.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map(label => label.textContent),
      gaugeWidth: gauge.querySelector('[data-chart-gauge-fill]').style.width,
      targetPosition: gauge.querySelector('[data-chart-gauge-marker]').style.left,
      signedWidth: signed.querySelector('[data-chart-gauge-fill]').style.width,
      signedStart: signed.querySelector('[data-chart-gauge-fill]').style.left,
      alternative: first.querySelector('[data-chart-alternative]').textContent,
      heatmap: [...root.querySelectorAll('[data-heatmap-state]')].map(cell => ({
        state: cell.dataset.heatmapState, color: getComputedStyle(cell).backgroundColor,
      })),
      tooltipValues: [...root.querySelectorAll('[data-chart-tooltip-value]')].map(value => value.textContent),
      composition: {
        header: {
          display: getComputedStyle(header).display,
          alignItems: getComputedStyle(header).alignItems,
          columns: columns(header),
          title: titleBox,
          toolbar: toolbarBox,
          titleFullWidth: titleBox.width >= header.getBoundingClientRect().width * 0.95,
          toolbarPlacement: toolbarBelowTitle ? 'below' : 'alongside',
          toolbarCenterOffset,
          toolbarAlignment: toolbarBelowTitle ? 'below' : Math.abs(toolbarCenterOffset) <= 1
            ? 'centered' : toolbarCenterOffset < 0 ? 'above-center' : 'below-center',
          fits: fits(title, header) && fits(toolbar, header),
        },
        legend: {
          display: getComputedStyle(legendList).display,
          columns: columns(legendList),
          box: relativeBox(legendContent, plot),
          items: legendItems.map(item => relativeBox(item, legendContent)),
          itemsFit: legendItems.every(item => fits(item, legendContent)),
          insetBlockStart: legendItems[0].getBoundingClientRect().top - legendContent.getBoundingClientRect().top,
        },
        tooltip: {
          display: getComputedStyle(tooltipRow).display,
          columns: columns(tooltipRow),
          name: nameBox,
          value: valueBox,
          valuePlacement: valueBox.y >= nameBox.y + nameBox.height - 1 ? 'below' : 'alongside',
          fits: fits(tooltipName, tooltipRow) && fits(tooltipValue, tooltipRow),
        },
      },
      previewStyle: {
        padding: previewStyle.padding, border: previewStyle.borderWidth,
        radius: previewStyle.borderRadius, background: previewStyle.backgroundColor,
        rowDisplay: previewRowStyle.display, rowColumns: previewRowStyle.gridTemplateColumns,
      },
      previewOwner: previewTooltip.getAttribute('data-app-design-owner'),
      gaugeTransition: getComputedStyle(gauge.querySelector('[data-chart-gauge-fill]')).transitionDuration,
      ringSectors: root.querySelectorAll('.recharts-pie-sector .recharts-sector').length,
      scatterPoints: root.querySelectorAll('.recharts-scatter-symbol').length,
      radar: root.querySelectorAll('.recharts-radar-polygon').length,
      sparklineSegments: root.querySelectorAll('svg[data-chart-family="sparkline"] polyline[fill="none"]').length,
    };
  });
}

// Only structural layout/placement participates: not pack IDs, colors, radii,
// font metrics or arbitrary size differences between identity treatments.
function compositionFingerprint({ header, legend, tooltip }) {
  return JSON.stringify({
    header: [header.display, header.columns, header.titleFullWidth, header.toolbarPlacement, header.toolbarAlignment],
    legend: legend.display,
    tooltip: [tooltip.display, tooltip.columns, tooltip.valuePlacement],
  });
}

function assertCompositionActivation(result, baseline, pack) {
  assert.ok(result.owner?.split(' ').includes(`pack-${pack}`), `${pack}: missing complete-profile ownership`);
  assert.ok(result.partOwners.every(owner => owner === result.owner), `${pack}: unstamped actual chart/vendor part`);
  assert.notEqual(compositionFingerprint(result.composition), compositionFingerprint(baseline.composition),
    `${pack}: no measured layout activation beyond the unselected chart`);
  const { header, legend, tooltip } = result.composition;
  assert.ok(header.title.width > 0 && header.title.height > 0
    && header.toolbar.width > 0 && header.toolbar.height > 0 && header.fits, `${pack}: header allocation`);
  assert.ok(legend.display === 'grid' && legend.columns > 0 && legend.items.length > 0
    && legend.items.every(item => item.width > 0 && item.height > 0) && legend.itemsFit, `${pack}: real legend grid allocation`);
  assert.ok(legend.insetBlockStart > baseline.composition.legend.insetBlockStart + 0.5,
    `${pack}: legend composition did not activate`);
  assert.ok(tooltip.display === 'grid' && tooltip.columns >= 2 && tooltip.fits
    && tooltip.name.width > 0 && tooltip.value.width > 0, `${pack}: real tooltip layout activation`);
}

function assertFamilyComposition(family, result) {
  assert.equal(result.mode, family, `${family}: representative descriptor changed`);
  const { header, tooltip } = result.composition;
  assert.equal(tooltip.columns, family === 'editorial' ? 2 : 3, `${family}: tooltip reading hierarchy`);
  assert.equal(tooltip.valuePlacement, family === 'editorial' ? 'below' : 'alongside');
  if (family === 'editorial' || family === 'geometric') {
    assert.equal(header.display, 'grid');
    assert.equal(header.columns, family === 'editorial' ? 1 : 2);
    assert.equal(header.toolbarPlacement, family === 'editorial' ? 'below' : 'alongside');
  } else {
    assert.equal(header.display, 'flex');
    assert.equal(header.alignItems, family === 'precision' ? 'baseline' : family === 'instrument' ? 'center' : 'flex-start');
    if (family === 'precision') assert.notEqual(header.toolbarAlignment, 'centered', 'Precision baseline must differ geometrically from the centered instrument strip');
    if (family === 'instrument') assert.equal(header.toolbarAlignment, 'centered');
    if (family === 'soft') {
      assert.equal(header.titleFullWidth, true);
      assert.equal(header.toolbarPlacement, 'below');
    }
  }
}

function assertGeometry(result, baseline, label) {
  assert.equal(result.overflow, false, `${label}: page overflow`);
  assert.ok(result.plotted.length >= 7, `${label}: missing real chart SVGs`);
  assert.ok(result.plotted.every(plot => plot.width > 0 && plot.height > 0 && plot.fits),
    `${label}: SVG outside its allocated plot: ${JSON.stringify(result.plotted.filter(plot => plot.width <= 0 || plot.height <= 0 || !plot.fits))}`);
  assert.equal(result.legendFits, true, `${label}: clipped legend controls`);
  for (const key of ['powerColor', 'areaColor', 'annotationColor', 'gapSegments', 'bars',
    'travellers', 'gaugeWidth', 'targetPosition', 'signedWidth', 'signedStart', 'alternative',
    'heatmap', 'tooltipValues', 'ringSectors', 'scatterPoints', 'radar', 'sparklineSegments']) {
    assert.deepEqual(result[key], baseline[key], `${label}: changed source meaning (${key})`);
  }
  assert.ok(result.axisLabels.includes('-50') && result.axisLabels.includes('100'), `${label}: lost domain labels`);
  assert.deepEqual(result.previewStyle, baseline.previewStyle, `${label}: application mode leaked into an isolated preview`);
  assert.equal(result.previewOwner, baseline.previewOwner, `${label}: preview inherited live-root ownership`);
  assert.ok(Number.parseFloat(result.gaugeTransition) <= 0.00001, `${label}: reduced-motion gauge animates`);
}

try {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const fail = async () => {
      networkFailures.push(`${request.method()} ${url.origin}${url.pathname} (${request.resourceType()})`);
      await route.abort('blockedbyclient');
    };
    if (url.origin !== fixtureOrigin) return fail();
    if (request.method() === 'GET' && url.pathname === '/api/v1/settings' && url.search === '') {
      mockedApiRequests.push('GET /api/v1/settings');
      return route.fulfill({
        status: 200, json: fixtureSettings,
        headers: { 'cache-control': 'no-store', 'x-chart-fixture': 'settings' },
      });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return fail();
    if (request.method() === 'GET' && url.href === fixtureURL && request.resourceType() === 'document') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
      </script><script type="module" src="/@vite/client"></script></head><body>
      <script type="module" src="/src/components/charts/__tests__/appDesignCharts.browser.fixture.tsx"></script></body></html>`,
      });
    }
    if (request.method() === 'GET' && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    const staticPath = /^\/(?:src\/|node_modules\/|@(?:vite|id|fs)\/|@react-refresh(?:\/|$)|fonts\/|assets\/|icons\/|images\/)/.test(url.pathname);
    const staticType = ['script', 'stylesheet', 'font', 'image', 'other'].includes(request.resourceType());
    if (['GET', 'HEAD'].includes(request.method()) && staticPath && staticType) return route.continue();
    return fail();
  });
  await context.routeWebSocket('**/*', async socket => {
    const url = new URL(socket.url());
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    if (url.origin === fixtureOrigin && !url.pathname.startsWith('/api')
      && socket.protocols().includes('vite-hmr')) {
      socket.onMessage(() => undefined);
      return;
    }
    networkFailures.push(`WebSocket ${url.origin}${url.pathname}`);
    await socket.close({ code: 1008, reason: 'Unexpected fixture network request' });
  });
  await page.goto(fixtureURL);
  const settingsProbe = await page.evaluate(async () => {
    const response = await fetch('/api/v1/settings');
    return { status: response.status, fixture: response.headers.get('x-chart-fixture'), body: await response.json() };
  });
  assert.deepEqual(settingsProbe, { status: 200, fixture: 'settings', body: fixtureSettings });
  await page.locator('.recharts-line-curve').first().waitFor();
  await page.locator('[data-testid="small-multiples-cell-power"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-testid="small-multiples-cell-power"] .recharts-line-curve'));
  await settled();
  const baseline = await measure();
  assert.equal(baseline.gapSegments, 2);
  assert.equal(baseline.previewStyle.rowDisplay, 'grid', 'The isolated preview did not activate its actual chart composition');
  assert.ok(baseline.previewOwner?.split(' ').includes('pack-quiet'), 'Preview ownership observer did not activate');
  assert.equal(await page.getByText('Source content must not render until ready', { exact: true }).count(), 0);
  for (const state of ['loading', 'empty', 'error']) {
    assert.equal(await page.locator(`figure[data-chart-state="${state}"]`).count(), 1);
  }
  const packs = await page.evaluate(() => window.chartDesignCoverage.packs);
  assert.equal(packs.length, 27);
  const measuredPacks = new Map();
  for (const pack of packs) {
    await page.evaluate(pack => window.chartDesignCoverage.apply(pack), pack);
    await settled();
    const result = await measure();
    assertGeometry(result, baseline, pack);
    assertCompositionActivation(result, baseline, pack);
    measuredPacks.set(pack, result);
    console.log(JSON.stringify({ pack, width: 1280, mode: result.mode, svgCount: result.plotted.length,
      composition: result.composition, status: 'geometry passed' }));
  }
  const compositions = new Set();
  for (const [family, pack] of Object.entries(familyRepresentatives)) {
    const result = measuredPacks.get(pack);
    assert.ok(result, `Missing measured family representative: ${pack}`);
    assertFamilyComposition(family, result);
    compositions.add(compositionFingerprint(result.composition));
  }
  assert.equal(compositions.size, 5, 'The five chart families must have distinct measured structural compositions');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => {
      document.documentElement.classList.toggle('light-mode', theme === 'light');
      document.documentElement.style.colorScheme = theme;
      document.documentElement.style.setProperty('--font-scale', '1.35');
      document.documentElement.dir = 'rtl';
    }, theme);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => window.chartDesignCoverage.clear());
    await settled();
    const narrowBaseline = await measure();
    for (const pack of Object.values(familyRepresentatives)) {
      await page.evaluate(pack => window.chartDesignCoverage.apply(pack), pack);
      await settled();
      const result = await measure();
      assertGeometry(result, narrowBaseline, `${pack}/${theme}/320/RTL/135%`);
      assertCompositionActivation(result, narrowBaseline, pack);
      console.log(JSON.stringify({ pack, theme, width: 320, direction: 'rtl', textScale: 1.35, status: 'geometry passed' }));
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
  const first = page.locator('figure').first();
  await first.getByRole('button', { name: 'Signed power', exact: true }).click();
  await first.locator('.recharts-line-curve').waitFor({ state: 'detached' });
  assert.equal(await first.locator('.recharts-line-curve').count(), 0);
  assert.equal(await first.getByRole('button', { name: 'Signed power', exact: true }).getAttribute('data-series-key'), 'power');
  await first.getByRole('button', { name: 'Signed power', exact: true }).click();
  await first.locator('.recharts-line-curve').waitFor({ state: 'visible' });
  const endTraveller = await first.locator('.recharts-brush-traveller').last().boundingBox();
  assert.ok(endTraveller, 'Missing draggable native brush traveller');
  await page.mouse.move(endTraveller.x + endTraveller.width / 2, endTraveller.y + endTraveller.height / 2);
  await page.mouse.down();
  await page.mouse.move(endTraveller.x - 100, endTraveller.y + endTraveller.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(await first.locator('[data-brush-range]').textContent(), '0–4');
  assert.equal(await first.locator('[data-chart-alternative]').textContent(), baseline.alternative, 'Brush changed the full accessible source data');
  await first.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await page.locator('figure:fullscreen').waitFor();
  await first.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await first.getByRole('button', { name: 'Export chart', exact: true }).click();
  assert.ok(await page.getByRole('menuitem', { name: /CSV/ }).count());
  await page.keyboard.press('Escape');
  for (const media of ['print', 'screen']) {
    await page.emulateMedia({ media, forcedColors: media === 'screen' ? 'active' : 'none' });
    await page.evaluate(() => window.chartDesignCoverage.clear());
    const before = await first.locator('header').evaluate(header => getComputedStyle(header).display);
    await page.evaluate(() => window.chartDesignCoverage.apply('editorial'));
    const after = await first.locator('header').evaluate(header => getComputedStyle(header).display);
    assert.equal(after, before, `${media}: app design overrode the fallback`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(networkFailures, [], 'Unexpected network request was blocked');
  assert.ok(mockedApiRequests.includes('GET /api/v1/settings'), 'Settings response was not served by the fixture interceptor');
  await page.evaluate(() => window.chartDesignCoverage.dispose());
  assert.equal(await page.locator('[data-app-design-owner]').count(), 0, 'Fixture did not release its scope observer');
  console.log('PASS: 27 measured shared-owner compositions, five structurally distinct families, five narrow/RTL/135% modes, source invariants, legend IDs, brush, fullscreen, export controls, preview/print/forced-color isolation and observer cleanup');
  console.log(JSON.stringify({ mockedApiRequests, unexpectedNetworkRequests: networkFailures.length }));
} finally {
  try {
    if (!page.isClosed()) await page.evaluate(() => window.chartDesignCoverage?.dispose());
  } finally {
    await browser.close();
  }
}
