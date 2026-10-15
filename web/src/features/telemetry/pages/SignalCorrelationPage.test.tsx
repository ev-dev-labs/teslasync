import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Children, isValidElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ChartContainerProps } from '@/components/charts';
import type { CorrelationResult } from '../lib/signalCorrelation';
import SignalCorrelationPage from './SignalCorrelationPage';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { calendarRangeToInstants } from '@/lib/dateRange';

const mocks = vi.hoisted(() => ({
  signals: vi.fn(), history: vi.fn(), correlate: vi.fn(), vehicle: 42 as number | null,
  charts: vi.fn(),
  request: vi.fn(),
  range: {
    startInstant: '2026-10-04T14:29:35.783Z',
    endInstantExclusive: '2026-10-05T14:29:35.783Z',
  },
  formatDateTime: vi.fn((value: Date) => `saved-date:${value.toISOString()}`),
  formatTime: vi.fn((value: Date) => `saved-time:${value.toISOString()}`),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: (props: ChartContainerProps) => {
      mocks.charts(props);
      return <actual.ChartContainer {...props} />;
    },
  };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: mocks.formatDateTime,
    formatTime: mocks.formatTime,
    tz: 'America/Los_Angeles',
  }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => mocks.signals(),
  useSignalHistory: (...args: unknown[]) => mocks.history(...args),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: mocks.vehicle }) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => mocks.range }));
vi.mock('@/api/client', () => ({ request: mocks.request }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('../lib/signalCorrelation', () => ({
  analyzeCorrelation: (...args: unknown[]) => mocks.correlate(...args),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C',
    pressure: 'kPa', energy: 'kWh', duration: 's', power: 'kW', locale: 'en-US', precision: 3 },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

const SERIES = Object.freeze([
  { timestamp: '2026-10-05T01:00:00Z', valueNum: null },
  { timestamp: '2026-10-05T01:01:00Z', valueNum: 0 },
  { timestamp: '2026-10-05T01:02:00Z', valueNum: 0.8 },
]);
const RESULT: CorrelationResult = {
  bestR: -0.8, zeroLagR: 0.2, bestLagS: -60, bestN: 12, effectiveN: 7.5,
  significanceThreshold: 0.6, significant: true, lead: 'b',
  correlogram: [{ lagS: -60, r: -0.8, n: 12 }],
  seriesA: { t: [1791162060000], v: [0], stepMs: 60000, filled: 1, gaps: 0 },
  seriesB: { t: [1791162060000], v: [1], stepMs: 60000, filled: 1, gaps: 0 },
  overlapStartMs: null, overlapEndMs: null,
};
function query(data: unknown, error: Error | null = null) {
  return { data, error, isError: error != null, isLoading: false, isFetching: false,
    dataUpdatedAt: 1791162060000, refetch: vi.fn() };
}
function selectSignals() {
  fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
  fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
}
function latestChart(overlay = false) {
  return mocks.charts.mock.calls.map(([props]) => props as ChartContainerProps)
    .filter(props => overlay ? props.chartKey === 'signal-correlation-overlay' : props.title === 'Lagged correlogram').at(-1)!;
}
function chartElements(children: ReactNode): Array<{
  content?: ReactNode;
  tickFormatter?: (value: number) => string;
}> {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; content?: ReactNode; tickFormatter?: (value: number) => string }>(child)) return [];
    return [child.props, ...chartElements(child.props.children)];
  });
}
const originalPreferences = getFormatterPreferences();
afterEach(() => {
  act(() => {
    setGlobalLocale(originalPreferences.locale);
    setGlobalPrecision(originalPreferences.precision);
  });
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SignalCorrelationPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mocks.signals.mockReset();
  mocks.history.mockReset();
  mocks.correlate.mockReset();
  mocks.charts.mockClear();
  mocks.formatDateTime.mockClear();
  mocks.formatTime.mockClear();
  mocks.vehicle = 42;
  mocks.range = {
    startInstant: '2026-10-04T14:29:35.783Z',
    endInstantExclusive: '2026-10-05T14:29:35.783Z',
  };
  mocks.request.mockReset();
  mocks.signals.mockReturnValue(query(['BatteryLevel', 'CabinTemperature']));
  mocks.history.mockImplementation((_id: number, name: string) =>
    query(name ? { data: SERIES } : undefined));
  mocks.correlate.mockReturnValue({ result: RESULT, reason: null });
});

describe('SignalCorrelationPage canonical summary and unchanged controls', () => {
  it('updates both independent histories for a custom non-UTC range without resetting selections', () => {
    setup();
    selectSignals();
    mocks.range = calendarRangeToInstants({
      startDate: '2026-11-01', endDate: '2026-11-01', timezone: 'America/Los_Angeles',
    });
    expect(mocks.range).toEqual({
      startInstant: '2026-11-01T07:00:00.000Z',
      endInstantExclusive: '2026-11-02T08:00:00.000Z',
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Correlate changes, not levels' }));
    for (const signal of ['BatteryLevel', 'CabinTemperature']) {
      expect(mocks.history).toHaveBeenCalledWith(42, signal, 25, mocks.range);
    }
    expect(screen.getByLabelText('Signal A')).toHaveValue('BatteryLevel');
    expect(screen.getByLabelText('Signal B')).toHaveValue('CabinTemperature');
    expect(mocks.correlate).toHaveBeenLastCalledWith(SERIES, SERIES, { detrend: true });
  });
  it.each([true, false])('qualifies the screening outcome without changing populated charts (clears: %s)', significant => {
    mocks.correlate.mockReturnValue({ result: { ...RESULT, significant }, reason: null });
    setup();
    selectSignals();
    expect(screen.getByText(significant ? 'Clears screening threshold' : 'Below screening threshold')).toBeInTheDocument();
    expect(screen.getByText(/Methodology: the screening rule/)).toHaveTextContent(
      'It is not a calibrated 95% significance guarantee',
    );
    expect(screen.getByText(/Methodology: the screening rule/)).toHaveTextContent(
      'not conservative for small effective samples',
    );
    expect(screen.getByText(/Methodology: the screening rule/)).toHaveTextContent(
      'not corrected for multiple testing',
    );
    expect(latestChart().subtitle).toContain('approximate screening threshold');
    expect(latestChart().data).toEqual([{ lag: -60, r: -0.8, n: 12 }]);
    expect(latestChart(true).data).toHaveLength(1);
    expect(screen.queryByText(/unlikely to be an artefact/)).not.toBeInTheDocument();
    expect(screen.queryByText(/best treated as coincidence/)).not.toBeInTheDocument();
  });

  describe('correlation history request contract', () => {
    it('keys both exact bounds and signals independently and cancels superseded rolling requests', async () => {
      const { useSignalHistory, telemetryKeys } = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
        '@/api/hooks/useTelemetry',
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      mocks.request.mockImplementation(() => new Promise(() => {}));
      const firstWindow = { ...mocks.range };
      const hook = renderHook(({ window }) => ({
        a: useSignalHistory(42, 'BatteryLevel', 24, window),
        b: useSignalHistory(42, 'CabinTemperature', 24, window),
      }), { wrapper, initialProps: { window: firstWindow } });
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
      const firstCalls = mocks.request.mock.calls.slice();
      for (const [index, signalName] of ['BatteryLevel', 'CabinTemperature'].entries()) {
        const [path, options] = firstCalls[index]!;
        const url = new URL(path, 'http://localhost');
        expect(url.pathname).toBe(`/signals/42/${signalName}/history`);
        expect(url.searchParams.get('from')).toBe(firstWindow.startInstant);
        expect(url.searchParams.get('to')).toBe('2026-10-05T14:29:35.782999Z');
        expect(url.searchParams.has('hours')).toBe(false);
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.signal.aborted).toBe(false);
        expect(client.getQueryCache().find({
          queryKey: telemetryKeys.signalHistory(42, signalName, 24,
            firstWindow.startInstant, firstWindow.endInstantExclusive),
          exact: true,
        })).toBeDefined();
      }
      const nextWindow = {
        startInstant: '2026-10-04T14:30:35.783Z',
        endInstantExclusive: '2026-10-05T14:30:35.783Z',
      };
      hook.rerender({ window: nextWindow });
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(4));
      for (const [, options] of firstCalls) expect(options.signal.aborted).toBe(true);
      expect(new URL(mocks.request.mock.calls[2]![0], 'http://localhost').searchParams.get('to'))
        .toBe('2026-10-05T14:30:35.782999Z');
      expect(telemetryKeys.signalHistory(42, 'BatteryLevel', 24, nextWindow.startInstant, nextWindow.endInstantExclusive))
        .not.toEqual(telemetryKeys.signalHistory(42, 'BatteryLevel', 24, firstWindow.startInstant, firstWindow.endInstantExclusive));
      const customWindow = calendarRangeToInstants({
        startDate: '2026-11-01', endDate: '2026-11-01', timezone: 'America/Los_Angeles',
      });
      hook.rerender({ window: customWindow });
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(6));
      expect(new URL(mocks.request.mock.calls[4]![0], 'http://localhost').searchParams.get('to'))
        .toBe('2026-11-02T07:59:59.999999Z');
      expect(telemetryKeys.signalHistory(42, 'BatteryLevel', 24, firstWindow.startInstant, nextWindow.endInstantExclusive))
        .not.toEqual(telemetryKeys.signalHistory(42, 'BatteryLevel', 24, firstWindow.startInstant, firstWindow.endInstantExclusive));
      hook.unmount();
      for (const [, options] of mocks.request.mock.calls) expect(options.signal.aborted).toBe(true);
      client.clear();
    });
  });

  it('discloses methodology before signals are selected', () => {
    setup();
    expect(screen.getByText(/Methodology: the screening rule/)).toHaveTextContent(
      'resampling and gaps can affect dependence',
    );
    expect(mocks.correlate).not.toHaveBeenCalled();
  });

  it('formats signed seconds, coefficients and normalized values without changing chart data', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    mocks.correlate.mockReturnValue({ reason: null, result: {
      ...RESULT,
      correlogram: [{ lagS: -1234.5, r: -0.375, n: 1234 }, { lagS: 0, r: 0, n: 0 }],
      seriesA: { ...RESULT.seriesA, t: [1, 2, 3, 4], v: [0, 1, 4, null] },
      seriesB: { ...RESULT.seriesB, t: [1, 2, 3, 4], v: [4, 3, 0, null] },
    } });
    setup();
    selectSignals();
    const lagged = latestChart();
    const overlay = latestChart(true);
    expect(lagged.data).toEqual([
      { lag: -1234.5, r: -0.375, n: 1234 }, { lag: 0, r: 0, n: 0 },
    ]);
    expect(overlay.data?.map(row => [row.a, row.b])).toEqual([
      [0, 1], [0.25, 0.75], [1, 0], [null, null],
    ]);
    expect(lagged.dataColumns?.map(col => col.kind)).toEqual(['measurement', 'measurement', 'count']);
    expect(screen.getByRole('cell', { name: '-1.234,500 s' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '-0,375' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1.234' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '0' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '0,250' })).toHaveLength(1);
    for (const chart of [lagged, overlay]) {
      const elements = chartElements(typeof chart.children === 'function' ? null : chart.children);
      const ticks = elements.filter(element => element.tickFormatter);
      expect(ticks).toHaveLength(2);
      // The overlay's time axis retains its saved date formatter.
      const numericTicks = chart === lagged ? ticks : ticks.slice(1);
      for (const axis of numericTicks) expect(axis.tickFormatter?.(-0.375)).toBe('-0,375');
      const tooltip = elements.find(element => element.content)?.content;
      expect(isValidElement(tooltip)).toBe(true);
      if (!isValidElement<{
        valueFormatter: (value: unknown, name: string) => string;
        labelFormatter: (value: unknown) => string;
      }>(tooltip)) throw new Error('Expected chart tooltip');
      expect(tooltip.props.valueFormatter(0, 'r')).toBe('0,000');
      expect(tooltip.props.valueFormatter(-0.375, 'r')).toBe('-0,375');
      expect(tooltip.props.valueFormatter(0.25, 'a')).toBe('0,250');
      for (const invalid of [null, undefined, NaN, Infinity, -Infinity, '', '0']) {
        expect(tooltip.props.valueFormatter(invalid, 'a')).toBe('—');
        if (chart === lagged) expect(tooltip.props.labelFormatter(invalid)).toBe('—');
      }
      if (chart === lagged) {
        expect(tooltip.props.labelFormatter(-1234.5)).toBe('-1.234,500 s');
        expect(tooltip.props.labelFormatter(0)).toBe('0,000 s');
        expect(tooltip.props.labelFormatter(0.25)).toBe('0,250 s');
      }
    }
    for (const column of [...lagged.dataColumns ?? [], ...overlay.dataColumns ?? []]) {
      if (!column.format) continue;
      for (const invalid of [null, undefined, NaN, Infinity, -Infinity, '', '0']) {
        expect(column.format(invalid)).toBe('—');
      }
      expect(column.format(0)).toBe(column.key === 'lag' ? '0,000 s' : '0,000');
      expect(column.format(-0.25)).toBe(column.key === 'lag' ? '-0,250 s' : '-0,250');
    }
    const originalLagged = lagged.data;
    const originalOverlay = overlay.data;
    act(() => {
      setGlobalLocale('en-US');
      setGlobalPrecision(2);
    });
    expect(screen.getByRole('cell', { name: '-1,234.50 s' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1,234' })).toBeInTheDocument();
    expect(latestChart().data).toBe(originalLagged);
    expect(latestChart(true).data).toBe(originalOverlay);
    expect(latestChart(true).dataColumns?.[1]?.format?.(0.25)).toBe('0.25');
  });

  it.each([false, true])('names independent A/B coverage with asymmetric gaps (detrend: %s)', (detrend) => {
    mocks.correlate.mockReturnValue({ reason: null, result: {
      ...RESULT,
      seriesA: { ...RESULT.seriesA, filled: 40, gaps: 0 },
      seriesB: { ...RESULT.seriesB, filled: 13, gaps: 27 },
    } });
    setup();
    fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
    fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
    if (detrend) fireEvent.click(screen.getByRole('switch', { name: 'Correlate changes, not levels' }));
    expect(screen.getByText('Signal A: BatteryLevel — 40 filled · 0 gaps')).toBeInTheDocument();
    expect(screen.getByText('Signal B: CabinTemperature — 13 filled · 27 gaps')).toBeInTheDocument();
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('from 12 raw points');
    expect(mocks.correlate).toHaveBeenLastCalledWith(SERIES, SERIES, { detrend });
  });

  it('preserves raw inputs, both selections, detrend and both chart sections', () => {
    const { container } = setup();
    const choices = screen.getAllByRole('combobox');
    fireEvent.change(choices[0]!, { target: { value: 'BatteryLevel' } });
    fireEvent.change(choices[1]!, { target: { value: 'CabinTemperature' } });
    expect(mocks.history).toHaveBeenCalledWith(42, 'BatteryLevel', 24, mocks.range);
    expect(mocks.history).toHaveBeenCalledWith(42, 'CabinTemperature', 24, mocks.range);
    expect(mocks.correlate).toHaveBeenLastCalledWith(SERIES, SERIES, { detrend: false });
    const switchControl = screen.getByRole('switch', { name: 'Correlate changes, not levels' });
    fireEvent.click(switchControl);
    expect(mocks.correlate).toHaveBeenLastCalledWith(SERIES, SERIES, { detrend: true });
    const strip = screen.getByTestId('signal-correlation-summary');
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(strip).toHaveTextContent('CabinTemperature leads');
    expect(strip).toHaveTextContent('from 12 raw points');
    expect(screen.getByText('Lagged correlogram')).toBeInTheDocument();
    expect(screen.getByText('Normalised overlay')).toBeInTheDocument();
    expect(screen.getByText('Reading the result')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(SERIES[0]?.valueNum).toBeNull();
    expect(SERIES[1]?.valueNum).toBe(0);
  });

  it('keeps unknown summary values and the choose-two message before any selection', () => {
    setup();
    const strip = screen.getByTestId('signal-correlation-summary');
    expect([...strip.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(strip).toHaveTextContent('from — raw points');
    expect(screen.getAllByText('Choose two signals above to compute the correlogram.')).toHaveLength(3);
    expect(mocks.correlate).not.toHaveBeenCalled();
  });

  it('does not show or compute a correlation for an unselected vehicle', () => {
    mocks.vehicle = null;
    setup();
    expect(screen.queryByTestId('signal-correlation-summary')).not.toBeInTheDocument();
    expect(mocks.correlate).not.toHaveBeenCalled();
  });

  it('associates the changes switch with its full explanation without changing selection', () => {
    setup();
    const control = screen.getByRole('switch', { name: 'Correlate changes, not levels' });
    const description = control.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    expect(document.getElementById(description!)).toHaveTextContent(
      'Differencing removes shared drift, so two signals that merely both rise over the day stop looking related',
    );
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Signal A')).toHaveValue('');
    expect(screen.getByLabelText('Signal B')).toHaveValue('');
    expect(screen.getByText('Lagged correlogram')).toBeInTheDocument();
    expect(screen.getByText('Normalised overlay')).toBeInTheDocument();
    expect(screen.getByText('Reading the result')).toBeInTheDocument();
  });

  it('retains epoch identities and saved date labels with normalized zeros and gaps', () => {
    const times = [
      Date.parse('2026-11-01T08:30:00Z'),
      Date.parse('2026-11-01T09:30:00Z'),
      Date.parse('2026-11-02T09:30:00Z'),
    ];
    mocks.correlate.mockReturnValue({ reason: null, result: {
      ...RESULT,
      seriesA: { ...RESULT.seriesA, t: times, v: [-2, null, 2], filled: 2, gaps: 1 },
      seriesB: { ...RESULT.seriesB, t: times, v: [5, 0, null], filled: 2, gaps: 1 },
    } });
    setup();
    fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
    fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
    const overlayProps = mocks.charts.mock.calls.map(([props]) => props as ChartContainerProps)
      .filter(props => props.chartKey === 'signal-correlation-overlay').at(-1)!;
    expect(overlayProps.data).toEqual([
      { timestamp: times[0], time: 'saved-date:2026-11-01T08:30:00.000Z (America/Los_Angeles)', a: 0, b: 1 },
      { timestamp: times[1], time: 'saved-date:2026-11-01T09:30:00.000Z (America/Los_Angeles)', a: null, b: 0 },
      { timestamp: times[2], time: 'saved-date:2026-11-02T09:30:00.000Z (America/Los_Angeles)', a: 1, b: null },
    ]);
    expect(overlayProps.dataColumns).toMatchObject([
      { key: 'time', label: 'Time' },
      { key: 'a', label: 'BatteryLevel', kind: 'measurement' },
      { key: 'b', label: 'CabinTemperature', kind: 'measurement' },
    ]);
    expect(mocks.formatDateTime).toHaveBeenCalledWith(new Date('2026-11-01T08:30:00Z'));
    expect(mocks.formatDateTime).toHaveBeenCalledWith(new Date('2026-11-01T09:30:00Z'));
    expect(mocks.correlate).toHaveBeenLastCalledWith(SERIES, SERIES, { detrend: false });
  });

  it('retains the constant-series midpoint and measured summary during refresh errors', () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    mocks.history.mockImplementation((_id: number, name: string) => ({
      ...query(name ? { data: SERIES } : undefined, name ? new Error('refresh unavailable') : null),
      refetch: name === 'BatteryLevel' ? retryA : retryB,
    }));
    setup();
    fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
    fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
    const strip = screen.getByTestId('signal-correlation-summary');
    expect(strip).toHaveTextContent('Retained source data');
    expect(strip).toHaveTextContent('CabinTemperature leads');
    expect(strip).toHaveTextContent('from 12 raw points');
    const overlayProps = mocks.charts.mock.calls.map(([props]) => props as ChartContainerProps)
      .filter(props => props.chartKey === 'signal-correlation-overlay').at(-1)!;
    expect(overlayProps.error).toBeNull();
    expect(overlayProps.data).toEqual([
      { timestamp: 1791162060000, time: 'saved-date:2026-10-05T01:01:00.000Z (America/Los_Angeles)', a: 0.5, b: 0.5 },
    ]);
    expect(screen.getByText('Reading the result')).toBeInTheDocument();
    expect(retryA).not.toHaveBeenCalled();
    expect(retryB).not.toHaveBeenCalled();
  });

  it.each(['fetching', 'paused', 'idle'] as const)(
    'keeps unresolved %s histories distinct from resolved empty or disjoint histories',
    (fetchStatus) => {
      mocks.history.mockReturnValue({
        ...query(undefined), isPending: true, fetchStatus,
        isLoading: fetchStatus === 'fetching', isFetching: fetchStatus === 'fetching',
      });
      setup();
      fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
      fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
      expect(mocks.correlate).not.toHaveBeenCalled();
      for (const title of ['Lagged correlogram', 'Normalised overlay', 'Reading the result']) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
      expect(screen.queryByText(/no overlapping window/)).not.toBeInTheDocument();
      expect(screen.queryByText(/has no history in the requested/)).not.toBeInTheDocument();
      const overlay = mocks.charts.mock.calls.map(([props]) => props as ChartContainerProps)
        .filter(props => props.chartKey === 'signal-correlation-overlay').at(-1)!;
      expect(overlay.loading).toBe(fetchStatus === 'fetching');
      if (fetchStatus !== 'fetching') {
        expect(screen.getAllByText(fetchStatus === 'paused'
          ? 'History loading is paused. No comparison evidence has loaded yet.'
          : 'History availability has not resolved yet.')).toHaveLength(3);
      }
    },
  );

  it.each([
    ['empty', 'No signal data matches the selected signals and time range.'],
    ['nonnumeric', 'At least one selected history has no usable numeric or boolean measurements.'],
    ['insufficient', 'There is not enough comparable evidence to compute a correlation.'],
    ['disjoint', 'Not enough overlapping evidence'],
  ])('explains resolved %s evidence consistently across all comparison shells', (reason, message) => {
    mocks.correlate.mockReturnValue({ result: null, reason });
    if (reason === 'empty') {
      mocks.history.mockImplementation((_id: number, name: string) =>
        query(name ? { data: [] } : undefined));
    }
    setup();
    fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
    fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
    expect(screen.getAllByText(message)).toHaveLength(3);
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('from — raw points');
    expect(screen.queryByText('Pick two signals to see how the result should be read.')).not.toBeInTheDocument();
    if (reason === 'empty') expect(mocks.correlate).toHaveBeenCalledWith([], [], { detrend: false });
  });

  it('keeps successful zero coefficients measured and recovers after a retained refresh failure', () => {
    const zeroResult = {
      ...RESULT, bestR: 0, zeroLagR: 0, bestLagS: 0, significant: false, lead: 'none',
    };
    mocks.correlate.mockReturnValue({ result: zeroResult, reason: null });
    let failure: Error | null = null;
    const retry = vi.fn();
    mocks.history.mockImplementation((_id: number, name: string) => ({
      ...query(name ? { data: SERIES } : undefined, name ? failure : null), refetch: retry,
    }));
    setup();
    fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'BatteryLevel' } });
    fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'CabinTemperature' } });
    const strip = screen.getByTestId('signal-correlation-summary');
    expect(strip).toHaveTextContent('Queried snapshot');
    expect(strip.querySelector('[data-operational-metric]')).not.toHaveAttribute('data-value-state', 'missing');
    expect(strip).toHaveTextContent('No relationship');
    failure = new Error('refresh unavailable');
    fireEvent.click(screen.getByRole('switch', { name: 'Correlate changes, not levels' }));
    expect(strip).toHaveTextContent('Retained source data');
    expect(strip).toHaveTextContent('from 12 raw points');
    failure = null;
    fireEvent.click(screen.getByRole('switch', { name: 'Correlate changes, not levels' }));
    expect(strip).toHaveTextContent('Queried snapshot');
    expect(strip).not.toHaveTextContent('Retained source data');
    expect(screen.queryByText('refresh unavailable')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });
});
