// @vitest-environment node
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { AreaChartWrapper } from '@/components/charts/AreaChartWrapper';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { HistoryListRow } from '@/components/data-display/HistoryListRow';
import { InlineMetric } from '@/components/data-display/InlineMetric';
import { StatCard } from '@/components/data-display/StatCard';
import { UsageCard } from '@/components/data-display/UsageCard';
import { WidgetBigNumber } from '@/features/dashboard/widgets/shared/WidgetBigNumber';
import { WidgetComparisonCard } from '@/features/dashboard/widgets/shared/WidgetComparisonCard';
import { WidgetGaugeHero } from '@/features/dashboard/widgets/shared/WidgetGaugeHero';
import InstrumentLayout from '@/features/dashboard/widgets/designPacks/families/InstrumentLayout';
import LineTelemetryLayout from '@/features/dashboard/widgets/designPacks/families/LineTelemetryLayout';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '../designs';

const sheets = PACK_IDS.map(pack => {
  const root = postcss.parse(readFileSync(new URL(`./${APP_DESIGN_PACK_FILES[pack]}`, import.meta.url), 'utf8'));
  const rules: postcss.Rule[] = [];
  root.walkRules(rule => { rules.push(rule); });
  return { pack, rules };
});
const nativeAreaRows = [{ sample: 0, power: 25 }];

function nativeMarkup() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(['settings'], {
    unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
    locale: 'en-US', decimal_precision: 2, currency_symbol: '$',
  });
  try {
    return renderToStaticMarkup(<QueryClientProvider client={client}>
      <StatCard label="Ordinary stat" value={25} />
      <UsageCard bands={[{ label: 'Ordinary grid', value: 25 }]} />
      <ChartContainer variant="embedded" title="Native area" ariaLabel="Retained observations"
        height={300} mobileHeight={300} exportable={false} data={nativeAreaRows}
        dataColumns={[{ key: 'sample', label: 'Sample' }, { key: 'power', label: 'Power' }]}>
        <AreaChartWrapper data={nativeAreaRows} xKey="sample" height={300}
          series={[{ key: 'power', label: 'Power', color: 'var(--semantic-warning)' }]} />
      </ChartContainer>
      <AreaChartWrapper data={nativeAreaRows} xKey="sample" height={300}
        ariaLabel="Standalone native observations"
        series={[{ key: 'power', label: 'Power', color: 'var(--semantic-warning)' }]} />
      <HistoryListRow primary="History" metrics={<InlineMetric icon={null} label="Distance" value={12} />} hideChevron />
      <WidgetBigNumber value={0} label="Centered headline" unit="mi" size="secondary" align="center" animated={false} />
      <WidgetBigNumber value={null} label="Unknown headline" unit="mi" subtitle="Retained context" animated={false} />
      <WidgetComparisonCard previousLabel="Previous" metrics={[{
        label: 'Comparison', current: 25, previous: 20, formattedCurrent: '25', formattedPrevious: '20 mi', unit: 'mi',
      }]} />
      <LineTelemetryLayout appearance="precision" headline={{ label: 'Line headline', value: 0, unit: 'mi' }}
        details={[{ label: 'Line fact', value: 25, unit: 'mi' }]} sourceBoundary={children => children}
        chart={<svg viewBox="0 0 7 11" aria-label="Caller geometry"><path d="M0 5 L5 0" /></svg>} />
      {(['studio', 'analog'] as const).map(appearance => <InstrumentLayout key={appearance}
        appearance={appearance} family="ring" headline={<WidgetBigNumber value={25} unit="%" animated={false} />}
        reading={{ value: 25, max: 100, label: 'Recovery', color: 'var(--semantic-warning)' }} />)}
      {[25, 0, null].map(value => <WidgetGaugeHero key={String(value)}
        gauge={{ value, max: 100, label: String(value), unit: '%', color: 'var(--semantic-warning)',
          marker: 75, preserveReadingAndScale: true }}
        stats={[{ label: 'Native stat', value: 0, unit: 'mi' }]}><span>Caller content</span></WidgetGaugeHero>)}
      <WidgetGaugeHero gauge={{ value: 10, max: 0, label: 'Invalid scale', unit: '%',
        color: 'var(--semantic-warning)', preserveReadingAndScale: true }} />
      <WidgetGaugeHero compact gauge={{ value: 25, max: 100, label: 'Compact', unit: '%', color: 'var(--semantic-warning)' }}
        stats={[{ label: 'Omitted stat', value: 25 }]}><span>Omitted content</span></WidgetGaugeHero>
    </QueryClientProvider>);
  } finally { client.clear(); }
}

const markup = nativeMarkup();
const metricSlots = '[data-app-part~="metric"], [data-app-part~="metric-label"], [data-app-part~="metric-value"]';
const geometry = '[data-chart-gauge-track], [data-chart-gauge-fill], [data-chart-gauge-marker], [data-chart-gauge-tick], svg, svg *';

function declarations(element: Element, rules: postcss.Rule[]) {
  return rules.filter(rule => element.matches(rule.selector)).flatMap(rule =>
    rule.nodes.filter((node): node is postcss.Declaration => node.type === 'decl')
      .map(node => ({ property: node.prop, value: node.value, selector: rule.selector })));
}

function fixture(pack: typeof PACK_IDS[number]) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) doc.documentElement.setAttribute(name, value);
  doc.body.innerHTML = markup;
  const release = observeAppDesignScopes(doc.documentElement);
  return { doc, dispose: () => { release(); dom.window.close(); } };
}

describe.each(sheets)('$pack native composition preservation', ({ pack, rules }) => {
  it('keeps the native host, inline bank and specialized metrics outside generic card restructuring at every breakpoint', () => {
    const view = fixture(pack);
    try {
      for (const host of view.doc.querySelectorAll(
        '[data-app-metric-grid="inline"], [data-app-metric-grid="native-gauge"], [data-app-metric="headline"], [data-app-metric="comparison"], [data-app-metric="ring"]',
      )) {
        expect(declarations(host, rules), host.outerHTML).toEqual([]);
        if (!host.matches('[data-app-metric-grid="inline"]')) {
          for (const slot of host.querySelectorAll(metricSlots)) {
            expect(declarations(slot, rules), slot.outerHTML).toEqual([]);
          }
        }
      }
      expect(declarations(view.doc.querySelector('[data-app-metric="stat-card"]')!, rules).length).toBeGreaterThan(0);
      expect(declarations(view.doc.querySelector('[data-app-part~="metric-grid"]:not([data-app-metric-grid])')!, rules))
        .toEqual(expect.arrayContaining([expect.objectContaining({ property: 'display', value: 'grid' })]));
    } finally { view.dispose(); }
  });

  it('preserves actual native data paint, extents, zero, unknown and invalid-scale branches', () => {
    const view = fixture(pack);
    try {
      for (const element of view.doc.querySelectorAll(geometry)) {
        expect(declarations(element, rules), element.outerHTML).toEqual([]);
      }
      const gauges = view.doc.querySelectorAll('[data-app-metric-grid="native-gauge"]');
      expect(gauges).toHaveLength(5);
      expect(gauges[0].classList.contains('flex-col')).toBe(true);
      expect(gauges[0].querySelector('[data-chart-gauge-fill]')?.getAttribute('style'))
        .toBe('width:25%;background-color:var(--semantic-warning)');
      expect(gauges[0].querySelector('[data-chart-gauge-marker]')?.getAttribute('style')).toBe('left:75%');
      expect(gauges[1].querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0');
      expect(gauges[1].querySelector('[data-chart-gauge-fill]')?.getAttribute('style')).toContain('width:0%');
      for (const gauge of [gauges[2], gauges[3]]) {
        expect(gauge.querySelector('[role="meter"], [data-chart-gauge-fill]')).toBeNull();
      }
      expect(gauges[3].querySelector('[data-chart-readout]')?.textContent).toContain('10');
      expect(gauges[4].querySelector('[data-app-part~="metric"]')).toBeNull();
      expect(gauges[4].textContent).not.toContain('Omitted');
      expect(view.doc.querySelector('[data-chart-gauge-fill][stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe('25 100');
      expect(view.doc.querySelectorAll('[data-chart-gauge-tick]')).toHaveLength(11);
      expect(view.doc.querySelector('svg[aria-label="Caller geometry"] path')?.getAttribute('d')).toBe('M0 5 L5 0');
      const centered = view.doc.querySelector('[data-app-metric="headline"]')!;
      expect(centered.classList.contains('items-center')).toBe(true);
      expect(centered.querySelector('[data-app-part~="metric-value"]')?.textContent).toBe('0');
      expect(centered.nextElementSibling?.querySelector('[data-app-part~="metric-unit"]')).toBeNull();
    } finally { view.dispose(); }
  });

  it('keeps identity plot frames out of native viewport and renderer allocation at every breakpoint', () => {
    const view = fixture(pack);
    try {
      const plots = view.doc.querySelectorAll('[data-app-part~="chart-plot"]');
      expect(plots).toHaveLength(3);
      const frameLayout = /^(?:border(?:-.+)?|padding(?:-.+)?|margin(?:-.+)?|display|flex(?:-.+)?|grid(?:-.+)?|gap|(?:row|column)-gap|(?:min-|max-)?(?:width|height|inline-size|block-size)|position|inset(?:-.+)?|top|right|bottom|left|transform|translate|scale|zoom|box-sizing|contain)$/;
      for (const plot of [...plots, ...view.doc.querySelectorAll('.recharts-responsive-container, .recharts-wrapper')]) {
        const layout = declarations(plot, rules).filter(({ property, value }) =>
          frameLayout.test(property) && property !== 'border-radius'
          && !(property === 'min-inline-size' && value === '0'));
        expect(layout, `${plot.tagName} ${plot.getAttribute('data-chart-family') ?? 'bounded plot'}`).toEqual([]);
      }
      const viewport = view.doc.querySelector('[data-chart-viewport="bounded"]')!;
      expect(viewport.classList.contains('[contain:layout_size]')).toBe(true);
      expect(viewport.getAttribute('style')).toContain('--chart-height-desktop:300px');
      expect(viewport.getAttribute('style')).toContain('--chart-height-mobile:300px');
      expect(viewport.querySelector('[data-chart-family="area"] .recharts-responsive-container')).not.toBeNull();
      expect(view.doc.querySelectorAll('[data-chart-family="area"]')).toHaveLength(2);
      for (const container of view.doc.querySelectorAll<HTMLElement>('.recharts-responsive-container')) {
        expect(container.style.height).toBe('300px');
      }
      expect(declarations(viewport, rules).some(({ property }) => property.startsWith('background'))).toBe(true);
    } finally { view.dispose(); }
  });

  it('honors nearest complete and incomplete previews, widget-only neutrality and final-target ownership', async () => {
    const view = fixture(pack);
    try {
      const next = sheets[(PACK_IDS.indexOf(pack) + 1) % sheets.length];
      const complete = view.doc.createElement('section');
      complete.setAttribute('data-app-design-preview', '');
      for (const [name, value] of Object.entries(getAppDesignAttributes(next.pack))) complete.setAttribute(name, value);
      complete.innerHTML = renderToStaticMarkup(<StatCard label="Preview" value={0} />);
      complete.append(view.doc.querySelector('[data-chart-viewport]')!.cloneNode(true));
      const incomplete = complete.cloneNode(true) as Element;
      incomplete.removeAttribute('data-app-header');
      const rescued = complete.cloneNode(true) as Element;
      incomplete.append(rescued);
      view.doc.body.append(complete, incomplete);
      await Promise.resolve();
      const previewMetric = complete.querySelector('[data-app-part~="metric"]')!;
      expect(declarations(previewMetric, rules)).toEqual([]);
      expect(declarations(previewMetric, next.rules).length).toBeGreaterThan(0);
      const previewPlot = complete.querySelector('[data-chart-viewport]')!;
      expect(previewPlot.getAttribute('data-app-design-owner')).toContain(`pack-${next.pack}`);
      expect(declarations(previewPlot, rules)).toEqual([]);
      expect(declarations(previewPlot, next.rules).length).toBeGreaterThan(0);
      const neutralMetric = incomplete.querySelector('[data-app-part~="metric"]')!;
      for (const sheet of sheets) {
        expect(declarations(neutralMetric, sheet.rules)).toEqual([]);
        for (const plot of incomplete.querySelector('[data-chart-viewport]')!.querySelectorAll('[data-app-part~="chart-plot"]')) {
          expect(declarations(plot, sheet.rules)).toEqual([]);
        }
        expect(declarations(incomplete.querySelector('[data-chart-viewport]')!, sheet.rules)).toEqual([]);
      }
      expect(declarations(rescued.querySelector('[data-app-part~="metric"]')!, next.rules).length).toBeGreaterThan(0);
      expect(declarations(rescued.querySelector('[data-chart-viewport]')!, next.rules).length).toBeGreaterThan(0);
      const target = view.doc.querySelector('[data-app-metric="stat-card"]')!;
      expect(target.parentElement?.hasAttribute('data-app-design-owner')).toBe(true);
      target.removeAttribute('data-app-design-owner');
      expect(declarations(target, rules)).toEqual([]);
      previewPlot.removeAttribute('data-app-design-owner');
      expect(declarations(previewPlot, next.rules)).toEqual([]);
      view.doc.documentElement.removeAttribute('data-app-design-pack');
      await Promise.resolve();
      for (const element of view.doc.body.querySelectorAll(
        ':scope > [data-app-part~="metric"], :scope > [data-app-metric-grid="native-gauge"]',
      )) {
        for (const sheet of sheets) expect(declarations(element, sheet.rules)).toEqual([]);
      }
      for (const plot of view.doc.querySelectorAll('body > figure [data-app-part~="chart-plot"], body > [data-chart-family="area"]')) {
        for (const sheet of sheets) expect(declarations(plot, sheet.rules)).toEqual([]);
      }
    } finally { view.dispose(); }
  });
});

it.each(['classic', 'v4', 'v6', 'v7', 'editorial', 'terminal', 'atlas', 'bauhaus', 'brutal'] as const)(
  'keeps %s phone metric typography outside protected and native gauge surfaces', async pack => {
  const view = fixture(pack);
  try {
    const sheet = sheets.find(candidate => candidate.pack === pack)!;
    const metric = pack === 'classic'
      ? '<div class="widget-detail-list"><span class="text-xs">Recent context</span></div>'
      : renderToStaticMarkup(<WidgetBigNumber value={12} unit="km" subtitle="Recent context" animated={false} />);
    const widget = view.doc.createElement('section');
    widget.setAttribute('data-widget-pack', pack);
    widget.innerHTML = `
      <div data-case="ordinary">${metric}</div>
      <div data-case="protected" data-app-design-preserve>${metric}</div>
      <div data-case="gauge" data-app-metric-grid="native-gauge">${metric}</div>
      <div data-case="bar" data-app-metric="bar">${metric}</div>
      <div data-case="ring" data-app-metric="ring">${metric}</div>
      <div data-case="composition" data-app-metric="composition">${metric}</div>
      <div data-case="score" data-app-metric="score">${metric}</div>
      <div data-case="segments" data-app-metric="segments">${metric}</div>
      <div data-case="report" data-presentation-mode="report">${metric}</div>
      <div data-case="kiosk" data-presentation-mode="kiosk">${metric}</div>`;
    view.doc.body.append(widget);
    await Promise.resolve();
    for (const kind of ['ordinary', 'protected', 'gauge', 'bar', 'ring', 'composition', 'score', 'segments', 'report', 'kiosk']) {
      const parts = pack === 'classic' ? ['.text-xs'] : ['[data-app-part~="metric-context"]', '[data-app-part~="metric-unit"]'];
      for (const part of parts) {
        const element = widget.querySelector(`[data-case="${kind}"] ${part}`)!;
        if (kind === 'protected') element.setAttribute('data-app-design-owner', `pack-${pack}`);
        const typography = declarations(element, sheet.rules).filter(({ property }) => property === 'font-size');
        if (kind === 'ordinary') {
          expect(typography, `${kind} ${part}`).toEqual(expect.arrayContaining([
            expect.objectContaining({ value: expect.stringContaining('--app-body-size') }),
          ]));
          element.removeAttribute('data-app-design-owner');
          expect(declarations(element, sheet.rules).filter(({ property }) => property === 'font-size')).toEqual([]);
        } else {
          expect(typography, `${kind} ${part}`).toEqual([]);
        }
      }
    }
  } finally { view.dispose(); }
});

it('retains a same-property Ambient atmosphere fallback before the color-mix enhancement', () => {
  const view = fixture('ambient');
  try {
    const main = view.doc.createElement('main');
    main.setAttribute('data-app-part', 'shell-main');
    view.doc.body.append(main);
    const release = observeAppDesignScopes(main);
    try {
      const images = declarations(main, sheets.find(sheet => sheet.pack === 'ambient')!.rules)
        .filter(({ property }) => property === 'background-image').map(({ value }) => value);
      expect(images).toHaveLength(2);
      expect(images[0]).toMatch(/^radial-gradient\(.+var\(--surface-2\).+transparent 60%\)$/);
      expect(images[0]).not.toContain('color-mix(');
      expect(images[1]).toContain('color-mix(in srgb, var(--theme-accent) 4%, transparent)');
    } finally { release(); }
  } finally { view.dispose(); }
});

it('keeps Analog plot ink out of the nested native viewport and ResponsiveContainer allocation', () => {
  const view = fixture('analog');
  try {
    const viewport = view.doc.querySelector('[data-chart-viewport]')!;
    const area = viewport.querySelector('[data-chart-family="area"]')!;
    expect(area.querySelector('.recharts-responsive-container')).not.toBeNull();
    const rules = sheets.find(sheet => sheet.pack === 'analog')!.rules;
    for (const plot of [viewport, area]) {
      const ink = declarations(plot, rules);
      expect(ink.filter(({ property }) => /^(?:border(?:-.+)?|padding(?:-.+)?)$/.test(property))).toEqual([]);
      expect(ink).toEqual(expect.arrayContaining([expect.objectContaining({
        property: 'box-shadow', value: 'inset 0 0 0 1px var(--border-default)',
      })]));
    }
  } finally { view.dispose(); }
});

it('provides the plotted native observations as an accessible table outside the bounded plot', () => {
  const view = fixture('classic');
  try {
    const alternative = view.doc.querySelector<HTMLElement>('[data-chart-alternative]')!;
    expect([...alternative.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual(['Sample', 'Power']);
    expect([...alternative.querySelectorAll('tbody tr')].map(row =>
      [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([['0', '25']]);
    expect(alternative.closest('[data-chart-viewport]')).toBeNull();
    expect(alternative.closest('figure')?.getAttribute('aria-describedby')?.split(' ')).toContain(alternative.id);
    expect(alternative.classList.contains('forced-colors:not-sr-only')).toBe(true);
  } finally { view.dispose(); }
});
