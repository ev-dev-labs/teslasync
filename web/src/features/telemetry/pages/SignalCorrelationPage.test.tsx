import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { CorrelationResult } from '../lib/signalCorrelation';
import SignalCorrelationPage from './SignalCorrelationPage';

const mocks = vi.hoisted(() => ({
  signals: vi.fn(), history: vi.fn(), correlate: vi.fn(), vehicle: 42 as number | null,
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
});
