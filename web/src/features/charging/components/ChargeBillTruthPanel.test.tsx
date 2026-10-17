import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChargingSession } from '@/api/types';
import { ChargeBillTruthPanel } from './ChargeBillTruthPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { energy: 'kWh' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

function session(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: '254',
    vehicle_id: '1',
    charger_type: 'Supercharger',
    start_soc_pct: 19,
    end_soc_pct: 79,
    total_energy_added_wh: 42_620,
    peak_power_w: 197_000,
    cost_decimal: 20.88,
    started_at: '2026-09-05T18:00:00Z',
    start_ts: '2026-09-05T18:00:00Z',
    startedAt: '2026-09-05T18:00:00Z',
    duration_min: 28,
    billed_energy_wh: 44_490.6,
    billed_cost_decimal: 21.80,
    billed_currency: 'USD',
    billed_rate_per_kwh: 0.49,
    billed_source: 'tesla_charging_history',
    billed_site: 'Hayward, CA',
    ...overrides,
  };
}

describe('ChargeBillTruthPanel', () => {
  it('shows billed vs pack and the cabinet explanation', () => {
    render(<ChargeBillTruthPanel session={session()} />);
    expect(screen.getByTestId('charge-bill-truth')).toBeInTheDocument();
    expect(screen.getByText('Bill vs pack')).toBeInTheDocument();
    expect(screen.getByText('Hayward, CA')).toBeInTheDocument();
    expect(screen.getByText(/Tesla bills cabinet/)).toBeInTheDocument();
  });
  it('retains actual invoice denomination and signed cabinet/pack differences in real readings and the drawer', () => {
    const { container } = render(<ChargeBillTruthPanel session={session({
      billed_energy_wh: 40_000, billed_cost_decimal: 22, billed_rate_per_kwh: 0.5,
      billed_currency: 'EUR',
    })} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="delta"] [data-operational-value]'))
      .toHaveTextContent('-2.62 kWh');
    expect(container.querySelector('[data-operational-metric="fees"] [data-operational-value]'))
      .toHaveTextContent('EUR2.00');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText(/invoices meter energy at the cabinet/).length)
      .toBeGreaterThan(0);
  });
  it('does not turn an absent invoice into a zero bill or drop the measured pack reading', () => {
    const { container } = render(<ChargeBillTruthPanel session={session({
      billed_energy_wh: null, billed_cost_decimal: null, billed_rate_per_kwh: null,
    })} />);
    expect(container.querySelector('[data-operational-metric="billed"]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="pack"] [data-operational-value]'))
      .toHaveTextContent('42.62 kWh');
    expect(screen.getByText(/Pack energy is measured; the bill is missing/)).toBeInTheDocument();
  });
});
