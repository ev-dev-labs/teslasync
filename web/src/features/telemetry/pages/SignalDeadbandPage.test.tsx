import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { ChartContainerProps } from '@/components/charts';
import type { StatMetric } from '@/components/data-display';
import { analyzeSignalDeadband } from '../lib/signalDeadband';
import { calendarRangeToInstants } from '@/lib/dateRange';

interface Query<T> extends DataStateSource<T> {
  refetch: ReturnType<typeof vi.fn>;
}
type BriefProps = ComponentProps<typeof import('../components/operationalbrief-all/TelemetrySummaryBrief').TelemetrySummaryBrief>;

const state = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  catalog: {} as Query<string[]>,
  history: {} as Query<SignalHistoryResponse>,
  historyHook: vi.fn(),
  request: vi.fn(),
  range: {
    startInstant: '2026-10-11T14:13:12.123Z',
    endInstantExclusive: '2026-10-12T14:13:12.123Z',
  },
  chart: null as ChartContainerProps | null,
  briefs: {} as Record<string, BriefProps>,
  series: [] as Array<{ dataKey: string; type: string; strokeWidth: number }>,
  axes: {} as Record<string, { tickFormatter?: (value: number) => string; tick?: { fontSize: number } }>,
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
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtScientificNumber: (value: unknown) => `scientific:${value}`,
    fmtInt: (value: unknown) => `integer:${value}`,
    fmtPercent: (value: unknown) => `percent:${value}`,
  }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => state.catalog,
  useSignalHistory: (...args: unknown[]) => {
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
vi.mock('@/components/ui', async () => ({
  Select: (await import('@/components/ui/Select')).Select,
  GlassPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  PanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Icon: () => null,
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
  TelemetrySummaryBrief: (props: BriefProps) => {
    state.briefs[props.testId] = props;
    return <section data-testid={props.testId}><h2>{props.title}</h2>
      {props.metrics.map((metric: StatMetric) => <p key={metric.occurrenceId}>{metric.label}{metric.description}</p>)}
    </section>;
  },
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: (props: ChartContainerProps) => {
    state.chart = props;
    return <section><h2>{props.title}</h2>
      {props.loading ? <p>Loading chart</p> : props.error ? <p>{String(props.error)}</p>
        : props.empty ? <p>{props.emptyMessage}</p> : typeof props.children !== 'function' ? props.children : null}
    </section>;
  },
  ChartTooltip: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  Line: (props: { dataKey: string; type: string; strokeWidth: number }) => { state.series.push(props); return null; },
  XAxis: (props: { tickFormatter?: (value: number) => string; tick?: { fontSize: number } }) => { state.axes.x = props; return null; },
  YAxis: (props: { tickFormatter?: (value: number) => string; tick?: { fontSize: number } }) => { state.axes.y = props; return null; },
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import SignalDeadbandPage from './SignalDeadbandPage';

function query<T>(data?: T, overrides: Partial<Query<T>> = {}): Query<T> {
  return {
    data, isSuccess: data !== undefined, isLoading: data === undefined,
    isPending: data === undefined, isError: false, isFetching: false,
    fetchStatus: 'idle', dataUpdatedAt: 12345, refetch: vi.fn(), ...overrides,
  };
}
function history(values: readonly number[]): SignalHistoryResponse {
  return {
    vehicleId: 4, signal: 'Speed', from: '2026-10-11T00:00:00Z', to: '2026-10-12T00:00:00Z',
    count: values.length,
    data: values.map((value, index) => ({
      ts: new Date(Date.parse('2026-10-11T12:00:00Z') + index * 100).toISOString(),
      kind: 'ValueKindDouble', value, ingest_origin: null, source_emitted_at: null,
      received_at: null, normalization_version: null,
    })),
  };
}
function choose(value = 'Speed') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Numeric signal' }), { target: { value } });
}
function assertSections() {
  for (const heading of ['Signal under test', 'Deadband metrics', 'Cumulative retained updates', 'Retention audit']) {
    expect(screen.getAllByRole('heading', { name: heading })).toHaveLength(1);
  }
}
beforeEach(() => {
  state.vehicleId = 4;
  state.catalog = query(['Speed', 'Gear', 'A/raw signal']);
  state.history = query<SignalHistoryResponse>();
  state.historyHook.mockClear();
  state.request.mockReset();
  state.range = {
    startInstant: '2026-10-11T14:13:12.123Z',
    endInstantExclusive: '2026-10-12T14:13:12.123Z',
  };
  state.chart = null;
  state.briefs = {};
  state.series = [];
  state.axes = {};
});

describe('SignalDeadbandPage evidence preservation', () => {
  it('keeps four titled sections and unknown readings before signal selection', () => {
    render(<SignalDeadbandPage />);
    assertSections();
    expect(state.briefs['signal-deadband-summary']?.metrics.map((metric) => metric.rawValue))
      .toEqual([undefined, null, undefined, null]);
    expect(state.chart?.emptyMessage).toBe('Choose a signal to audit candidate deadbands.');
    expect(screen.queryByRole('button', { name: /apply|save/i })).not.toBeInTheDocument();
  });

  it('preserves every literal signal identity, stable help association, mobile target and 24 hour scope', () => {
    render(<SignalDeadbandPage />);
    const control = screen.getByRole('combobox', { name: 'Numeric signal' });
    expect(control).toHaveAttribute('id', 'signal-deadband-signal');
    expect(control).toHaveAttribute('aria-describedby', 'signal-deadband-signal-hint');
    expect(control).toHaveAccessibleDescription('Thresholds are analyzed in canonical SI signal units; conversion belongs only at the display boundary.');
    expect(control).toHaveClass('min-h-11', 'md:min-h-10');
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(['', 'Speed', 'Gear', 'A/raw signal']);
    choose('A/raw signal');
    expect(state.historyHook).toHaveBeenLastCalledWith(4, 'A/raw signal', 24, state.range);
    choose('');
    expect(state.historyHook).toHaveBeenLastCalledWith(4, '', 24, state.range);
  });

  it('describes an empty catalog without inventing missing recorded telemetry', () => {
    state.catalog = query([]);
    render(<SignalDeadbandPage />);
    assertSections();
    expect(screen.getByText('No signals available')).toBeInTheDocument();
    expect(screen.queryByText('No telemetry signals have been recorded for this vehicle yet.')).not.toBeInTheDocument();
  });

  it.each([
    { name: 'empty history', values: [], message: 'No signal samples', status: 'unavailable' },
    { name: 'one numeric point', values: [0], message: 'This signal needs at least three numeric history points.', status: 'ok' },
    { name: 'two numeric points', values: [0, 0], message: 'This signal needs at least three numeric history points.', status: 'ok' },
  ])('keeps $name distinct from measured analysis', ({ values, message, status }) => {
    state.history = query(history(values));
    render(<SignalDeadbandPage />);
    choose();
    assertSections();
    expect(state.chart?.emptyMessage).toBe(message);
    expect(state.chart?.data).toEqual([]);
    expect(state.briefs['signal-deadband-summary']?.sourceStatus).toBe(status);
    expect(state.briefs['signal-deadband-summary']?.metrics[1]?.rawValue).toBeNull();
  });

  it('does not turn initial loading or paused history into empty measured evidence', () => {
    const view = render(<SignalDeadbandPage />);
    choose();
    expect(state.chart?.loading).toBe(true);
    state.history = query(undefined, { fetchStatus: 'paused', isLoading: false });
    view.rerender(<SignalDeadbandPage />);
    assertSections();
    expect(state.chart?.loading).toBe(false);
    expect(state.chart?.emptyMessage).toBe('Source values unknown');
    expect(state.chart?.error).toBeNull();
  });

  it('preserves exact SI thresholds, all fourteen distributions, recommendation and default exports', () => {
    const response = history([0, 0, 1]);
    const original = structuredClone(response);
    state.history = query(response);
    render(<SignalDeadbandPage />);
    // The chart mock records one series entry per render; drop the
    // pre-selection render so the series assertion pins the live chart.
    state.series = [];
    choose();
    assertSections();
    expect(response).toEqual(original);
    expect(state.briefs['signal-deadband-summary']?.metrics.map((metric) => metric.rawValue))
      .toEqual([2.2239, 100, 1.11195, 66.6667]);
    expect(state.briefs['signal-deadband-retention-summary']?.metrics.map((metric) => metric.rawValue))
      .toEqual([3, 100, 100, 35.85]);
    expect(state.chart?.dataColumns?.map((column) => column.key))
      .toEqual(['threshold', 'retained', 'reduction', 'noiseSuppression', 'materialRetention', 'fidelity']);
    expect(state.chart?.data?.[0]).toEqual({
      threshold: 0, retained: 3, reduction: 0, noiseSuppression: 0, materialRetention: 100, fidelity: 100,
    });
    expect(state.chart?.data?.at(-1)).toEqual({
      threshold: 4.4478, retained: 1, reduction: 66.7, noiseSuppression: 100, materialRetention: 100, fidelity: 35.9,
    });
    expect(state.series).toEqual([expect.objectContaining({ dataKey: 'retained', type: 'monotone', strokeWidth: 2 })]);
    expect(state.chart?.exportData).toBeUndefined();
    expect(state.chart?.fullscreen).toBeUndefined();
    expect(state.chart?.dataColumns?.[0]?.format?.(0.000012345)).toBe('scientific:0.000012345');
    expect(state.chart?.dataColumns?.[1]?.format?.(1234)).toBe('integer:1234');
    expect(state.chart?.dataColumns?.[2]?.format?.(33.3)).toBe('percent:33.3');
    expect(state.axes.x?.tickFormatter?.(0.000012345)).toBe('scientific:0.000012345');
    expect(state.axes.y?.tickFormatter?.(1234)).toBe('integer:1234');
    expect(state.axes.x?.tick?.fontSize).toBe(12);
    expect(state.briefs['signal-deadband-summary']?.sourceBounds).toEqual([{ signal: 'Speed', from: response.from, to: response.to }]);
    expect(state.briefs['signal-deadband-summary']?.description).toContain('not guaranteed full-window coverage');
  });

  it('preserves numeric filtering, chronological order, last valid duplicates and cumulative simulation', () => {
    const response = history([0.000123456, -2, 0, 20, 20.0001]);
    response.data.reverse();
    response.data.push({ ...response.data[0]!, kind: 'ValueKindBool', value: true });
    response.data.push({ ...response.data[1]!, value: 20.000123456 });
    const original = structuredClone(response);
    const expected = analyzeSignalDeadband(response.data)!;
    state.history = query(response);
    render(<SignalDeadbandPage />);
    choose();
    expect(response).toEqual(original);
    expect(state.chart?.data?.map((row) => ({ threshold: row.threshold, retained: row.retained })))
      .toEqual(expected.candidates.map((candidate) => ({ threshold: candidate.threshold, retained: candidate.retainedUpdates })));
    expect(state.briefs['signal-deadband-retention-summary']?.metrics[0]?.rawValue).toBe(5);
    expect(state.briefs['signal-deadband-summary']?.metrics[2]?.rawValue).toBe(expected.recommended.threshold);
  });

  it.each([
    { name: 'refresh failure', overrides: { error: new Error('Refresh failed'), isError: true } },
    { name: 'paused refresh', overrides: { fetchStatus: 'paused' as const } },
  ])('retains every historical distribution and recommendation during $name', ({ overrides }) => {
    state.history = query(history([0, 0, 1]), overrides);
    render(<SignalDeadbandPage />);
    choose();
    assertSections();
    expect(state.chart?.error).toBeNull();
    expect(state.chart?.data).toHaveLength(14);
    expect(state.briefs['signal-deadband-summary']?.retained).toBe(true);
    expect(state.briefs['signal-deadband-retention-summary']?.retained).toBe(true);
    expect(state.briefs['signal-deadband-summary']?.sourceStatus).toBe('stale');
    expect(state.briefs['signal-deadband-summary']?.metrics[2]?.rawValue).toBe(1.11195);
  });

  it('keeps a titled fatal history chart and one source-owned retry without losing catalog actions', () => {
    const error = new Error('History unavailable');
    state.history = query(undefined, { error, isError: true, isLoading: false });
    render(<SignalDeadbandPage />);
    choose();
    assertSections();
    expect(state.chart?.error).toBe(error);
    expect(state.chart?.onRetry).toBeUndefined();
    expect(screen.getAllByRole('button', { name: /^Retry/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Selected signal history' }));
    expect(state.history.refetch).toHaveBeenCalledTimes(1);
    expect(state.catalog.refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('preserves the governed no-vehicle prerequisite without inventing a vehicle', () => {
    state.vehicleId = null;
    render(<SignalDeadbandPage />);
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(state.historyHook).toHaveBeenCalledWith(0, '', 24, state.range);
  });

  it('updates both analysis summaries and the typed hook for a custom non-UTC DST range', () => {
    state.history = query(history([0, 0, 1]));
    const view = render(<SignalDeadbandPage />);
    choose();
    state.range = calendarRangeToInstants({
      startDate: '2026-03-08', endDate: '2026-03-08', timezone: 'America/Los_Angeles',
    });
    view.rerender(<SignalDeadbandPage />);
    expect(state.range).toMatchObject({
      startInstant: '2026-03-08T08:00:00.000Z',
      endInstantExclusive: '2026-03-09T07:00:00.000Z',
    });
    expect(state.historyHook).toHaveBeenLastCalledWith(4, 'Speed', 23, state.range);
    for (const id of ['signal-deadband-summary', 'signal-deadband-retention-summary']) {
      expect(state.briefs[id]?.scope).toBe('23h requested · Speed');
    }
    assertSections();
  });

  it('passes the precise moving 24-hour window through without calendar-day rounding', () => {
    const view = render(<SignalDeadbandPage />);
    choose();
    state.range = {
      startInstant: '2026-10-11T14:14:12.123Z',
      endInstantExclusive: '2026-10-12T14:14:12.123Z',
    };
    view.rerender(<SignalDeadbandPage />);
    expect(state.historyHook).toHaveBeenLastCalledWith(4, 'Speed', 24, state.range);
    expect(state.briefs['signal-deadband-summary']?.scope).toBe('24h requested · Speed');
  });
});

describe('deadband history transport', () => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, wrapper };
  }

  it('preserves raw kinds, polling and cache identity while translating the exact exclusive upper bound', async () => {
    const { useSignalHistory, telemetryKeys } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    const response = history([0, 0, 1]);
    response.data.push({ ...response.data[0]!, kind: 'ValueKindBool', value: true });
    state.request.mockResolvedValue(response);
    const { client, wrapper } = setup();
    const { result, rerender, unmount } = renderHook(
      ({ window }) => useSignalHistory(4, 'A/raw signal', 24, window),
      { wrapper, initialProps: { window: state.range } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    const params = new URL(state.request.mock.calls[0]![0], 'http://localhost').searchParams;
    expect(params.get('from')).toBe(state.range.startInstant);
    expect(params.get('to')).toBe('2026-10-12T14:13:12.122999Z');
    expect(params.has('hours')).toBe(false);
    expect(state.request.mock.calls[0]![0]).toContain('/signals/4/A%2Fraw%20signal/history?');
    expect(state.request.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    const firstKey = telemetryKeys.signalHistory(4, 'A/raw signal', 24,
      state.range.startInstant, state.range.endInstantExclusive);
    const cached = client.getQueryCache().find({ queryKey: firstKey });
    expect(cached?.options).toMatchObject({ refetchInterval: 30_000 });
    const next = { ...state.range, endInstantExclusive: '2026-10-13T00:00:00.000Z' };
    rerender({ window: next });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
    expect(new URL(state.request.mock.calls[1]![0], 'http://localhost').searchParams.get('to'))
      .toBe('2026-10-12T23:59:59.999999Z');
    rerender({ window: { ...next, startInstant: '2026-10-11T07:00:00.000Z' } });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3));
    expect(client.getQueryCache().getAll()).toHaveLength(3);
    expect(client.getQueryData(firstKey)).toEqual(response);
    unmount();
    client.clear();
  });

  it('keeps the existing unbounded 24-hour query key and request', async () => {
    const { useSignalHistory, telemetryKeys } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    state.request.mockResolvedValue(history([]));
    const { client, wrapper } = setup();
    const { result, unmount } = renderHook(() => useSignalHistory(4, 'Speed', 24), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.request.mock.calls[0]![0]).toBe('/signals/4/Speed/history?hours=24');
    expect(telemetryKeys.signalHistory(4, 'Speed', 24)).toEqual(['signal-history', 4, 'Speed', 24]);
    unmount();
    client.clear();
  });

  it('cancels obsolete windows and disables queries without a vehicle or signal', async () => {
    const { useSignalHistory } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
    state.request.mockImplementation(() => new Promise<SignalHistoryResponse>(() => {}));
    const { client, wrapper } = setup();
    const { rerender, unmount } = renderHook(
      ({ vehicle, signal, window }) => useSignalHistory(vehicle, signal, 24, window),
      { wrapper, initialProps: { vehicle: 0, signal: '', window: state.range } },
    );
    expect(state.request).not.toHaveBeenCalled();
    rerender({ vehicle: 4, signal: '', window: state.range });
    expect(state.request).not.toHaveBeenCalled();
    rerender({ vehicle: 4, signal: 'Speed', window: state.range });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
    const firstAbort = state.request.mock.calls[0]![1].signal as AbortSignal;
    rerender({ vehicle: 4, signal: 'Speed', window: {
      ...state.range, endInstantExclusive: '2026-10-13T14:13:12.123Z',
    } });
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
    expect(firstAbort.aborted).toBe(true);
    const secondAbort = state.request.mock.calls[1]![1].signal as AbortSignal;
    unmount();
    expect(secondAbort.aborted).toBe(true);
    client.clear();
  });
});
