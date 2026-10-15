import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ChargingSession } from '@/api/types';
import { ChargingInsights } from './ChargingInsights';
import {
  computeAcDcBreakdown, computeStartLevelDist, computeChargeRateStats, computeChargerSpecs,
} from './helpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name)),
  }),
}));

vi.mock('./index', () => ({
  AcDcStatsPanel: ({ breakdown }: { breakdown: ReturnType<typeof computeAcDcBreakdown> }) =>
    <div>AC/DC sessions: {breakdown.ac.count + breakdown.dc.count}</div>,
  BatteryLevelChart: ({ data }: { data: ReturnType<typeof computeStartLevelDist> }) =>
    <div>Battery observations: {data.reduce((sum, bucket) => sum + bucket.count, 0)}</div>,
  ChargeRatePanel: ({ stats }: { stats: NonNullable<ReturnType<typeof computeChargeRateStats>> }) =>
    <div>Delivery observations: {stats.count}</div>,
  ChargerSpecsPanel: ({ specs }: { specs: NonNullable<ReturnType<typeof computeChargerSpecs>> }) =>
    <div>Charger brands: {specs.brand.length}</div>,
  OptimizerSection: ({ optimizer }: { optimizer: NonNullable<Props['optimizer']> }) =>
    <div>Optimizer score: {optimizer.battery_health_score}</div>,
}));

afterEach(cleanup);

type Props = ComponentProps<typeof ChargingInsights>;
const titles = [
  'Charging stats by type', 'Battery start-level distribution', 'Charging delivery rate',
  'Charger specs breakdown', 'Cost optimizer & heatmap',
];
const recovery = 'Choose a wider analysis window or complete a charging session.';

function session(id: number): ChargingSession {
  return {
    id, vehicle_id: 1,
    started_at: '2026-10-01T10:00:00Z', startedAt: '2026-10-01T10:00:00Z',
    ended_at: '2026-10-01T11:00:00Z', duration_min: 60,
    delta_soc_pct: 60, start_odometer_m: null, end_odometer_m: null,
    start_lat: null, start_lng: null, start_place: null, cost_currency: 'USD',
    start_soc_pct: 20, end_soc_pct: 80, total_energy_added_wh: 30000,
    peak_power_w: 11000, avg_power_w: 10000, cost_decimal: 5,
    charger_type: 'AC', cable_type: 'Type 2',
  };
}

function props(count: number): Props {
  const sessions = Array.from({ length: count }, (_, i) => session(i + 1));
  return {
    sessions, loading: false,
    acDcBreakdown: computeAcDcBreakdown(sessions),
    startLevelDist: computeStartLevelDist(sessions),
    chargeRateStats: computeChargeRateStats(sessions),
    chargerSpecs: computeChargerSpecs(sessions),
    optimizer: {
      battery_health_score: 85, recommendations: [], weekly_heatmap: [],
      current_schedule: {
        most_common_start_hour: 22, most_common_day: 'Monday',
        avg_sessions_per_week: 2, home_charging_pct: 50, avg_charge_to_pct: 80,
      },
      cost_analysis: {
        peak_hours: [], offpeak_hours: [], peak_cost_per_kwh: 0.3,
        offpeak_cost_per_kwh: 0.1, sessions_during_peak_pct: 20, potential_monthly_savings: 0,
      },
    },
  };
}

function region(title: string) {
  return within(screen.getByRole('region', { name: title }));
}

describe('ChargingInsights independent shells', () => {
  it('keeps all five named shells and their prerequisites when history is empty', () => {
    render(<ChargingInsights {...props(0)} optimizer={undefined} />);
    for (const title of titles) {
      expect(region(title).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(region(title).getByRole('status')).toHaveTextContent('You have 0 so far.');
      expect(region(title).getByRole('status')).toHaveTextContent(recovery);
    }
  });

  it('keeps named loading shells without falsely reporting zero sessions', () => {
    render(<ChargingInsights {...props(0)} sessions={undefined} loading optimizer={undefined} />);
    for (const title of titles) {
      expect(region(title).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(region(title).queryByRole('status')).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/You have 0/)).not.toBeInTheDocument();
  });

  it.each([4, 5, 9, 10])('preserves populated panels and exact thresholds at %i sessions', count => {
    render(<ChargingInsights {...props(count)} />);
    expect(region(titles[0]).getByText(`AC/DC sessions: ${count}`)).toBeInTheDocument();
    expect(region(titles[2]).getByText(`Delivery observations: ${count}`)).toBeInTheDocument();
    for (const title of [titles[1], titles[3]]) {
      expect(region(title).queryByRole('status') !== null).toBe(count < 5);
    }
    expect(region(titles[4]).queryByRole('status') !== null).toBe(count < 10);
    if (count >= 5) {
      expect(region(titles[1]).getByText(`Battery observations: ${count}`)).toBeInTheDocument();
      expect(region(titles[3]).getByText('Charger brands: 1')).toBeInTheDocument();
    }
    if (count >= 10) expect(region(titles[4]).getByText('Optimizer score: 85')).toBeInTheDocument();
  });

  it.each([
    { title: titles[0], missing: { acDcBreakdown: null } },
    { title: titles[1], missing: { startLevelDist: [] } },
    { title: titles[2], missing: { chargeRateStats: null } },
    { title: titles[3], missing: { chargerSpecs: null } },
    { title: titles[4], missing: { optimizer: undefined } },
  ])('shows an unknown/recovery state only for $title', ({ title, missing }) => {
    render(<ChargingInsights {...props(10)} {...missing} />);
    expect(region(title).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(region(title).getByRole('status')).toHaveTextContent(recovery);
    expect(region(title).getByRole('status')).not.toHaveTextContent('Need at least');
    for (const neighbor of titles.filter(value => value !== title)) {
      expect(region(neighbor).queryByRole('status')).not.toBeInTheDocument();
    }
  });

  it('does not mistake empty battery buckets for observed battery data', () => {
    render(<ChargingInsights {...props(10)} startLevelDist={computeStartLevelDist([])} />);
    expect(region(titles[1]).getByRole('status')).toHaveTextContent('Not enough data');
    expect(region(titles[1]).queryByText(/Battery observations/)).not.toBeInTheDocument();
  });

  it('retains available panels while missing neighbors load', () => {
    render(<ChargingInsights {...props(10)} loading chargeRateStats={null} />);
    expect(region(titles[0]).getByText('AC/DC sessions: 10')).toBeInTheDocument();
    expect(region(titles[4]).getByText('Optimizer score: 85')).toBeInTheDocument();
    expect(region(titles[2]).getByRole('heading', { name: titles[2] })).toBeInTheDocument();
    expect(region(titles[2]).queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not claim a known session count when history is unavailable', () => {
    render(<ChargingInsights {...props(0)} sessions={undefined} optimizer={undefined} />);
    for (const title of titles) {
      expect(region(title).getByRole('status')).toHaveTextContent(recovery);
      expect(region(title).getByRole('status')).not.toHaveTextContent('You have 0');
    }
  });
});
