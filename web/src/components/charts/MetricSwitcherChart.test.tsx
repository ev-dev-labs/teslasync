import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import '@/i18n';
import english from '@/i18n/en.json';
import { Button } from '@/components/ui/Button';
import { MetricSwitcherChart, resolveYAxisProps } from './MetricSwitcherChart';

// Only external collaborators are mocked: allocation uses the real frame,
// PillFilterBar, Button and installed Tailwind configuration.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isPending: false, isLoading: false, isFetching: false, isError: false, error: null, fetchStatus: 'idle', dataUpdatedAt: 0, refetch: vi.fn() }),
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

describe('resolveYAxisProps', () => {
  it('forces integer ticks for integer-only series', () => {
    // The "1, 1, 1, 0, 0" axis: fractional ticks over a [0, 1] domain all
    // round to the same labels. Integer data must never see them.
    expect(resolveYAxisProps([0, 1, 1, 0], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });

  });
});

describe('MetricSwitcherChart native trend controls', () => {
  it('translates the complete selector label with title interpolation and stable metric keys', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'fr',
      fallbackLng: 'en',
      resources: {
        en: { translation: { chart: english.chart } },
        fr: { translation: { chart: { a11y: { metricSelector: 'Mesure pour {{title}}' } } } },
      },
      interpolation: { escapeValue: false },
    });
    const onMetricChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <MetricSwitcherChart
              title="Tendances de recharge"
              ariaLabel="Tendances de recharge"
              series={{
                energy: [{ date: '2026-10-12', value: 2200 }],
                cost: [{ date: '2026-10-12', value: 4.5 }],
              }}
              metrics={[{ key: 'energy', label: 'Énergie' }, { key: 'cost', label: 'Coût' }]}
              activeMetric="energy"
              onMetricChange={onMetricChange}
              emptyMessage="Aucune recharge"
            />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const tabs = within(screen.getByRole('tablist', { name: 'Mesure pour Tendances de recharge' }));
    expect(tabs.getByRole('tab', { name: 'Énergie' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs.getByRole('tab', { name: 'Coût' }));
    expect(onMetricChange).toHaveBeenCalledExactlyOnceWith('cost');
    expect(screen.getByRole('table')).toHaveTextContent('2200');
    expect(screen.queryByRole('tablist', { name: 'Tendances de recharge metric' })).toBeNull();
  });

      it('bounds the five metric trend allocation and reflows caller actions below md', async () => {
        const onMetricChange = vi.fn();
        const onCompare = vi.fn();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const metrics = [
          { key: 'drives', label: 'Drives', chart: 'bar' as const },
          { key: 'distance', label: 'Distance', chart: 'area' as const },
          { key: 'energy', label: 'Energy', chart: 'line' as const },
          { key: 'score', label: 'Score', chart: 'line' as const },
          { key: 'cost', label: 'Cost', chart: 'bar' as const, formatValue: (value: number) => `$${value}` },
        ];
        const series = {
          drives: [{ date: '2026-10-12', value: 3 }],
          distance: [{ date: '2026-10-12', value: 12500 }],
          energy: [{ date: '2026-10-12', value: 2200 }],
          score: [{ date: '2026-10-12', value: 82 }],
          cost: [{ date: '2026-10-12', value: 4.5 }],
        };
        const chart = (activeMetric: string, withAction = true) => (
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <MetricSwitcherChart
                title="Drive trends"
                ariaLabel="Drive trends"
                series={series}
                metrics={metrics}
                activeMetric={activeMetric}
                onMetricChange={onMetricChange}
                emptyMessage="No drives"
                action={withAction ? <Button onClick={onCompare}>Compare drives</Button> : undefined}
              />
            </MemoryRouter>
          </QueryClientProvider>
        );
        const { rerender } = render(chart('drives'));
        const tablist = screen.getByRole('tablist', { name: 'Drive trends metric' });
        const allocation = tablist.parentElement;
        expect(allocation).toHaveClass('flex', 'w-full', 'min-w-0', 'max-w-full', 'flex-wrap', 'md:w-auto', 'md:flex-1');
        expect(allocation?.parentElement).toHaveAttribute('data-chart-toolbar');
        expect(tablist).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-x-auto', 'md:w-auto', 'md:flex-1');
        expect(within(tablist).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
          'Drives', 'Distance', 'Energy', 'Score', 'Cost',
        ]);
        expect(screen.getByRole('button', { name: 'Compare drives' }).parentElement).toBe(allocation);
        fireEvent.click(screen.getByRole('button', { name: 'Compare drives' }));
        expect(onCompare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          type: 'click',
          target: screen.getByRole('button', { name: 'Compare drives' }),
        }));
        fireEvent.click(within(tablist).getByRole('tab', { name: 'Cost' }));
        expect(onMetricChange).toHaveBeenCalledExactlyOnceWith('cost');
        // The caller still owns selection; a click cannot silently replace its data.
        expect(within(tablist).getByRole('tab', { selected: true })).toHaveTextContent('Drives');
        rerender(chart('cost'));
        expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Cost');
        expect(screen.getByRole('table')).toHaveTextContent('$4.5');
        expect(screen.getByRole('table')).toHaveTextContent('2026-10-12');
        expect(screen.getByRole('button', { name: 'Export chart' })).toBeEnabled();
        rerender(chart('cost', false));
        expect(screen.queryByRole('button', { name: 'Compare drives' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(5);
        expect(screen.getByRole('table')).toHaveTextContent('$4.5');

        const config = loadConfig(resolve('tailwind.config.js'));
        const root = (await postcss([tailwindcss({
          ...config,
          content: [{ raw: `${allocation?.className} ${tablist.className}`, extension: 'html' }],
        })]).process('@tailwind utilities;', { from: undefined })).root;
        const declarations = (element: HTMLElement, width: number) => {
          const result: Record<string, string> = {};
          root.walkRules(rule => {
            const className = rule.selector.replace(/\\(.)/g, '$1').slice(1);
            if (!element.classList.contains(className)) return;
            const parent = rule.parent;
            if (parent instanceof postcss.AtRule && parent.name === 'media') {
              expect(parent.params).toBe('(min-width: 768px)');
              if (width < 768) return;
            }
            rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
          });
          return result;
        };
        expect(allocation).not.toBeNull();
        if (!allocation) throw new Error('Metric allocation is missing');
        for (const width of [375, 767]) {
          expect(declarations(allocation, width)).toMatchObject({
            display: 'flex', width: '100%', 'min-width': '0px', 'max-width': '100%', 'flex-wrap': 'wrap',
          });
          expect(declarations(tablist, width)).toMatchObject({
            width: '100%', 'min-width': '0px', 'max-width': '100%', 'overflow-x': 'auto',
          });
        }
        for (const element of [allocation, tablist]) {
          expect(declarations(element, 768)).toMatchObject({
            width: 'auto', flex: '1 1 0%', 'min-width': '0px', 'max-width': '100%',
          });
        }
        console.log('SOURCE CSS: real metric allocation is bounded/full-row at 375/767px and shrinkable at md=768px; native geometry NOTRUN.');
      });
    });

describe('resolveYAxisProps', () => {
  it('keeps decimal ticks when any value is fractional', () => {
    expect(resolveYAxisProps([0.9, 1.2], 'bar')).toEqual({
      allowDecimals: true,
      domain: [0, 2.2],
    });
  });

  it('pins bar floors at zero with headroom above the max', () => {
    // A lone small bar gets a [0, 2] frame instead of filling the chart.
    expect(resolveYAxisProps([1], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
    expect(resolveYAxisProps([40, 100], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 110],
    });
  });

  it('renders an all-zero bar series as a flat baseline, not a degenerate axis', () => {
    expect(resolveYAxisProps([0, 0, 0], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
  });

  it('leaves line and area domains automatic — their values live far from zero', () => {
    expect(resolveYAxisProps([280, 295], 'line')).toEqual({
      allowDecimals: false,
      domain: ['auto', 'auto'],
    });
    expect(resolveYAxisProps([280.5, 295.1], 'area')).toEqual({
      allowDecimals: true,
      domain: ['auto', 'auto'],
    });
  });

  it('falls back to automatic for negative or empty bar data', () => {
    expect(resolveYAxisProps([-5, 10], 'bar')).toEqual({
      allowDecimals: false,
      domain: ['auto', 'auto'],
    });
    expect(resolveYAxisProps([], 'bar')).toEqual({
      allowDecimals: true,
      domain: ['auto', 'auto'],
    });
  });

  it('ignores non-finite values', () => {
    expect(resolveYAxisProps([1, Number.NaN, Number.POSITIVE_INFINITY], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
  });
});
