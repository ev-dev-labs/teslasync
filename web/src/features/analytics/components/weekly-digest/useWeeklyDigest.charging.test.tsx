import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display';
import type { ChargingSession } from './types';
import { getWeekRange } from './helpers';
import { useWeeklyDigest } from './useWeeklyDigest';
import { BatteryPanel } from '../weekly-digest-modernization/BatteryPanel';
import { ChargingPanel } from '../weekly-digest-modernization/ChargingPanel';
import { DigestOperationalSummary } from '../operationalbrief-n-z/DigestOperationalSummary';

const state = vi.hoisted(() => ({
  charging: {
    data: undefined as ChargingSession[] | undefined,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  drives: { data: undefined as [] | undefined, isLoading: false, error: null, refetch: vi.fn() },
  capture: vi.fn<(metrics: readonly StatMetric[]) => void>(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ isLoading: false }) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 1, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: () => state.drives }));
vi.mock('@/api/hooks/useCharging', () => ({ useChargingSessionsPaginated: () => state.charging }));
vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertHistory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: String, fmtInt: String, precision: 1, locale: 'en' }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ formatCurrency: String }) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (value: number) => `${value} m`,
    formatEnergy: (value: number) => `${value} Wh`,
    formatPower: (value: number) => `${value} W`,
    unitPrefs: { distance: 'km', energy: 'kWh' },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/components/charts', () => ({
  CHART_COLORS: [], chartGrid: null, axisTickSm: {}, chartMarginLabeled: {}, chartAnimation: {},
  ChartTooltip: () => null, BarChart: () => null, Bar: () => null,
  XAxis: () => null, YAxis: () => null, Tooltip: () => null, ResponsiveContainer: () => null,
}));
vi.mock('@/hooks/useOperationalMetrics', () => ({
  useOperationalMetrics: (metrics: readonly StatMetric[]) => { state.capture(metrics); return []; },
}));
vi.mock('@/components/data-display', () => ({
  OperationalBrief: ({ statusLabel, loading }: { statusLabel: string; loading: boolean }) => (
    <div data-testid="brief" data-loading={String(loading)}>{statusLabel}</div>
  ),
}));
vi.mock('@/components/data-display/stat-reference', () => ({
  StatGroup: ({ metrics }: { metrics: StatMetric[] }) => (
    <div>{metrics.map(metric => <div key={metric.occurrenceId}>{metric.label}: {String(metric.rawValue)}</div>)}</div>
  ),
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartCard: ({ footer }: { footer: ReactNode }) => <div>{footer}</div>,
}));
vi.mock('../weekly-digest', () => ({
  BatteryPill: ({ level, label }: { level: number; label: string }) => <div>{label}: {level}%</div>,
}));
vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Caption: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/feedback', () => ({
  QueryError: () => <div>Source error</div>,
  Skeleton: () => <div>Loading</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('../weekly-digest-modernization/DigestTrend', () => ({ DigestTrend: () => null }));

const period = {
  kind: 'event' as const, label: 'Selected week', eventId: 'test',
  start: '2026-10-12', end: '2026-10-19', provenance: 'Test charging records',
};
function charge(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1, started_at: getWeekRange(0)[0].toISOString(), ended_at: null,
    total_energy_added_wh: null, cost_decimal: 12,
    start_soc_pct: null, end_soc_pct: null, ...overrides,
  };
}

beforeEach(() => {
  state.charging.data = undefined;
  state.charging.isLoading = false;
  state.charging.error = null;
  state.drives.data = undefined;
  state.drives.isLoading = false;
  state.capture.mockClear();
});

describe('weekly digest charging evidence', () => {
  it.each([true, false])('keeps absent measurements unknown while loading=%s (including paused without data)', loading => {
    state.charging.isLoading = loading;
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics).toMatchObject({
      batteryStart: null, batteryEnd: null, chargeEnergyAddedWh: null, prevChargeEnergyWh: null,
      chargingSessionCount: 0,
    });
    render(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      isLoading={loading} driveAvailable={false} chargingAvailable={false} />);
    expect(state.capture.mock.lastCall?.[0].every(metric => metric.rawValue == null)).toBe(true);
    expect(screen.getByTestId('brief')).toHaveAttribute('data-loading', String(loading));
    expect(screen.getByText(loading ? 'Loading weekly records' : 'Weekly sources unavailable')).toBeInTheDocument();
  });

  it('preserves a successful empty total as zero without fabricating SOC averages', () => {
    state.charging.data = [];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics).toMatchObject({
      batteryStart: null, batteryEnd: null, chargeEnergyAddedWh: 0, chargingSessionCount: 0,
    });
    render(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      driveAvailable={false} chargingAvailable />);
    expect(state.capture.mock.lastCall?.[0].find(metric => metric.occurrenceId === 'weekly-cost')?.rawValue).toBe(0);
  });

  it('keeps counts independent of missing SOC and energy, and does not synthesize a gain or range', () => {
    state.charging.data = [charge({ start_soc_pct: 0 })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics).toMatchObject({
      batteryStart: 0, batteryEnd: null, chargeEnergyAddedWh: null, chargingSessionCount: 1,
    });
    render(<BatteryPanel metrics={result.current.metrics} period={period} />);
    expect(screen.getByText('Avg battery at charge start: 0%')).toBeInTheDocument();
    expect(screen.getByText('Avg charge gain: —')).toBeInTheDocument();
    expect(screen.getByText('Est. range added: —')).toBeInTheDocument();
    expect(screen.getByText('Charge sessions: 1')).toBeInTheDocument();
  });

  it('preserves measured zero SOC, gain and energy', () => {
    state.charging.data = [charge({ start_soc_pct: 0, end_soc_pct: 0, total_energy_added_wh: 0 })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics).toMatchObject({ batteryStart: 0, batteryEnd: 0, chargeEnergyAddedWh: 0 });
    render(<BatteryPanel metrics={result.current.metrics} period={period} />);
    expect(screen.getByText('Avg charge gain: 0%')).toBeInTheDocument();
    expect(screen.getByText('Est. range added: 0 m')).toBeInTheDocument();
  });

  it('does not report a partial energy sum as a complete measured total', () => {
    state.charging.data = [charge({ total_energy_added_wh: 500 }), charge({ id: 2 })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics.chargeEnergyAddedWh).toBeNull();
    expect(result.current.metrics.chargingSessionCount).toBe(2);
  });

  it('renders unknown charged energy independently of session count and recovers to real zero', () => {
    state.charging.data = [charge()];
    const { result, rerender } = renderHook(useWeeklyDigest);
    const view = render(<ChargingPanel metrics={result.current.metrics} period={period}
      dailyEnergyData={result.current.dailyEnergyData} />);
    expect(screen.getByText('Total energy added: —')).toBeInTheDocument();
    expect(screen.getByText('Sessions: 1')).toBeInTheDocument();
    state.charging.data = [charge({ total_energy_added_wh: 0 })];
    rerender();
    view.rerender(<ChargingPanel metrics={result.current.metrics} period={period}
      dailyEnergyData={result.current.dailyEnergyData} />);
    expect(screen.getByText('Total energy added: 0 Wh')).toBeInTheDocument();
  });

  it('does not infer a SOC gain from unpaired start and end measurements', () => {
    state.charging.data = [charge({ start_soc_pct: 20 }), charge({ id: 2, end_soc_pct: 80 })];
    const { result } = renderHook(useWeeklyDigest);
    expect(result.current.metrics).toMatchObject({ batteryStart: 20, batteryEnd: 80, batteryGain: null });
    render(<BatteryPanel metrics={result.current.metrics} period={period} />);
    expect(screen.getByText('Avg charge gain: —')).toBeInTheDocument();
  });

  it('retains charging evidence through independent drive loading, refresh failure and recovery', () => {
    state.charging.data = [charge({ start_soc_pct: 20, end_soc_pct: 60, total_energy_added_wh: 5000 })];
    state.drives.isLoading = true;
    const { result, rerender } = renderHook(useWeeklyDigest);
    const view = render(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      isLoading driveAvailable={false} chargingAvailable />);
    expect(state.capture.mock.lastCall?.[0].find(metric => metric.occurrenceId === 'weekly-cost')?.rawValue).toBe(12);
    expect(screen.getByTestId('brief')).toHaveAttribute('data-loading', 'false');
    state.charging.error = new Error('Refresh failed');
    rerender();
    expect(result.current.metrics).toMatchObject({
      batteryStart: 20, batteryEnd: 60, chargeEnergyAddedWh: 5000, chargingSessionCount: 1,
    });
    view.rerender(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      isError error={state.charging.error} driveAvailable={false} chargingAvailable />);
    expect(screen.getByText('Retained or partial weekly records')).toBeInTheDocument();
    expect(screen.getByText('Source error')).toBeInTheDocument();
    expect(state.capture.mock.lastCall?.[0].find(metric => metric.occurrenceId === 'weekly-cost')?.rawValue).toBe(12);
    state.charging.error = null;
    state.charging.data = [charge({ start_soc_pct: 30, end_soc_pct: 80, total_energy_added_wh: 8000 })];
    rerender();
    view.rerender(<DigestOperationalSummary metrics={result.current.metrics} period={period}
      driveAvailable={false} chargingAvailable />);
    expect(result.current.metrics).toMatchObject({ batteryStart: 30, batteryEnd: 80, chargeEnergyAddedWh: 8000 });
    expect(screen.queryByText('Source error')).not.toBeInTheDocument();
  });
});
