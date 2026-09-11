/**
 * BillVarianceCard — reconciled / review / missing verdicts.
 *
 * `useBillVariance` is mocked and driven per test; <CostSection> is stubbed
 * to a faithful gate (echoes title, renders children only when data is
 * active) so assertions target this component's own derivations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { BillVarianceReport } from '@/types/charging';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
  }),
}));

vi.mock('@/api/hooks/useCharging', () => ({ useBillVariance: vi.fn() }));

vi.mock('./CostSection', () => ({
  CostSection: ({ title, children, isEmpty }: { title: string; children?: ReactNode; isEmpty?: boolean }) => (
    <section aria-label={title}>{isEmpty ? <p>empty</p> : children}</section>
  ),
}));

import { useBillVariance } from '@/api/hooks/useCharging';
import { BillVarianceCard } from './BillVarianceCard';

const mockVariance = useBillVariance as unknown as ReturnType<typeof vi.fn>;

function report(over: Partial<BillVarianceReport> = {}): BillVarianceReport {
  return {
    vehicle_id: 9,
    measured_sessions: 40,
    measured_energy_wh: 100000,
    measured_cost: 35,
    invoiced_sessions: 40,
    invoiced_energy_wh: 104000,
    invoiced_cost: 36.5,
    energy_delta_wh: 4000,
    energy_delta_pct: 4,
    cost_delta: 1.5,
    cost_delta_pct: 4.29,
    cabinet_loss_pct: 3.85,
    verdict: 'reconciled',
    explanation: 'Measured and billed DC charging agree.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVariance.mockReturnValue({ data: report(), isLoading: false, error: null, refetch: vi.fn() });
});

describe('BillVarianceCard', () => {
  it('renders the reconciled verdict with deltas and explanation', () => {
    render(<BillVarianceCard vehicleId={9} />);
    expect(screen.getByText('Reconciled')).toBeTruthy();
    expect(screen.getByText('Measured and billed DC charging agree.')).toBeTruthy();
    expect(screen.getByText('40 measured · 40 invoiced DC sessions')).toBeTruthy();
  });

  it('renders the review verdict when deltas breach tolerance', () => {
    mockVariance.mockReturnValue({
      data: report({ verdict: 'review', energy_delta_pct: 30, explanation: 'Billed energy differs.' }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<BillVarianceCard vehicleId={9} />);
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Billed energy differs.')).toBeTruthy();
  });

  it('renders the missing verdict when no invoices are on file', () => {
    mockVariance.mockReturnValue({
      data: report({ verdict: 'missing_data', invoiced_sessions: 0, explanation: 'No Tesla invoices on file.' }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<BillVarianceCard vehicleId={9} />);
    expect(screen.getByText('Missing invoices')).toBeTruthy();
  });
});
