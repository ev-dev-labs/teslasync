import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MileageStats } from '@/types/analytics';
import { MileageBrief } from './MileageBrief';
import { MileageBudgetBrief } from './MileageBudgetBrief';
import { LifetimeBrief } from './LifetimeBrief';
import { FirmwareBrief } from './FirmwareBrief';
import { FleetComparisonBrief } from './FleetComparisonBrief';
import { MilestoneBrief } from './MilestoneBrief';
import { computeMileageBudget } from '../../lib/mileageBudget';
import { buildOdometerMilestones } from '../../lib/odometerMilestones';
import { analyzeFirmwareImpact } from '../../lib/firmwareImpact';
import { firmwareImpactState } from '../firmware-impact-modernization/firmwareImpactState';
import { deriveDataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';
import { LifetimeContextBrief } from './LifetimeContextBrief';
import { FleetOverviewBrief } from './FleetOverviewBrief';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { FleetAnalytics } from '@/api/types';

const preferences = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi', locale: 'en-US', precision: 2 }));
vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g,
        (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: preferences.distance, speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: preferences.precision, locale: preferences.locale,
  }, formatDistance: (raw: number) => `${(raw / 1000).toFixed(2)} km` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    precision: preferences.precision, locale: preferences.locale,
    fmtInt: (raw: number) => new Intl.NumberFormat(preferences.locale, { maximumFractionDigits: 0 }).format(raw),
    fmtNumber: (raw: number) => new Intl.NumberFormat(preferences.locale, {
      minimumFractionDigits: preferences.precision, maximumFractionDigits: preferences.precision,
    }).format(raw),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$', formatCurrency: (raw: number) => `$${raw.toFixed(2)}` }),
}));

afterEach(() => { cleanup(); preferences.distance = 'km'; });
const stats: MileageStats = {
  vehicle_id: 7, lifetime_km: 12000, last_7d_km: 210, last_30d_km: 930, last_365d_km: 9500,
  drive_count_lifetime: 500, drive_count_30d: 60, first_drive_at: null, last_drive_at: null,
};
const period = { kind: 'unknown', label: 'Configured term', reason: 'Coverage is unknown.' } as const;
const distance = (raw: number) => `${(raw / 1000).toFixed(2)} km`;
const currency = (raw: number) => `$${raw.toFixed(2)}`;
const budget = computeMileageBudget([], {
  annualAllowanceKm: 10000, termStartIso: '2026-01-01', termMonths: 12, overagePerKm: 0.2,
}, new Date('2026-07-01T12:00:00Z').getTime());
const lifetime: LifetimeStats = {
  total_drives: 0, total_distance_km: 0, total_driving_hours: 0, longest_drive_km: 0,
  highest_speed_kmh: 0, avg_efficiency_wh_km: 155, total_charge_sessions: 0, total_energy_kwh: 0,
  total_charging_hours: 0, total_charging_cost: 0, gas_equivalent_cost: 0, total_savings: 100,
  co2_offset_kg: 0, trees_equivalent: 0, earth_circumferences: 2.5, moon_trips: 0.032,
  days_on_road: 88.4, homes_equivalent_days: 12.3, first_drive_date: null, ownership_days: 0,
  most_active_day_of_week: 'Saturday', most_active_hour: 0,
  longest_drive_record: { value: 0, date: null }, highest_speed_record: { value: 0, date: null },
  max_charge_record: { value: 0, date: null }, achievements: [],
};
const emptyStatistics = { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 0 };
const fleet: FleetAnalytics = {
  period_days: 30, total_vehicles: 1, total_distance_km: 100, total_drives: 5,
  total_charging_sessions: 2, total_energy_kwh: 20, total_cost: 5, avg_efficiency_wh_km: 200,
  most_efficient_vehicle: null, vehicle_comparison: [],
  drive_analytics: { hourly_pattern: [], day_of_week: [], speed_distribution: [], distance_distribution: [],
    speed_stats: emptyStatistics, power_stats: emptyStatistics, regen_stats: emptyStatistics,
    duration_stats: emptyStatistics, distance_stats: emptyStatistics, efficiency_stats: emptyStatistics,
    daily_trend: [], temp_vs_efficiency: [], temperature: { inside: emptyStatistics, outside: emptyStatistics } },
  charging_analytics: { hourly_pattern: [], charger_types: [], charger_brands: [], monthly_trend: [],
    power_stats: emptyStatistics, duration_stats: emptyStatistics, energy_stats: emptyStatistics,
    cost_stats: emptyStatistics, start_battery_dist: [], efficiency_stats: emptyStatistics },
  battery_trend: [],
};
function FleetOverviewHarness() {
  const query = useQuery({ queryKey: ['brief-analytics-test'], queryFn: async () => fleet, initialData: fleet, enabled: false });
  return <FleetOverviewBrief query={query} scope="2026-01-01 – 2026-01-30" retained />;
}

describe('real analytics summary OperationalBrief contracts', () => {
  it('retains all six fleet summary operands, original derived estimates, and scope', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const original = JSON.stringify(fleet);
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter>
      <FleetOverviewHarness />
    </MemoryRouter></QueryClientProvider>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByText('100.00 km')).toBeInTheDocument();
    expect(screen.getByText('20.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('200.00 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('$7.75')).toBeInTheDocument();
    expect(screen.getByText('12.00 kg')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 – 2026-01-30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(JSON.stringify(fleet)).toBe(original);
    client.clear();
  });
  it('retains six mileage values, explicit mixed periods, and the real drawer', () => {
    const original = JSON.stringify(stats);
    const { container } = render(<MemoryRouter><MileageBrief stats={stats} loading={false} retained /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByText('12,000 km')).toBeInTheDocument();
    expect(screen.getByText('31.00 km')).toBeInTheDocument();
    expect(screen.getByText('11,315 km')).toBeInTheDocument();
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    expect(screen.getByText('Recorded lifetime · trailing 30-day average · annual projection · trailing 7 / 365 days'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('The last-30-day daily average multiplied by 365. This is a projection, not measured annual distance.'))
      .toBeInTheDocument();
    expect(JSON.stringify(stats)).toBe(original);
  });
  it('reconverts mileage using saved distance preferences', () => {
    preferences.distance = 'mi';
    render(<MemoryRouter><MileageBrief stats={stats} loading={false} retained={false} /></MemoryRouter>);
    expect(screen.getByText('7,456 mi')).toBeInTheDocument();
  });
  it('distinguishes missing lifetime inputs from measured zero and allows recovery', () => {
    const retry = vi.fn();
    const { container } = render(<MemoryRouter><LifetimeBrief stats={undefined} loading={false}
      fatalError error={new Error('failed')} onRetry={retry} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(container.querySelector('[data-value-state="value"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('keeps loading geometry without assigning measured values to absent sources', () => {
    const { container } = render(<MemoryRouter><MileageBrief stats={undefined} loading retained={false} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
  });
  it('retains a budget zero and exposes capped projections as unavailable', () => {
    const source = deriveDataState<Drive[]>({ data: [], isError: true, error: new Error('refresh failed') });
    const { container } = render(<MemoryRouter><MileageBudgetBrief budget={{ ...budget, historyCapReached: true }}
      source={source} period={period} formatDistance={distance} formatCurrency={currency} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="budget-used"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(screen.getByText('0.00 km')).toBeInTheDocument();
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('At least this much is present; older term drives may be absent')).toBeInTheDocument();
  });
  it('preserves four firmware quantities and the thin-history limitation', () => {
    const summary = analyzeFirmwareImpact([], []);
    const state = firmwareImpactState({ data: [] }, { data: [] });
    const { container } = render(<MemoryRouter><FirmwareBrief summary={summary} best={null} worst={null}
      state={state} onRetry={vi.fn()} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('p < 0.05 with a non-trivial effect')).toBeInTheDocument();
  });
  it('retains each numeric A/B operand and the original paired caption', () => {
    const { container } = render(<MemoryRouter><FleetComparisonBrief nameA="Vehicle A" nameB="Vehicle B" items={[
      { id: 'battery', label: 'Battery', metricId: 'percent', rawA: 0, rawB: undefined,
        value: '0% vs —', loading: false, format: raw => `${raw}%` },
    ]} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="battery-a"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="battery-b"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getAllByText('0% vs —')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Battery · Vehicle A')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Battery · Vehicle B')).toBeInTheDocument();
  });
  it('keeps calibration, supported pace, ETA reasons, and browse action', () => {
    const summary = buildOdometerMilestones([], { baseOdometerKm: 1000, nowMs: Date.now(), milestoneUnitKm: 1, historyLimit: 1000 });
    const { container } = render(<MemoryRouter><MilestoneBrief summary={summary} isLoading={false}
      error={null} onRetry={vi.fn()} retained /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getByText('Bounded observations and calibration; lifetime completeness is unknown.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Unavailable without supported 90-day evidence')).toBeInTheDocument();
  });
  it.each([
    ['funfacts', 4], ['environment', 3], ['activity', 4],
  ] as const)('keeps the complete %s lifetime band and rich details', (mode, count) => {
    const { container } = render(<MemoryRouter><LifetimeContextBrief mode={mode} stats={lifetime}
      loading={false} error={new Error('refresh failed')} onRetry={vi.fn()} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(count);
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(count);
    if (mode === 'funfacts') expect(screen.getByText('250.00%')).toBeInTheDocument();
    if (mode === 'activity') {
      expect(screen.getByText('0:00')).toBeInTheDocument();
      expect(screen.getByText('88.40')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'More info about Avg efficiency' })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    if (mode === 'funfacts') {
      const details = within(screen.getByRole('dialog'));
      expect(details.getByText('250.00%')).toBeInTheDocument();
      expect(details.getByText('3.20%')).toBeInTheDocument();
      expect(details.getByText('All time')).toBeInTheDocument();
      expect(details.getAllByText('Percentage input is already on the 0–100 scale.')).toHaveLength(2);
    }
    if (mode === 'activity') expect(within(screen.getByRole('dialog'))
      .getByText('Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.'))
      .toBeInTheDocument();
  });
  it('keeps fractional tree-equivalent source values valid with the original integer display', () => {
    const { container } = render(<MemoryRouter><LifetimeContextBrief mode="funfacts"
      stats={{ ...lifetime, trees_equivalent: 2.5 }} loading={false} error={null} onRetry={vi.fn()} /></MemoryRouter>);
    const trees = container.querySelector('[data-operational-metric="lifetime-fun-trees"]');
    expect(trees).toHaveAttribute('data-value-state', 'value');
    expect(trees?.querySelector('[data-operational-value]')).toHaveTextContent('3');
  });
});
