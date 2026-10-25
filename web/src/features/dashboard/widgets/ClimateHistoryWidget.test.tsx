import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CHART_COLORS } from '@/lib/colors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  }),
}));

let vehicles: { data: Array<{ id: number }> | undefined } = { data: [] };
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => vehicles }));

let temperature: '°C' | '°F' = '°C';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature } }),
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

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

const cap = vi.hoisted(() => ({
  data: null as unknown,
  xTick: null as null | ((value: string) => string),
  tooltip: null as null | ((value: number, name: string) => [string, string]),
  label: null as null | ((value: string) => string),
  lines: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    chartGrid: null,
    ResponsiveContainer: (props: { children: ReactNode }) => <div data-testid="line-chart-shell">{props.children}</div>,
    LineChart: (props: { data: unknown; children: ReactNode }) => {
      cap.data = props.data;
      return <div data-testid="line-chart">{props.children}</div>;
    },
    XAxis: (props: { tickFormatter: (value: string) => string }) => {
      cap.xTick = props.tickFormatter;
      return null;
    },
    Tooltip: (props: { formatter: (value: number, name: string) => [string, string]; labelFormatter: (value: string) => string }) => {
      cap.tooltip = props.formatter;
      cap.label = props.labelFormatter;
      return null;
    },
    Line: (props: Record<string, unknown>) => {
      const key = String(props.dataKey);
      cap.lines[key] = props;
      return null;
    },
  };
});

import { request } from '@/api/client';
import ClimateHistoryWidget from './ClimateHistoryWidget';
import type { ClimateState } from '@/types/vehicle-systems';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const full = { cols: 2, rows: 2 };

function climate(created_at: string, insideTemp: number | null, outsideTemp: number | null): ClimateState {
  return { created_at, insideTemp, outsideTemp };
}

function renderWidget(vehicleId?: number, size = full) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClimateHistoryWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vehicles = { data: [] };
  temperature = '°C';
  cap.data = null;
  cap.lines = {};
  cap.xTick = null;
  cap.tooltip = null;
  cap.label = null;
  mockedRequest.mockReset();
});

describe('ClimateHistoryWidget redesign', () => {
  it('renders the After line-chart hierarchy, shared legend dots, and no repeated value labels', async () => {
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T02:00:00Z', 22, 12),
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T01:00:00Z', 21, 11),
    ]);
    renderWidget(7);

    expect(await screen.findByTestId('line-chart')).toBeInTheDocument();
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/climate?vehicle_id=7&start=2026-07-01T00%3A00%3A00.000Z&end=2026-07-02T00%3A00%3A00.000Z',
    );
    expect(cap.data).toEqual([
      { time: '2026-07-01T00:00:00Z', inside: 20, outside: 10 },
      { time: '2026-07-01T01:00:00Z', inside: 21, outside: 11 },
      { time: '2026-07-01T02:00:00Z', inside: 22, outside: 12 },
    ]);
    expect(cap.lines.inside).toMatchObject({ stroke: CHART_COLORS[0], dot: false, connectNulls: false });
    expect(cap.lines.outside).toMatchObject({ stroke: CHART_COLORS[1], dot: false, connectNulls: false });
    expect(screen.getByText('Inside').closest('li')?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Outside').closest('li')?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByText('Cabin')).toBeNull();
    expect(screen.queryByText(/Last 24 hours/)).toBeNull();
  });

  it('uses shared timezone-aware formatting and unit-aware tooltips without inventing y labels', async () => {
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T01:00:00Z', 21, 11),
    ]);
    renderWidget(7);
    await screen.findByTestId('line-chart');

    expect(cap.xTick?.('2026-07-01T00:00:00Z')).toBe('tz(2026-07-01T00:00:00Z)');
    expect(cap.label?.('2026-07-01T00:00:00Z')).toBe('tz(2026-07-01T00:00:00Z)');
    expect(cap.tooltip?.(21, 'inside')).toEqual(['21°C', 'Cabin']);
    expect(cap.tooltip?.(11, 'outside')).toEqual(['11°C', 'Outside']);
  });

  it('converts SI Celsius to Fahrenheit throughout the chart', async () => {
    temperature = '°F';
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T01:00:00Z', 25, 15),
    ]);
    renderWidget(7);
    await screen.findByTestId('line-chart');
    expect(cap.data).toEqual([
      { time: '2026-07-01T00:00:00Z', inside: 68, outside: 50 },
      { time: '2026-07-01T01:00:00Z', inside: 77, outside: 59 },
    ]);
    expect(cap.tooltip?.(77, 'inside')).toEqual(['77°F', 'Cabin']);
  });

  it('keeps non-finite samples as gaps and never fabricates zero', async () => {
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', Number.NaN, 10),
      climate('2026-07-01T01:00:00Z', 20, Number.POSITIVE_INFINITY),
    ]);
    renderWidget(7);
    await screen.findByTestId('line-chart');
    expect(cap.data).toEqual([
      { time: '2026-07-01T00:00:00Z', inside: null, outside: 10 },
      { time: '2026-07-01T01:00:00Z', inside: 20, outside: null },
    ]);
    expect(document.querySelector('[data-data-state="partial"]')).not.toBeNull();
  });

  it('renders compact stats-free and full chart content by width', async () => {
    mockedRequest.mockResolvedValue([climate('2026-07-01T00:00:00Z', 20, 10)]);
    const compact = renderWidget(7, { cols: 1, rows: 1 });
    await waitFor(() => expect(compact.queryByTestId('line-chart')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Climate history' })).toBeInTheDocument();
    cleanup();

    mockedRequest.mockResolvedValue([climate('2026-07-01T00:00:00Z', 20, 10)]);
    renderWidget(7, { cols: 2, rows: 2 });
    await screen.findByTestId('line-chart');
  });

  it('shows empty, loading, error, and refresh states honestly', async () => {
    mockedRequest.mockResolvedValue([]);
    const empty = renderWidget(7);
    expect(await screen.findByText('No climate history')).toBeInTheDocument();
    expect(screen.getByText('No climate history').closest('[role="status"]')).not.toBeNull();
    empty.unmount();

    mockedRequest.mockReturnValue(new Promise(() => undefined));
    const loading = renderWidget(7);
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    mockedRequest.mockRejectedValue(new Error('boom'));
    renderWidget(7);
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
  });

  it('disables invalid and missing vehicles and resolves the first fleet vehicle', async () => {
    renderWidget(0);
    expect(mockedRequest).not.toHaveBeenCalled();
    cleanup();

    vehicles = { data: [{ id: 3 }] };
    mockedRequest.mockResolvedValue([climate('2026-07-01T00:00:00Z', 18, 5)]);
    renderWidget();
    await waitFor(() => expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/climate?vehicle_id=3&start=2026-07-01T00%3A00%3A00.000Z&end=2026-07-02T00%3A00%3A00.000Z',
    ));
  });

  it('refetches through the accessible freshness control', async () => {
    mockedRequest.mockResolvedValue([climate('2026-07-01T00:00:00Z', 20, 10)]);
    renderWidget(7);
    await screen.findByTestId('line-chart');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });
});
