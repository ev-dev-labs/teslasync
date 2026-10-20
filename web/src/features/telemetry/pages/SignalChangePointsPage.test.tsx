import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { ChartContainerProps } from '@/components/charts';
import type { StatMetric } from '@/components/data-display';
import { summarizeSignalChangePoints, toNumericPoints } from '../lib/signalChangePoints';
import canonicalEnglish from '@/i18n/en.json';
import telemetryEnglish from '@/i18n/en/locale-telemetry.json';

interface Query<T> extends DataStateSource<T> {
  refetch: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  catalog: {} as Query<string[]>,
  history: {} as Query<SignalHistoryResponse>,
  historyHook: vi.fn(),
  request: vi.fn(),
  range: {
    startInstant: '2026-10-10T00:00:00.123Z',
    endInstantExclusive: '2026-10-13T00:00:00.123Z',
  },
  chart: null as ChartContainerProps | null,
  metrics: [] as readonly StatMetric[],
  markers: [] as number[],
  series: [] as Array<{ dataKey: string; strokeWidth: number; type: string }>,
  axis: null as { dataKey: string; type: string; tickFormatter: (ms: number) => string } | null,
  dateFormat: vi.fn((value: string | Date) => `saved-zone:${new Date(value).toISOString().slice(0, 16)}`),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: unknown, options?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      return Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), fallback,
      );
    },
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: state.vehicleId }) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => state.range }));
vi.mock('@/api/client', () => ({ request: state.request }));
vi.mock('@/hooks/useDateFormat', () => ({ useDateFormat: () => ({ formatDateTime: state.dateFormat }) }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => `number:${value}`,
    fmtScientificNumber: (value: number) => `scientific:${value}`,
  }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => state.catalog,
  useSignalAnalysisHistory: (...args: unknown[]) => {
    state.historyHook(...args);
    return state.history;
  },
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ title, children, dataSources }: ComponentProps<typeof import('@/components/layout').PageLayout>) => (
    <main><h1>{title}</h1>
      {dataSources?.filter((source) => source.enabled !== false && source.query.isError).map((source) => (
        <button key={source.id} onClick={() => source.query.refetch?.()}>Retry {source.label}</button>
      ))}
      {children}
    </main>
  ),
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children, className }: { children: ReactNode; className?: string }) => <section className={className}>{children}</section>,
  PanelTitle: ({ children, className }: { children: ReactNode; className?: string }) => <h2 className={className}>{children}</h2>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Icon: () => null,
  HelpTooltip: ({ ariaLabel }: { ariaLabel: string }) => <button aria-label={ariaLabel} />,
  Select: ({ label, options, value, onChange, placeholder, className }: ComponentProps<typeof import('@/components/ui').Select>) => (
    <label>{label}<select aria-label={label} value={value} onChange={onChange} className={className}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
  ),
}));
vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div data-testid="source-loading" />,
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  QueryError: ({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) => (
    <div role="alert">{error?.message}{onRetry && <button onClick={onRetry}>Retry</button>}</div>
  ),
}));
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: () => <p>No vehicle selected</p>,
}));
vi.mock('../components/operationalbrief-all/TelemetrySummaryBrief', () => ({
  TelemetrySummaryBrief: ({ title, metrics, retained, loading, sourceStatus }: {
    title: string; metrics: readonly StatMetric[]; retained?: boolean; loading?: boolean; sourceStatus?: string;
  }) => {
    state.metrics = metrics;
    return <section data-testid="signal-change-points-summary" data-retained={retained}
      data-loading={loading} data-source-status={sourceStatus}>
      <h2>{title}</h2>
      {metrics.map((metric) => <div key={metric.occurrenceId}>{metric.label}{metric.description}{metric.context}</div>)}
    </section>;
  },
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: (props: ChartContainerProps) => {
    state.chart = props;
    return <section><h2>{props.title}</h2>
      {props.loading ? <p>Loading timeline</p> : props.error ? <p>{String(props.error)}</p>
        : props.empty ? <p>{props.emptyMessage}</p> : typeof props.children !== 'function' ? props.children : null}
    </section>;
  },
  ChartTooltip: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  ReferenceLine: ({ x }: { x: number }) => { state.markers.push(x); return null; },
  Line: (props: { dataKey: string; strokeWidth: number; type: string }) => { state.series.push(props); return null; },
  XAxis: (props: NonNullable<typeof state.axis>) => { state.axis = props; return null; },
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import SignalChangePointsPage from './SignalChangePointsPage';

function query<T>(data?: T, overrides: Partial<Query<T>> = {}): Query<T> {
  return {
    data, isSuccess: data !== undefined, isLoading: data === undefined,
    isPending: data === undefined, isError: false, isFetching: false,
    fetchStatus: 'idle', dataUpdatedAt: 12345, refetch: vi.fn(), ...overrides,
  };
}

function history(values: readonly number[]): SignalHistoryResponse {
  return {
    vehicleId: 4, signal: 'Speed', from: '2026-10-10T00:00:00Z', to: '2026-10-13T00:00:00Z',
    count: values.length,
    data: values.map((value, index) => ({
      ts: new Date(Date.parse('2026-10-12T00:00:00Z') + index * 100).toISOString(),
      kind: 'ValueKindDouble', value, ingest_origin: null, source_emitted_at: null,
      received_at: null, normalization_version: null,
    })),
  };
}

function choose() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Signal' }), { target: { value: 'Speed' } });
}

beforeEach(() => {
  state.vehicleId = 4;
  state.range = {
    startInstant: '2026-10-10T00:00:00.123Z',
    endInstantExclusive: '2026-10-13T00:00:00.123Z',
  };
  state.request.mockReset();
  state.catalog = query(['Speed', 'Gear', 'A/raw signal']);
  state.history = query<SignalHistoryResponse>();
  state.chart = null;
  state.metrics = [];
  state.markers = [];
  state.series = [];
  state.axis = null;
  state.historyHook.mockClear();
  state.dateFormat.mockClear();
});

describe('SignalChangePointsPage evidence preservation', () => {
  it('keeps all four sections and unknown metrics before selection', () => {
    render(<SignalChangePointsPage />);
    for (const heading of ['Choose a signal', 'Change-point metrics', 'Regime timeline', 'Reading the result']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(state.metrics).toHaveLength(4);
    expect(state.metrics.map((metric) => metric.rawValue)).toEqual([null, undefined, null, null]);
    expect(screen.queryByText('No alarm detected')).not.toBeInTheDocument();
    expect(screen.queryByText('no shift detected')).not.toBeInTheDocument();
    expect(screen.queryByText('noise scale scientific:0')).not.toBeInTheDocument();
  });

  it('preserves literal catalog options, vehicle scope, the shared range and clearing selection', () => {
    render(<SignalChangePointsPage />);
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['', 'Speed', 'Gear', 'A/raw signal']);
    choose();
    expect(state.historyHook).toHaveBeenLastCalledWith(4, 'Speed', 72, 10_000, state.range);
    expect(screen.getByRole('combobox')).toHaveClass('min-h-11', 'md:min-h-10');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(state.historyHook).toHaveBeenLastCalledWith(4, '', 72, 10_000, state.range);
  });

  it('updates both precise bounds without adding a second range picker or losing populated analysis', () => {
    state.history = query(history([0, 0, 0, 0, 0]));
    const { rerender } = render(<SignalChangePointsPage />);
    choose();
    state.range = {
      startInstant: '2026-10-12T13:55:58.824Z',
      endInstantExclusive: '2026-10-13T13:55:58.824Z',
    };
    rerender(<SignalChangePointsPage />);
    expect(state.historyHook).toHaveBeenLastCalledWith(4, 'Speed', 24, 10_000, state.range);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(state.chart?.data).toHaveLength(5);
    expect(screen.getByText('No alarm detected')).toBeInTheDocument();
    expect(screen.getByText(/raw sample sequence over number:24h/)).toBeInTheDocument();
  });

  it.each([{ name: 'one sample', values: [0] }, { name: 'below minimum', values: [1, 1, 1, 1] }])(
    'does not report stability or a measured change count for $name',
    ({ values }) => {
      state.history = query(history(values));
      render(<SignalChangePointsPage />);
      choose();
      expect(state.metrics[0]?.rawValue).toBeNull();
      expect(state.metrics[3]?.rawValue).toBe(values.length);
      expect(state.chart?.data).toHaveLength(values.length);
      expect(screen.queryByText('No alarm detected')).not.toBeInTheDocument();
      expect(screen.getAllByText('Not enough history yet for this signal.').length).toBeGreaterThan(0);
    },
  );

  it('reports measured zero shifts only after the fixed minimum evidence exists', () => {
    state.history = query(history([0, 0, 0, 0, 0]));
    render(<SignalChangePointsPage />);
    choose();
    expect(state.metrics[0]?.rawValue).toBe(0);
    expect(state.metrics[2]?.rawValue).toBe(1);
    expect(state.metrics[3]?.rawValue).toBe(5);
    expect(screen.getByText('No alarm detected')).toBeInTheDocument();
    expect(screen.getByText(/This does not establish stability or rule out drift/)).toBeInTheDocument();
  });

  it('explains recurring ramp alarms without claiming an abrupt step or drift immunity', () => {
    const response = history(Array.from({ length: 60 }, (_, i) => i * 0.01));
    const expected = summarizeSignalChangePoints(response.data);
    expect(expected.changePoints.length).toBeGreaterThan(1);
    state.history = query(response);
    render(<SignalChangePointsPage />);
    state.markers = [];
    choose();

    expect(state.metrics[0]?.rawValue).toBe(expected.changePoints.length);
    expect(state.markers).toEqual(expected.changePoints.map((point) => point.ms));
    expect(screen.getByText('Alarm threshold crossed')).toBeInTheDocument();
    expect(screen.getByText(/Abrupt shifts or sustained drift can trigger alarms/)).toBeInTheDocument();
    expect(screen.getByText(/including repeated alarms after resets/)).toBeInTheDocument();
    expect(screen.queryByText(/slow ramp, which would show no alarm/)).not.toBeInTheDocument();
  });

  it('keeps canonical and runtime English aligned with the statistical policy', () => {
    for (const key of ['subtitle', 'shifted', 'shiftedText', 'stable', 'stableText'] as const) {
      expect(telemetryEnglish.signalChangePoints[key]).toBe(canonicalEnglish.signalChangePoints[key]);
    }
    expect(canonicalEnglish.signalChangePoints.shiftedText).toContain('sustained drift');
    expect(canonicalEnglish.signalChangePoints.shiftedText).toContain('repeated alarms after resets');
    expect(canonicalEnglish.signalChangePoints.stableText).toContain('does not establish stability');
  });

  it('keeps raw SI precision, precise timestamps, both series and every detector marker', () => {
    const response = history([
      ...Array.from({ length: 8 }, () => 0.000123456789),
      ...Array.from({ length: 8 }, () => 20.123456789),
      ...Array.from({ length: 8 }, () => -5.123456789),
    ]);
    const frozen = structuredClone(response);
    const expected = summarizeSignalChangePoints(response.data);
    expect(expected.changePoints.length).toBeGreaterThan(1);
    state.history = query(response);
    render(<SignalChangePointsPage />);
    state.markers = [];
    state.series = [];
    choose();
    expect(response).toEqual(frozen);
    expect(state.chart?.data?.map((row) => row.value)).toEqual(response.data.map((row) => row.value));
    expect(state.chart?.data?.[0]?.level).toBe(expected.segments[0]?.mean);
    expect(state.axis).toMatchObject({ dataKey: 'ms', type: 'number' });
    expect(state.markers).toEqual(expected.changePoints.map((point) => point.ms));
    expect(new Set(state.markers).size).toBe(state.markers.length);
    expect(state.series).toEqual(expect.arrayContaining([
      expect.objectContaining({ dataKey: 'value', type: 'monotone', strokeWidth: 2 }),
      expect.objectContaining({ dataKey: 'level', type: 'stepAfter', strokeWidth: 1 }),
    ]));
    const valueColumn = state.chart?.dataColumns?.find((column) => column.key === 'value');
    expect(valueColumn?.format?.(0.000123456789)).toBe('scientific:0.000123456789');
    const timeColumn = state.chart?.dataColumns?.find((column) => column.key === 'time');
    expect(timeColumn?.format?.(response.data[1]?.ts)).toContain(response.data[1]!.ts);
    expect(state.axis?.tickFormatter(Date.parse(response.data[1]!.ts))).toContain('saved-zone:');
    for (const point of expected.changePoints) {
      expect(state.chart?.data?.[point.index]).toMatchObject({
        magnitude: point.magnitude,
        changePoint: `${point.direction} · confidence number:${point.confidence}`,
      });
    }
    expect(state.chart?.exportData).toBeUndefined();
    expect(state.chart?.fullscreen).toBeUndefined();
  });

  it('preserves numeric filtering, last-valid timestamp deduplication and chronological order', () => {
    const response = history([3, 2, 1, 0, -1]);
    response.data.reverse();
    response.data.push({ ...response.data[0]!, kind: 'ValueKindBool', value: true });
    response.data.push({ ...response.data[1]!, value: 0.000012345 });
    state.history = query(response);
    render(<SignalChangePointsPage />);
    choose();
    expect(state.chart?.data?.map((row) => ({ ms: row.ms, value: row.value }))).toEqual(toNumericPoints(response.data));
    expect(state.metrics[3]?.rawValue).toBe(5);
  });

  it('keeps resolved empty evidence distinct from an unchosen source', () => {
    state.history = query(history([]));
    render(<SignalChangePointsPage />);
    choose();
    expect(state.metrics[3]?.rawValue).toBe(0);
    expect(state.metrics[0]?.rawValue).toBeNull();
    expect(state.chart?.emptyMessage).toBe('Not enough history yet for this signal.');
    expect(screen.queryByText('Pick a signal to see how its change points should be read.')).not.toBeInTheDocument();
  });

  it('does not infer empty or stable evidence while the initial source is paused', () => {
    state.history = query(undefined, { fetchStatus: 'paused', isLoading: false });
    render(<SignalChangePointsPage />);
    choose();
    expect(state.metrics[3]?.rawValue).toBeNull();
    expect(state.chart?.emptyMessage).toBe('Source values unknown');
    expect(screen.queryByText('Not enough history yet for this signal.')).not.toBeInTheDocument();
    expect(screen.queryByText('No alarm detected')).not.toBeInTheDocument();
  });

  it('shows source loading without fabricating measurements', () => {
    render(<SignalChangePointsPage />);
    choose();
    expect(state.chart?.loading).toBe(true);
    expect(screen.getByTestId('signal-change-points-summary')).toHaveAttribute('data-loading', 'true');
    expect(state.metrics[0]?.rawValue).toBeNull();
  });

  it.each([
    { name: 'refresh failure', overrides: { error: new Error('History refresh failed'), isError: true } },
    { name: 'paused refresh', overrides: { fetchStatus: 'paused' as const } },
  ])('retains all analysis and historical trust during $name', ({ overrides }) => {
    state.history = query(history([1, 1, 1, 1, 1]), overrides);
    render(<SignalChangePointsPage />);
    choose();
    expect(state.chart?.error).toBeNull();
    expect(state.chart?.data).toHaveLength(5);
    expect(screen.getByText('No alarm detected')).toBeInTheDocument();
    expect(screen.getByTestId('signal-change-points-summary')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('signal-change-points-summary')).toHaveAttribute('data-source-status', 'stale');
  });

  it('keeps source failure contextual without duplicating history retry controls', () => {
    const error = new Error('History unavailable');
    state.history = query(undefined, { error, isError: true, isLoading: false });
    render(<SignalChangePointsPage />);
    choose();
    expect(state.chart?.error).toBe(error);
    expect(state.chart?.onRetry).toBeUndefined();
    expect(screen.getAllByRole('button', { name: /^Retry / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Selected signal history' }));
    expect(state.history.refetch).toHaveBeenCalledTimes(1);
    expect(state.catalog.refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reading the result' })).toBeInTheDocument();
  });

  it('keeps the governed no-vehicle prerequisite and disabled hook scope', () => {
    state.vehicleId = null;
    render(<SignalChangePointsPage />);
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(state.historyHook).toHaveBeenCalledWith(0, '', 72, 10_000, state.range);
  });
});

describe('change-point history transport', () => {
  it('keys both bounds, preserves cancellation and polling, and caps the request at 10000 rows', async () => {
    const { useSignalAnalysisHistory, telemetryKeys } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    state.request.mockResolvedValue(history([1, 1, 1, 1, 1]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender, unmount } = renderHook(
      ({ window }) => useSignalAnalysisHistory(4, 'A/raw signal', 72, 20_000, window),
      { wrapper, initialProps: { window: state.range } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, options] = state.request.mock.calls[0]!;
    expect(url).toBe(`/signals/4/A%2Fraw%20signal/history?from=${encodeURIComponent(state.range.startInstant)}&to=${encodeURIComponent(state.range.endInstantExclusive)}&limit=10000`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const firstKey = telemetryKeys.signalAnalysisHistory(4, 'A/raw signal', 72, 10_000,
      state.range.startInstant, state.range.endInstantExclusive);
    const firstQuery = client.getQueryCache().find({ queryKey: firstKey });
    expect(firstQuery?.options).toMatchObject({ refetchInterval: 30_000, refetchIntervalInBackground: false });
    const nextWindow = { ...state.range, endInstantExclusive: '2026-10-14T00:00:00.456Z' };
    rerender({ window: nextWindow });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
    expect(state.request.mock.calls[1]?.[0]).toContain(`to=${encodeURIComponent(nextWindow.endInstantExclusive)}`);
    rerender({ window: { ...nextWindow, startInstant: '2026-10-11T01:02:03.789Z' } });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
    expect(client.getQueryCache().getAll()).toHaveLength(3);
    expect(telemetryKeys.signalAnalysisHistory(4, 'Speed', 72, 10_000))
      .toEqual(['signal-analysis-history', 4, 'Speed', 72, 10_000]);
    unmount();
    client.clear();
  });

  it('preserves relative hours for existing callers without an explicit range', async () => {
    const { useSignalAnalysisHistory } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    state.request.mockResolvedValue(history([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useSignalAnalysisHistory(4, 'Speed', 72), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.request.mock.calls[0]?.[0]).toBe('/signals/4/Speed/history?hours=72&limit=10000');
    unmount();
    client.clear();
  });

  it('aborts an obsolete window and keeps unselected or missing-vehicle queries disabled', async () => {
    const { useSignalAnalysisHistory } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    state.request.mockImplementation(() => new Promise<SignalHistoryResponse>(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(
      ({ vehicleId, name, window }) => useSignalAnalysisHistory(vehicleId, name, 72, 10_000, window),
      { wrapper, initialProps: { vehicleId: 4, name: 'Speed', window: state.range } },
    );
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
    const firstSignal: AbortSignal = state.request.mock.calls[0]?.[1].signal;
    expect(firstSignal.aborted).toBe(false);
    const nextWindow = { ...state.range, endInstantExclusive: '2026-10-14T00:00:00.456Z' };
    rerender({ vehicleId: 4, name: 'Speed', window: nextWindow });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    const nextSignal: AbortSignal = state.request.mock.calls[1]?.[1].signal;
    rerender({ vehicleId: 4, name: '', window: nextWindow });
    expect(nextSignal.aborted).toBe(true);
    rerender({ vehicleId: 0, name: 'Speed', window: nextWindow });
    expect(state.request).toHaveBeenCalledTimes(2);
    unmount();
    client.clear();
  });
});
