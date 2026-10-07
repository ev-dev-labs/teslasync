/**
 * SharedSessionReport — behaviour coverage.
 *
 * The report is presentational over a `SharedSessionData` prop; only the
 * unit formatters are mocked. Shared UI (GlassPanel, OperationalBrief, charts) is
 * REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
    },
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
    const title = screen.getByRole('heading', { level: 1, name: 'Baker Supercharger Stop' });
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveAttribute('data-route-focus-target', 'true');
    expect(title.closest('header')).toHaveAttribute('data-role', 'page-header');
    expect(title.closest('header')).toHaveClass('border-0', 'rounded-none');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Baker, CA').closest('[data-action-group="context"]')).not.toBeNull();
  });

  it('renders the vehicle badge and cost when present', () => {
    render(<SharedSessionReport data={sessionData} />);
    expect(screen.getByText('Tesla Model 3')).toBeInTheDocument();
    expect(screen.getByText('USD 9.99')).toBeInTheDocument();
  });

  it('renders the charge curve chart when points exist', () => {
    render(<SharedSessionReport data={sessionData} />);
    expect(screen.getAllByRole('heading', { name: 'Charge curve' }).filter(heading => heading.hasAttribute('data-card-title'))).toHaveLength(1);
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
    expect(screen.queryByText('Charge curve')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Energy added')).not.toBeInTheDocument();
    expect(screen.queryByText('Battery')).not.toBeInTheDocument();
    // Duration always renders.
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('renders actual shared zero readings and zero cost, then removes fields the owner no longer includes', () => {
    const zeroData: SharedSessionData = {
      ...sessionData,
      session: {
        ...sessionData.session,
        energy_added_wh: 0,
        peak_power_w: 0,
        start_soc_pct: 0,
        end_soc_pct: 0,
        cost: 0,
        curve: null,
      },
    };
    const snapshot = structuredClone(zeroData);
    Object.freeze(zeroData.session);
    const view = render(<SharedSessionReport data={zeroData} />);
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0 kW')).toBeInTheDocument();
    expect(screen.getByText('0% → 0%')).toBeInTheDocument();
    expect(screen.getByText('USD 0.00')).toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(screen.getByText('The charge curve was not included in this share.')).toBeInTheDocument();

    view.rerender(<SharedSessionReport data={{
      ...zeroData,
      vehicle: null,
      session: {
        ...zeroData.session, energy_added_wh: null, peak_power_w: null,
        start_soc_pct: null, end_soc_pct: null, cost: null, place: '',
      },
    }} />);
    for (const label of ['Energy added', 'Peak power', 'Battery', 'Cost']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Baker, CA')).not.toBeInTheDocument();
    expect(screen.queryByText('Tesla Model 3')).not.toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Baker Supercharger Stop')).toBeInTheDocument();
    expect(zeroData).toEqual(snapshot);
  });

  it('opens the real shared drawer with raw source measurements, both battery endpoints and unchanged efficiency operands', () => {
    const fractional = {
      ...sessionData,
      session: { ...sessionData.session, start_soc_pct: 20.14, end_soc_pct: 80.26 },
    };
    const snapshot = structuredClone(fractional);
    Object.freeze(fractional.session);
    render(<SharedSessionReport data={fractional} />);
    const brief = screen.getByTestId('public-session-brief');
    expect(within(brief).getAllByRole('listitem')).toHaveLength(6);
    expect(within(brief).getByText('20% → 80%')).toBeInTheDocument();
    expect(within(brief).getByText('74.88 kWh/%')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Shared charging measurements details' });
    for (const raw of [
      'energy_added_wh: 45000 Wh', 'duration_s: 2400 s', 'start_soc_pct: 20.14 %',
      'end_soc_pct: 80.26 %', 'peak_power_w: 250000 W',
      'Rounded SoC change (derived): 60.1 %', 'cost: 9.99 USD',
    ]) expect(within(drawer).getByText(raw)).toBeInTheDocument();
    expect(within(drawer).getAllByText('Owner-shared charging session payload').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/Report event date: 2026-03-15/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText('74.88 kWh/%')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(fractional).toEqual(snapshot);
  });

  it('retains source currency verbatim, including zero and absent denominations, without selecting a workspace currency', () => {
    const view = render(<SharedSessionReport data={{
      ...sessionData, session: { ...sessionData.session, cost: 0, cost_currency: 'CAD' },
    }} />);
    expect(within(screen.getByTestId('public-session-brief')).getByText('CAD 0.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Shared charging measurements details' });
    expect(within(drawer).getByText('cost: 0 CAD')).toBeInTheDocument();
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    view.rerender(<SharedSessionReport data={{
      ...sessionData, session: { ...sessionData.session, cost: 0, cost_currency: null },
    }} />);
    expect(within(screen.getByTestId('public-session-brief')).getByText('0.00')).toBeInTheDocument();
    expect(screen.queryByText('CAD 0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('removes owner-withheld evidence from an already-open drawer without retaining a cached cost or curve', () => {
    const view = render(<SharedSessionReport data={sessionData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('cost: 9.99 USD');
    view.rerender(<SharedSessionReport data={{
      ...sessionData,
      vehicle: null,
      session: {
        ...sessionData.session, cost: null, energy_added_wh: null, peak_power_w: null,
        start_soc_pct: null, end_soc_pct: null, curve: null,
      },
    }} />);
    const drawer = screen.getByRole('dialog', { name: 'Shared charging measurements details' });
    expect(within(drawer).getByText('duration_s: 2400 s')).toBeInTheDocument();
    for (const raw of ['cost: 9.99 USD', 'energy_added_wh: 45000 Wh', 'peak_power_w: 250000 W']) {
      expect(within(drawer).queryByText(raw)).not.toBeInTheDocument();
    }
    expect(within(drawer).queryByText('Cost')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Efficiency')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Battery')).not.toBeInTheDocument();
    expect(screen.getByText('The charge curve was not included in this share.')).toBeInTheDocument();
    expect(screen.queryByText('Tesla Model 3')).not.toBeInTheDocument();
  });
});
