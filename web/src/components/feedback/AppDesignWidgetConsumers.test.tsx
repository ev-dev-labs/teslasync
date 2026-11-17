import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  matchesAppDesignCss as matches, matchingAppDesignDataRules as modeMatches,
  expectAppDesignDataMode as expectOwnMode, setAppDesignTestProfile as setProfile,
} from './appDesignCss.test-utils';
import { UsageCard } from '../data-display/UsageCard';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import LineTelemetryLayout from '@/features/dashboard/widgets/designPacks/families/LineTelemetryLayout';
import { WidgetBigNumber } from '@/features/dashboard/widgets/shared/WidgetBigNumber';
import { WidgetComparisonCard } from '@/features/dashboard/widgets/shared/WidgetComparisonCard';
import { WidgetGaugeHero } from '@/features/dashboard/widgets/shared/WidgetGaugeHero';
import { WidgetRankedList } from '@/features/dashboard/widgets/shared/WidgetRankedList';

function settingsClient() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, gcTime: 0 } } });
  client.setQueryData(['settings'], {
    unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
    locale: 'de-DE', decimal_precision: 2, currency_symbol: '€', ui_density: 'compact',
  });
  return client;
}

function NativeConsumers() {
  return (
    <>
      <WidgetBigNumber value={0} label="Measured headline" unit="%" animated={false}
        align="center" size="secondary" valueColor="text-[var(--semantic-warning)]"
        subtitle="Retained context" delta={{ text: ' −6,60% since sample ', tone: 'neutral', trend: 'down' }} />
      <WidgetBigNumber value={null} label="Unknown headline" unit="%" animated={false}
        subtitle="Unknown context stays" delta={{ text: '+8', tone: 'good' }}
        badge={{ text: 'Pending source', variant: 'warning' }} />
      <WidgetComparisonCard previousLabel="Previous sample" metrics={[
        { label: 'Zero comparison', current: 0, previous: 0, formattedCurrent: '0,00',
          formattedPrevious: '0,00 Wh', unit: 'Wh' },
        { label: 'Improvement', current: 1, previous: 2, formattedCurrent: '1,00',
          formattedPrevious: '2,00 Wh/km', unit: 'Wh/km', higherIsBetter: false, tone: 'good' },
        { label: 'Unknown comparison', current: Number.NaN, previous: 2, formattedCurrent: '—', unit: 'Wh' },
      ]} />
      <WidgetRankedList order="source" wrapContent items={[
        { id: 'unknown', label: 'Unknown route', value: null, formattedValue: 'Unknown, not zero',
          status: 'warning', sublabel: 'Retained route context', hint: 'Awaiting source',
          badge: { text: 'Unconfirmed', variant: 'warning' } },
        { id: 'zero', label: 'Measured zero', value: 0, formattedValue: '0,00 Wh/km',
          labelContent: <a href="#retained-route">Measured zero</a> },
        { id: 'negative', label: 'Signed reading', value: -1, formattedValue: '−1,00 Wh/km' },
      ]} />
      <LineTelemetryLayout appearance="pixel" compact={false}
        context={<span>Context outside source boundary</span>}
        headline={{ label: 'Sampled headline', value: '0', unit: 'W' }}
        details={[{ label: 'Zero fact', value: '0', unit: 'm/s' },
          { label: 'Unknown fact', value: null, unit: 'm/s' }]}
        chart={<svg data-app-part="chart chart-plot" data-chart-family="line" role="img"
          aria-label="Caller plot" viewBox="0 0 7 11"><path d="M0 5 L5 0" strokeDasharray="4 2" /></svg>}
        sourceBoundary={content => <section data-testid="source-boundary">{content}</section>} />
      <WidgetGaugeHero gauge={{ value: 0, max: 100, preserveReadingAndScale: true,
        label: 'Native gauge', unit: '%', color: 'var(--semantic-warning)', marker: 70, markerLabel: 'Reference' }}
        stats={[{ label: 'Native fact', value: 0, unit: 'm/s' }]}>
        <span>Native trailing context</span>
      </WidgetGaugeHero>
      <UsageCard topLists={[{ key: 'other-ranked-shape', title: 'Other ranked consumer',
        items: [{ key: 'row', label: 'Caller label', value: 'Retained formatted value' }] }]} />
    </>
  );
}

describe('actual native widget DATA consumers', () => {
  it.each(PACK_IDS)('%s composes actual slots without taking over native scale, readings or renderer geometry', pack => {
    const client = settingsClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl"><NativeConsumers /></div>
      </QueryClientProvider>,
    );
    const host = container.querySelector('[data-app-design-preview]')!;
    const release = observeAppDesignScopes(host);
    try {
      const mode = APPLICATION_DESIGNS[pack].data;
      const headline = host.querySelector('.widget-big-number')!;
      const reading = headline.querySelector('[data-app-part~="metric-reading"]')!;
      expectOwnMode(headline, mode, '[data-app-metric="headline"]');
      expectOwnMode(reading, mode, '[data-app-metric="headline"]');
      expect(headline).toHaveClass('h-full', 'flex', 'flex-col', 'justify-center', 'items-center', 'text-center');
      expect(reading.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0');
      expect(reading.querySelector('[data-app-part~="metric-value"] > span'))
        .toHaveClass('text-lg', 'text-[var(--semantic-warning)]');
      expect(reading.querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('%');
      const comparisonText = headline.querySelector('[data-app-part~="metric-comparison"]')!;
      expect(comparisonText.textContent).toBe(' −6,60% since sample ');
      expect(comparisonText).toHaveClass('text-[var(--text-muted)]', 'inline-flex');
      expect(comparisonText.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      for (const match of matches(headline)) {
        expect(match.declarations).not.toHaveProperty('min-block-size');
        for (const property of ['font-size', 'text-align', 'align-items', 'height', 'padding', 'background']) {
          expect(match.declarations).not.toHaveProperty(property);
        }
      }
      const unknownHeadline = host.querySelectorAll('.widget-big-number')[1];
      expect(unknownHeadline.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
      expect(unknownHeadline.querySelector('[data-app-part~="metric-unit"]')).toBeNull();
      expect(unknownHeadline.querySelector('[data-app-part~="metric-comparison"]')).toBeNull();
      expect(unknownHeadline).toHaveTextContent('Unknown context stays');
      expect(unknownHeadline).toHaveTextContent('Pending source');

      const rows = host.querySelectorAll('[data-app-metric="comparison"]');
      for (const row of rows) {
        const heading = row.querySelector('[data-app-part~="metric-heading"]')!;
        const bank = heading.nextElementSibling!;
        const actualReading = bank.querySelector('[data-app-part~="metric-reading"]')!;
        const delta = bank.querySelector('[data-app-part~="metric-comparison"]')!;
        expectOwnMode(bank, mode, '[data-app-metric="comparison"]');
        expectOwnMode(actualReading, mode, '[data-app-metric="comparison"]');
        expect(delta.parentElement).not.toBe(bank);
        expect(delta).not.toHaveAttribute('data-app-metric');
        expect(row).toHaveClass('flex', 'gap-3', 'py-2', 'border-b');
        for (const match of matches(row)) {
          for (const property of ['display', 'grid-template-columns', 'flex-direction', 'min-block-size', 'padding', 'padding-block']) {
            expect(match.declarations).not.toHaveProperty(property);
          }
        }
      }
      expect(rows[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0,00');
      expect(rows[0].querySelector('[data-app-part~="metric-context"]')?.parentElement)
        .toBe(rows[0].querySelector('[data-app-part~="metric-heading"]'));
      expect(rows[0].querySelector('[data-app-part~="metric-comparison"]')).toHaveTextContent('—');
      expect(rows[1].querySelector('[data-app-part~="metric-comparison"]')).toHaveClass('text-emerald-400');
      expect(rows[2].querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('Wh');
      expect(rows[2].querySelector('[data-app-part~="metric-comparison"]')).toHaveClass('text-[var(--text-muted)]');

      const ranked = host.querySelector('.overflow-y-auto > [data-app-list="ranked"]')!;
      expect(ranked.parentElement).toHaveClass('overflow-y-auto');
      expect([...ranked.querySelectorAll('[data-app-part~="metric-value"]')].map(node => node.textContent))
        .toEqual(['Unknown, not zero', '0,00 Wh/km', '−1,00 Wh/km']);
      for (const row of ranked.children) {
        expect(row.children).toHaveLength(2);
        expect(row).toHaveClass('min-h-8', 'py-2', 'gap-2.5');
        expectOwnMode(row, mode, '[data-app-list="ranked"]');
        for (const cell of row.children) {
          expectOwnMode(cell, mode, '[data-app-list="ranked"]');
          expect(modeMatches(cell).some(match => match.declarations['min-inline-size'] === '0')).toBe(true);
        }
        for (const context of row.querySelectorAll('[data-app-part~="metric-context"]')) {
          expect(context.parentElement).not.toBe(row);
          expect(matches(context).every(match => !('grid-column' in match.declarations))).toBe(true);
        }
      }
      expect(ranked.querySelector('[aria-hidden="true"]')).toHaveClass('bg-[var(--semantic-warning)]');
      expect(within(ranked as HTMLElement).getByRole('link', { name: 'Measured zero' })).toHaveAttribute('href', '#retained-route');
      expect(ranked.querySelector('[data-metric-track], [data-metric-fill], [data-app-part~="metric-unit"]')).toBeNull();

      const facts = host.querySelector('dl[data-app-list="definitions"]')!;
      for (const actualReading of facts.querySelectorAll('dd[data-app-part~="metric-reading"]')) {
        expectOwnMode(actualReading, mode, '[data-app-list="definitions"]');
        expect(modeMatches(actualReading).some(match => match.declarations.display === 'flex')).toBe(true);
        expect(actualReading.firstElementChild).toHaveAttribute('data-app-part', 'metric-value');
      }
      expect(facts.children[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0');
      expect(facts.children[0].querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('m/s');
      expect(facts.children[1].querySelector('[data-app-part~="metric-unit"]')).toBeNull();
      const lineHeadline = host.querySelector('dl[data-app-metric="headline"]')!;
      expectOwnMode(lineHeadline.querySelector('dd')!, mode, '[data-app-metric="headline"]');
      const boundary = screen.getByTestId('source-boundary');
      expect(boundary).toContainElement(facts);
      expect(boundary).toContainElement(lineHeadline);
      expect(boundary).not.toContainElement(screen.getByText('Context outside source boundary'));
      const chart = screen.getByRole('img', { name: 'Caller plot' });
      expect(chart).toHaveAttribute('viewBox', '0 0 7 11');
      expect(chart.querySelector('path')).toHaveAttribute('d', 'M0 5 L5 0');
      expect(chart.querySelector('path')).toHaveAttribute('stroke-dasharray', '4 2');
      const decoration = host.querySelector('svg[shape-rendering="crispEdges"]')!;
      for (const node of [chart, chart.parentElement!, chart.querySelector('path')!, decoration]) {
        expect(matches(node)).toHaveLength(0);
      }

      const gaugeGrid = host.querySelector('[data-app-metric-grid="native-gauge"]')!;
      expect(gaugeGrid).toHaveClass('flex', 'h-full', 'w-full', 'flex-col', 'items-center', 'justify-center', 'gap-3');
      for (const match of matches(gaugeGrid)) expect(Object.keys(match.declarations)).toEqual(['min-inline-size']);
      const gauge = within(gaugeGrid as HTMLElement).getByRole('meter', { name: 'Native gauge' });
      expect(gaugeGrid.firstElementChild).toBe(gauge);
      expect(gauge).toHaveAttribute('aria-valuenow', '0');
      const track = gauge.querySelector('[data-chart-gauge-track]')!;
      expect(track).toHaveClass('h-2');
      expect(track.querySelector('[data-chart-gauge-fill]')).toHaveStyle({ width: '0%', backgroundColor: 'var(--semantic-warning)' });
      expect(track.querySelector('[data-chart-gauge-marker]')).toHaveStyle({ left: '70%' });
      for (const node of [gauge, track, ...gaugeGrid.querySelectorAll('[data-app-part~="metric"]')]) {
        for (const match of matches(node)) expect(Object.keys(match.declarations)).toEqual(['min-inline-size']);
      }
      expect(gaugeGrid.lastElementChild).toHaveTextContent('Native trailing context');
      const otherList = host.querySelector('[data-app-list="ranked"]:not(.overflow-y-auto > *)')!;
      expect(otherList.firstElementChild?.children[0].tagName).toBe('SPAN');
      expect(modeMatches(otherList.firstElementChild!, '.overflow-y-auto')).toHaveLength(0);
    } finally {
      release();
      client.clear();
    }
  });

  it('guards actual descendant slots at conflicting root, complete preview and incomplete boundaries', async () => {
    const root = document.documentElement;
    const originals = Object.keys(getAppDesignAttributes('v1')).map(name => [name, root.getAttribute(name)] as const);
    setProfile(root, 'v1');
    const client = settingsClient();
    render(<QueryClientProvider client={client}>
      <div data-testid="complete" data-app-design-preview="" {...getAppDesignAttributes('blueprint')}><NativeConsumers /></div>
      <div data-testid="incomplete" data-app-design-preview="" data-app-design-pack="v1"><NativeConsumers /></div>
    </QueryClientProvider>);
    const release = observeAppDesignScopes(root);
    try {
      const preview = screen.getByTestId('complete');
      const targets = preview.querySelectorAll(
        '[data-app-metric="headline"], [data-app-part~="metric-reading"], '
        + '.overflow-y-auto > [data-app-list="ranked"] > [data-app-part~="list-row"], '
        + '[data-app-metric="comparison"] > [data-app-part~="metric-heading"] + div',
      );
      for (const node of targets) expectOwnMode(node, 'ledger', '');
      for (const node of screen.getByTestId('incomplete').querySelectorAll('[data-app-part]')) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matches(node)).toHaveLength(0);
      }
      setProfile(preview, 'v2');
      await waitFor(() => expect(targets[0].getAttribute('data-app-design-owner')).toContain('data-cards'));
      for (const node of targets) expectOwnMode(node, 'cards', '');
      const bank = preview.querySelector('[data-app-metric="comparison"] > [data-app-part~="metric-heading"] + div')!;
      const owner = bank.getAttribute('data-app-design-owner')!;
      bank.setAttribute('data-app-design-owner', 'pack-v2');
      expect(modeMatches(bank)).toHaveLength(0);
      bank.setAttribute('data-app-design-owner', owner);
    } finally {
      release();
      client.clear();
      for (const [name, value] of originals) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });
});
