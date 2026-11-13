import { cloneElement, type ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BatteryHealthAnalytics } from '@/types/energy';
import { formatDateShort } from '@/lib/dateFormat';
import BatteryTrendCharts from './BatteryTrendCharts';

vi.mock('@/components/motion/ambient', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion/ambient')>(),
  prefersReducedMotion: () => true,
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 640, height: 300 }),
}));

const health: BatteryHealthAnalytics = {
  vehicle_id: 7, current_soh: 95, estimated_capacity_wh: 75_000, original_capacity_wh: 80_000,
  degradation_rate_pct_per_year: 1, battery_age_months: 12, total_cycles: 100,
  avg_depth_of_discharge_pct: 40, fast_charge_pct: 20, full_charge_pct: 10,
  charge_habits_score: 80, stress_level: 'Low', temp_exposure_score: null, temp_exposure_reason: null,
  history: [
    { date: '2026-01-01', soh_pct: 98, capacity_wh: 78_000, range_m: 400_000, odometer_m: 10_000 },
    { date: '2026-02-01', soh_pct: 95, capacity_wh: 75_000, range_m: 380_000, odometer_m: 20_000 },
  ],
  prediction: {
    has_enough_data: true, slope_per_year: -1, years_to_80_pct: 15,
    predicted_date: '2041-02-01', projection_points: [{ month: '2026-03', health: 94 }],
  },
  projections: [], risk_factors: [], recommendations: [], capacity_source: 'model_estimate',
  charging_habits: {
    fast_charge_count: 2, slow_charge_count: 8, deep_discharge_count: 0,
    charge_to_full_count: 1, high_soc_count: 1, avg_energy_per_session: 20, total_count: 10,
  },
  charging_analysis: {
    charge_level_distribution: [], avg_start_soc_pct: 20, avg_end_soc_pct: 80,
    ac_session_count: 8, dc_session_count: 2, supercharger_count: 2, dc_fast_count: 0,
    deep_discharge_count: 0, ac_energy_wh: 160_000, dc_energy_wh: 40_000, total_sessions: 10,
  },
};

function mount(alert: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[alert ? '/battery?t=2026-02-01&signal=BatteryLevel' : '/battery']}>
        <BatteryTrendCharts health={health} vehicleId={7} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('battery trend native marker composition', () => {
  it('places the alert on both real time axes without losing actual, forecast, range or fallback rows', () => {
    const { container } = mount(true);
    const label = formatDateShort('2026-02-01');
    const markers = [...container.querySelectorAll('.recharts-reference-line')]
      .filter(line => line.textContent === 'Alert');
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      const chart = marker.closest('.recharts-wrapper');
      const tick = [...(chart?.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value') ?? [])]
        .find(node => node.textContent === label);
      expect(tick).toBeInTheDocument();
      const line = marker.querySelector('.recharts-reference-line-line');
      expect(line).toHaveAttribute('x1', tick?.getAttribute('x') ?? '');
      expect(line).toHaveAttribute('x2', tick?.getAttribute('x') ?? '');
    }
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-area-area')).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Capacity Trend & Prediction — data table' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(table).toHaveTextContent('98');
    expect(table).toHaveTextContent('94');
    expect(screen.getByRole('table', { name: 'Estimated Range Over Time — data table' })).toHaveTextContent('380');
  });

  it('keeps both charts and their threshold references without inventing an alert when context is absent', () => {
    const { container } = mount(false);
    expect(screen.queryByText('Alert')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-reference-line-line')).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-xAxis')).toHaveLength(2);
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });
});
