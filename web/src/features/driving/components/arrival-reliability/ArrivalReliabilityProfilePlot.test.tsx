import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ChartContainerProps } from '@/components/charts';
import { ChartHiddenSeriesProvider } from '@/components/charts/ChartHiddenSeriesContext';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';
import {
  ArrivalReliabilityProfilePlot,
  type ArrivalReliabilityProfileRow,
} from './ArrivalReliabilityProfilePlot';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback: string) => fallback ?? key }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number, _precision: unknown, locale: string) =>
      new Intl.NumberFormat(locale).format(value),
  }),
}));
vi.mock('@/components/charts', async () => {
  const { ChartHiddenSeriesProvider, useChartHiddenSeries } =
    await import('@/components/charts/ChartHiddenSeriesContext');
  const { Button } = await import('@/components/ui/Button');
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const series = ({ dataKey, name, hide }: {
    dataKey: string; name: string; hide?: boolean;
  }) => <div data-testid={dataKey} data-hidden={String(hide)}>{name}</div>;
  return {
    useChartHiddenSeries,
    CHART_COLORS: ['var(--chart-1)', '', 'var(--chart-3)', '', 'var(--chart-5)'],
    axisTick: {},
    EmbeddedChart: (props: ChartContainerProps) => (
      <div data-testid="embedded" data-chart-key={props.chartKey} aria-label={props.ariaLabel}>
        <output data-testid="columns">
          {JSON.stringify(props.dataColumns?.map((column) => ({
            key: column.key,
            label: column.label,
            values: props.data?.map((row) =>
              column.format ? column.format(row[column.key]) : row[column.key]),
          })))}
        </output>
        <ChartHiddenSeriesProvider chartKey={props.chartKey}>
          {(hiddenSeries) => typeof props.children === 'function'
            ? props.children({ hiddenSeries, annotations: [], hidden: false })
            : props.children}
        </ChartHiddenSeriesProvider>
      </div>
    ),
    ResponsiveContainer: passthrough,
    ComposedChart: passthrough,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ChartTooltip: () => null,
    Bar: series,
    Line: series,
    ChartLegend: ({ state }: { state?: HiddenSeriesState }) => {
      const context = useChartHiddenSeries();
      const controller = state ?? context;
      return <>{['samples', 'normalizedDurationIndex', 'allowanceShare'].map((key) => (
        <Button key={key} aria-pressed={controller?.isHidden(key) ?? false}
          onClick={() => controller?.toggle(key)}>{key}</Button>
      ))}</>;
    },
  };
});

const keys = ['arrival-weekday-profile', 'arrival-window-profile', 'arrival-month-trend'];
const rows: ArrivalReliabilityProfileRow[] = [
  { key: 'observed', label: 'Observed', normalizedDurationIndex: 101.5, allowanceShare: 75, samples: 4 },
  { key: 'missing', label: 'Missing', normalizedDurationIndex: null, allowanceShare: null, samples: 0 },
];
const props = {
  rows,
  normalizedName: 'Normalized duration',
  allowanceName: 'Allowance share',
  samplesName: 'Samples',
  locale: 'en-US',
};

function Location() {
  return <output data-testid="url">{useLocation().search}</output>;
}

function Profiles({ external }: { external?: HiddenSeriesState }) {
  return <>{keys.map((key) => (
    <div key={key} data-testid={key}>
      <ChartHiddenSeriesProvider chartKey={key}>
        {() => <ArrivalReliabilityProfilePlot {...props} hiddenSeries={external} />}
      </ChartHiddenSeriesProvider>
    </div>
  ))}<Location /></>;
}

function show(search = '', external?: HiddenSeriesState) {
  return render(<MemoryRouter initialEntries={[`/${search}`]}>
    <Profiles external={external} />
  </MemoryRouter>);
}

describe('Arrival reliability profile controller', () => {
  it.each(keys)('toggles only the canonical %s key through its legend', (key) => {
    show('?unrelated=kept');
    const profile = within(screen.getByTestId(key));
    fireEvent.click(profile.getByRole('button', { name: 'samples' }));
    expect(profile.getByTestId('samples')).toHaveAttribute('data-hidden', 'true');
    expect(profile.getByRole('button', { name: 'samples' })).toHaveAttribute('aria-pressed', 'true');
    for (const other of keys.filter((candidate) => candidate !== key)) {
      expect(within(screen.getByTestId(other)).getByTestId('samples'))
        .toHaveAttribute('data-hidden', 'false');
    }
    const url = new URLSearchParams(screen.getByTestId('url').textContent ?? '');
    expect(url.get(`hidden_${key}`)).toBe('samples');
    expect(url.get('unrelated')).toBe('kept');
    expect(url.has('hidden_arrival-reliability-profile')).toBe(false);
    fireEvent.click(profile.getByRole('button', { name: 'samples' }));
    expect(profile.getByTestId('samples')).toHaveAttribute('data-hidden', 'false');
  });

  it('honors saved per-profile flags and ignores, but retains, the old shared URL key', () => {
    show('?hidden_arrival-reliability-profile=samples&hidden_arrival-weekday-profile=allowanceShare');
    const weekday = within(screen.getByTestId(keys[0]));
    expect(weekday.getByTestId('allowanceShare')).toHaveAttribute('data-hidden', 'true');
    expect(weekday.getByTestId('samples')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(weekday.getByRole('button', { name: 'normalizedDurationIndex' }));
    const url = new URLSearchParams(screen.getByTestId('url').textContent ?? '');
    expect(url.get('hidden_arrival-reliability-profile')).toBe('samples');
    expect(url.get('hidden_arrival-weekday-profile')).toBe('allowanceShare,normalizedDurationIndex');
    expect(within(screen.getByTestId(keys[1])).getByTestId('normalizedDurationIndex'))
      .toHaveAttribute('data-hidden', 'false');
  });

  it('uses the nearest profile context instead of an unrelated external controller', () => {
    const toggle = vi.fn();
    show('', { hidden: new Set(['samples']), isHidden: () => true, toggle, reset: vi.fn() });
    const weekday = within(screen.getByTestId(keys[0]));
    expect(weekday.getByTestId('samples')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(weekday.getByRole('button', { name: 'samples' }));
    expect(toggle).not.toHaveBeenCalled();
    expect(weekday.getByTestId('samples')).toHaveAttribute('data-hidden', 'true');
  });

  it('uses the explicit controller for both legend and marks without a profile context', () => {
    const toggle = vi.fn();
    render(<ArrivalReliabilityProfilePlot {...props}
      hiddenSeries={{ hidden: new Set(['samples']), isHidden: (key) => key === 'samples',
        toggle, reset: vi.fn() }} />);
    expect(screen.getByTestId('samples')).toHaveAttribute('data-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'samples' }));
    expect(toggle).toHaveBeenCalledWith('samples');
  });

  it('preserves populated series, accessible columns, null gaps and real zero counts', () => {
    render(<ArrivalReliabilityProfilePlot {...props} ariaLabel="Profile evidence" />);
    expect(screen.getByTestId('embedded')).toHaveAttribute('aria-label', 'Profile evidence');
    expect(screen.getByTestId('embedded')).not.toHaveAttribute('data-chart-key');
    expect(screen.getByTestId('columns').textContent).toBe(JSON.stringify([
      { key: 'label', label: 'Category', values: ['Observed', 'Missing'] },
      { key: 'normalizedDurationIndex', label: 'Normalized duration', values: ['101.5', '—'] },
      { key: 'allowanceShare', label: 'Allowance share', values: ['75', '—'] },
      { key: 'samples', label: 'Samples', values: ['4', '0'] },
    ]));
    expect(screen.getByTestId('normalizedDurationIndex')).toHaveTextContent('Normalized duration');
    expect(screen.getByTestId('allowanceShare')).toHaveTextContent('Allowance share');
    expect(screen.getByTestId('samples')).toHaveTextContent('Samples');
  });
});
