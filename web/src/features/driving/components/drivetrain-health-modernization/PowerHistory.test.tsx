import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { deriveDataState } from '@/api/dataState';
import { downloadCSV } from '@/lib/csvExport';
import { chartTokens, typography } from '@/lib/tokens';
import type { PowerUnitPref } from '@/lib/unitConversion';
import type { DriveChartRow } from './model';
import { PowerHistory } from './PowerHistory';

const selected = vi.hoisted(() => ({ power: 'kW' as PowerUnitPref }));

// Exercise the real SI formatter, including the supported W preference that
// useUnits currently does not expose through its fixed kW settings default.
vi.mock('@/hooks/useUnits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useUnits')>();
  const { formatPower } = await import('@/lib/unitConversion');
  return {
    ...actual,
    useUnits: () => {
      const units = actual.useUnits();
      const unitPrefs = { ...units.unitPrefs, power: selected.power, locale: 'en-US', precision: 2 };
      return { ...units, unitPrefs, formatPower: (value: number | null | undefined) => formatPower(value, unitPrefs) };
    },
  };
});

vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
  }),
}));

// jsdom has no chart layout. Only the vendor renderer is substituted; the
// feature, shared frame/table/export, tooltip, legend and URL hook stay real.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  const { createContext, useContext, Children, isValidElement, cloneElement } = await import('react');
  type Series = {
    dataKey: 'powerMax' | 'powerMin'; name: string; stroke: string; fill: string;
    hide?: boolean; connectNulls?: boolean; strokeWidth?: number;
  };
  const Chart = createContext<{ rows: DriveChartRow[]; series: Series[] }>({ rows: [], series: [] });
  function Area({ dataKey, name, stroke, fill, hide, connectNulls, strokeWidth }: Series) {
    return <path data-testid={dataKey} aria-label={name} stroke={stroke} fill={fill}
      strokeWidth={strokeWidth} data-hidden={String(hide)} data-connect-nulls={String(connectNulls)} />;
  }
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    AreaChart: ({ data, children }: { data: DriveChartRow[]; children: ReactNode }) => {
      const series = Children.toArray(children).flatMap(child =>
        isValidElement<Series>(child) && child.type === Area ? [child.props] : []);
      return <Chart.Provider value={{ rows: data, series }}>
        <svg data-testid="power-chart">
          <metadata data-testid="chart-input">{JSON.stringify(data)}</metadata>
          {children}
        </svg>
      </Chart.Provider>;
    },
    Area,
    XAxis: ({ dataKey, tick }: { dataKey: string; tick: { fill: string; className: string } }) =>
      <g data-testid="x-axis" data-key={dataKey}><text {...tick}>Date</text></g>,
    YAxis: ({ tickFormatter, tick }: {
      tickFormatter: (value: number) => string; tick: { fill: string; className: string };
    }) => {
      const { rows } = useContext(Chart);
      return <g data-testid="axis-values">{rows.flatMap(row => [row.powerMax, row.powerMin])
        .filter((value): value is number => value != null)
        .map((value, index) => <text key={index} {...tick}>{tickFormatter(value)}</text>)}</g>;
    },
    CartesianGrid: ({ stroke, strokeOpacity }: { stroke: string; strokeOpacity: number }) =>
      <g data-testid="grid" stroke={stroke} strokeOpacity={strokeOpacity} />,
    ReferenceLine: ({ y, stroke, strokeDasharray }: { y: number; stroke: string; strokeDasharray: string }) =>
      <line data-testid="zero-reference" data-y={y} stroke={stroke} strokeDasharray={strokeDasharray} />,
    Tooltip: ({ content }: { content: React.ReactElement<{
      active?: boolean; label?: string; payload?: { name: string; value: number | null; color: string; dataKey: string }[];
    }> }) => {
      const { rows, series } = useContext(Chart);
      return <foreignObject>{rows.map(row => <div key={row.date}>
        {cloneElement(content, {
          active: true,
          label: row.date,
          payload: series.filter(item => !item.hide).map(item => ({
            name: item.name, value: row[item.dataKey], color: item.stroke, dataKey: item.dataKey,
          })),
        })}
      </div>)}</foreignObject>;
    },
    Legend: ({ formatter }: {
      formatter: (value: string, entry: { value: string; dataKey: string }, index: number) => ReactNode;
    }) => {
      const { series } = useContext(Chart);
      return <foreignObject>{series.map((item, index) => <div key={item.dataKey}>
        {formatter(item.name, { value: item.name, dataKey: item.dataKey }, index)}
      </div>)}</foreignObject>;
    },
  };
});

const rows: DriveChartRow[] = [
  { date: 'Drive one', powerMax: 1234.56, powerMin: null, outsideTemp: 12, distance: 3000 },
  { date: 'Drive two', powerMax: 0, powerMin: -4500, outsideTemp: null, distance: 0 },
  { date: 'Drive three', powerMax: null, powerMin: 0, outsideTemp: -5, distance: null },
];
rows.forEach(row => Object.freeze(row));
Object.freeze(rows);
const originalRows = JSON.stringify(rows);
let client: QueryClient;

function LocationProbe() {
  return <output aria-label="Chart location">{useLocation().search}</output>;
}
function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><MemoryRouter>
    {children}<LocationProbe />
  </MemoryRouter></QueryClientProvider>;
}
function ready() {
  return deriveDataState({ data: rows, isSuccess: true }, { provenance: 'historical' });
}

beforeEach(() => {
  selected.power = 'kW';
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('PowerHistory display boundary', () => {
  it.each([
    { case: 'kilowatts', unit: 'kW' as const, peak: '1.23 kW', regen: '-4.50 kW', csvPeak: '1.23 kW' },
    { case: 'watts', unit: 'W' as const, peak: '1,234.56 W', regen: '-4,500.00 W', csvPeak: '"1,234.56 W"' },
  ])('renders selected $case quantities across axes tooltip table and CSV', ({ unit, peak, regen, csvPeak }) => {
    selected.power = unit;
    render(<PowerHistory rows={rows} state={ready()} loading={false} />, { wrapper: Providers });
    const axes = within(screen.getByTestId('axis-values'));
    expect(axes.getByText(peak)).toBeInTheDocument();
    expect(axes.getByText(regen)).toBeInTheDocument();
    expect(axes.getAllByText(`0.00 ${unit}`)).toHaveLength(2);
    // Chart tooltips render inside the chart double; the frame's help tooltip also has role="tooltip".
    const tooltips = screen.getAllByRole('tooltip').filter(tip => tip.parentElement?.parentElement?.tagName === 'foreignObject');
    expect(within(tooltips[0]).getByText(peak)).toBeInTheDocument();
    expect(within(tooltips[0]).getByText('—')).toBeInTheDocument();
    expect(within(tooltips[1]).getByText(regen)).toBeInTheDocument();
    expect(within(tooltips[1]).getByText(`0.00 ${unit}`)).toBeInTheDocument();
    expect(within(tooltips[0]).getByText(`Peak-labelled average drive power (${unit}):`)).toBeInTheDocument();
    expect(within(tooltips[0]).getByText(`Regen Power (${unit}):`)).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: `Peak-labelled average drive power (${unit})` })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: `Regen (${unit})` })).toBeInTheDocument();
    expect(table.getByRole('cell', { name: peak })).toBeInTheDocument();
    expect(table.getByRole('cell', { name: regen })).toBeInTheDocument();
    expect(table.getAllByRole('cell', { name: `0.00 ${unit}` })).toHaveLength(2);
    expect(table.getAllByRole('cell', { name: '—' })).toHaveLength(2);
    expect(table.getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [, csv] = vi.mocked(downloadCSV).mock.calls[0];
    expect(csv.split('\r\n')[0]).toBe('date,power_max_kw,power_min_kw');
    expect(csv.split('\r\n')[1]).toBe(`Drive one,${csvPeak},—`);
    expect(csv).toContain(unit === 'W' ? 'Drive two,0.00 W,"\'-4,500.00 W"' : 'Drive two,0.00 kW,\'-4.50 kW');
    expect(JSON.stringify(rows)).toBe(originalRows);
  });

  it('keeps every raw SI chart field immutable when the display unit changes', () => {
    const { rerender } = render(<PowerHistory rows={rows} state={ready()} loading={false} />, { wrapper: Providers });
    expect(screen.getByTestId('chart-input').textContent).toBe(originalRows);
    selected.power = 'W';
    rerender(<PowerHistory rows={rows} state={ready()} loading={false} />);
    expect(screen.getByTestId('chart-input').textContent).toBe(originalRows);
    expect(screen.getByRole('cell', { name: '1,234.56 W' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '1.23 kW' })).not.toBeInTheDocument();
    expect(JSON.stringify(rows)).toBe(originalRows);
  });

  it('retains restrained series roles caption ticks gradients zero reference and persisted legend IDs', () => {
    const { container } = render(<PowerHistory rows={rows} state={ready()} loading={false} />, { wrapper: Providers });
    expect(screen.getByRole('figure')).toHaveAccessibleDescription(/average drive power from up to 30 returned drives.*gaps are unknown, not zero/);
    for (const [key, gradient, color] of [
      ['powerMax', 'dtPwrMaxGrad', chartTokens.series[4]],
      ['powerMin', 'dtPwrMinGrad', chartTokens.series[3]],
    ]) {
      const area = screen.getByTestId(key);
      expect(area).toHaveAttribute('stroke', color);
      expect(area).toHaveAttribute('fill', `url(#${gradient})`);
      expect(area).toHaveAttribute('data-connect-nulls', 'false');
      expect(area).toHaveAttribute('stroke-width', '2');
      const stops = container.querySelectorAll(`#${gradient} stop`);
      expect(stops).toHaveLength(2);
      expect(stops[0]).toHaveAttribute('stop-color', color);
      expect(stops[0]).toHaveAttribute('stop-opacity', '0.08');
    }
    for (const tick of container.querySelectorAll('[data-testid="x-axis"] text, [data-testid="axis-values"] text')) {
      expect(tick).toHaveClass(...typography.role.caption.split(' '));
      expect(tick).toHaveAttribute('fill', chartTokens.axisStroke);
      expect(tick).not.toHaveAttribute('font-size');
    }
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'date');
    expect(screen.getByTestId('grid')).toHaveAttribute('stroke', chartTokens.gridStroke);
    expect(screen.getByTestId('zero-reference')).toHaveAttribute('data-y', '0');
    expect(screen.getByTestId('zero-reference')).toHaveAttribute('stroke', chartTokens.axisStroke);
    expect(screen.getByTestId('zero-reference')).toHaveAttribute('stroke-dasharray', '2 2');
    const regen = screen.getByRole('button', { name: 'Regen Power (kW)' });
    fireEvent.click(regen);
    expect(regen).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('powerMin')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByLabelText('Chart location')).toHaveTextContent('hidden_drivetrain-power-output=powerMin');
    expect(screen.getByRole('cell', { name: '-4.50 kW' })).toBeInTheDocument();
    fireEvent.click(regen);
    fireEvent.click(screen.getByRole('button', { name: 'Peak-labelled average drive power (kW)' }));
    expect(screen.getByTestId('powerMax')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByLabelText('Chart location')).toHaveTextContent('hidden_drivetrain-power-output=powerMax');
    expect(JSON.stringify(rows)).toBe(originalRows);
  });

  it('retains historical readings and exports through refresh failure and paused refresh', () => {
    const retry = vi.fn();
    const failed = deriveDataState({ data: rows, error: new Error('Refresh failed'), isError: true, refetch: retry });
    const { rerender } = render(<PowerHistory rows={rows} state={failed} loading />, { wrapper: Providers });
    expect(screen.getByRole('cell', { name: '1.23 kW' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    const paused = deriveDataState({ data: rows, fetchStatus: 'paused', isSuccess: true });
    rerender(<PowerHistory rows={rows} state={paused} loading />);
    expect(screen.getByRole('cell', { name: '1.23 kW' })).toBeInTheDocument();
    expect(screen.getByTestId('powerMin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeEnabled();
    expect(JSON.stringify(rows)).toBe(originalRows);
  });
});
