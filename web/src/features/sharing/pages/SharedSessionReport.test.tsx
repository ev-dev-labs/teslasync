/**
 * SharedSessionReport — behaviour coverage.
 *
 * The report is presentational over a `SharedSessionData` prop; only the
 * unit formatters are mocked. Shared UI (GlassPanel, StatCard, charts) is
 * REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh`,
    formatPower: (w: number) => `${(w / 1000).toFixed(1)} kW`,
  }),
}));

import { SharedSessionReport } from './SharedSessionReport';
import type { SharedSessionData } from '@/types/sharing';

vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const sessionData: SharedSessionData = {
  payload_version: 'v2',
  share_type: 'charging_session',
  title: 'Baker Supercharger Stop',
  description: 'Quick top-up on the way north.',
  session: {
    date: '2026-03-15',
    duration_s: 2400,
    energy_added_wh: 45000,
    start_soc_pct: 20,
    end_soc_pct: 80,
    charger_type: 'supercharger',
    place: 'Baker, CA',
    peak_power_w: 250000,
    avg_power_w: 67500,
    cost: 9.99,
    cost_currency: 'USD',
    curve: [
      { t_s: 0, power_kw: 250, battery_pct: 20, energy_kwh: 0 },
      { t_s: 1200, power_kw: 120, battery_pct: 55, energy_kwh: 25 },
      { t_s: 2400, power_kw: 60, battery_pct: 80, energy_kwh: 45 },
    ],
  },
  vehicle: { model: 'Model 3', color: 'White' },
};

describe('SharedSessionReport', () => {
  it('renders the title, place, and stat grid', () => {
    render(<SharedSessionReport data={sessionData} />);
    expect(screen.getByText('Baker Supercharger Stop')).toBeInTheDocument();
    expect(screen.getByText('Quick top-up on the way north.')).toBeInTheDocument();
    expect(screen.getByText('Baker, CA')).toBeInTheDocument();
    expect(screen.getByText('45.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('20% → 80%')).toBeInTheDocument();
    expect(screen.getByText('250.0 kW')).toBeInTheDocument();
  });

  it('renders the vehicle badge and cost when present', () => {
    render(<SharedSessionReport data={sessionData} />);
    expect(screen.getByText('Tesla Model 3')).toBeInTheDocument();
    expect(screen.getByText('USD 9.99')).toBeInTheDocument();
  });

  it('renders the charge curve chart when points exist', () => {
    render(<SharedSessionReport data={sessionData} />);
    expect(screen.getByText('Charge Curve')).toBeInTheDocument();
  });

  it('shows the no-curve fallback when the curve was not shared', () => {
    render(
      <SharedSessionReport
        data={{ ...sessionData, session: { ...sessionData.session, curve: null, cost: null } }}
      />,
    );
    expect(
      screen.getByText('The charge curve was not included in this share.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Charge Curve')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
  });

  it('omits optional stats when the session lacks them', () => {
    render(
      <SharedSessionReport
        data={{
          ...sessionData,
          vehicle: null,
          session: {
            ...sessionData.session,
            energy_added_wh: null,
            start_soc_pct: null,
            end_soc_pct: null,
            peak_power_w: null,
          },
        }}
      />,
    );
    expect(screen.queryByText('Tesla Model 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Battery')).not.toBeInTheDocument();
    // Duration always renders.
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });
});
