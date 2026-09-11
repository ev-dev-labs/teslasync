/**
 * TrueCostFixedLedger — totals, add flow, delete flow.
 *
 * Ledger hooks are mocked and driven per test; GlassPanel/DataTable/
 * ConfirmDialog render for real so the wiring is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { TcoLedgerResponse } from '@/types/analytics';

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

vi.mock('@/api/hooks/useAnalytics', () => ({
  useTcoLedger: vi.fn(),
  useAddTcoLedgerEntry: vi.fn(),
  useDeleteTcoLedgerEntry: vi.fn(),
}));

import { useTcoLedger, useAddTcoLedgerEntry, useDeleteTcoLedgerEntry } from '@/api/hooks/useAnalytics';
import { TrueCostFixedLedger } from './TrueCostFixedLedger';

const mockList = useTcoLedger as unknown as ReturnType<typeof vi.fn>;
const mockAdd = useAddTcoLedgerEntry as unknown as ReturnType<typeof vi.fn>;
const mockDelete = useDeleteTcoLedgerEntry as unknown as ReturnType<typeof vi.fn>;

const ledger: TcoLedgerResponse = {
  vehicle_id: 3,
  entries: [
    { id: 1, vehicle_id: 3, category: 'insurance', amount: 500, currency: 'USD', incurred_on: '2026-01-01', note: '', created_at: '' },
    { id: 2, vehicle_id: 3, category: 'tires', amount: 800, currency: 'USD', incurred_on: '2026-01-10', note: 'winter set', created_at: '' },
  ],
  totals: { by_category: { insurance: 500, tires: 800 }, grand_total: 1300, entries: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockReturnValue({ data: ledger, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mockAdd.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  mockDelete.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
});

describe('TrueCostFixedLedger', () => {
  it('shows the all-in total combining charging and fixed costs', () => {
    render(<TrueCostFixedLedger vehicleId={3} totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText('All-in: $2000.00 ($0.20/km)')).toBeTruthy();
    expect(screen.getByText('winter set')).toBeTruthy();
  });

  it('blocks submit with an empty amount and submits once filled', () => {
    const mutate = vi.fn();
    mockAdd.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<TrueCostFixedLedger vehicleId={3} totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText('Record cost').closest('button')).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Record cost'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ vehicle_id: 3, amount: 120 });
  });

  it('deletes through the confirm dialog', () => {
    const mutate = vi.fn();
    mockDelete.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<TrueCostFixedLedger vehicleId={3} totalKm={10000} totalChargingCost={700} />);
    fireEvent.click(screen.getAllByLabelText('Delete entry')[0]);
    fireEvent.click(screen.getByText('Delete'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ vehicleId: 3, id: 1 });
  });
});
