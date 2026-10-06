/**
 * ChargingReconciliationPage — confirm-gated invoice deletion.
 *
 * Removing an invoice is destructive (reconciled lines go with it), so the
 * row Remove button must open a danger confirm dialog naming the invoice
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the table, buttons, and confirm dialog
 * render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
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

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useChargingInvoices: vi.fn(),
    useCreateDispute: vi.fn(),
    useCreateInvoice: vi.fn(),
    useDeleteInvoice: vi.fn(),
    useReconciliationReport: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useChargingInvoices,
  useCreateDispute,
  useCreateInvoice,
  useDeleteInvoice,
  useReconciliationReport,
} from '@/api/hooks/useOwnership';
import ChargingReconciliationPage from './ChargingReconciliationPage';
import type { ChargingInvoice } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockInvoices = useChargingInvoices as unknown as ReturnType<typeof vi.fn>;
const mockDispute = useCreateDispute as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateInvoice as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteInvoice as unknown as ReturnType<typeof vi.fn>;
const mockReport = useReconciliationReport as unknown as ReturnType<typeof vi.fn>;

function makeInvoice(overrides: Partial<ChargingInvoice> = {}): ChargingInvoice {
  return {
    id: 1,
    vehicle_id: 7,
    provider: 'GridCo',
    invoice_ref: 'INV-001',
    currency: 'USD',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    billed_total_minor: 1250,
    status: 'open',
    line_count: 2,
    version: 1,
    lines: [],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChargingReconciliationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given invoice ref. */
function removeButton(ref: string): HTMLElement {
  const row = screen.getByText(ref).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockInvoices.mockReturnValue(
    makeQuery({ items: [makeInvoice(), makeInvoice({ id: 2, invoice_ref: 'INV-002' })] }),
  );
  mockDispute.mockReturnValue(makeMutation());
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockReport.mockReturnValue(makeQuery(undefined));
});

describe('ChargingReconciliationPage — confirm-gated delete', () => {
  it('keeps imported statements and all audit shells visible during a register refresh error', () => {
    const refetch = vi.fn();
    mockInvoices.mockReturnValue({
      ...makeQuery({ items: [makeInvoice()] }),
      error: new Error('refresh failed'),
      isError: true,
      refetch,
    });
    renderPage();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Line-by-line audit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Variance attribution' })).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
  });

  it('keeps the import action and audit prerequisites reachable after an initial register failure', () => {
    mockInvoices.mockReturnValue({ ...makeQuery(undefined), error: new Error('initial failure') });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Provider statements' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dispute desk' })).toBeInTheDocument();
    expect(screen.getByText('Select a statement above to run the audit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not advertise checklist filters over the first server invoice page', () => {
    mockInvoices.mockReturnValue(makeQuery({
      items: [makeInvoice()],
      total: 500,
      limit: 50,
      offset: 0,
    }));
    renderPage();

    const row = screen.getByText('INV-001').closest('tr');
    const table = row?.closest('table');
    expect(table).not.toBeNull();
    expect(within(table!).queryByRole('button', { name: /^Filter / })).not.toBeInTheDocument();
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
  });

  it('opens a danger confirm naming the invoice instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('INV-001'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this invoice?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('INV-001');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('INV-002'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('INV-001'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('INV-002')).toBeDisabled();
    expect(removeButton('INV-001')).not.toBeDisabled();
  });
});
