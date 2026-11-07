import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotorSnapshot } from '@/api/types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import MotorHistoryWidget from './MotorHistoryWidget';

const state = vi.hoisted(() => ({
  history: [] as MotorSnapshot[] | undefined,
  temperature: '°C',
  refetch: vi.fn(),
  query: {
    isLoading: false, isPending: false, isFetching: false, isStale: false,
    isError: false, error: null as Error | null, dataUpdatedAt: Date.now(),
  },
  range: {
    start: '2026-05-04', end: '2026-05-10',
    startInstant: '2026-05-04T00:00:00Z', endInstantExclusive: '2026-05-11T00:00:00Z',
    presetId: '7d',
  },
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 7 }] }),
  useMotorHistory: vi.fn(() => ({ ...state.query, data: state.history, refetch: state.refetch })),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: state.temperature } }),
}));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => state.range }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string) => value,
    formatDateShort: (value: string) => value,
    formatTime: (value: string) => value,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number, decimals = 1) => value.toFixed(decimals),
    fmtInt: (value: number) => value.toFixed(0),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' && fallback !== null
        ? fallback as Record<string, unknown> : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return Object.entries(options ?? {}).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)), text,
      );
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

// Keep the real embedded frame, accessible table, shell and pack layouts; jsdom has no plot geometry.
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  useMeasuredAxisWidth: () => 40,
  ComposedChart: ({ data, children }: { data: unknown[]; children?: ReactNode }) => (
    <div data-testid="motor-plot" data-rows={JSON.stringify(data)}>{children}</div>
  ),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Line: ({ dataKey, yAxisId, connectNulls, strokeDasharray }: {
    dataKey: string; yAxisId: string; connectNulls?: boolean; strokeDasharray?: string;
  }) => <div data-testid={`series-${dataKey}`} data-axis={yAxisId}
    data-connect-nulls={String(connectNulls)} data-dash={strokeDasharray} />,
  XAxis: ({ dataKey }: { dataKey: string }) => <div data-testid="time-axis" data-key={dataKey} />,
  YAxis: ({ yAxisId, domain, orientation }: {
    yAxisId: string; domain?: readonly number[]; orientation?: string;
  }) => <div data-testid={`axis-${yAxisId}`} data-domain={JSON.stringify(domain)} data-orientation={orientation} />,
  ReferenceArea: ({ y1, y2 }: { y1: number; y2: number }) => (
    <div data-testid="danger-zone" data-min={y1} data-max={y2} />
  ),
  Tooltip: ({ formatter, labelFormatter }: {
    formatter: (value: number, name: string) => [string, string];
    labelFormatter: (value: string) => string;
  }) => <div data-testid="motor-tooltip"
    data-torque={formatter(-240, 'Torque')[0]}
    data-temperature={formatter(state.temperature === '°F' ? 149 : 65, 'Stator')[0]}
    data-time={labelFormatter('2026-05-10T12:00:00Z')} />,
  ChartTooltip: () => null,
  ChartLegend: () => null,
  chartGrid: <div />,
}));

function snapshot(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-05-10T12:00:00Z', created_at: '2026-05-10T12:00:00Z',
    torque_nm_front: null, torque_nm_rear: null, di_torque: null,
    motor_rpm_front: null, motor_rpm_rear: null,
    motor_temp_c_front: null, motor_temp_c_rear: null,
    inverter_temp_c: null, inverter_temp_rear: null,
    heatsink_temp_front: null, heatsink_temp_rear: null,
    motor_current_front: null, motor_current_rear: null,
    state_front: null, state_rear: null, shift_state: null,
    vbat_front: null, vbat_rear: null,
    ...overrides,
  };
}

function observedHistory(): MotorSnapshot[] {
  return [
    snapshot({ di_stator_temp: 65, di_torque: 240 }),
    snapshot({ ts: '2026-05-10T11:00:00Z', di_torque: -240 }),
    snapshot({ ts: '2026-05-10T13:00:00Z', di_stator_temp: 125, di_torque: 0 }),
  ];
}

function mountWidget(pack: PackId = 'classic', size = { cols: 2, rows: 4 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <MotorHistoryWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: PackId) => view.rerender(tree(next)) };
}

async function expectPack(container: HTMLElement, pack: Exclude<PackId, 'classic'>) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-appearance="${PACK_APPEARANCES[pack]}"]`))
      .toHaveAttribute('data-widget-family', 'line');
  });
}

function plottedReadings() {
  return JSON.parse(screen.getByTestId('motor-plot').getAttribute('data-rows') ?? '[]') as Array<{
    time: string; temperature: number | null; torque: number | null;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.history = observedHistory();
  state.temperature = '°C';
  state.query = {
    isLoading: false, isPending: false, isFetching: false, isStale: false,
    isError: false, error: null, dataUpdatedAt: Date.now(),
  };
});

describe.each(Object.entries(PACK_APPEARANCES) as Array<[Exclude<PackId, 'classic'>, string]>)(
  'Motor history %s (%s)',
  (pack) => {
    it('keeps observed samples, separate axes, the danger zone, units and the source refresh action', async () => {
      const { container } = mountWidget(pack);
      await expectPack(container, pack);
      expect(container.querySelector('[data-role="widget-header-title"]')).toHaveTextContent('Motor history');
      expect(screen.getByText('125')).toBeInTheDocument();
      expect(screen.getByText('Stator temp · 7 days')).toBeInTheDocument();
      expect(screen.getByText('Danger threshold reached')).toBeInTheDocument();
      expect(screen.getByText('Danger zone above 120 °C')).toBeInTheDocument();
      expect(plottedReadings().map(({ time, temperature, torque }) => [time, temperature, torque])).toEqual([
        ['2026-05-10T11:00:00Z', null, -240],
        ['2026-05-10T12:00:00Z', 65, 240],
        ['2026-05-10T13:00:00Z', 125, 0],
      ]);
      expect(screen.getByTestId('series-temperature')).toHaveAttribute('data-axis', 'temp');
      expect(screen.getByTestId('series-torque')).toHaveAttribute('data-axis', 'torque');
      expect(screen.getByTestId('series-temperature')).toHaveAttribute('data-connect-nulls', 'false');
      expect(screen.getByTestId('series-torque')).toHaveAttribute('data-connect-nulls', 'false');
      if (pack === 'v7') expect(screen.getByTestId('series-torque')).toHaveAttribute('data-dash', '2 3');
      expect(screen.getByTestId('time-axis')).toHaveAttribute('data-key', 'time');
      expect(screen.getByTestId('axis-temp')).toHaveAttribute('data-domain', '[65,135]');
      expect(screen.getByTestId('axis-temp')).toHaveAttribute('data-orientation', 'right');
      expect(screen.getByTestId('axis-acceleration')).toBeInTheDocument();
      expect(screen.getByTestId('danger-zone')).toHaveAttribute('data-min', '120');
      expect(screen.getByTestId('danger-zone')).toHaveAttribute('data-max', '135');
      expect(screen.getByTestId('motor-tooltip')).toHaveAttribute('data-torque', '-240.0 N·m');
      expect(screen.getByTestId('motor-tooltip')).toHaveAttribute('data-temperature', '65.0 °C');
      expect(screen.getByTestId('motor-tooltip')).toHaveAttribute('data-time', '2026-05-10T12:00:00Z');
      expect(screen.getByRole('columnheader', { name: 'Stator (°C)' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Torque (N·m)' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '-240.0' })).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
      expect(state.refetch).toHaveBeenCalledOnce();
      const { useMotorHistory } = await import('@/api/hooks/useVehicles');
      expect(useMotorHistory).toHaveBeenCalledWith(7, {
        limit: 200, start: state.range.startInstant, end: state.range.endInstantExclusive,
      });
    });

    it('preserves the compact peak and range without introducing a fake plot or scale', async () => {
      const { container } = mountWidget(pack, { cols: 1, rows: 2 });
      await expectPack(container, pack);
      expect(screen.getByText('Peak stator temp')).toBeInTheDocument();
      expect(screen.getByText('125')).toBeInTheDocument();
      expect(screen.getByText('7 days')).toBeInTheDocument();
      expect(screen.queryByTestId('motor-plot')).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('retains signed torque-only data while temperature and its danger state remain unknown', async () => {
      state.history = [snapshot({ di_torque: -240 })];
      const { container } = mountWidget(pack);
      await expectPack(container, pack);
      expect(plottedReadings().map(row => [row.temperature, row.torque])).toEqual([[null, -240]]);
      expect(screen.getByText('Awaiting temperature reading')).toBeInTheDocument();
      expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
      expect(screen.queryByText('Danger zone not reached')).not.toBeInTheDocument();
      expect(screen.queryByText('No motor history')).not.toBeInTheDocument();
    });

    it('keeps the empty source shell and unknown headline visible without fabricated readings', async () => {
      state.history = [];
      const { container } = mountWidget(pack);
      await expectPack(container, pack);
      expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull();
      expect(screen.getByText('No motor history')).toBeInTheDocument();
      expect(screen.getByText('Awaiting temperature reading')).toBeInTheDocument();
      expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
      expect(screen.queryByTestId('motor-plot')).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });
  },
);

it('keeps Classic as the default and restores its full original body after all seven pack selections', async () => {
  const { container, selectPack } = mountWidget();
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByTestId('motor-plot')).toBeInTheDocument();
  expect(screen.getByTestId('series-torque')).not.toHaveAttribute('data-dash');
  const originalRows = plottedReadings();
  for (const pack of Object.keys(PACK_APPEARANCES) as Array<Exclude<PackId, 'classic'>>) {
    selectPack(pack);
    await expectPack(container, pack);
    expect(plottedReadings()).toEqual(originalRows);
  }
  selectPack('classic');
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('125')).toBeInTheDocument();
  expect(screen.getByText('Danger threshold reached')).toBeInTheDocument();
  expect(plottedReadings()).toEqual(originalRows);
  expect(screen.getByTestId('series-torque')).not.toHaveAttribute('data-dash');
});

it('uses the display preference for every pack sample, threshold, tooltip and accessible column', async () => {
  state.temperature = '°F';
  state.history = [snapshot({ di_stator_temp: 65, di_torque: -240 })];
  const { container } = mountWidget('v7');
  await expectPack(container, 'v7');
  expect(screen.getByText('149')).toBeInTheDocument();
  expect(plottedReadings()[0].temperature).toBe(149);
  expect(screen.getByTestId('danger-zone')).toHaveAttribute('data-min', '248');
  expect(screen.getByText('Danger zone above 248 °F')).toBeInTheDocument();
  expect(screen.getByTestId('motor-tooltip')).toHaveAttribute('data-temperature', '149.0 °F');
  expect(screen.getByRole('columnheader', { name: 'Stator (°F)' })).toBeInTheDocument();
});

it('keeps retained observations and source trust visible when a pack refresh fails', async () => {
  state.query.isError = true;
  state.query.isStale = true;
  state.query.error = new Error('Motor history refresh failed');
  const { container } = mountWidget('v4');
  await expectPack(container, 'v4');
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
    'Previously loaded data remains visible while affected sources recover.',
  );
  expect(screen.getByText('125')).toBeInTheDocument();
  expect(plottedReadings()).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it('keeps in-flight refresh disabled while retaining the observed chart', async () => {
  state.query.isFetching = true;
  const { container } = mountWidget('v2');
  await expectPack(container, 'v2');
  const refresh = screen.getByRole('button', { name: /^Refresh data/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(state.refetch).not.toHaveBeenCalled();
  expect(plottedReadings()).toHaveLength(3);
});

it('retains loading and fatal-error shells instead of rendering a successful pack with no source', () => {
  state.history = undefined;
  state.query.isLoading = true;
  state.query.isPending = true;
  const { container, selectPack } = mountWidget('v6');
  expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByTestId('motor-plot')).not.toBeInTheDocument();
  state.query.isLoading = false;
  state.query.isPending = false;
  state.query.isError = true;
  state.query.error = new Error('Motor history unavailable');
  selectPack('v6');
  expect(container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
  expect(screen.queryByTestId('motor-plot')).not.toBeInTheDocument();
  expect(screen.queryByText('Danger zone not reached')).not.toBeInTheDocument();
});
