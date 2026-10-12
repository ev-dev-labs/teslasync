import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ChartContainerProps } from '@/components/charts';
import type { CorrelationResult } from '../lib/signalCorrelation';
import SignalCorrelationPage from './SignalCorrelationPage';

const mocks = vi.hoisted(() => ({
  signals: vi.fn(), history: vi.fn(), correlate: vi.fn(), vehicle: 42 as number | null,
  charts: vi.fn(),
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
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('../lib/signalCorrelation', () => ({ crossCorrelate: (...args: unknown[]) => mocks.correlate(...args) }));
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
  mocks.signals.mockReturnValue(query(['BatteryLevel', 'CabinTemperature']));
  mocks.history.mockImplementation((_id: number, name: string) =>
    query(name ? { data: SERIES } : undefined));
  mocks.correlate.mockReturnValue(RESULT);
});

describe('SignalCorrelationPage canonical summary and unchanged controls', () => {
  it('preserves raw inputs, both selections, detrend and both chart sections', () => {
    const { container } = setup();
    const choices = screen.getAllByRole('combobox');
    fireEvent.change(choices[0]!, { target: { value: 'BatteryLevel' } });
    fireEvent.change(choices[1]!, { target: { value: 'CabinTemperature' } });
    expect(mocks.history).toHaveBeenCalledWith(42, 'BatteryLevel', 24);
    expect(mocks.history).toHaveBeenCalledWith(42, 'CabinTemperature', 24);
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
    expect(screen.getByText('Choose two signals above to compute the correlogram.')).toBeInTheDocument();
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
    mocks.correlate.mockReturnValue({
      ...RESULT,
      seriesA: { ...RESULT.seriesA, t: times, v: [-2, null, 2], filled: 2, gaps: 1 },
      seriesB: { ...RESULT.seriesB, t: times, v: [5, 0, null], filled: 2, gaps: 1 },
    });
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
    expect(overlayProps.dataColumns).toEqual([
      { key: 'time', label: 'Time' },
      { key: 'a', label: 'BatteryLevel' },
      { key: 'b', label: 'CabinTemperature' },
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
});
