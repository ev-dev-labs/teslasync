import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TcoLedgerResponse } from '@/types/analytics';

const h = vi.hoisted(() => ({
  data: undefined as TcoLedgerResponse | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useTcoLedger: () => ({
    data: h.data, isLoading: h.isLoading, isError: h.isError,
    error: h.isError ? new Error('Ledger refresh unavailable') : null,
    refetch: h.refetch,
  }),
  useAddTcoLedgerEntry: () => ({ mutate: h.add, isPending: false, isError: false }),
  useDeleteTcoLedgerEntry: () => ({ mutate: h.remove, isPending: false, isError: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const values = (typeof second === 'object' && second ? second : third) as Record<string, unknown> | undefined;
      const fallback = typeof second === 'string' ? second
        : typeof values?.defaultValue === 'string' ? values.defaultValue : key;
      return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));

import { TrueCostFixedLedger } from './TrueCostFixedLedger';

const retained: TcoLedgerResponse = {
  vehicle_id: 3,
  entries: [{
    id: 2, vehicle_id: 3, category: 'tires', amount: 800, currency: 'USD',
    incurred_on: '2026-01-10', note: 'winter set', created_at: '',
  }],
  totals: { by_category: { tires: 800 }, grand_total: 800, entries: 1 },
};

function mount() {
  return render(
    <TrueCostFixedLedger vehicleId={3} totalKm={10000} totalChargingCost={700} />,
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter> },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.data = retained;
  h.isLoading = false;
  h.isError = false;
});

describe('modernized fixed-cost ledger retained-source behavior', () => {
  it('keeps loaded rows, accounting, inputs and delete access after a refresh failure', () => {
    const view = mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '120' } });
    h.isError = true;
    view.rerender(<TrueCostFixedLedger vehicleId={3} totalKm={10000} totalChargingCost={700} />);
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(screen.getByText('All-in: $1500.00 ($0.15/km)')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(120);
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeEnabled();
    expect(screen.getByText(/most recently loaded entries remain visible/)).toBeInTheDocument();
    // Rendering a refresh failure never performs a write.
    expect(h.add).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('keeps a retained empty ledger distinct from a fatal no-data error', () => {
    h.data = { ...retained, entries: [], totals: { by_category: {}, grand_total: 0, entries: 0 } };
    h.isError = true;
    mount();
    expect(screen.getByText(/most recently loaded entries remain visible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeInTheDocument();
    expect(screen.getByText(/No fixed costs recorded/)).toBeInTheDocument();
  });

  it('retries a retained refresh error without changing rows or performing a mutation', () => {
    h.isError = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(h.add).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('does not replace retained entries with an initial-loading skeleton', () => {
    h.isLoading = true;
    mount();
    expect(screen.getByText('winter set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record cost' })).toBeInTheDocument();
  });

  it('renders a no-data fatal error inside the ledger shell without showing an empty table', () => {
    h.data = undefined;
    h.isError = true;
    mount();
    expect(screen.getByText('Fixed-cost ledger')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record cost' })).not.toBeInTheDocument();
    expect(screen.queryByText(/most recently loaded entries remain visible/)).not.toBeInTheDocument();
  });

  it('preserves record payload, note trimming and post-success input reset during retained failure', () => {
    h.isError = true;
    mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '  renewal  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record cost' }));
    expect(h.add).toHaveBeenCalledWith({
      vehicle_id: 3, category: 'insurance', amount: 120,
      incurred_on: '2026-09-30', note: 'renewal',
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    act(() => h.add.mock.calls[0][1].onSuccess());
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveValue(null);
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-30');
  });

  it('retains the explicit delete confirmation and scoped payload on refresh failure', () => {
    h.isError = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    expect(h.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(h.remove).toHaveBeenCalledWith(
      { vehicleId: 3, id: 2 }, expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
