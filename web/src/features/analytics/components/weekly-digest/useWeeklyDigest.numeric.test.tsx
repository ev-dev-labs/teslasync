import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { useWeeklyDigest } from './useWeeklyDigest';
import { getWeekRange } from './helpers';
import type { Drive, ChargingSession } from './types';
import { DrivingPanel } from '../weekly-digest-modernization/DrivingPanel';
import { ChargingPanel } from '../weekly-digest-modernization/ChargingPanel';
import { DigestOperationalSummary } from '../operationalbrief-n-z/DigestOperationalSummary';
import { numericPresentedMetric } from '../weekly-digest-modernization/presentation';

const source = vi.hoisted(() => ({
  drives: undefined as Drive[] | undefined,
  charges: undefined as ChargingSession[] | undefined,
  error: undefined as Error | undefined,
  operational: vi.fn(),
}));
const preferences: MetricPreferences = {
  units: { distance: 'km', energy: 'kWh', duration: 'h', power: 'kW',
    speed: 'km/h', temperature: 'C', pressure: 'kPa', locale: 'en-US', precision: 2 },
  currency: { kind: 'symbol', value: '$' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: string) => fallback ?? key,
}) }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ isLoading: false }) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({
  vehicleId: 1, vehicles: [], setVehicleId: vi.fn(),
}) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: () => ({
  data: source.drives, error: source.error, isLoading: false, refetch: vi.fn(),
}) }));
vi.mock('@/api/hooks/useCharging', () => ({ useChargingSessionsPaginated: () => ({
  data: source.charges, isLoading: false, refetch: vi.fn(),
}) }));
vi.mock('@/api/hooks/useNotifications', () => ({ useAlertHistory: () => ({
  data: [], isLoading: false, refetch: vi.fn(),
}) }));
vi.mock('@/api/hooks/useAnalytics', () => ({ useFsdInsightsRange: () => ({
  isLoading: false, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2 },
  formatDistance: (raw: number) => `${(raw / 1000).toFixed(2)} km`,
  formatEnergy: (raw: number) => `${(raw / 1000).toFixed(2)} kWh`,
  formatDuration: (raw: number) => `${(raw / 3600).toFixed(2)} h`,
  formatPower: (raw: number) => `${(raw / 1000).toFixed(2)} kW`,
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({
  formatCurrency: (raw: number) => `$${raw.toFixed(2)}`,
}) }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({
  fmtInt: (raw: number) => raw.toFixed(0),
  fmtNumber: (raw: number) => raw.toFixed(2).replace('.', ','),
  precision: 2, locale: 'de-DE',
}) }));
vi.mock('@/hooks/useOperationalMetrics', () => ({
  useOperationalMetrics: (items: StatMetric[]) => { source.operational(items); return []; },
}));
vi.mock('@/components/data-display', () => ({ OperationalBrief: () => null }));
vi.mock('@/components/data-display/stat-reference', () => ({
  StatGroup: ({ metrics }: { metrics: StatMetric[] }) => <div>{metrics.map(metric => {
    const formatted = formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display);
    return <div key={metric.occurrenceId} data-testid={metric.occurrenceId}
      data-state={formatted.state} data-raw={String(metric.rawValue)}>{formatted.text}</div>;
  })}</div>,
}));
vi.mock('@/components/layout/layout-reference', () => ({
  ChartCard: ({ footer }: { footer: ReactNode }) => <section>{footer}</section>,
}));
vi.mock('@/components/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Caption: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: () => <span>No top drive</span>, QueryError: () => <span>Source error</span>,
}));
vi.mock('@/components/charts', () => ({
  CHART_COLORS: ['series'], ChartTooltip: () => null, chartGrid: null,
  axisTickSm: {}, chartMarginLabeled: {}, chartAnimation: {},
  BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, ResponsiveContainer: () => null,
}));
const period = { kind: 'unknown', label: 'Selected week' } as const;
function drive(overrides: Partial<Drive> = {}): Drive {
  return { id: 1, startTs: getWeekRange(0)[0].toISOString(),
    distanceM: 1000, durationS: 1800.5, energyUsedWh: -125.5, ...overrides };
}
function charge(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return { id: 1, started_at: getWeekRange(0)[0].toISOString(), ended_at: null,
    total_energy_added_wh: 0, avg_power_w: 0, cost_decimal: -1.25,
    start_soc_pct: null, end_soc_pct: null, ...overrides };
}
beforeEach(() => {
  source.drives = undefined; source.charges = undefined; source.error = undefined;
  source.operational.mockClear();
});

describe('weekly numeric detail observations', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])('does not format missing/invalid %s', raw => {
    const formatter = vi.fn(() => 'formatted');
    const metric = numericPresentedMetric('test', 'energy', 'Energy', raw, formatter);
    expect(formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display).state)
      .toBe(raw == null ? 'missing' : 'invalid');
    expect(formatter).not.toHaveBeenCalled();
  });
  it.each([0, -12.5, 0.125])('retains measured %s and invokes the specialist formatter', raw => {
    const formatter = vi.fn((value: number) => `specialist ${value}`);
    const metric = numericPresentedMetric('test', 'energy', 'Energy', raw, formatter);
    const formatted = formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display);
    expect(formatted.state).toBe('value');
    expect(formatted.rawValue).toBe(raw);
    expect(formatted.text).toBe(`specialist ${raw}`);
    expect(formatter).toHaveBeenCalledWith(raw);
  });
  it('marks unavailable sources missing even when the fallback aggregate is zero', () => {
    const { result } = renderHook(useWeeklyDigest);
    render(<><DrivingPanel metrics={result.current.metrics} period={period} dailyDistanceData={[]} />
      <ChargingPanel metrics={result.current.metrics} period={period} dailyEnergyData={[]} /></>);
    expect(screen.getByTestId('drives-count')).toHaveAttribute('data-state', 'missing');
    expect(screen.getByTestId('sessions')).toHaveAttribute('data-state', 'missing');
    expect(screen.getByTestId('driving-time')).toHaveAttribute('data-state', 'missing');
  });
  it('keeps signed fractional readings, measured zero and top drive through a refresh error', () => {
    source.drives = [drive()];
    source.charges = [charge()];
    source.error = new Error('Refresh failed');
    const { result } = renderHook(useWeeklyDigest);
    render(<><DrivingPanel metrics={result.current.metrics} period={period} dailyDistanceData={[]}
      isError error={source.error} />
      <ChargingPanel metrics={result.current.metrics} period={period} dailyEnergyData={[]} isLoading /></>);
    expect(screen.getByTestId('avg-efficiency')).toHaveAttribute('data-raw', '-0.1255');
    expect(screen.getByTestId('driving-time')).toHaveAttribute('data-raw', '1800.5');
    expect(screen.getByTestId('avg-charge-rate')).toHaveTextContent('0.00 kW');
    expect(screen.getByTestId('energy-added')).toHaveTextContent('0.00 kWh');
    expect(screen.getByTestId('total-cost')).toHaveTextContent('$-1.25');
    expect(screen.getByTestId('top-distance')).toHaveTextContent('1.00 km');
    expect(screen.getByTestId('top-efficiency')).toHaveAttribute('data-state', 'value');
  });
  it('does not invent measurements from malformed fields or missing rate operands', () => {
    source.drives = [drive({ energyUsedWh: undefined, durationS: NaN })];
    source.charges = [charge({ avg_power_w: null, total_energy_added_wh: null, cost_decimal: NaN })];
    const { result } = renderHook(useWeeklyDigest);
    render(<><DrivingPanel metrics={result.current.metrics} period={period} dailyDistanceData={[]} />
      <ChargingPanel metrics={result.current.metrics} period={period} dailyEnergyData={[]} /></>);
    for (const id of ['avg-efficiency', 'driving-time', 'top-efficiency', 'energy-added', 'avg-charge-rate', 'total-cost']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-state', 'missing');
    }
    expect(screen.getByTestId('top-distance')).toHaveAttribute('data-state', 'value');
    expect(screen.getByTestId('drives-count')).toHaveTextContent('1');
  });
  it('retains authoritative empty counts and duration without inventing an average', () => {
    source.drives = []; source.charges = [];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics.detailMetrics).toMatchObject({
      driveAvailable: true, chargingAvailable: true, totalDurationS: 0,
      avgEfficiencyWhPerM: null, avgChargePowerW: null, chargingCost: 0,
    });
    render(<><DrivingPanel metrics={result.current.metrics} period={period} dailyDistanceData={[]} />
      <ChargingPanel metrics={result.current.metrics} period={period} dailyEnergyData={[]} /></>);
    expect(screen.getByTestId('drives-count')).toHaveAttribute('data-state', 'value');
    expect(screen.getByTestId('sessions')).toHaveTextContent('0');
    expect(screen.getByTestId('driving-time')).toHaveTextContent('0.00 h');
    expect(screen.getByTestId('avg-charge-rate')).toHaveAttribute('data-state', 'missing');
  });
  it('derives fractional signed power only with measured energy and positive elapsed time', () => {
    const started_at = getWeekRange(0)[0].toISOString();
    source.charges = [charge({ avg_power_w: null, total_energy_added_wh: -125.25,
      ended_at: new Date(Date.parse(started_at) + 3_600_000).toISOString() })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics.detailMetrics?.avgChargePowerW).toBe(-125.25);
  });
  it('uses the unrounded multiplier rather than parsing its localized label', () => {
    source.drives = [drive({ distanceM: 500_000 })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.funFact?.times).toContain(',');
    render(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      funFact={result.current.funFact} driveAvailable chargingAvailable={false} />);
    const items: StatMetric[] = source.operational.mock.calls[0][0];
    expect(items.find(item => item.occurrenceId === 'weekly-fun-fact')?.rawValue)
      .toBe(result.current.metrics.funFactMultiplier);
    expect(items.find(item => item.occurrenceId === 'weekly-cost')?.rawValue).toBeNull();
  });
});
