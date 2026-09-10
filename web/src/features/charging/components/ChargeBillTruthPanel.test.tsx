import { render, screen } from '@testing-library/react';
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
});
