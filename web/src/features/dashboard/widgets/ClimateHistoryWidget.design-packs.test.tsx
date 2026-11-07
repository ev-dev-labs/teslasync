import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ChartDataRow } from '@/components/charts';
import type { ClimateState } from '@/types/vehicle-systems';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));

const source = vi.hoisted(() => ({
  temperature: '°C' as '°C' | '°F',
  discoveryRefresh: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 7 }], refetch: source.discoveryRefresh }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: source.temperature } }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: string | Date | null | undefined) => `tz(${String(value)})`,
    formatDateTime: (value: string | Date | null | undefined) => `tz(${String(value)})`,
  }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-07-01T00:00:00.000Z',
    endInstantExclusive: '2026-07-02T00:00:00.000Z',
  }),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));

const plot = vi.hoisted(() => ({
  data: null as readonly ChartDataRow[] | null,
  lines: {} as Record<string, Record<string, unknown>>,
  tick: null as ((value: string) => string) | null,
  tooltip: null as ((value: number, name: string) => [string, string]) | null,
  tooltipTime: null as ((value: string) => string) | null,
}));

// Keep the real embedded frame, fallback table, pack loader and shell. Only
// replace layout-dependent Recharts primitives in jsdom.
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  chartGrid: null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ data, children }: { data: readonly ChartDataRow[]; children: ReactNode }) => {
    plot.data = data;
    return <div data-testid="climate-history-plot">{children}</div>;
  },
  XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) => {
    plot.tick = tickFormatter;
    return null;
  },
  Tooltip: (props: {
    formatter: (value: number, name: string) => [string, string];
    labelFormatter: (value: string) => string;
  }) => {
    plot.tooltip = props.formatter;
    plot.tooltipTime = props.labelFormatter;
    return null;
  },
  Line: (props: Record<string, unknown>) => {
    plot.lines[String(props.dataKey)] = props;
    return null;
  },
  ChartLegend: () => null,
}));

import { request } from '@/api/client';
import ClimateHistoryWidget from './ClimateHistoryWidget';

const mockedRequest = vi.mocked(request);
const samples: ClimateState[] = [
  { created_at: '2026-07-01T02:00:00Z', insideTemp: 21, outsideTemp: 18 },
  { created_at: '2026-07-01T00:00:00Z', insideTemp: 20, outsideTemp: 18 },
  { created_at: '2026-07-01T01:00:00Z', insideTemp: null, outsideTemp: null },
  { created_at: 'invalid timestamp', insideTemp: 900, outsideTemp: 900 },
];
const expectedSamples = [
  { time: '2026-07-01T00:00:00Z', inside: 20, outside: 18 },
  { time: '2026-07-01T01:00:00Z', inside: null, outside: null },
  { time: '2026-07-01T02:00:00Z', inside: 21, outside: 18 },
];
const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][];

function renderPack(packId: PackId, cols = 2, entry = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  const tree = (pack: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <PackBoundary requestedPackId={pack}>
          <ClimateHistoryWidget vehicleId={7} size={{ cols, rows: 2 }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (pack: PackId) => view.rerender(tree(pack)) };
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="line"][data-widget-appearance="${appearance}"]`,
  )).not.toBeNull());
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(samples);
  source.temperature = '°C';
  plot.data = null;
  plot.lines = {};
  plot.tick = null;
  plot.tooltip = null;
  plot.tooltipTime = null;
  setGlobalLocale('en-US');
  setGlobalPrecision(1);
});

describe.each(packs)('climate history %s (%s)', (packId, appearance) => {
  it('composes real readings and the original two-series plot, range, units and refresh action', async () => {
    const { container } = renderPack(packId);
    await expectAppearance(container, appearance);

    expect(screen.getByText('Cabin temperature')).toBeInTheDocument();
    expect(screen.getByText('21.0')).toBeInTheDocument();
    expect(screen.getByText('18.0')).toBeInTheDocument();
    expect(screen.getByText('Cabin change')).toBeInTheDocument();
    expect(screen.getByText('+1.0')).toBeInTheDocument();
    expect(screen.getByText('Inside and outside temperatures can be compared over the same period.')).toBeInTheDocument();
    expect(container.querySelector('[data-chart-key="dashboard-climate-history"]')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Cabin (°C)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Outside (°C)' })).toBeInTheDocument();
    expect(plot.data).toEqual(expectedSamples);
    expect(plot.lines.inside).toMatchObject({
      stroke: CHART_COLORS[0], strokeWidth: 2, connectNulls: false, dot: false, hide: false,
    });
    expect(plot.lines.outside).toMatchObject({
      stroke: CHART_COLORS[1], strokeWidth: packId === 'v6' ? 2.5 : 2,
      strokeDasharray: packId === 'v5' ? '2 3' : undefined,
      connectNulls: false, dot: false, hide: false,
    });
    expect(plot.tick?.(samples[0].created_at ?? '')).toBe('tz(2026-07-01T02:00:00Z)');
    expect(plot.tooltipTime?.(samples[0].created_at ?? '')).toBe('tz(2026-07-01T02:00:00Z)');
    expect(plot.tooltip?.(21, 'inside')).toEqual(['21°C', 'Cabin']);
    expect(plot.tooltip?.(18, 'outside')).toEqual(['18°C', 'Outside']);
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(container.querySelector('.lucide-thermometer-sun')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/climate?vehicle_id=7&start=2026-07-01T00%3A00%3A00.000Z&end=2026-07-02T00%3A00%3A00.000Z',
    );

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    expect(source.discoveryRefresh).not.toHaveBeenCalled();
  });

  it('keeps empty source shells and unknown facts instead of a zero or an invented scale', async () => {
    mockedRequest.mockResolvedValue([]);
    const { container } = renderPack(packId);
    await expectAppearance(container, appearance);

    expect(screen.getByText('No climate history')).toBeInTheDocument();
    expect(screen.getByText('Cabin temperature')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('Cabin change')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('climate-history-plot')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull();
  });

  it('retains the compact temperature summary without mounting a chart', async () => {
    const { container } = renderPack(packId, 1);
    await expectAppearance(container, appearance);
    expect(screen.getByText('Cabin temperature')).toBeInTheDocument();
    expect(screen.getByText('21.0')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('18.0')).toBeInTheDocument();
    expect(screen.getByText('+1.0')).toBeInTheDocument();
    expect(screen.queryByTestId('climate-history-plot')).not.toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

it('preserves Classic and changes all seven presentations without a second data acquisition', async () => {
  const view = renderPack('classic');
  await screen.findByTestId('climate-history-plot');
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.queryByText('Cabin temperature')).not.toBeInTheDocument();

  for (const [packId, appearance] of packs) {
    view.selectPack(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.getAllByTestId('climate-history-plot')).toHaveLength(1);
    expect(plot.data).toEqual(expectedSamples);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  }

  view.selectPack('classic');
  await waitFor(() => expect(view.container.querySelector('[data-widget-family]')).toBeNull());
  expect(screen.queryByText('Cabin temperature')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('climate-history-plot')).toHaveLength(1);
  expect(plot.lines.outside).toMatchObject({ strokeWidth: 2, strokeDasharray: undefined });
  expect(mockedRequest).toHaveBeenCalledTimes(1);
});

it('retains source readings and the last chart on a failed refresh, including a subsequent pack change', async () => {
  const view = renderPack('v4');
  await expectAppearance(view.container, 'owner');
  mockedRequest.mockRejectedValueOnce(new Error('History refresh failed'));
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
  await waitFor(() => expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull());
  expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
  expect(screen.getByText('21.0')).toBeInTheDocument();
  expect(screen.getByTestId('climate-history-plot')).toBeInTheDocument();
  expect(plot.data).toEqual(expectedSamples);

  view.selectPack('v7');
  await expectAppearance(view.container, 'pixel');
  expect(screen.getByText('21.0')).toBeInTheDocument();
  expect(screen.getByTestId('climate-history-plot')).toBeInTheDocument();
  expect(mockedRequest).toHaveBeenCalledTimes(2);
});

it('does not convert invalid temperatures into a successful cabin reading or bridge their plot gaps', async () => {
  mockedRequest.mockResolvedValue([
    { created_at: '2026-07-01T00:00:00Z', insideTemp: Number.NaN, outsideTemp: null },
    { created_at: '2026-07-01T01:00:00Z', insideTemp: null, outsideTemp: Number.POSITIVE_INFINITY },
  ] satisfies ClimateState[]);
  const { container } = renderPack('v7');
  await expectAppearance(container, 'pixel');
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  expect(screen.queryByText('+0.0')).not.toBeInTheDocument();
  expect(plot.data).toEqual([
    { time: '2026-07-01T00:00:00Z', inside: null, outside: null },
    { time: '2026-07-01T01:00:00Z', inside: null, outside: null },
  ]);
  expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
  expect(screen.getByTestId('climate-history-plot')).toBeInTheDocument();
});

it.each([
  { temperature: '°F' as const, first: 20, last: 21, headline: '69.8', change: '+1.8' },
  { temperature: '°C' as const, first: -4, last: -5, headline: '-5.0', change: '-1.0' },
  { temperature: '°C' as const, first: 0, last: 0, headline: '0.0', change: '0.0' },
])('keeps $temperature temperature differences, measured zero and signs honest', async ({ temperature, first, last, headline, change }) => {
  source.temperature = temperature;
  mockedRequest.mockResolvedValue([
    { created_at: '2026-07-01T00:00:00Z', insideTemp: first, outsideTemp: null },
    { created_at: '2026-07-01T01:00:00Z', insideTemp: last, outsideTemp: null },
  ] satisfies ClimateState[]);
  const { container } = renderPack('v3');
  await expectAppearance(container, 'precision');
  expect(screen.getAllByText(headline).length).toBeGreaterThan(0);
  expect(screen.getAllByText(change).length).toBeGreaterThan(0);
  expect(screen.getByRole('columnheader', { name: `Cabin (${temperature})` })).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

it('does not infer a cabin change from a single known temperature', async () => {
  mockedRequest.mockResolvedValue([samples[0]]);
  const { container } = renderPack('v2');
  await expectAppearance(container, 'elevated');
  expect(screen.getByText('21.0')).toBeInTheDocument();
  expect(screen.getByText('Cabin change')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
});

it('keeps the existing URL-owned series visibility when the appearance changes', async () => {
  const view = renderPack('v5', 2, '/?hidden_dashboard-climate-history=outside');
  await expectAppearance(view.container, 'iconic');
  expect(plot.lines.inside.hide).toBe(false);
  expect(plot.lines.outside.hide).toBe(true);
  view.selectPack('v6');
  await expectAppearance(view.container, 'expressive');
  expect(plot.lines.outside.hide).toBe(true);
  expect(plot.data).toEqual(expectedSamples);
  expect(mockedRequest).toHaveBeenCalledTimes(1);
});
