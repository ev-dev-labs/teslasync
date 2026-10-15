import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { deriveDataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { formatDate } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import { GasTrendChart } from './GasTrendChart';

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => { throw new Error('History must not use the configured currency symbol'); },
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: unknown) => Number(value).toFixed(2) }),
}));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--text-secondary)'],
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    AreaChart: ({ data, children, margin }: { data: GasPriceHistory[]; children: ReactNode; margin: unknown }) => (
      <div data-testid="plot" data-rows={JSON.stringify(data)} data-margin={JSON.stringify(margin)}>{children}</div>
    ),
    Area: ({ dataKey, name, connectNulls }: {
      dataKey: (row: GasPriceHistory) => number | null;
      name: string;
      connectNulls: boolean;
    }) => <div data-testid="series" data-name={name} data-connect-nulls={String(connectNulls)}
      data-values={JSON.stringify(history.slice().reverse().map(dataKey))} />,
    XAxis: ({ tick, dataKey }: { tick: unknown; dataKey: string }) =>
      <span data-testid="x-axis" data-tick={JSON.stringify(tick)} data-key={dataKey} />,
    YAxis: ({ tickFormatter, tick, width, domain }: {
      tickFormatter: (value: number) => string; tick: unknown; width: number; domain: unknown;
    }) => <span data-testid="tick" data-tick={JSON.stringify(tick)} data-width={width}
      data-domain={JSON.stringify(domain)}>{tickFormatter(3)}</span>,
    CartesianGrid: ({ stroke }: { stroke: string }) => <span data-testid="grid" data-stroke={stroke} />,
    Legend: ({ wrapperStyle }: { wrapperStyle: unknown }) =>
      <span data-testid="legend" data-typography={JSON.stringify(wrapperStyle)} />,
    Tooltip: ({ content }: { content: ReactNode }) => <>{content}</>,
    areaGradient: () => null,
  };
});

const history: GasPriceHistory[] = [
  { id: 3, price_per_unit: 3.5, unit: 'gallon', efficiency_mpg: 25, effective_from: '2026-03-01T00:00:00Z', effective_to: null, created_at: '2026-03-01T00:00:00Z' },
  { id: 2, price_per_unit: 1.2, unit: 'liter', efficiency_mpg: 25, effective_from: '2026-02-01T00:00:00Z', effective_to: null, created_at: '2026-02-01T00:00:00Z' },
  { id: 1, price_per_unit: 3, unit: 'gallon', efficiency_mpg: 25, effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-02-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
];

function renderChart(data: GasPriceHistory[], error?: Error) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><GasTrendChart source={deriveDataState({ data, error })} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  document.documentElement.style.removeProperty('--font-sans');
  document.documentElement.style.removeProperty('--font-scale');
});

describe('GasTrendChart', () => {
  it('uses the saved font and text scale for axes and legend while retaining compact chart geometry', () => {
    document.documentElement.style.setProperty('--font-sans', 'Preference Sans');
    document.documentElement.style.setProperty('--font-scale', '1.35');
    renderChart(history);
    const tick = { fontFamily: 'Preference Sans', fontSize: 16, fill: chartTokens.axisStroke };
    expect(JSON.parse(screen.getByTestId('x-axis').dataset.tick ?? '{}')).toEqual(tick);
    expect(JSON.parse(screen.getByTestId('tick').dataset.tick ?? '{}')).toEqual(tick);
    expect(JSON.parse(screen.getByTestId('legend').dataset.typography ?? '{}')).toEqual({
      fontFamily: 'Preference Sans', fontSize: 16, color: chartTokens.tooltipMutedText,
    });
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'date');
    expect(screen.getByTestId('tick')).toHaveAttribute('data-width', '96');
    expect(JSON.parse(screen.getByTestId('tick').dataset.domain ?? '[]')).toEqual(['auto', 'auto']);
    expect(JSON.parse(screen.getByTestId('plot').dataset.margin ?? '{}')).toEqual({
      top: 8, right: 8, left: 0, bottom: 0,
    });
    expect(screen.getByTestId('grid')).toHaveAttribute('data-stroke', chartTokens.gridStroke);
  });

  it('keeps mixed source denominations in separate, labelled series without converting or joining gaps', () => {
    renderChart(history);
    const series = screen.getAllByTestId('series');
    expect(series.map((item) => item.dataset.name)).toEqual(['Price/gallon', 'Price/liter']);
    expect(series.map((item) => JSON.parse(item.dataset.values ?? '[]'))).toEqual([[3, null, 3.5], [null, 1.2, null]]);
    series.forEach((item) => expect(item).toHaveAttribute('data-connect-nulls', 'false'));
    expect(screen.getByTestId('tick')).toHaveTextContent('3.00');
    expect(screen.getByTestId('tick')).not.toHaveTextContent('$');
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Unit');
    expect(table).toHaveTextContent('gallon');
    expect(table).toHaveTextContent('liter');
    expect(table).toHaveTextContent('1.20');
    expect(table).not.toHaveTextContent('$');
  });

  it('preserves populated dates, raw payloads, the accessible alternative and cached data on refresh failure', () => {
    const snapshot = structuredClone(history);
    renderChart(history, new Error('refresh failed'));
    const rows = JSON.parse(screen.getByTestId('plot').dataset.rows ?? '[]');
    expect(rows).toEqual(snapshot.slice().reverse().map((item) => ({
      ...item, date: formatDate(item.effective_from), price: item.price_per_unit,
    })));
    expect(history).toEqual(snapshot);
    expect(screen.getByRole('img', { name: 'Line chart of historical gas prices over time' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('3.50');
  });

  it('labels a single denomination on the axis and retains its populated series', () => {
    renderChart(history.filter((item) => item.unit === 'gallon'));
    expect(screen.getByTestId('tick')).toHaveTextContent('3.00/gallon');
    expect(screen.getAllByTestId('series')).toHaveLength(1);
    expect(screen.getByTestId('series')).toHaveAttribute('data-name', 'Price/gallon');
  });

  it('does not assume a denomination when the source unit is blank', () => {
    renderChart([{ ...history[0], unit: '' }]);
    expect(screen.getByTestId('tick')).toHaveTextContent('3.00/—');
    expect(screen.getByTestId('series')).toHaveAttribute('data-name', 'Price/—');
  });
});
