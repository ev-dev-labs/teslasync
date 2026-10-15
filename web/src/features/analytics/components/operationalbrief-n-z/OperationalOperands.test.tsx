import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display';
import { StatisticsPeriodBrief } from './StatisticsPeriodBrief';
import { YearEnvironmentBrief } from './YearEnvironmentBrief';
import { YearPatternsBrief } from './YearPatternsBrief';
import type { YearReview } from '@/api/types';
import type { StatPeriod } from '@/lib/metric-reference';
import { DigestOperationalSummary } from './DigestOperationalSummary';
import type { DigestMetrics } from '../weekly-digest/types';

const bridgeCapture = vi.hoisted(() => vi.fn<(metrics: readonly StatMetric[]) => void>());
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
    bridgeCapture(args[0]);
    return actual.useOperationalMetrics(...args);
  } };
});
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallback === 'object' ? fallback : options;
      const text = typeof fallback === 'string' ? fallback : String(values?.defaultValue ?? key);
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const period: StatPeriod = { kind: 'event', label: '2023', eventId: 'year-review:2023',
  start: '2023-01-01', end: '2023-12-31', provenance: 'Year in review' };
function year(overrides: Partial<YearReview>): YearReview {
  return {
    year: 2023, vehicle: { id: 7, display_name: 'Test vehicle', model: 'Model 3' },
    total_drives: 42, total_distance_km: 500, total_energy_kwh: 100,
    total_charge_sessions: 6, total_driving_minutes: 720, total_charging_cost: 250,
    gas_savings: 50, co2_offset_kg: 50,
    longest_drive: null, shortest_drive: null, most_efficient_drive: null, least_efficient_drive: null,
    fastest_speed_kmh: 100, coldest_drive_temp_c: 0, hottest_drive_temp_c: 30,
    monthly_stats: [], most_active_day_of_week: 'Tuesday', most_active_hour: 0,
    avg_drives_per_week: 3.5, avg_distance_per_drive_km: 12.34, avg_efficiency_wh_km: 160.25,
    supercharger_pct: 25, dc_fast_pct: 25, ac_other_pct: 50, avg_charge_start_soc: 20,
    comparisons: [], ...overrides,
  };
}
const digest: DigestMetrics = {
  totalDistanceM: 120000, prevDistanceM: 60000, totalDrives: 12, prevDriveCount: 6,
  energyUsedWh: 18000, prevEnergyWh: 9000, chargingCost: 36, prevChargingCost: 18,
  co2Saved: 24, prevCo2: 12, avgEfficiencyWhPerM: 0.15, prevAvgEfficiencyWhPerM: 0.15,
  totalDurationS: 7200, topDrive: undefined, chargeEnergyAddedWh: 20000, prevChargeEnergyWh: 10000,
  avgChargePowerW: 7000, chargingSessionCount: 3, batteryStart: 20, batteryEnd: 80,
  alertsByType: {}, alertTotal: 0,
};

function show(content: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{content}</MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => { bridgeCapture.mockClear(); });

describe('analytics operational raw operands', () => {
  it('keeps independent retained driving evidence when charging is unavailable rather than reporting its fallback zero', () => {
    show(<DigestOperationalSummary metrics={digest} period={period} isError error={new Error('charging unavailable')}
      driveAvailable chargingAvailable={false} onRetry={vi.fn()} />);
    const metrics = bridgeCapture.mock.lastCall?.[0];
    expect(metrics?.find(metric => metric.occurrenceId === 'weekly-distance')).toMatchObject({ metricId: 'distance', rawValue: 120000 });
    expect(metrics?.find(metric => metric.occurrenceId === 'weekly-cost')?.rawValue).toBeNull();
    const brief = screen.getByTestId('weekly-digest-summary');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
    expect(within(brief).getByText('Retained or partial weekly records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retains source kilometres, kWh, Wh/km and the kilometre cost denominator through canonical raw types', () => {
    show(<StatisticsPeriodBrief stats={{ total_distance: 500, total_drives: 42, energy_used: 100,
      avg_efficiency: 160, total_cost: 250, co2_saved: 50 }}
      loading={false} error={null} onRetry={vi.fn()}
      fromKm={value => value} whPerKmToDisplay={value => value} distanceUnit="km" efficiencyUnit="Wh/km" />);
    const metrics = bridgeCapture.mock.calls.flatMap(call => call[0]);
    expect(metrics.find(metric => metric.occurrenceId === 'statistics-total-distance')).toMatchObject({
      metricId: 'distance', rawValue: 500000,
    });
    expect(metrics.find(metric => metric.occurrenceId === 'statistics-total-energy')).toMatchObject({
      metricId: 'energy', rawValue: 100000,
    });
    expect(metrics.find(metric => metric.occurrenceId === 'statistics-average-efficiency')).toMatchObject({
      metricId: 'efficiency', rawValue: 0.16,
    });
    expect(metrics.find(metric => metric.occurrenceId === 'statistics-cost-per-km')).toMatchObject({
      metricId: 'rate', rawValue: 0.5,
    });
    expect(metrics.find(metric => metric.occurrenceId === 'statistics-co2')).toMatchObject({
      metricId: 'mass', rawValue: 50,
    });
  });

  it('does not fabricate zero totals or valid averages from an unavailable period source', () => {
    show(<StatisticsPeriodBrief loading={false} error={new Error('Unavailable')} onRetry={vi.fn()}
      fromKm={value => value} whPerKmToDisplay={value => value} distanceUnit="km" efficiencyUnit="Wh/km" />);
    for (const metric of bridgeCapture.mock.calls.flatMap(call => call[0])) expect(metric.rawValue).toBeNull();
    expect(screen.getByTestId('statistics-totals-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
    expect(screen.getByTestId('statistics-averages-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps year mass and the tree estimate distinct with real drawer context and specialist integer rounding', () => {
    show(<YearEnvironmentBrief data={year({ co2_offset_kg: 840.25 })} period={period} />);
    expect(bridgeCapture.mock.lastCall?.[0][0]).toMatchObject({ metricId: 'mass', rawValue: 840.25 });
    const brief = screen.getByTestId('year-review-environment-brief');
    expect(within(brief).getByText('840 kg')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Like planting 40 trees')).toBeInTheDocument();
  });

  it('retains fractional weekly drive rates as rates, and canonical per-drive distance and efficiency operands', () => {
    show(<YearPatternsBrief data={year({})} period={period} />);
    const metrics = bridgeCapture.mock.lastCall?.[0];
    expect(metrics?.[0]).toMatchObject({ metricId: 'rate', rawValue: 3.5 });
    expect(metrics?.[1]).toMatchObject({ metricId: 'distance', rawValue: 12340 });
    expect(metrics?.[2]).toMatchObject({ metricId: 'efficiency', rawValue: 0.16025 });
  });
});
